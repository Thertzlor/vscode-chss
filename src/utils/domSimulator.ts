import {commands,SymbolKind,Range} from 'vscode';
import {DOMParser} from 'linkedom';
import type {DocumentSymbol,Uri, TextDocument} from 'vscode';
import type {HTMLElement,HTMLDivElement} from 'linkedom';
import type {TokenCollection, TokenData} from './rangesByName';
import {rangeToIdentifier,identifierToRange} from './helperFunctions';
import type {ParsedSelector} from './chssParser';


type SymbolToken = Lowercase<keyof typeof SymbolKind>|'parameter'|'type';
type SymbolData = {tk:TokenData,sy:DocumentSymbol,tp:SymbolToken};

const symSort = (a:{range:Range},b:{range:Range}) => a.range.start.compareTo(b.range.start);
const tokenToSymbol = ({range,name}:TokenData):DocumentSymbol => ({range,children:[],selectionRange:range,name,detail:'generated',kind:SymbolKind.Variable});
const getNodeType = (sym:DocumentSymbol,token?:TokenData) => (token?.type??SymbolKind[sym.kind].toLowerCase()) as SymbolToken;
export class DomSimulator{
  private constructor(
    symbols:DocumentSymbol[],
    tokens:TokenCollection,
    public readonly uri:Uri,
    stringContent:TextDocument,
    private readonly document = (new DOMParser()).parseFromString('<html><head></head><body></body></html>', 'text/html'),
    private readonly queryMap = new Map<string,Range[]>()
  ){
    const lang = stringContent.languageId;
    const todex = new Set<number>();
    const accessors =new Set(
      lang === 'typescript'?['.','?.','!.']:
      lang === 'javascript'?['.','?.']:
      lang === 'lua'?['.',':']:
      ['.']
    );
    const hasFields = new Set<SymbolToken>(['class','property','variable','object','parameter']);
    const isField = new Set<SymbolToken>(['property','method']);
    const collapsable = new Set<SymbolToken>(['variable','constant']);
    const {_all:all,_byRange:byRange} = tokens;
    const processedRanges = new Map<string,[HTMLDivElement,Range]>();
    const sortChildren = (node:HTMLElement) => {
      for (const c of node.children.sort((a:HTMLDivElement,b:HTMLDivElement) => processedRanges.get(a.getAttribute('data-namerange'))![1].start.compareTo(processedRanges.get(b.getAttribute('data-namerange'))![1].start))) node.appendChild(c);
    };

    const encodeNode = (sym:DocumentSymbol,parent:HTMLElement,token?:TokenData,manualType?:SymbolToken,top=false) => {
      const noNest = new Set(['package','keyword','other']);
      const range = sym.selectionRange;
      const fullRange = sym.range;
      const rangeIdent = rangeToIdentifier(range);
      if (processedRanges.has(rangeIdent)) return;
      const rangeIdentFull = rangeToIdentifier(fullRange);
      const semant = token ?? byRange.get(rangeIdent);
      const nodeType = manualType ?? getNodeType(sym,semant);
      if (noNest.has(nodeType)) for (const cc of sym.children.sort(symSort)) encodeNode(cc,parent);
      else {
        const current = parent.appendChild(document.createElement('div')) as HTMLDivElement;
        processedRanges.set(rangeIdent,[current,range]);
        current.setAttribute('data-namerange', rangeIdent);
        current.setAttribute('data-fullrange', rangeIdentFull);
        current.setAttribute('data-name', sym.name);
        current.className=semant?[nodeType, ...semant.modifiers].join(' '):nodeType;
        const childList = sym.children.sort(symSort);
        for (const c of childList) encodeNode(c,current);
        if (semant)todex.add(semant.index);
        const tokenSymbols = new Set<SymbolData>();
        let currentData:SymbolData|undefined;
        for (const tok of all) {
          if (!top && fullRange.start.isAfterOrEqual(tok.range.end)) continue;
          if (!top && (sym.children.length || !collapsable.has(nodeType)?fullRange:range).end.isBeforeOrEqual(tok.range.start)) break;
          if (todex.has(tok.index)) continue;
          const sy = tokenToSymbol(tok);
          const sData:SymbolData = {tk:tok,sy,tp:getNodeType(sy,tok)};
          if (currentData && isField.has(sData.tp) && hasFields.has(currentData.tp) && accessors.has(stringContent.getText(new Range(currentData.tk.range.end,sData.tk.range.start)).trim())){
            currentData.sy.children.push(sData.sy);
          } else tokenSymbols.add(sData);
          currentData = hasFields.has(sData.tp)? sData:undefined;
        }
        for (const {tk,sy,tp} of tokenSymbols) encodeNode(sy,current,tk,tp);
        sortChildren(current);
      }
    };
    for (const e of symbols.sort(symSort)) encodeNode(e,document.body as any as HTMLElement);
    for (const a of all){
      if (processedRanges.has(rangeToIdentifier(a.range))) continue;
      encodeNode(tokenToSymbol(a),document.body,a,undefined,true);
    }
    sortChildren(document.body);
  }

