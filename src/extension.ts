import {workspace,window, Uri} from 'vscode';
import type {ExtensionContext, ConfigurationChangeEvent} from 'vscode';
import {ChssParser} from './utils/chssParser';
import {TextDecoder} from 'util';
import {isAbsolute} from 'path';
import {debounce} from './utils/helperFunctions';
import {DecorationManager} from './utils/decorationManager';
// import TextmateLanguageService from 'vscode-textmate-languageservice';

const getConfigGeneric = <O extends Record<string,unknown>>(section:string) => <K extends Extract<keyof O,string>>(name:K) => ((c=workspace.getConfiguration(section)) => (c.get(name)??c.inspect(name)?.defaultValue) as O[K])();

export async function activate(context:ExtensionContext) {
  // const selector: vscode.DocumentSelector = 'custom';
  // const textmateService = new TextmateLanguageService('typescript', context);
  // const textmateTokenService = await textmateService.initTokenService();
  const getConfig = getConfigGeneric<{realtimeCHSS:boolean,stylesheetLocation:string,fullCss:boolean,caseInsensitiveMatch:boolean,debugView:boolean}>('chss');
  const loadFile = async(p=getConfig('stylesheetLocation')) => (p?isAbsolute(p)? Uri.file(p) : (await workspace.findFiles(p))[0] as Uri|undefined:undefined);

  let directUpdate = getConfig('realtimeCHSS');
  let insensitive = getConfig('caseInsensitiveMatch');
  let debugMode = getConfig('debugView');
  let chssFile = await loadFile();
  // console.log('imagine activating an extension');

  const main = async() => {
    const parser = new ChssParser(workspace.workspaceFolders?.[0]?.uri);
    const decorator = new DecorationManager(parser);
    let styleTime = 0;
    const timeMap = new Map<string,number>();

    const debounceVal = 100;
    const chssText = new TextDecoder().decode(await workspace.fs.readFile(chssFile!));
    let rules = parser.parseChss(chssText);

    const processAll = debounce(() => {for (const e of window.visibleTextEditors) decorator.processEditor(e,true,rules,insensitive,debugMode);},debounceVal);
    const throttledEditor = debounce((...args:Parameters<DecorationManager['processEditor']>) => decorator.processEditor(...args) ,debounceVal);

    processAll();

    context.subscriptions.push(
      window.onDidChangeActiveTextEditor(e => (decorator.decorations.has(e?.document.uri.toString()??'')&& (timeMap.get(e!.document.uri.toString()) ?? 0 > styleTime)?decorator.reApply(e):decorator.processEditor(e,false,rules,insensitive,debugMode))),
      workspace.onDidChangeTextDocument(e => {
        if (e.document.fileName !== window.activeTextEditor?.document.fileName) return;
        if (e.document.uri.toString() === chssFile?.toString() && (directUpdate || !e.document.isDirty)) {
          styleTime = Date.now();
          rules = parser.parseChss(e.document.getText());
          processAll();
        }
        else {
          timeMap.set(e.document.uri.toString(),Date.now());
          throttledEditor(undefined,false,rules,insensitive,debugMode);
        }
      }),
      workspace.onDidChangeConfiguration(
        async(e:ConfigurationChangeEvent) => {
          let reProcess = false;
          e.affectsConfiguration('chss.realtimeCHSS') && (directUpdate = getConfig('realtimeCHSS'));
          if (e.affectsConfiguration('chss.stylesheetLocation')) {chssFile = await loadFile(); reProcess = true;}
          if (e.affectsConfiguration('chss.caseInsensitiveMatch')) {insensitive = getConfig('caseInsensitiveMatch'); reProcess = true;}
          if (e.affectsConfiguration('chss.debugView')) {debugMode = getConfig('debugView');}
          reProcess && processAll();
        }
      )
    );
  };

  if (!chssFile) {
    const createWatcher = workspace.onDidCreateFiles(async() =>
    {
      chssFile = await loadFile();
      if (!chssFile) return;
      createWatcher.dispose();
      main();
    });
    context.subscriptions.push(createWatcher);
  } else main();
}
export async function deactivate(){/**/}