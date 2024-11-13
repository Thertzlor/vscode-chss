import * as vscode from 'vscode';
import {hasFields, mightMissProps, rangeToIdentifier} from './helperFunctions';
import type {SymbolToken} from './helperFunctions';
import {Range} from 'vscode';
// import { tokenKinds } from '../configuration';

/**
 * Tokens in a file are represented as an array of integers. The position of each token is expressed relative to
 * the token before it, because most tokens remain stable relative to each other when edits are made in a file.
 *
 * ---
 * In short, each token takes 5 integers to represent, so a specific token `i` in the file consists of the following array indices:
 *  - at index `5*i`   - `deltaLine`: token line number, relative to the previous token
 *  - at index `5*i+1` - `deltaStart`: token start character, relative to the previous token (relative to 0 or the previous token's start if they are on the same line)
 *  - at index `5*i+2` - `length`: the length of the token. A token cannot be multiline.
 *  - at index `5*i+3` - `tokenType`: will be looked up in `SemanticTokensLegend.tokenTypes`. We currently ask that `tokenType` \< 65536.
 *  - at index `5*i+4` - `tokenModifiers`: each set bit will be looked up in `SemanticTokensLegend.tokenModifiers`
 *
 * ---
 * ### How to encode tokens
 *
 * Here is an example for encoding a file with 3 tokens in a uint32 array:
 * ```
 *    { line: 2, startChar:  5, length: 3, tokenType: "property",  tokenModifiers: ["private", "static"] },
 *    { line: 2, startChar: 10, length: 4, tokenType: "type",      tokenModifiers: [] },
 *    { line: 5, startChar:  2, length: 7, tokenType: "class",     tokenModifiers: [] }
 * ```
 *
 * 1. First of all, a legend must be devised. This legend must be provided up-front and capture all possible token types.
 * For this example, we will choose the following legend which must be passed in when registering the provider:
 * ```
 *    tokenTypes: ['property', 'type', 'class'],
 *    tokenModifiers: ['private', 'static']
 * ```
 *
 * 2. The first transformation step is to encode `tokenType` and `tokenModifiers` as integers using the legend. Token types are looked
 * up by index, so a `tokenType` value of `1` means `tokenTypes[1]`. Multiple token modifiers can be set by using bit flags,
 * so a `tokenModifier` value of `3` is first viewed as binary `0b00000011`, which means `[tokenModifiers[0], tokenModifiers[1]]` because
 * bits 0 and 1 are set. Using this legend, the tokens now are:
 * ```
 *    { line: 2, startChar:  5, length: 3, tokenType: 0, tokenModifiers: 3 },
 *    { line: 2, startChar: 10, length: 4, tokenType: 1, tokenModifiers: 0 },
 *    { line: 5, startChar:  2, length: 7, tokenType: 2, tokenModifiers: 0 }
 * ```
 *
 * 3. The next step is to represent each token relative to the previous token in the file. In this case, the second token
 * is on the same line as the first token, so the `startChar` of the second token is made relative to the `startChar`
 * of the first token, so it will be `10 - 5`. The third token is on a different line than the second token, so the
 * `startChar` of the third token will not be altered:
 * ```
 *    { deltaLine: 2, deltaStartChar: 5, length: 3, tokenType: 0, tokenModifiers: 3 },
 *    { deltaLine: 0, deltaStartChar: 5, length: 4, tokenType: 1, tokenModifiers: 0 },
 *    { deltaLine: 3, deltaStartChar: 2, length: 7, tokenType: 2, tokenModifiers: 0 }
 * ```
 *
 * 4. Finally, the last step is to inline each of the 5 fields for a token in a single array, which is a memory friendly representation:
 * ```
 *    // 1st token,  2nd token,  3rd token
 *    [  2,5,3,0,3,  0,5,4,1,0,  3,2,7,2,0 ]
 * ```
 *
 * @see [SemanticTokensBuilder](#SemanticTokensBuilder) for a helper to encode tokens as integers.
 * *NOTE*: When doing edits, it is possible that multiple edits occur until VS Code decides to invoke the semantic tokens provider.
 * *NOTE*: If the provider cannot temporarily compute semantic tokens, it can indicate this by throwing an error with the message 'Busy'.
 */
