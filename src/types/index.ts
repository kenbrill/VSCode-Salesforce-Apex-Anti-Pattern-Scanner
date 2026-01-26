import * as vscode from 'vscode';

/**
 * Types of anti-patterns we detect
 */
export enum AntiPatternType {
    SOQLInLoop = 'SOQL_IN_LOOP',
    DMLInLoop = 'DML_IN_LOOP',
    SOQLInLoopViaMethod = 'SOQL_IN_LOOP_VIA_METHOD',
    DMLInLoopViaMethod = 'DML_IN_LOOP_VIA_METHOD',
    HardcodedId = 'HARDCODED_ID',
    MissingLimit = 'MISSING_LIMIT',
    UntestedField = 'UNTESTED_FIELD'
}

/**
 * Severity mapping for anti-patterns
 */
export const AntiPatternSeverity: Record<AntiPatternType, vscode.DiagnosticSeverity> = {
    [AntiPatternType.SOQLInLoop]: vscode.DiagnosticSeverity.Error,
    [AntiPatternType.DMLInLoop]: vscode.DiagnosticSeverity.Error,
    [AntiPatternType.SOQLInLoopViaMethod]: vscode.DiagnosticSeverity.Error,
    [AntiPatternType.DMLInLoopViaMethod]: vscode.DiagnosticSeverity.Error,
    [AntiPatternType.HardcodedId]: vscode.DiagnosticSeverity.Warning,
    [AntiPatternType.MissingLimit]: vscode.DiagnosticSeverity.Warning,
    [AntiPatternType.UntestedField]: vscode.DiagnosticSeverity.Warning
};

/**
 * A detected anti-pattern issue
 */
export interface AntiPatternIssue {
    type: AntiPatternType;
    message: string;
    range: vscode.Range;
    relatedInfo?: {
        location: vscode.Range;
        message: string;
    };
}

/**
 * Represents a loop in the code
 */
export interface LoopInfo {
    type: 'for' | 'while' | 'do-while' | 'for-each';
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
}

/**
 * Represents a SOQL query in the code
 */
export interface SOQLInfo {
    query: string;
    line: number;
    startChar: number;
    endChar: number;
    hasLimit: boolean;
}

/**
 * Represents a DML operation in the code
 */
export interface DMLInfo {
    operation: 'insert' | 'update' | 'delete' | 'upsert' | 'merge' | 'undelete';
    line: number;
    startChar: number;
    endChar: number;
}

/**
 * Represents a method definition in the code
 */
export interface MethodInfo {
    name: string;
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
    containsSOQL: SOQLInfo[];
    containsDML: DMLInfo[];
    callsMethodsNames: string[];
}

/**
 * Represents a method call in the code
 */
export interface MethodCallInfo {
    methodName: string;
    line: number;
    startChar: number;
    endChar: number;
}

/**
 * Represents a hardcoded Salesforce ID
 */
export interface HardcodedIdInfo {
    id: string;
    line: number;
    startChar: number;
    endChar: number;
}

/**
 * Represents a field reference in the code
 */
export interface FieldReferenceInfo {
    fieldName: string;
    objectName?: string;  // Parent object if known (e.g., Account in Account.Name)
    line: number;
    startChar: number;
    endChar: number;
}

/**
 * Extension configuration
 */
export interface ExtensionConfig {
    enableOnSave: boolean;
    enableRealTime: boolean;
    detectSOQLInLoops: boolean;
    detectDMLInLoops: boolean;
    detectHardcodedIds: boolean;
    detectMissingLimits: boolean;
    followMethodCalls: boolean;
    detectUntestedFields: boolean;
}

/**
 * Parsed Apex file information
 */
export interface ParsedApexFile {
    loops: LoopInfo[];
    soqlQueries: SOQLInfo[];
    dmlOperations: DMLInfo[];
    methods: MethodInfo[];
    methodCalls: MethodCallInfo[];
    hardcodedIds: HardcodedIdInfo[];
    fieldReferences: FieldReferenceInfo[];
    isTestClass: boolean;
    className: string;
}
