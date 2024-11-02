import {commands,SymbolKind} from 'vscode';
import {DOMParser} from 'linkedom';
import type {DocumentSymbol,Uri,Range} from 'vscode';
import type {HTMLElement,HTMLDivElement} from 'linkedom';
import type {TokenData} from './rangesByName';
import {RangeIdentifier, rangeToIdentifier,identifierToRange} from './helperFunctions';
import type {ParsedSelector} from './chssParser';


type SymbolToken = Lowercase<keyof typeof SymbolKind>;


export class DomSimulator{
  private constructor(
    symbols:DocumentSymbol[],
    semanticRanges:Map<RangeIdentifier,TokenData|undefined>,
    public readonly uri:Uri,
    private readonly document = (new DOMParser()).parseFromString('<html><body></body></html>', 'text/html'),
    private readonly queryMap = new Map<string,Range[]>()
  ){
    const encodeNode = (sym:DocumentSymbol,parent:HTMLElement) => {
      const noNest = ['package','keyword'];
      const range = sym.selectionRange;
      const fullRange = sym.selectionRange;
      const rangeIdent = rangeToIdentifier(range);
      const rangeIdentFull = rangeToIdentifier(fullRange);
      const semant = semanticRanges.get(rangeIdent);
      const nodeToken = semant?.type??SymbolKind[sym.kind].toLowerCase() as SymbolToken;
      if (noNest.includes(nodeToken)) for (const cc of sym.children) encodeNode(cc,parent);
      else {const current = parent.appendChild(document.createElement('div')) as HTMLDivElement;
        current.setAttribute('data-namerange', rangeIdent);
        current.setAttribute('data-fullrange', rangeIdentFull);
        current.setAttribute('data-name', sym.name);
        current.className=semant?[nodeToken, ...semant.modifiers].join(' '):nodeToken;
        for (const c of sym.children) encodeNode(c,current);}
    };
    for (const e of symbols) encodeNode(e,document.body as any as HTMLElement);

  }

  public rangesFromQuery(selector:string){
    if (this.queryMap.has(selector)) return this.queryMap.get(selector)!;
    const ranges = this.document.querySelectorAll(selector).map((n:HTMLElement) => identifierToRange(n.getAttribute('data-fullrange')));

    this.queryMap.set(selector, ranges);
    return ranges;
  }

  public getSelectionAccuracy(sel:ParsedSelector){
    if (sel.regexp) return false;
    return true;
  }

  public selectorToQuery(sel:ParsedSelector){}

  static async init(target:Uri,bing:Map<RangeIdentifier,TokenData|undefined>){
    const syms:DocumentSymbol[] = await commands.executeCommand('vscode.executeDocumentSymbolProvider',target);
    return new DomSimulator(syms,bing,target);
  }
}