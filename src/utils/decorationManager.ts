import {commands,window} from 'vscode';
import {rangesByName} from './rangesByName';
import type {Range, SemanticTokens, SemanticTokensLegend, TextEditorDecorationType} from 'vscode';
import type {ChssParser} from './chssParser';
import {setTimeStyled} from './helperFunctions';


export class DecorationManager{

  constructor(
    /**The parser for turning CHSS rules into ranges for our decorators. */
    private readonly parser:ChssParser,
    /**Mapping stringified styles to specific text decorations, so they can be reused. */
    private readonly decoGlobal = new Map<string,TextEditorDecorationType>(),
    /**For each URI we map a style to an array of ranges in that file.*/
    public readonly decorations = new Map<string,Map<string,Range[]>>()
  ){}

  /**
   * Applies text decorations to a previously unloaded editor without re-parsing the CHSS.
   * @param editor - The editor to decorate
   */
  public async reApply(editor = window.activeTextEditor) {
    if (!editor) return;
    const textDocument = editor.document;
    const uString = textDocument.uri.toString();
    //No style for this file yet...
    if (!this.decorations.has(uString)) return;
    const decos = this.decorations.get(uString)!;
    // Applying the decorations to previously saved ranges.
    for (const [rule,rangeList] of decos.entries()) (rangeList.length && this.decoGlobal.has(rule)) && editor.setDecorations(this.decoGlobal.get(rule)!, rangeList);
  }

  public async processEditor(editor = window.activeTextEditor,full=false,rules:ReturnType<typeof this.parser.parseChss>,insen = false,debugMode=false) {
    if (!editor) return;
    const textDocument = editor.document;
    const {uri} = textDocument;
    const uString = uri.toString();
    const currentDecorations = (this.decorations.has(uString)?this.decorations.get(uString):this.decorations.set(uString, new Map()).get(uString))!;
    //Fetching all the data we need.
    const tokensData:SemanticTokens | undefined = await commands.executeCommand('vscode.provideDocumentSemanticTokens', uri);
    const legend:SemanticTokensLegend | undefined = await commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri);
    if (!tokensData || !legend) return;

    const ranges = rangesByName(tokensData,legend,editor);
    const chss = await this.parser.processChss(ranges,rules,textDocument,insen,debugMode);
    setTimeStyled(editor.document.uri);

    for (const [rule,rangeList] of currentDecorations.entries()) {
      //Resetting the list of ranges, so we don't conflict with existing rules.
      rangeList.length=0;
      if (full){
        //If we do a full re-parse, we reset all decorations.
        editor.setDecorations(this.decoGlobal.get(rule)!,[]);
        currentDecorations.delete(rule);
      }
    }

    for (const {style,range,pseudo} of chss) {
      const styleString = Object.entries(style).reduce<string>((p,[k,v]) => `${p}|${k}:${v}` ,'');
      // We cache all our decorations, and only create new TextEditorDecorationTypes, if we haven't encountered a style before.
      if (this.decoGlobal.has(styleString)){
        const targetDecoration = currentDecorations.get(styleString) ?? currentDecorations.set(styleString, []).get(styleString)!;
        targetDecoration.push(range);
      } else {
        // Creating a new style. Pseudo selectors like ::before, ::after and ::dark are actually sub-objects of a style object.
        const newType = window.createTextEditorDecorationType(pseudo ? {[pseudo]: style} : style);
        this.decoGlobal.set(styleString,newType);
        currentDecorations.set(styleString,[range]);
      }
    }

    for (const [rule,rangeList] of currentDecorations.entries()){
      //For every decoration type, we set decorations on all ranges at once.
      if (rangeList.length && this.decoGlobal.has(rule)) editor.setDecorations(this.decoGlobal.get(rule)!, rangeList);
      else {
        //Decorations that are no longer used are disposed of. Perhaps this is over-optimizing?
        this.decoGlobal.get(rule)?.dispose();
        this.decoGlobal.delete(rule);
        currentDecorations.delete(rule);
      }
    }

  }


}