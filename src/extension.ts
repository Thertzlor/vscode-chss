import * as vscode from 'vscode'
// import TextmateLanguageService from 'vscode-textmate-languageservice';
import { rangesByName } from './utils/rangesByName';
import { HssParser } from './utils/hssParser';
import {TextDecoder} from 'util';

export async function activate(context: vscode.ExtensionContext) {
    // const selector: vscode.DocumentSelector = 'custom';
    // const textmateService = new TextmateLanguageService('typescript', context);
    // const textmateTokenService = await textmateService.initTokenService();

    const cs = await vscode.workspace.findFiles('hurr.css').then(c => c[0] && vscode.workspace.fs.readFile(c[0]))
    const wa = new TextDecoder().decode(cs);
    const wUri = vscode.workspace.workspaceFolders?.[0]?.uri
    const parser = new HssParser(wUri)

    const decorations = new Map<string,Map<vscode.Range,vscode.TextEditorDecorationType>>()

    let rules = parser.parseHss(wa)
    const processEditor = async (editor = vscode.window.activeTextEditor) => {
        if(!editor) return
        
        const textDocument = editor.document;
        const {uri} = textDocument
        const uString = uri.toString()
        const decos = (decorations.has(uString)?decorations.get(uString):decorations.set(uString, new Map()).get(uString))!
        const tokensData: vscode.SemanticTokens | undefined =  await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', uri);
        const legend: vscode.SemanticTokensLegend | undefined = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri );
    if(!tokensData || !legend) return
    // const tokens = await textmateTokenService.fetch(textDocument);
    const ranges = rangesByName(tokensData,legend,editor)
    console.log(ranges)
    const  hss = parser.processHss(ranges,rules,textDocument)
for (const hssRule of hss) {
    const dec = vscode.window.createTextEditorDecorationType(hssRule.style)
    for (const [key,el] of decos.entries()) {
        if (!hssRule.range.intersection(key)) continue;
        el.dispose() 
        decos.delete(key)
    }
    decos.set(hssRule.range,dec)
editor.setDecorations(dec,[hssRule.range])
    }

}

    vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.fileName !== vscode.window.activeTextEditor?.document.fileName) return;
        if(e.document.fileName.endsWith('.css')) {
            rules = parser.parseHss(e.document.getText())
            vscode.window.visibleTextEditors.forEach(e => processEditor(e))}
        else processEditor()
    })

    processEditor()

};