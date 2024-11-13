import {commands,SymbolKind,Range} from 'vscode';
import {DOMParser} from 'linkedom';
import {rangeToIdentifier,identifierToRange, accessors, isField, hasFields} from './helperFunctions';
import type {DocumentSymbol,Uri, TextDocument} from 'vscode';
import type {HTMLElement,HTMLDivElement} from 'linkedom';
import type {TokenCollection, TokenData} from './rangesByName';
import type {SymbolToken} from './helperFunctions';
import type {MatchPair, ParsedSelector} from './chssParser';

type SymbolData = {tk:TokenData,sy:DocumentSymbol,tp:SymbolToken};

const symbolSort = (a:{range:Range},b:{range:Range}) => a.range.start.compareTo(b.range.start);
const tokenToSymbol = ({range,name}:TokenData):DocumentSymbol => ({range,children:[],selectionRange:range,name,detail:'generated',kind:SymbolKind.Variable});
const getNodeType = (sym:DocumentSymbol,token?:TokenData) => (token?.type??SymbolKind[sym.kind].toLowerCase()) as SymbolToken;
export class DomSimulator{

  static async init(target:Uri,tokens:TokenCollection, text:TextDocument){
    return new DomSimulator(await commands.executeCommand('vscode.executeDocumentSymbolProvider',target),tokens,target,text);
  }

