import * as vscode from 'vscode';
import {
    ParsedApexFile,
    AntiPatternIssue,
    AntiPatternType,
    ExtensionConfig,
    MethodInfo,
    LoopInfo,
    SOQLInfo,
    DMLInfo
} from '../types';

/**
 * Analyzes parsed Apex code for anti-patterns
 */
export class AntiPatternAnalyzer {
    private config: ExtensionConfig;

    constructor(config: ExtensionConfig) {
        this.config = config;
    }

    /**
     * Analyze the parsed file for anti-patterns
     */
    analyze(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        if (this.config.detectSOQLInLoops) {
            issues.push(...this.detectSOQLInLoops(parsed));
        }

        if (this.config.detectDMLInLoops) {
            issues.push(...this.detectDMLInLoops(parsed));
        }

        if (this.config.detectHardcodedIds) {
            issues.push(...this.detectHardcodedIds(parsed));
        }

        if (this.config.detectMissingLimits) {
            issues.push(...this.detectMissingLimits(parsed));
        }

        return issues;
    }

    /**
     * Detect SOQL queries inside loops
     */
    private detectSOQLInLoops(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        for (const loop of parsed.loops) {
            // Check for direct SOQL in loop
            for (const soql of parsed.soqlQueries) {
                if (this.isInLoop(soql.line, loop)) {
                    issues.push({
                        type: AntiPatternType.SOQLInLoop,
                        message: `SOQL query inside ${loop.type} loop. This can cause governor limit issues. Consider bulkifying by querying outside the loop.`,
                        range: new vscode.Range(
                            soql.line, soql.startChar,
                            soql.line, soql.endChar
                        )
                    });
                }
            }

            // Check for SOQL via method calls (if enabled)
            if (this.config.followMethodCalls) {
                issues.push(...this.detectSOQLViaMethodCalls(parsed, loop));
            }
        }

        return issues;
    }

    /**
     * Detect SOQL in methods called from loops
     */
    private detectSOQLViaMethodCalls(parsed: ParsedApexFile, loop: LoopInfo): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        // Find method calls inside this loop
        for (const call of parsed.methodCalls) {
            if (!this.isInLoop(call.line, loop)) {
                continue;
            }

            // Find the method definition
            const method = parsed.methods.find(m => m.name === call.methodName);
            if (!method) {
                continue;
            }

            // Check if method contains SOQL
            if (method.containsSOQL.length > 0) {
                issues.push({
                    type: AntiPatternType.SOQLInLoopViaMethod,
                    message: `Method '${call.methodName}()' contains SOQL and is called inside a ${loop.type} loop. This can cause governor limit issues.`,
                    range: new vscode.Range(
                        call.line, call.startChar,
                        call.line, call.endChar
                    ),
                    relatedInfo: {
                        location: new vscode.Range(
                            method.containsSOQL[0].line + method.startLine,
                            method.containsSOQL[0].startChar,
                            method.containsSOQL[0].line + method.startLine,
                            method.containsSOQL[0].endChar
                        ),
                        message: `SOQL query in method '${call.methodName}'`
                    }
                });
            }

            // Recursively check methods called by this method
            issues.push(...this.detectSOQLInCalledMethods(parsed, method, loop, call, new Set([method.name])));
        }