  public rangesFromQuery(selector:string,full=false){
    if (this.queryMap.has(selector)) return this.queryMap.get(selector)!;
    try {const ranges = this.document.querySelectorAll(selector).map((n:HTMLElement) => identifierToRange(n.getAttribute(`data-${full?'fullrange':'namerange'}`)));
      this.queryMap.set(selector, ranges);
      return ranges;} catch {
      return [];
    }
  }

  public getSelectionAccuracy(sel:ParsedSelector){
    if (sel.regexp) return false;
    return true;
  }

  public selectorToQuery({match,name,type,modifiers}:ParsedSelector,prevSelectors=[''],regexRanges?:Range[]){
    const finalTypes = type.filter(f => f!=='*');
    let selectorStrings = prevSelectors;
    if (match === 'match' && regexRanges?.length)selectorStrings = regexRanges.flatMap(r => selectorStrings.map(s => `${s}[data-namerange="${rangeToIdentifier(r)}"]`));
    else if (match &&match !== 'match')selectorStrings = selectorStrings.map(s => `${s}[data-namerange${match === 'includes'?'*':match === 'startsWith'?'^':'$'}="${name}"]`);
    else if (name && name !== '*') selectorStrings = selectorStrings.map(s => `${s}[data-name="${name}"]`);
    if (modifiers.length)selectorStrings = modifiers.flatMap(m => selectorStrings.map(s => `${s}.${m.join('.')}`));
    if (finalTypes.length)selectorStrings = finalTypes.flatMap(t => selectorStrings.map(s => `${s}.${t}`));
    else if (finalTypes.length !== type.length && !name)selectorStrings = selectorStrings.map(s => `${s}[data-fullrange]`);
    return selectorStrings;
  }

  public getHtml(){
    const styled = /*html*/`
      <!DOCTYPE html> <html><head> <style> html,body{background:white; width:100%; text-align:center; padding: 1em 0; font-size:0.95em } div {border-radius:.3em; margin: .5em; padding: .2em; width: 90%; border:.15em solid rgba(0, 0, 0, 0.150); background: rgba(0, 0, 0, 0.050); min-height: 1em; display:inline-block; color:#a52634; text-align:center; position:relative } div::after{content: "[" attr(class) "]"; display:block; position:absolute; top: .2em; left:.2em} div::before { display: block; font-weight: bold; content: attr(data-name); } </style> </head> <body> ${this.document.body.innerHTML} </body> </html>
    `;
    return styled;
  }

  static async init(target:Uri,tokens:TokenCollection, text:TextDocument){
    const syms:DocumentSymbol[] = await commands.executeCommand('vscode.executeDocumentSymbolProvider',target);
    return new DomSimulator(syms,tokens,target,text);
  }
}