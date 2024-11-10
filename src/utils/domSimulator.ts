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
    const todex = new Set<number>();
    const accessors = new Set(['.']);
    const hasFields = new Set<SymbolToken>(['class','property','variable','object','parameter']);
    const isField = new Set<SymbolToken>(['property','method']);
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
          if (!top &&fullRange.end.isBeforeOrEqual(tok.range.start)) break;
          if (todex.has(tok.index)) continue;
          todex.add(tok.index);
          const sy = tokenToSymbol(tok);
          const sData:SymbolData = {tk:tok,sy,tp:getNodeType(sy,tok)};
          let stillProp = false;
          if (currentData && isField.has(sData.tp) && hasFields.has(currentData.tp) && accessors.has(stringContent.getText(new Range(currentData.tk.range.end,sData.tk.range.start)).trim())){
            currentData.sy.children.push(sData.sy);
            console.log(`${sData.tk.name} property of ${currentData.tk.name}`);
            stillProp = true;
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
      <html><head>
            <style>
              html,body{
                width:100%;
                text-align:center
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
                  .typeParameter {
          background: rgb(239, 199, 148);
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
                display:inline-block;
                color:black;
                text-align:center
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

  static async init(target:Uri,tokens:TokenCollection, text:TextDocument){
    const syms:DocumentSymbol[] = await commands.executeCommand('vscode.executeDocumentSymbolProvider',target);
    console.log(syms);
    return new DomSimulator(syms,tokens,target,text);
  }
}