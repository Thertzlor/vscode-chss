import * as vscode from 'vscode'
// import TextmateLanguageService from 'vscode-textmate-languageservice';
import { rangesByName } from './utils/rangesByName';
import { HssParser } from './utils/hssParser';
import {TextDecoder} from 'util';

export async function activate(context: vscode.ExtensionContext) {
    // const selector: vscode.DocumentSelector = 'custom';
    // const textmateService = new TextmateLanguageService('typescript', context);
    // const textmateTokenService = await textmateService.initTokenService();
vscode.SymbolKind
    const cs = await vscode.workspace.findFiles('*.hss').then(c => c[0] && vscode.workspace.fs.readFile(c[0]))
    const wa = new TextDecoder().decode(cs);
    const wUri = vscode.workspace.workspaceFolders?.[0]?.uri
    const parser = new HssParser(wUri)

    const decorations = new Map<string,Map<vscode.Range,vscode.TextEditorDecorationType>>()

    let rules = parser.parseHss(wa)
    const processEditor = async (editor = vscode.window.activeTextEditor,full=false) => {
        if(!editor) return
        
        const textDocument = editor.document;
        const {uri} = textDocument
        const uString = uri.toString()
        const decos = (decorations.has(uString)?decorations.get(uString):decorations.set(uString, new Map()).get(uString))!
        if(full) {
            for (const decType of decos.values()) decType.dispose()
            decos.clear()
        }
        const tokensData: vscode.SemanticTokens | undefined =  await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', uri);
        const legend: vscode.SemanticTokensLegend | undefined = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri );
    if(!tokensData || !legend) return
    // const tokens = await textmateTokenService.fetch(textDocument);
    // console.log(await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider',vscode.window.activeTextEditor?.document.uri))
    const ranges = rangesByName(tokensData,legend,editor)
    const  hss = parser.processHss(ranges,rules,textDocument)
    for (const {style,range} of hss) {
        for (const [key,deco] of decos.entries()) {
            if (!range.intersection(key)) continue;
            deco.dispose()
            decos.delete(key)
        }
        const deco = vscode.window.createTextEditorDecorationType(style)
        decos.set(range,deco)
        editor.setDecorations(deco,[range])
    }
}

    vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.fileName !== vscode.window.activeTextEditor?.document.fileName) return;
        if(e.document.fileName.endsWith('.hss')) {
            rules = parser.parseHss(e.document.getText())
            vscode.window.visibleTextEditors.forEach(e => processEditor(e,true))}
        else processEditor()
    })

    vscode.window.visibleTextEditors.forEach(e => processEditor(e)) 
    vscode.window.onDidChangeActiveTextEditor(e => processEditor(e))
};