import {commands,window} from 'vscode';
import {rangesByName} from './rangesByName';
import type {Range, SemanticTokens, SemanticTokensLegend, TextEditorDecorationType} from 'vscode';
import type {ChssParser} from './chssParser';


export class DecorationManager{

  constructor(
    private readonly parser:ChssParser,
    private readonly decoGlobal = new Map<string,TextEditorDecorationType>(),
    public readonly decorations = new Map<string,Map<string,[decoRanges:Range[]]>>()
  ){}

  public disposeGlobals(){
    for (const element of this.decoGlobal.values()) element.dispose();
  }

  public async reApply(editor = window.activeTextEditor) {
    if (!editor) return;
    const textDocument = editor.document;
    const {uri} = textDocument;
    const uString = uri.toString();
    const decos = (this.decorations.has(uString)?this.decorations.get(uString):this.decorations.set(uString, new Map()).get(uString))!;
    for (const [k,[rs]] of decos.entries()) (rs.length && this.decoGlobal.has(k)) && editor.setDecorations(this.decoGlobal.get(k)!, rs);
  }

  public async processEditor(editor = window.activeTextEditor,full=false,rules:ReturnType<typeof this.parser.parseChss>,insen = false,debugMode=false) {
    if (!editor) return;
    const textDocument = editor.document;
    const {uri} = textDocument;
    const uString = uri.toString();
    const decos = (this.decorations.has(uString)?this.decorations.get(uString):this.decorations.set(uString, new Map()).get(uString))!;
    const tokensData:SemanticTokens | undefined = await commands.executeCommand('vscode.provideDocumentSemanticTokens', uri);
    const legend:SemanticTokensLegend | undefined = await commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri);
    if (!tokensData || !legend) return;

    for (const [k,[arr]] of decos.entries()) {
      arr.length=0;
      if (full){
        editor.setDecorations(this.decoGlobal.get(k)!,[]);
        decos.delete(k);
      }
    }

    const ranges = rangesByName(tokensData,legend,editor);
    const chss = await this.parser.processChss(ranges,rules,textDocument,insen,debugMode);

    for (const {style,range,pseudo} of chss) {
      const stryle = JSON.stringify(style);

      if (this.decoGlobal.has(stryle)){
        const doco = decos.get(stryle) ?? decos.set(stryle, [[]]).get(stryle)!;
        doco[0].push(range);
      } else {
        const newType = window.createTextEditorDecorationType(pseudo ? {[pseudo]: style} : style);
        this.decoGlobal.set(stryle,newType);
        decos.set(stryle,[[range]]);
      }
    }

    for (const [k,[rs]] of decos.entries()){
      if (rs.length && this.decoGlobal.has(k)) editor.setDecorations(this.decoGlobal.get(k)!, rs);
      else {
        this.decoGlobal.get(k)?.dispose();
        this.decoGlobal.delete(k);
        decos.delete(k);
      }
    }

  }


}