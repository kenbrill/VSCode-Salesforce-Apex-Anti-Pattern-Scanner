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

        if (this.config.detectRecordTypeQueries) {
            issues.push(...this.detectRecordTypeQueries(parsed));
        }

        if (this.config.detectNonBulkifiedMethods) {
            issues.push(...this.detectSingleSObjectParameter(parsed));
            issues.push(...this.detectNonBulkifiedInvocable(parsed));
        }

        if (this.config.detectTriggerRecursion) {
            issues.push(...this.detectTriggerWithoutRecursionGuard(parsed));
        }

        if (this.config.detectDeeplyNestedCode) {
            issues.push(...this.detectDeeplyNestedCode(parsed));
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
                            soql.endLine, soql.endChar
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
                        soql.endLine, soql.endChar
                    )
                });
            }
        }

        return issues;
    }

    /**
     * Detect SOQL queries on RecordType object
     */
    private detectRecordTypeQueries(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        for (const soql of parsed.soqlQueries) {
            // Check if the query is selecting from RecordType
            if (/\bFROM\s+RecordType\b/i.test(soql.query)) {
                issues.push({
                    type: AntiPatternType.RecordTypeQuery,
                    message: `Avoid SOQL on RecordType. Use Schema.SObjectType.YourSFObject.getRecordTypeInfosByDeveloperName() instead - it's cached and doesn't count against SOQL limits.`,
                    range: new vscode.Range(
                        soql.line, soql.startChar,
                        soql.endLine, soql.endChar
                    )
                });
            }
        }

        return issues;
    }

    /**
     * Detect methods with single SObject parameters that perform DML on them
     */
    private detectSingleSObjectParameter(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        for (const method of parsed.methods) {
            // Skip if method has no parameters or has collection parameters
            if (method.parameters.length !== 1) {
                continue;
            }

            const param = method.parameters[0];

            // Check if the single parameter is a non-collection SObject
            if (!param.isSObject || param.isCollection) {
                continue;
            }

            // Check if the method contains DML that targets this parameter
            for (const dml of method.containsDML) {
                if (dml.targetVariable === param.name) {
                    issues.push({
                        type: AntiPatternType.SingleSObjectParameter,
                        message: `Method '${method.name}' accepts a single ${param.type} and performs DML on it. Consider accepting List<${param.type}> for bulkification.`,
                        range: new vscode.Range(
                            method.startLine, method.startChar,
                            method.startLine, method.startChar + method.name.length + 20
                        )
                    });
                    break; // Only report once per method
                }
            }
        }

        return issues;
    }

    /**
     * Detect @InvocableMethod methods that don't accept a List parameter
     */
    private detectNonBulkifiedInvocable(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        for (const method of parsed.methods) {
            // Check if method has @InvocableMethod annotation
            const hasInvocableMethod = method.annotations.some(
                a => a.name.toLowerCase() === 'invocablemethod'
            );

            if (!hasInvocableMethod) {
                continue;
            }

            // @InvocableMethod must have exactly one parameter that is a List
            if (method.parameters.length === 0) {
                issues.push({
                    type: AntiPatternType.NonBulkifiedInvocable,
                    message: `@InvocableMethod '${method.name}' must accept a List parameter. Invocable methods receive bulk input.`,
                    range: new vscode.Range(
                        method.startLine, method.startChar,
                        method.startLine, method.startChar + method.name.length + 20
                    )
                });
                continue;
            }

            const firstParam = method.parameters[0];

            // Check if the first parameter is a List
            if (!firstParam.isCollection || !firstParam.type.toLowerCase().startsWith('list')) {
                issues.push({
                    type: AntiPatternType.NonBulkifiedInvocable,
                    message: `@InvocableMethod '${method.name}' should accept a List<${firstParam.type}> parameter. Invocable methods receive bulk input and should be bulkified.`,
                    range: new vscode.Range(
                        method.startLine, method.startChar,
                        method.startLine, method.startChar + method.name.length + 20
                    )
                });
            }
        }

        return issues;
    }

    /**
     * Detect triggers with DML that lack recursion protection
     */
    private detectTriggerWithoutRecursionGuard(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        // Only check trigger files
        if (!parsed.isTrigger || !parsed.triggerInfo) {
            return issues;
        }

        const trigger = parsed.triggerInfo;

        // Only flag if trigger contains DML and has no recursion guard
        if (trigger.containsDML.length > 0 && !trigger.hasRecursionGuard) {
            // Check if it's an "after" trigger with update/insert DML (most likely to cause recursion)
            const hasAfterEvent = trigger.events.some(e => e.includes('after'));
            const hasDMLThatCanCauseRecursion = trigger.containsDML.some(
                dml => ['insert', 'update', 'upsert'].includes(dml.operation)
            );

            if (hasAfterEvent && hasDMLThatCanCauseRecursion) {
                const dmlOperations = trigger.containsDML
                    .map(d => d.operation)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .join(', ');

                issues.push({
                    type: AntiPatternType.TriggerWithoutRecursionGuard,
                    message: `Trigger '${trigger.name}' contains DML (${dmlOperations}) without recursion protection. This may cause infinite recursion. Consider using a static variable to prevent re-entry.`,
                    range: new vscode.Range(
                        trigger.startLine, trigger.startChar,
                        trigger.startLine, trigger.startChar + trigger.name.length + 10
                    )
                });
            }
        }

        return issues;
    }

    /**
     * Detect deeply nested code blocks
     */
    private detectDeeplyNestedCode(parsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];
        const maxDepth = this.config.maxNestingDepth || 3;

        for (const nesting of parsed.deepNestings) {
            if (nesting.depth > maxDepth) {
                issues.push({
                    type: AntiPatternType.DeeplyNestedCode,
                    message: `Code is nested ${nesting.depth} levels deep (${nesting.blockType}). Consider extracting to a separate method to improve readability. Maximum recommended: ${maxDepth} levels.`,
                    range: new vscode.Range(
                        nesting.line, nesting.startChar,
                        nesting.line, nesting.endChar + 10
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

    /**
     * Analyze for fields in source class that aren't referenced in test class
     */
    analyzeUntestedFields(sourceParsed: ParsedApexFile, testParsed: ParsedApexFile): AntiPatternIssue[] {
        const issues: AntiPatternIssue[] = [];

        // Get all CUSTOM field names from source class (only __c fields)
        // Standard fields are well-tested by Salesforce and don't need coverage warnings
        const sourceFields = new Map<string, { fieldName: string; line: number; startChar: number; endChar: number }>();
        for (const field of sourceParsed.fieldReferences) {
            // Only track custom fields (ending in __c)
            if (!field.fieldName.toLowerCase().endsWith('__c')) {
                continue;
            }
            const normalizedName = field.fieldName.toLowerCase();
            if (!sourceFields.has(normalizedName)) {
                sourceFields.set(normalizedName, {
                    fieldName: field.fieldName,
                    line: field.line,
                    startChar: field.startChar,
                    endChar: field.endChar
                });
            }
        }

        // Get all field names from test class (normalized to lowercase)
        const testFields = new Set<string>();
        for (const field of testParsed.fieldReferences) {
            testFields.add(field.fieldName.toLowerCase());
        }

        // Find custom fields in source that aren't in test
        for (const [normalizedName, fieldInfo] of sourceFields) {
            if (!testFields.has(normalizedName)) {
                // Skip relationship fields (ending in __r) - shouldn't happen but just in case
                if (normalizedName.endsWith('__r')) {
                    continue;
                }

                issues.push({
                    type: AntiPatternType.UntestedField,
                    message: `Custom field '${fieldInfo.fieldName}' is referenced in source class but not in test class. Consider adding test coverage for this field.`,
                    range: new vscode.Range(
                        fieldInfo.line, fieldInfo.startChar,
                        fieldInfo.line, fieldInfo.endChar
                    )
                });
            }
        }

        return issues;
    }
}
