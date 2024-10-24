import {workspace,window, TextEditorDecorationType,commands} from 'vscode';
import type {Range, ExtensionContext, SemanticTokens, SemanticTokensLegend} from 'vscode';
import {rangesByName} from './utils/rangesByName';
import {HssParser} from './utils/hssParser';
import {TextDecoder} from 'util';
// import TextmateLanguageService from 'vscode-textmate-languageservice';

export async function activate(_context:ExtensionContext) {
    // const selector: vscode.DocumentSelector = 'custom';
    // const textmateService = new TextmateLanguageService('typescript', context);
    // const textmateTokenService = await textmateService.initTokenService();
  const cs = await workspace.findFiles('*.hss').then(c => c[0] && workspace.fs.readFile(c[0]));
  const wa = new TextDecoder().decode(cs);
  const wUri = workspace.workspaceFolders?.[0]?.uri;
  const parser = new HssParser(wUri);
  const decorations = new Map<string,Map<string,[TextEditorDecorationType,Range[]]>>();

  let rules = parser.parseHss(wa);
  const processEditor = async(editor = window.activeTextEditor,full=false) => {
    if (!editor) return;
    const textDocument = editor.document;
    const {uri} = textDocument;
    const uString = uri.toString();
    const decos = (decorations.has(uString)?decorations.get(uString):decorations.set(uString, new Map()).get(uString))!;
    for (const [k,[t,arr]] of decos.entries()) {
      arr.length=0;
      if (full){
        t.dispose();
        decos.delete(k);
      }
    }
    const tokensData:SemanticTokens | undefined = await commands.executeCommand('vscode.provideDocumentSemanticTokens', uri);
    const legend:SemanticTokensLegend | undefined = await commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri);
    if (!tokensData || !legend) return;
        // const tokens = await textmateTokenService.fetch(textDocument);
        // console.log(await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider',vscode.window.activeTextEditor?.document.uri))
    const ranges = rangesByName(tokensData,legend,editor);
    const hss = parser.processHss(ranges,rules,textDocument);
    for (const {style,range} of hss) {
      const stryle = JSON.stringify(style);
      if (decos.has(stryle)){
        const doco = decos.get(stryle)!;
        doco[1].push(range);
      } else decos.set(stryle,[window.createTextEditorDecorationType(style),[range]]);
    }
    for (const [k,[style,rs]] of decos.entries()){
      if (rs.length)editor.setDecorations(style, rs);
      else {
        style.dispose();
        decos.delete(k);
      }
    }
  };
  for (const e of window.visibleTextEditors) processEditor(e);
  workspace.onDidChangeTextDocument(e => {
    if (e.document.fileName !== window.activeTextEditor?.document.fileName) return;
    if (e.document.fileName.endsWith('.hss')) {
      rules = parser.parseHss(e.document.getText());
      for (const ed of window.visibleTextEditors) processEditor(ed,true);
    }
    else processEditor();
  });
  window.onDidChangeActiveTextEditor(e => processEditor(e,false));
}