  private constructor(
    symbols:DocumentSymbol[],
    {all,byRange}:TokenCollection,
    public readonly uri:Uri,
    readonly stringContent:TextDocument,
    readonly lang = stringContent.languageId,
    private readonly document = (new DOMParser()).parseFromString('<html><head></head><body></body></html>', 'text/html'),
    private readonly queryMap = new Map<string,MatchPair>()
  ){
    const tokenIndex = new Set<number>();
    const collapsable = new Set<SymbolToken>(['variable','constant']);
    const processedRanges = new Map<string,[HTMLDivElement,Range]>();
    const allTokens = new Set(all);
    /**
     * Sorting the child Elements of a DOM node into the same order the tokens were in the document.
     * @param node - The parent element
     */
    const sortChildren = (node:HTMLElement) => {
      for (const c of node.children.sort((a:HTMLDivElement,b:HTMLDivElement) => processedRanges.get(a.getAttribute('data-namerange'))![1].start.compareTo(processedRanges.get(b.getAttribute('data-namerange'))![1].start))) node.appendChild(c);
    };

    const encodeNode = (sym:DocumentSymbol,parent:HTMLElement,tokenData?:TokenData,manualType?:SymbolToken,top=false) => {
      const noNest = new Set(['package','keyword','other']);
      const fullRange = sym.range;
      //Anonymous functions have their entire body declared as selectionRange, which we don't want. So we reduce it to an zero length range.
      const range = !sym.selectionRange.isSingleLine || sym.name.length !== sym.selectionRange.end.character - sym.selectionRange.start.character?new Range(fullRange.start,fullRange.start):sym.selectionRange;
      const rangeIdent = rangeToIdentifier(range);
      if (processedRanges.has(rangeIdent)) return;
      const rangeIdentFull = rangeToIdentifier(fullRange);
      const semant = tokenData ?? byRange.get(rangeToIdentifier(range));
      const nodeType = manualType ?? getNodeType(sym,semant);
      if (noNest.has(nodeType)) for (const cc of sym.children.sort(symbolSort)) encodeNode(cc,parent);
      else {
        const current = parent.appendChild(document.createElement('div')) as HTMLDivElement;
        processedRanges.set(rangeIdent,[current,range]);
        current.id = `o${semant?.offset ?? stringContent.offsetAt(range.start)}`;
        current.setAttribute('data-namerange', rangeIdent);
        current.setAttribute('data-fullrange', rangeIdentFull);
        current.setAttribute('data-name', sym.name);
        current.className=semant?[nodeType, ...semant.modifiers].join(' '):nodeType;
        const childList = sym.children.sort(symbolSort);
        for (const c of childList) encodeNode(c,current);
        if (semant)tokenIndex.add(semant.index);
        const tokenSymbols = new Set<SymbolData>();
        let currentData:SymbolData|undefined;
        // The tree of DocumentSymbols actually only tracks declarations of symbols. We fill in the rest from our token list.
        for (const token of allTokens) {
          if (!top && fullRange.start.isAfterOrEqual(token.range.end)) continue;
          if (!top && (sym.children.length || !collapsable.has(nodeType)?fullRange:range).end.isBeforeOrEqual(token.range.start)) break;
          if (tokenIndex.has(token.index)) continue;
          const sy = tokenToSymbol(token);
          const sData:SymbolData = {tk:token,sy,tp:getNodeType(sy,token)};
          if (currentData && isField.has(sData.tp) && hasFields.has(currentData.tp) && accessors.get(lang)?.has(stringContent.getText(new Range(currentData.tk.range.end,sData.tk.range.start)).trim())){
            currentData.sy.children.push(sData.sy);
          } else tokenSymbols.add(sData);
          currentData = hasFields.has(sData.tp)? sData:undefined;
          allTokens.delete(token);
        }
        for (const {tk,sy,tp} of tokenSymbols) encodeNode(sy,current,tk,tp);
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
  public selectorToCSS({match,name,type,modifiers,combinator}:ParsedSelector,prevSelectors=[''],regexOffsets?:number[],notRanges?:number[],caseInsensitive=false){
    /**For making attribute selectors case insensitive */
    const flag = caseInsensitive?' i':'';
    /**Filtering out the star selector to simplify things.*/
    const finalTypes = type.filter(f => f!=='*');
    let selectorStrings = prevSelectors;
    //CSS can't handle complex regex matches, so we resolve them on a token basis,
    //parse the offsets to IDs and restrict our selection to them using a snazzy double negation.
    if (match === 'match' && regexOffsets?.length)selectorStrings = selectorStrings.map(s => `${s}:not(:not(${regexOffsets.map(n => `#o${n}`).join(',')}))`);
    //If CSS is capable of matching a value, we use an attribute selector.
    else if (match && match !== 'match') selectorStrings = selectorStrings.map(s => `${s}[data-name${match === 'includes'?'*':match === 'startsWith'?'^':'$'}="${name}"${flag}]`);
    else if (name && name !== '*') selectorStrings = selectorStrings.map(s => `${s}[data-name="${name}"${flag}]`);
    //Modifiers and types are classes, so we chain them with `.`
    //Because there can be multiple of each, we flatMap into multiple alterations, expanding like SCSS.
    if (modifiers.length) {selectorStrings = modifiers.flatMap(m => selectorStrings.map(
      s => (
        //"none" excludes any other modifiers, so if it paired with anything, we prevent the selector from matching at all.
        m.includes('none')?m.length!==1?`${s}:not(*)`:
        //How do we match "no modifiers"? By excluding all class attributes with spaces, which means there's only a type class.
        `${s}:not([class*=" "])`:
        //Regular modifiers are regular multi class selectors.
        `${s}.${m.join('.')}`)
    ));}
    //Type selectors work the same as modifiers, without the complication of "none".
    if (finalTypes.length) selectorStrings = finalTypes.flatMap(t => selectorStrings.map(s => `${s}.${t}`));
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
      <!DOCTYPE html> <html><head> <style> html,body{background:white; width:100%; text-align:center; padding: 1em 0; font-size:0.95em } div {border-radius:.3em; margin: .5em; padding: .2em; width: 90%; border:.15em solid rgba(0, 0, 0, 0.150); background: rgba(0, 0, 0, 0.050); min-height: 1em; display:inline-block; color:#a52634; text-align:center; position:relative } div::after{content: "[" attr(class) "]"; display:block; position:absolute; top: .2em; left:.2em} div::before { display: block; font-weight: bold; content: attr(data-name); } </style> </head> <body> ${this.document.body.innerHTML} </body> </html>
    `;
  }

}