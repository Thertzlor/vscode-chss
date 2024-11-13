import {commands,window} from 'vscode';
import {rangesByName} from './rangesByName';
import type {Range, SemanticTokens, SemanticTokensLegend, TextEditorDecorationType} from 'vscode';
import type {ChssParser} from './chssParser';


export class DecorationManager{

  constructor(
    /**The parser for turning CHSS rules into ranges for our decorators. */
    private readonly parser:ChssParser,
    /**Mapping stringified URIs to  */
    private readonly decoGlobal = new Map<string,TextEditorDecorationType>(),
    public readonly decorations = new Map<string,Map<string,Range[]>>()
  ){}

  /**
   * Applies text decorations to a previously unloaded editor without re-parsing the CHSS.
   * @param editor - The editor to decorate
   */
  public async reApply(editor = window.activeTextEditor) {
    if (!editor) return;
    const textDocument = editor.document;
    const {uri} = textDocument;
    const uString = uri.toString();
    const decos = (this.decorations.has(uString)?this.decorations.get(uString):this.decorations.set(uString, new Map()).get(uString))!;
    for (const [rule,rangeList] of decos.entries()) (rangeList.length && this.decoGlobal.has(rule)) && editor.setDecorations(this.decoGlobal.get(rule)!, rangeList);
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

    for (const [rule,rangeList] of decos.entries()) {
      rangeList.length=0;
      if (full){
        editor.setDecorations(this.decoGlobal.get(rule)!,[]);
        decos.delete(rule);
      }
    }

    const ranges = rangesByName(tokensData,legend,editor);
    const chss = await this.parser.processChss(ranges,rules,textDocument,insen,debugMode);

    for (const {style,range,pseudo} of chss) {
      const styleString = Object.entries(style).reduce<string>((p,[k,v]) => `${p}|${k}:${v}` ,'');

      if (this.decoGlobal.has(styleString)){
        const doco = decos.get(styleString) ?? decos.set(styleString, []).get(styleString)!;
        doco.push(range);
      } else {
        const newType = window.createTextEditorDecorationType(pseudo ? {[pseudo]: style} : style);
        this.decoGlobal.set(styleString,newType);
        decos.set(styleString,[range]);
      }
    }

    for (const [rule,rangeList] of decos.entries()){
      if (rangeList.length && this.decoGlobal.has(rule)) editor.setDecorations(this.decoGlobal.get(rule)!, rangeList);
      else {
        this.decoGlobal.get(rule)?.dispose();
        this.decoGlobal.delete(rule);
        decos.delete(rule);
      }
    }

  }


}