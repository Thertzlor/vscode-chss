import {workspace,window, TextEditorDecorationType,commands,Uri} from 'vscode';
import type {Range, ExtensionContext, SemanticTokens, SemanticTokensLegend, ConfigurationChangeEvent} from 'vscode';
import {rangesByName} from './utils/rangesByName';
import {ChssParser} from './utils/chssParser';
import {TextDecoder} from 'util';
import {isAbsolute} from 'path';
import {debounce} from './utils/helperFunctions';
// import TextmateLanguageService from 'vscode-textmate-languageservice';

const getConfigGeneric = <O extends Record<string,unknown>>(section:string) => <K extends Extract<keyof O,string>>(name:K) => ((c=workspace.getConfiguration(section)) => (c.get(name)??c.inspect(name)?.defaultValue) as O[K])();
const decoGlobal = new Map<string,TextEditorDecorationType>();

export async function activate(context:ExtensionContext) {
  // const selector: vscode.DocumentSelector = 'custom';
  // const textmateService = new TextmateLanguageService('typescript', context);
  // const textmateTokenService = await textmateService.initTokenService();
  const getConfig = getConfigGeneric<{realtimeCHSS:boolean,stylesheetLocation:string,fullCss:boolean,caseInsensitiveMatch:boolean}>('chss');
  const loadFile = async(p=getConfig('stylesheetLocation')) => (p?isAbsolute(p)? Uri.file(p) : (await workspace.findFiles(p))[0] as Uri|undefined:undefined);

  let directUpdate = getConfig('realtimeCHSS');
  let insen = getConfig('caseInsensitiveMatch');
  let chssFile = await loadFile();

  const main = async() => {
    const chssText = new TextDecoder().decode(await workspace.fs.readFile(chssFile!));
    const parser = new ChssParser(workspace.workspaceFolders?.[0]?.uri);
    const decorations = new Map<string,Map<string,[decoRanges:Range[]]>>();
    const debounceVal = 100;

    let rules = parser.parseChss(chssText);

    const reApply=async(editor = window.activeTextEditor) => {
      if (!editor) return;
      const textDocument = editor.document;
      const {uri} = textDocument;
      const uString = uri.toString();
      const decos = (decorations.has(uString)?decorations.get(uString):decorations.set(uString, new Map()).get(uString))!;
      for (const [k,[rs]] of decos.entries()) (rs.length && decoGlobal.has(k)) && editor.setDecorations(decoGlobal.get(k)!, rs);
    };

    const processEditor = async(editor = window.activeTextEditor,full=false) => {
      if (!editor) return;
      const textDocument = editor.document;
      const {uri} = textDocument;
      const uString = uri.toString();
      const decos = (decorations.has(uString)?decorations.get(uString):decorations.set(uString, new Map()).get(uString))!;
      const tokensData:SemanticTokens | undefined = await commands.executeCommand('vscode.provideDocumentSemanticTokens', uri);
      const legend:SemanticTokensLegend | undefined = await commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri);
      if (!tokensData || !legend) return;

      for (const [k,[arr]] of decos.entries()) {
        arr.length=0;
        if (full){
          editor.setDecorations(decoGlobal.get(k)!, []);
          decos.delete(k);
        }
      }
      // const tokens = await textmateTokenService.fetch(textDocument);
      // console.log(await commands.executeCommand('vscode.executeDocumentSymbolProvider',window.activeTextEditor?.document.uri));
      const ranges = rangesByName(tokensData,legend,editor);
      const chss = parser.processChss(ranges,rules,textDocument,insen);

      for (const {style,range,pseudo} of chss) {
        const stryle = JSON.stringify(style);

        if (decoGlobal.has(stryle)){
          const doco = decos.get(stryle) ?? decos.set(stryle, [[]]).get(stryle)!;
          doco[0].push(range);
        } else {
          const newType = window.createTextEditorDecorationType(pseudo ? {[pseudo]: style} : style);
          decoGlobal.set(stryle,newType);
          decos.set(stryle,[[range]]);
        }
      }

      for (const [k,[rs]] of decos.entries()){
        if (rs.length && decoGlobal.has(k)) editor.setDecorations(decoGlobal.get(k)!, rs);
        else {
          decoGlobal.get(k)?.dispose();
          decoGlobal.delete(k);
          decos.delete(k);
        }
      }

    };

    const processAll = debounce(() => {for (const e of window.visibleTextEditors) processEditor(e,true);},debounceVal);
    const throttledEditor = debounce(processEditor,debounceVal);

    processAll();

    context.subscriptions.push(
      window.onDidChangeActiveTextEditor(e => (decorations.has(e?.document.uri.toString()??'')?reApply(e):processEditor(e))),
      workspace.onDidChangeTextDocument(e => {
        if (e.document.fileName !== window.activeTextEditor?.document.fileName) return;
        if (e.document.uri.toString() === chssFile?.toString() && (directUpdate || !e.document.isDirty)) {
          rules = parser.parseChss(e.document.getText());
          processAll();
        }
        else throttledEditor();
      }),
      workspace.onDidChangeConfiguration(
        async(e:ConfigurationChangeEvent) => {
          let reProcess = false;

          e.affectsConfiguration('chss.realtimeCHSS') && (directUpdate = getConfig('realtimeCHSS'));
          if (e.affectsConfiguration('chss.stylesheetLocation')) {chssFile = await loadFile(); reProcess = true;}
          if (e.affectsConfiguration('chss.caseInsensitiveMatch')) {insen = getConfig('caseInsensitiveMatch'); reProcess = true;}

          reProcess && processAll();
        }
      )
    );
  };

  if (!chssFile) {
    const createWatcher = workspace.onDidCreateFiles(async() =>
    {
      chssFile = await loadFile();
      if (chssFile){
        createWatcher.dispose();
        main();
      }
    });
    context.subscriptions.push(createWatcher);
  } else main();
}
export async function deactivate(){
  for (const element of decoGlobal.values()) element.dispose();
}