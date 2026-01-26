import * as vscode from 'vscode';
import { ApexParser } from './parser/apexParser';
import { AntiPatternAnalyzer } from './analyzer/antiPatternAnalyzer';
import { ExtensionConfig, AntiPatternSeverity, AntiPatternIssue } from './types';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    console.log('Salesforce Anti-Pattern Scanner is now active');

    // Create diagnostic collection
    diagnosticCollection = vscode.languages.createDiagnosticCollection('sfAntipattern');
    context.subscriptions.push(diagnosticCollection);

    // Register commands
    const scanFileCommand = vscode.commands.registerCommand(
        'sfAntipattern.scanFile',
        () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'apex') {
                scanDocument(editor.document);
            } else {
                vscode.window.showWarningMessage('Please open an Apex file to scan');
            }
        }
    );

    const scanWorkspaceCommand = vscode.commands.registerCommand(
        'sfAntipattern.scanWorkspace',
        async () => {
            const apexFiles = await vscode.workspace.findFiles('**/*.cls', '**/node_modules/**');
            let totalIssues = 0;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Scanning workspace for anti-patterns...',
                    cancellable: true
                },
                async (progress, token) => {
                    for (let i = 0; i < apexFiles.length; i++) {
                        if (token.isCancellationRequested) {
                            break;
                        }

                        const file = apexFiles[i];
                        progress.report({
                            message: `Scanning ${file.fsPath.split('/').pop()}`,
                            increment: (100 / apexFiles.length)
                        });

                        const document = await vscode.workspace.openTextDocument(file);
                        const issues = scanDocument(document);
                        totalIssues += issues;
                    }
                }
            );

            vscode.window.showInformationMessage(
                `Scan complete. Found ${totalIssues} anti-pattern issue(s) in ${apexFiles.length} file(s).`
            );
        }
    );

    context.subscriptions.push(scanFileCommand, scanWorkspaceCommand);

    // Scan on save (if enabled)
    const onSaveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
        const config = getConfig();
        if (config.enableOnSave && document.languageId === 'apex') {
            scanDocument(document);
        }
    });
    context.subscriptions.push(onSaveDisposable);

    // Real-time scanning (if enabled)
    let debounceTimer: NodeJS.Timeout | undefined;
    const onChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        const config = getConfig();
        if (config.enableRealTime && event.document.languageId === 'apex') {
            // Debounce to avoid scanning on every keystroke
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                scanDocument(event.document);
            }, 500);
        }
    });
    context.subscriptions.push(onChangeDisposable);

    // Scan open Apex files on activation
    vscode.window.visibleTextEditors.forEach(editor => {
        if (editor.document.languageId === 'apex') {
            scanDocument(editor.document);
        }
    });

    // Scan when an Apex file is opened
    const onOpenDisposable = vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === 'apex') {
            scanDocument(document);
        }
    });
    context.subscriptions.push(onOpenDisposable);
}

/**
 * Get extension configuration
 */
function getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('sfAntipattern');
    return {
        enableOnSave: config.get<boolean>('enableOnSave', true),
        enableRealTime: config.get<boolean>('enableRealTime', true),
        detectSOQLInLoops: config.get<boolean>('detectSOQLInLoops', true),
        detectDMLInLoops: config.get<boolean>('detectDMLInLoops', true),
        detectHardcodedIds: config.get<boolean>('detectHardcodedIds', true),
        detectMissingLimits: config.get<boolean>('detectMissingLimits', false),
        followMethodCalls: config.get<boolean>('followMethodCalls', true)
    };
}

/**
 * Scan a document for anti-patterns
 */
function scanDocument(document: vscode.TextDocument): number {
    const config = getConfig();
    const text = document.getText();

    // Parse the Apex file
    const parser = new ApexParser(text);
    const parsed = parser.parse();

    // Analyze for anti-patterns
    const analyzer = new AntiPatternAnalyzer(config);
    const issues = analyzer.analyze(parsed);

    // Convert to VS Code diagnostics
    const diagnostics = issues.map(issue => createDiagnostic(issue, document));

    // Update diagnostics
    diagnosticCollection.set(document.uri, diagnostics);

    return issues.length;
}

/**
 * Create a VS Code diagnostic from an anti-pattern issue
 */
function createDiagnostic(issue: AntiPatternIssue, document: vscode.TextDocument): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(
        issue.range,
        issue.message,
        AntiPatternSeverity[issue.type]
    );

    diagnostic.source = 'Salesforce Anti-Pattern Scanner';
    diagnostic.code = issue.type;

    // Add related information if available
    if (issue.relatedInfo) {
        diagnostic.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, issue.relatedInfo.location),
                issue.relatedInfo.message
            )
        ];
    }

    return diagnostic;
}

export function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}
