import {commands,SymbolKind,Range} from 'vscode';
import {DOMParser} from 'linkedom';
import {rangeToIdentifier,identifierToRange, accessors, isField, hasFields} from './helperFunctions';
import type {DocumentSymbol,Uri, TextDocument} from 'vscode';
import type {HTMLElement,HTMLDivElement} from 'linkedom';
import type {TokenCollection, TokenData} from './rangesByName';
import type {TokenKind} from './helperFunctions';
import type {MatchPair, ParsedSelector} from './chssParser';

type SymbolData = {tk:TokenData,sy:DocumentSymbol,tp:TokenKind};
/**
 * Sorts symbols by comparing their ranges.
 * @param a - a symbol
 * @param b - another symbol
 */
const symbolSort = (a:{range:Range},b:{range:Range}) => a.range.start.compareTo(b.range.start);

/**
 * Using this function we can pretend that a token is actually a DocumentSymbol.
 * @param token - The token to convert 
 */
const tokenToSymbol = ({range,name}:TokenData):DocumentSymbol => ({range,children:[],selectionRange:range,name,detail:'generated',kind:SymbolKind.Variable});

/**
 * Uses either semantic token or symbol information to get the type of a node.
 * @param sym - A documentSymbol
 * @param token - A semantic token associated with the symbol.
 */
const getNodeType = (sym:DocumentSymbol,token?:TokenData) => (token?.type??SymbolKind[sym.kind].toLowerCase()) as TokenKind;


const convertModifier = (m:string,grouped:boolean) => (
  //"none" excludes any other modifiers, so if it paired with anything, we prevent the selector from matching at all.
  m === 'none'?grouped?':not(*)':
  //How do we match "no modifiers"? By excluding all class attributes with spaces, which means there's only a type class.
  ':not([class*=" "])':
  //Regular modifiers are regular multi class selectors.
  `.${m}`);


const isPseudoClass = (m:string) => m === 'empty' || m.includes('-')|| m.includes('(');

export class DomSimulator{

  static async init(target:Uri,tokens:TokenCollection, text:TextDocument){
    const syms = await commands.executeCommand('vscode.executeDocumentSymbolProvider',target);
    if (!syms) return;
    return new DomSimulator(syms as DocumentSymbol[],tokens,target,text);
  }

