import * as vscode from 'vscode'
// import TextmateLanguageService from 'vscode-textmate-languageservice';
import { rangesByName } from './utils/rangesByName';
import { readFile } from 'fs';
import { parseHss,processHss } from './utils/hssParser';
import {TextDecoder} from 'util';

export async function activate(context: vscode.ExtensionContext) {
    // const selector: vscode.DocumentSelector = 'custom';
    // const textmateService = new TextmateLanguageService('typescript', context);
    // const textmateTokenService = await textmateService.initTokenService();
    const editor = vscode.window.activeTextEditor;
    if(!editor) return
    const textDocument = editor.document;
    const {uri} = textDocument
    const cs = await vscode.workspace.findFiles('hurr.css').then(c => c[0] && vscode.workspace.fs.readFile(c[0]))
    const wa = new TextDecoder().decode(cs);

    const rules = parseHss(wa)

    const tokensData: vscode.SemanticTokens | undefined =  await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', uri);
    const legend: vscode.SemanticTokensLegend | undefined = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri );
    if(!tokensData || !legend) return
    // const tokens = await textmateTokenService.fetch(textDocument);
    const ranges = rangesByName(tokensData,legend,editor)

const  yo = processHss(ranges,rules)
for (const y of yo) {
editor.setDecorations(vscode.window.createTextEditorDecorationType(y.style),[y.range])
}
};