import {commands,SymbolKind} from 'vscode';
import {DOMParser} from 'linkedom';
import type {DocumentSymbol,Uri,Range} from 'vscode';
import type {HTMLElement,HTMLDivElement} from 'linkedom';
import type {TokenCollection, TokenData} from './rangesByName';
import {rangeToIdentifier,identifierToRange} from './helperFunctions';
import type {ParsedSelector} from './chssParser';


type SymbolToken = Lowercase<keyof typeof SymbolKind>;


export class DomSimulator{
  private constructor(
    symbols:DocumentSymbol[],
    tokens:TokenCollection,
    public readonly uri:Uri,
    private readonly document = (new DOMParser()).parseFromString('<html><head></head><body></body></html>', 'text/html'),
    private readonly queryMap = new Map<string,Range[]>()
  ){
    const todex = new Set<number>();
    const {_all:all,_byRange:byRange} = tokens;
    const symSort = (a:{range:Range},b:{range:Range}) => a.range.start.compareTo(b.range.start);
    const encodeNode = (sym:DocumentSymbol,parent:HTMLElement,token?:TokenData) => {
      const noNest = ['package','keyword'];
      const range = sym.selectionRange;
      const fullRange = sym.range;
      const rangeIdent = rangeToIdentifier(range);
      const rangeIdentFull = rangeToIdentifier(fullRange);
      const semant = token ?? byRange.get(rangeIdent);
      const nodeToken = semant?.type??SymbolKind[sym.kind].toLowerCase() as SymbolToken;
      if (noNest.includes(nodeToken)) for (const cc of sym.children.sort(symSort)) encodeNode(cc,parent);
      else {
        const current = parent.appendChild(document.createElement('div')) as HTMLDivElement;
        current.setAttribute('data-namerange', rangeIdent);
        current.setAttribute('data-fullrange', rangeIdentFull);
        current.setAttribute('data-name', sym.name);
        current.className=semant?[nodeToken, ...semant.modifiers].join(' '):nodeToken;
        for (const c of sym.children.sort(symSort)) encodeNode(c,current);
        if (semant)todex.add(semant.index);
        for (const tok of all) {
          if (fullRange.start.isAfterOrEqual(tok.range.end)) continue;
          if (fullRange.end.isBeforeOrEqual(tok.range.start)) break;
          if (todex.has(tok.index)) continue;
          todex.add(tok.index);
          // console.log({pn:current.className,tn:tok.name});
          encodeNode({children:[],name:tok.name,range:tok.range,selectionRange:tok.range,detail:'generated',kind:SymbolKind.Variable},current,tok);
        }
      }
    };
    for (const e of symbols.sort((a,b) => (a.range.start > b.range.start?-1:1))) encodeNode(e,document.body as any as HTMLElement);
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

  public getHtml(){
    const styled = /*html*/`
          <!DOCTYPE html>
      <html>

      <head>
        <style>
          html {
            text-align: left;
          }

          .array {
            background: yellow;
          }

          .variable {
            background: rgb(205, 63, 63);
          }

          .constant {
            background: rgb(126, 41, 41);
          }

          .class {
            background: rgb(0, 128, 124);
          }

          .object {
            background: green;
          }

          .property {
            background: rgb(144, 179, 103);
          }

          .function {
            background: blue;
          }

          .method {
            background: rgb(29, 155, 155);
          }

          .parameter {
            background: orange;
          }

          .constructor {
            background: purple;
          }

          .type {
            background: rgb(239, 239, 148);
          }

          .interface {
            background: rgb(239, 210, 148);
          }


          div {
            margin: .5em;
            padding: .2em;
            border: 1px solid black;
            width: 90%;
            background: grey;
            min-height: 1em;
            display: block;
            color:black;
            width:fit-content
          }

          div::before {
            display: block;
            font-weight: bold;
            content: attr(data-name);
          }
        </style>
      </head>

      <body>
       ${this.document.body.innerHTML}
      </body>

      </html>
    `;
    return styled;
  }

  static async init(target:Uri,bing:TokenCollection){
    const syms:DocumentSymbol[] = await commands.executeCommand('vscode.executeDocumentSymbolProvider',target);
    console.log(syms);
    return new DomSimulator(syms,bing,target);
  }
}