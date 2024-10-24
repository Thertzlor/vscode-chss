import {workspace,window, TextEditorDecorationType,commands} from 'vscode';
import type {Range, ExtensionContext, SemanticTokens, SemanticTokensLegend, Uri,ConfigurationChangeEvent} from 'vscode';
import {rangesByName} from './utils/rangesByName';
import {ChssParser} from './utils/chssParser';
import {TextDecoder} from 'util';
// import TextmateLanguageService from 'vscode-textmate-languageservice';

const getConfigGeneric = (section:string) => <T>(name:string):T => ((c=workspace.getConfiguration(section)) => c.get(name)??c.inspect(name)?.defaultValue as any)();
export async function activate(context:ExtensionContext) {
    // const selector: vscode.DocumentSelector = 'custom';
    // const textmateService = new TextmateLanguageService('typescript', context);
    // const textmateTokenService = await textmateService.initTokenService();
  const getConfig = getConfigGeneric('chss');
  const loadFile = async() => (await workspace.findFiles(getConfig<string>('styleLocation')))[0] as Uri|undefined;
  let directUpdate = getConfig<boolean>('realtimeChss');
  let chssFile = await loadFile();
  if (!chssFile) return;
  const chssText = new TextDecoder().decode(await workspace.fs.readFile(chssFile));
  const parser = new ChssParser(workspace.workspaceFolders?.[0]?.uri);
  const decorations = new Map<string,Map<string,[TextEditorDecorationType,Range[]]>>();

  async function onDidChangeConfiguration(e:ConfigurationChangeEvent) {
    e.affectsConfiguration('chss.styleLocation') && (chssFile = await loadFile());
    e.affectsConfiguration('chss.realtimeChss') && (directUpdate = getConfig('realtimeChss'));
  }
  context.subscriptions.push(workspace.onDidChangeConfiguration(onDidChangeConfiguration));

  let rules = parser.parseChss(chssText);
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
    console.log(await commands.executeCommand('vscode.executeDocumentSymbolProvider',window.activeTextEditor?.document.uri));
    const ranges = rangesByName(tokensData,legend,editor);
    const chss = parser.processChss(ranges,rules,textDocument);
    for (const {style,range} of chss) {
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
  window.onDidChangeActiveTextEditor(e => processEditor(e));
  workspace.onDidChangeTextDocument(e => {
    if (e.document.fileName !== window.activeTextEditor?.document.fileName) return;
    if (e.document.uri.toString() === chssFile?.toString() && (directUpdate || !e.document.isDirty)) {
      rules = parser.parseChss(e.document.getText());
      for (const ed of window.visibleTextEditors) processEditor(ed,true);
    }
    else processEditor();
  });
}