  private constructor(
    symbols:DocumentSymbol[],
    {all,byOffset}:TokenCollection,
    public readonly uri:Uri,
    readonly stringContent:TextDocument,
    readonly lang = stringContent.languageId,
    /**A LinkeDOM document that we use to recreate our document structure */
    private readonly document = (new DOMParser()).parseFromString('<html><head></head><body></body></html>', 'text/html'),
    private readonly queryMap = new Map<string,MatchPair>()
  ){
    const tokenIndex = new Set<number>();
    const collapsable = new Set<TokenKind>(['variable','constant']);
    const processedRanges = new Map<string,[HTMLDivElement,Range]>();
    const allTokens = new Set(all);
    const currentAccessors = accessors.get(lang);
    /**
     * Sorting the child Elements of a DOM node into the same order the tokens were in the document.
     * @param node - The parent element
     */
    const sortChildren = (node:HTMLElement) => {
      for (const c of node.children.sort((a:HTMLDivElement,b:HTMLDivElement) => processedRanges.get(a.getAttribute('data-namerange'))![1].start.compareTo(processedRanges.get(b.getAttribute('data-namerange'))![1].start))) node.appendChild(c);
    };

    const encodeNode = (sym:DocumentSymbol,parent:HTMLElement,tokenData?:TokenData,manualType?:TokenKind,top=false) => {
      /** We don't care about abstract unnamed constructs like blocks or conditions, we encode their children as children of their parent symbols */
      const noNest = new Set(['package','keyword','other']);
      const fullRange = sym.range;
      //Anonymous functions have their entire body declared as selectionRange, which we don't want. So we reduce it to an zero length range.
      const range = !sym.selectionRange.isSingleLine || sym.name.length !== sym.selectionRange.end.character - sym.selectionRange.start.character?new Range(fullRange.start,fullRange.start):sym.selectionRange;
      const rangeIdent = rangeToIdentifier(range);
      if (processedRanges.has(rangeIdent)) return;
      const rangeIdentFull = rangeToIdentifier(fullRange);
      const nodeOffset = stringContent.offsetAt(range.start);
      const semant = tokenData ?? byOffset.get(nodeOffset);
      const nodeType = manualType ?? getNodeType(sym,semant);
      if (noNest.has(nodeType)) for (const cc of sym.children.sort(symbolSort)) encodeNode(cc,parent);
      else {
        //In this section we encode all information we have on the token onto an HTML element, we can query via CSS later.
        const current = parent.appendChild(document.createElement(`code-${nodeType}`)) as HTMLDivElement;
        processedRanges.set(rangeIdent,[current,range]);
        current.id = `o${semant?.offset ?? nodeOffset}`;
        current.setAttribute('data-namerange', rangeIdent);
        current.setAttribute('data-fullrange', rangeIdentFull);
        current.setAttribute('data-name', sym.name);
        current.className=semant?[nodeType, ...semant.modifiers].join(' '):nodeType;
        //
        for (const c of sym.children.sort(symbolSort)) encodeNode(c,current);
        if (semant) tokenIndex.add(semant.index);
        const tokenSymbols = new Set<SymbolData>();
        /**This keeps track of the current parent node while nesting properties */
        let currentParent:SymbolData|undefined;
        // The tree of DocumentSymbols actually only tracks declarations of symbols. We fill in the rest from our token list.
        for (const token of allTokens.keys().drop(semant?.index??0).take(allTokens.size)) {
          //We skip all tokens that are not inside the current symbol.
          if (!top && fullRange.start.isAfterOrEqual(token.range.end)) continue;
          // We abort once we find the first token outside the symbol.
          if (!top && (sym.children.length || !collapsable.has(nodeType)?fullRange:range).end.isBeforeOrEqual(token.range.start)) break;
          // If we've already indexed a token it means that a child node has already included the token as a child of its own.
          if (tokenIndex.has(token.index)) continue;
          const sy = tokenToSymbol(token);
          const sData:SymbolData = {tk:token,sy,tp:getNodeType(sy,token)};
          //If the current token could be a child node of the current parent we add it to its list of children.
          if (currentParent && isField.has(sData.tp) && hasFields.has(currentParent.tp) && currentAccessors?.has(stringContent.getText(new Range(currentParent.tk.range.end,sData.tk.range.start)).trim())){
            currentParent.sy.children.push(sData.sy);
          } else tokenSymbols.add(sData);
          //If the current *could* have children, we designate it as the current parent node.
          currentParent = hasFields.has(sData.tp)? sData:undefined;
          //Deleting the token to prevent processing it multiple times.
          allTokens.delete(token);
        }
        //Finally encoding all tokens that are not part of our child symbols
        for (const {tk,sy,tp} of tokenSymbols) encodeNode(sy,current,tk,tp);
        //correcting the order, so that the child nodes we encoded earlier aren't pushed to the top.
        sortChildren(current);
      }
    };
    for (const e of symbols.sort(symbolSort)) encodeNode(e,document.body as any as HTMLElement);
    // Iterating again, for all unprocessed top level tokens.
    for (const a of all) encodeNode(tokenToSymbol(a),document.body,a,undefined,true);
    sortChildren(document.body);
  }