        return issues;
    }

    /**
     * Recursively detect SOQL in methods called by other methods
     */
    private detectSOQLInCalledMethods(
        parsed: ParsedApexFile,
        method: MethodInfo,
        loop: LoopInfo,
        originalCall: { line: number; startChar: number; endChar: number; methodName: string },
        visited: Set<string>
    ): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        for (const calledMethodName of method.callsMethodsNames) {
            if (visited.has(calledMethodName)) {
                continue;
            }
            visited.add(calledMethodName);

            const calledMethod = parsed.methods.find(m => m.name === calledMethodName);
            if (!calledMethod) {
                continue;
            }

            if (calledMethod.containsSOQL.length > 0) {
                issues.push({
                    type: AntiPatternType.SOQLInLoopViaMethod,
                    message: `Method '${originalCall.methodName}()' calls '${calledMethodName}()' which contains SOQL. Called inside a ${loop.type} loop.`,
                    range: new vscode.Range(
                        originalCall.line, originalCall.startChar,
                        originalCall.line, originalCall.endChar
                    ),
                    relatedInfo: {
                        location: new vscode.Range(
                            calledMethod.startLine, calledMethod.startChar,
                            calledMethod.startLine, calledMethod.startChar + calledMethodName.length
                        ),
                        message: `SOQL in '${calledMethodName}()' (called via '${method.name}()')`
                    }
                });
            }

            // Continue recursively
            issues.push(...this.detectSOQLInCalledMethods(parsed, calledMethod, loop, originalCall, visited));
        }

        return issues;
    }

    /**
     * Detect DML operations inside loops
     */
    private detectDMLInLoops(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        for (const loop of parsed.loops) {
            // Check for direct DML in loop
            for (const dml of parsed.dmlOperations) {
                if (this.isInLoop(dml.line, loop)) {
                    issues.push({
                        type: AntiPatternType.DMLInLoop,
                        message: `DML operation '${dml.operation}' inside ${loop.type} loop. This can cause governor limit issues. Consider collecting records and performing DML outside the loop.`,
                        range: new vscode.Range(
                            dml.line, dml.startChar,
                            dml.line, dml.endChar
                        )
                    });
                }
            }

            // Check for DML via method calls (if enabled)
            if (this.config.followMethodCalls) {
                issues.push(...this.detectDMLViaMethodCalls(parsed, loop));
            }
        }

        return issues;
    }

    /**
     * Detect DML in methods called from loops
     */
    private detectDMLViaMethodCalls(parsed: ParsedApexFile, loop: LoopInfo): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        // Find method calls inside this loop
        for (const call of parsed.methodCalls) {
            if (!this.isInLoop(call.line, loop)) {
                continue;
            }

            // Find the method definition
            const method = parsed.methods.find(m => m.name === call.methodName);
            if (!method) {
                continue;
            }

            // Check if method contains DML
            if (method.containsDML.length > 0) {
                const dmlOp = method.containsDML[0];
                issues.push({
                    type: AntiPatternType.DMLInLoopViaMethod,
                    message: `Method '${call.methodName}()' contains DML (${dmlOp.operation}) and is called inside a ${loop.type} loop. This can cause governor limit issues.`,
                    range: new vscode.Range(
                        call.line, call.startChar,
                        call.line, call.endChar
                    ),
                    relatedInfo: {
                        location: new vscode.Range(
                            dmlOp.line + method.startLine,
                            dmlOp.startChar,
                            dmlOp.line + method.startLine,
                            dmlOp.endChar
                        ),
                        message: `DML '${dmlOp.operation}' in method '${call.methodName}'`
                    }
                });
            }

            // Recursively check methods called by this method
            issues.push(...this.detectDMLInCalledMethods(parsed, method, loop, call, new Set([method.name])));
        }

        return issues;
    }

    /**
     * Recursively detect DML in methods called by other methods
     */
    private detectDMLInCalledMethods(
        parsed: ParsedApexFile,
        method: MethodInfo,
        loop: LoopInfo,
        originalCall: { line: number; startChar: number; endChar: number; methodName: string },
        visited: Set<string>
    ): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        for (const calledMethodName of method.callsMethodsNames) {
            if (visited.has(calledMethodName)) {
                continue;
            }
            visited.add(calledMethodName);

            const calledMethod = parsed.methods.find(m => m.name === calledMethodName);
            if (!calledMethod) {
                continue;
            }

            if (calledMethod.containsDML.length > 0) {
                const dmlOp = calledMethod.containsDML[0];
                issues.push({
                    type: AntiPatternType.DMLInLoopViaMethod,
                    message: `Method '${originalCall.methodName}()' calls '${calledMethodName}()' which contains DML (${dmlOp.operation}). Called inside a ${loop.type} loop.`,
                    range: new vscode.Range(
                        originalCall.line, originalCall.startChar,
                        originalCall.line, originalCall.endChar
                    ),
                    relatedInfo: {
                        location: new vscode.Range(
                            calledMethod.startLine, calledMethod.startChar,
                            calledMethod.startLine, calledMethod.startChar + calledMethodName.length
                        ),
                        message: `DML '${dmlOp.operation}' in '${calledMethodName}()' (called via '${method.name}()')`
                    }
                });
            }

            // Continue recursively
            issues.push(...this.detectDMLInCalledMethods(parsed, calledMethod, loop, originalCall, visited));
        }

        return issues;
    }

    /**
     * Detect hardcoded Salesforce IDs
     */
    private detectHardcodedIds(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        for (const id of parsed.hardcodedIds) {
            issues.push({
                type: AntiPatternType.HardcodedId,
                message: `Hardcoded Salesforce ID '${id.id}' detected. Hardcoded IDs break between environments. Consider using Custom Settings, Custom Metadata, or queries.`,
                range: new vscode.Range(
                    id.line, id.startChar,
                    id.line, id.endChar
                )
            });
        }

        return issues;
    }

    /**
     * Detect SOQL queries without LIMIT clause
     */
    private detectMissingLimits(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        for (const soql of parsed.soqlQueries) {
            if (!soql.hasLimit) {
                issues.push({
                    type: AntiPatternType.MissingLimit,
                    message: `SOQL query without LIMIT clause. Consider adding LIMIT to prevent unexpected large data volumes.`,
                    range: new vscode.Range(
                        soql.line, soql.startChar,
                        soql.line, soql.endChar
                    )
                });
            }
        }

        return issues;
    }

    /**
     * Check if a line is inside a loop
     */
    private isInLoop(line: number, loop: LoopInfo): boolean {
        return line >= loop.startLine && line <= loop.endLine;
    }
}