export type TokenData = {name:string,range:vscode.Range,modifiers:string[],type:string,index:number, offset:number};
export type TokenCollection = {byType:Map<string,Set<TokenData>>, byRange:Map<string,TokenData|undefined>,all:Set<TokenData>};
export function rangesByName(data:vscode.SemanticTokens, legend:vscode.SemanticTokensLegend, editor:vscode.TextEditor) {
  const collection:TokenCollection= {byRange:new Map(),all:new Set(),byType:new Map()};
  const doc = editor.document;
  const fullText = doc.getText();
  let index = 0;

  /**
   * Adding a token to all our collections
   * @param t -The token to add
   */
  const addToken = (t:TokenData) => {
    if (!collection.byType.has(t.type))collection.byType.set(t.type,new Set());
    collection.all.add(t);
    collection.byRange.set(rangeToIdentifier(t.range),t);
    collection.byType.get(t.type)!.add(t);
    index++;
  };

  /**
   * Funny story: In JS and TS, if a key name of a type isn't specified explicitly (as in `Record<string,any>`),
   * VSCode actually doesn't create a semantic token for it. These general properties are only highlighted via TextMate.  
   * But that means we can't (natively) style them, so as a workaround we attempt to parse the space between tokens for
   * potential missing properties and adding them "manually".
   * @param offset -
   * @param idx -
   * @param tok -
   */
  const generateMissingProperties = (offset?:number,idx?:number,tok?:TokenData) => {
    if (!collection.all.size || !mightMissProps.has(doc.languageId)) return;
    const lasToken = tok ?? collection.all.values().drop((idx??collection.all.size)-1).next().value;
    if (!lasToken || lasToken.modifiers.includes('declaration') || !hasFields.has(lasToken.type.toLowerCase() as SymbolToken)) return;
    const currentOffset = offset??fullText.length;
    if (currentOffset-lasToken.offset < 3) return;
    const propertyRegex = {
      javascript:/^(\s*\??\.\s*)(\w+\(?)/,
      typescript:/^(\s*?[!?]?\.\s*?)(\w+\(?)/
    }[doc.languageId];
    if (!propertyRegex) return;
    const newStart = lasToken.offset+lasToken.name.length;
    const between = fullText.slice(newStart,currentOffset);
    const propMatch = propertyRegex.exec(between);
    if (!propMatch) return;
    const start = newStart+propMatch[1].length;
    const word = propMatch[2];
    if (!word.length || word.trim().length !== word.length) return;
    const isMethod = word.endsWith('(');
    const end = start + word.length -(isMethod?1:0);
    const token:TokenData = {index:idx ?? collection.all.size,modifiers:[],name:word.slice(0,isMethod?-1:undefined),type:isMethod?'method':'property',offset:start, range:new Range(doc.positionAt(start),doc.positionAt(end))
    };
    addToken(token);
    //If we found a token which could have further missing properties, we call the function with the same offset until we have them all.
    if (hasFields.has(token.type.toLowerCase() as any)) generateMissingProperties(offset,idx,token);
  };

  const recordSize = 5;
  let line = 0;
  let column = 0;

  for (let i = 0; i < data.data.length; i += recordSize) {
    const [deltaLine, deltaColumn, length, kindIndex, modifierIndex] = data.data.slice(i, i + recordSize);
    const kind = legend.tokenTypes[kindIndex];

    column = deltaLine === 0 ? column : 0;
    line += deltaLine;
    column += deltaColumn;
		// if (!all && (!tokenKinds.has(kind))) continue;
    const modifierFlags = ['none', ...legend.tokenModifiers].reduce((a:Record<string,number>,c,n) => (a[c]=(n-1>=2?2 << (n-2):n),a),{});
    const modifiers = legend.tokenModifiers.filter(m => modifierIndex & modifierFlags[m]);
    const range = new vscode.Range(line, column, line, column + length);
    const name = doc.getText(range);
    const offset=doc.offsetAt(range.start);
    //Looking for missing property token between this token and the previous.
    generateMissingProperties(offset,index);
    addToken({range, name, modifiers, type: kind,index, offset});
  }
  //This generates missing properties after the last token.
  generateMissingProperties();
  return collection;
}