  /**
   * This method converts the selection objects parsed from our "fake" CSS to real CSS. The cycle is complete.  
   * This will for example convert  `DecorationManager:declaration:not(line) > [method/function]`  
   * to:`div[data-name="DecorationManager" i].declaration:not(#o7126,#o7424,#o7790,#o7804) >.declaration.method, div[data-name="DecorationManager" i].declaration:not(#o7126,#o7424,#o7790,#o7804) >.declaration.function`
   * @param selector - The Selector to parse 
   * @param prevSelectors - Parsed previous selectors that the current selector needs to be appended to.
   * @param regexOffsets - An array of offsets to limit the match to specific elements determined by regex.
   * @param notRanges - An array of offsets to include elemens from the match based on :not() selectors
   * @param caseInsensitive - If true matches names case insensitively.
   */
  public selectorToCSS({match,name,type,modifiers,combinator,regexp}:ParsedSelector,prevSelectors=[''],regexOffsets?:number[],notRanges?:number[],caseInsensitive=false){
    if (regexp && !regexOffsets?.length) return ['#invalid'];
    /**For making attribute selectors case insensitive */
    const pseudoClasses = [] as string[];
    const modifierAlterations = [] as string[][];
    const modifierClasses = [] as string[];
    for (const mods of modifiers) {
      for (let index = mods.findIndex(isPseudoClass); index !==-1; index = mods.findIndex(isPseudoClass)) pseudoClasses.push(mods.splice(index)[0]);
      if (!mods.length) continue;
      if (mods.length === 1) modifierClasses.push(mods[0]);
      else modifierAlterations.push(mods);
    }
    const flag = caseInsensitive?' i':'';
    /**Filtering out the star selector to simplify things.*/
    const finalTypes = type.filter(f => f!=='*');
    let selectorStrings = prevSelectors;
    //Type selectors work the same as modifiers, without the complication of "none".
    if (finalTypes.length) selectorStrings = finalTypes.flatMap(t => selectorStrings.map(s => `${s}code-${t}`));
    //We resolve :not() matches separately into offset based IDs and exclude them.
    //The reason is that they can most likely be resolved with tokens, which is cheaper than exponentially expanding this selector.
    //CSS can't handle complex regex matches, so we resolve them on a token basis,
    //parse the offsets to IDs and restrict our selection to them using a snazzy double negation.
    if (match === 'match' && regexOffsets?.length)selectorStrings = selectorStrings.map(s => `${s}:not(:not(${regexOffsets.map(n => `#o${n}`).join(',')}))`);
    //If CSS is capable of matching a value, we use an attribute selector.
    else if (match && match !== 'match') selectorStrings = selectorStrings.map(s => `${s}[data-name${match === 'includes'?'*':match === 'startsWith'?'^':'$'}="${name}"${flag}]`);
    else if (name && name !== '*') selectorStrings = selectorStrings.map(s => `${s}[data-name="${name}"${flag}]`);
    //Modifiers and types are classes, so we chain them with `.`
    //Because there can be multiple of each, we flatMap into multiple alterations, expanding like SCSS.
    if (modifierClasses.length) selectorStrings = selectorStrings.map(s => `${s}${modifierClasses.map(m => convertModifier(m, modifierClasses.length!==1)).join('')}`);
    if (modifierAlterations.length) {selectorStrings = modifierAlterations.map(
      a => a.map(m => selectorStrings.map(s => `${s}${convertModifier(m, false)}`))
    ).flat(2);}
    //Type selectors work the same as modifiers, without the complication of "none".
    if (pseudoClasses.length) selectorStrings = selectorStrings.map(s => `${s}:${pseudoClasses.join(':')}`);
    //We resolve :not() matches separately into offset based IDs and exclude them.
    //The reason is that they can most likely be resolved with tokens, which is cheaper than exponentially expanding this selector.
    if (notRanges?.length) selectorStrings = selectorStrings.map(s => `${s}:not(${notRanges.map(n => `#o${n}`).join(',')})`);
    //Now we check if we initially had a star selector. We can't actually use * at the end, so instead we match a property that we know all elements have.
    else if (finalTypes.length !== type.length && !name)selectorStrings = selectorStrings.map(s => `${s}[data-fullrange]`);
    if (combinator && combinator !== ',') selectorStrings = selectorStrings.map(s => `${s} ${combinator} `);
    return selectorStrings;
  }


  public matchesFromCSS(selector:string,full=false):MatchPair{
    //The neat thing about re-creating the DOM at every edit is that we know that the matched elements can't change during one "session".
    if (this.queryMap.has(selector)) return this.queryMap.get(selector)!;
    //Offsets are always the same, but we can either get the range of the full "body" of a symbol or just the range of the name.
    try {return ((pair = this.document.querySelectorAll(selector).reduce<MatchPair>((p,c:HTMLDivElement) => (p[0].push(identifierToRange(c.getAttribute(full?'data-fullrange':'data-namerange'))),p[1].push(parseInt(c.id.slice(1),10)),p),[[],[]])) => (this.queryMap.set(selector, pair),pair))();}
    catch {return [[],[]];}
  }

  /** HTML output for the debug view.*/
  public getHtml(){
    return /*html*/`
      <!DOCTYPE html> <html><head> <style> html,body{background:white; width:100%; text-align:center; padding: 1em 0; font-size:0.95em } [data-namerange] {border-radius:.3em; margin: .5em; padding: .2em; width: 90%; border:.15em solid rgba(0, 0, 0, 0.150); background: rgba(0, 0, 0, 0.050); min-height: 1em; display:inline-block; color:#a52634; text-align:center; position:relative } [data-namerange]::after{content: "[" attr(class) "]"; display:block; position:absolute; top: .2em; left:.2em} [data-namerange]::before { display: block; font-weight: bold; content: attr(data-name); } </style> </head> <body> ${this.document.body.innerHTML} </body> </html>
    `;
  }

}