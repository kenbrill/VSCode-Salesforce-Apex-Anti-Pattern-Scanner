import {
    ParsedApexFile,
    LoopInfo,
    SOQLInfo,
    DMLInfo,
    MethodInfo,
    MethodCallInfo,
    HardcodedIdInfo,
    FieldReferenceInfo,
    MethodParameter,
    MethodAnnotation,
    TriggerInfo,
    DeepNestingInfo
} from '../types';

/**
 * Standard Salesforce SObject types
 * todo: move this to either a call to SF (sf describe), and search 
 * requiring the 'Custom Objects' being vailable or this, a static 
 * list that is updated periodically
 */
const STANDARD_SOBJECTS = new Set([
    'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Task', 'Event',
    'Campaign', 'User', 'Profile', 'UserRole', 'Group', 'Asset', 'Contract',
    'Order', 'OrderItem', 'Product2', 'Pricebook2', 'PricebookEntry',
    'Quote', 'QuoteLineItem', 'Solution', 'CampaignMember', 'OpportunityLineItem',
    'OpportunityContactRole', 'AccountContactRole', 'CaseComment', 'FeedItem',
    'ContentDocument', 'ContentVersion', 'Attachment', 'Note', 'Document',
    'EmailMessage', 'EmailTemplate', 'Folder', 'Report', 'Dashboard',
    'RecordType', 'BusinessHours', 'Holiday', 'PermissionSet', 'PermissionSetAssignment',
    'SObject'
]);

/**
 * Parser for Apex code to extract loops, SOQL, DML, methods, etc.
 */
export class ApexParser {
    private text: string;
    private lines: string[];

    constructor(text: string) {
        this.text = text;
        this.lines = text.split('\n');
    }

    /**
     * Parse the Apex file and extract all relevant information
     */
    parse(): ParsedApexFile {
        const triggerInfo = this.findTriggerInfo();
        return {
            loops: this.findLoops(),
            soqlQueries: this.findSOQLQueries(),
            dmlOperations: this.findDMLOperations(),
            methods: this.findMethods(),
            methodCalls: this.findMethodCalls(),
            hardcodedIds: this.findHardcodedIds(),
            fieldReferences: this.findFieldReferences(),
            isTestClass: this.checkIsTestClass(),
            className: this.findClassName(),
            isTrigger: triggerInfo !== null,
            triggerInfo: triggerInfo ?? undefined,
            deepNestings: this.findDeepNestings()
        };
    }

    /**
     * Find all loops in the code
     */
    private findLoops(): LoopInfo[] {
        const loops: LoopInfo[] = [];

        // Track brace depth to find loop boundaries
        const loopStarts: Array<{ type: LoopInfo['type']; line: number; char: number; braceDepth: number }> = [];

        let inString = false;
        let inLineComment = false;
        let inBlockComment = false;
        let stringChar = '';
        let braceDepth = 0;
        let currentLine = 0;
        let currentChar = 0;

        for (let i = 0; i < this.text.length; i++) {
            const char = this.text[i];
            const nextChar = this.text[i + 1] || '';
            const prevChar = this.text[i - 1] || '';

            // Track line and character position
            if (char === '\n') {
                currentLine++;
                currentChar = 0;
                inLineComment = false;
                continue;
            }
            currentChar++;

            // Handle comments
            if (!inString && !inBlockComment && char === '/' && nextChar === '/') {
                inLineComment = true;
                continue;
            }
            if (!inString && !inLineComment && char === '/' && nextChar === '*') {
                inBlockComment = true;
                continue;
            }
            if (inBlockComment && char === '*' && nextChar === '/') {
                inBlockComment = false;
                i++;
                continue;
            }
            if (inLineComment || inBlockComment) {
                continue;
            }

            // Handle strings
            if (!inString && (char === '"' || char === '\'')) {
                inString = true;
                stringChar = char;
                continue;
            }
            if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
                continue;
            }
            if (inString) {
                continue;
            }

            // Track braces via the brett method
            if (char === '{') {
                braceDepth++;
            } else if (char === '}') {
                braceDepth--;

                // Check if this closes a loop
                for (let j = loopStarts.length - 1; j >= 0; j--) {
                    if (loopStarts[j].braceDepth === braceDepth) {
                        const loopStart = loopStarts[j];
                        loops.push({
                            type: loopStart.type,
                            startLine: loopStart.line,
                            endLine: currentLine,
                            startChar: loopStart.char,
                            endChar: currentChar
                        });
                        loopStarts.splice(j, 1);
                        break;
                    }
                }
            }

            // Look for loop keywords
            const textFromHere = this.text.substring(i);

            // For loop (traditional or for-each)
            if (textFromHere.match(/^for\s*\(/i)) {
                const isForEach = this.isForEachLoop(textFromHere);
                loopStarts.push({
                    type: isForEach ? 'for-each' : 'for',
                    line: currentLine,
                    char: currentChar,
                    braceDepth: braceDepth
                });
            }
            // While loop
            else if (textFromHere.match(/^while\s*\(/i) && !textFromHere.match(/^while\s*\([^)]*\)\s*;/i)) {
                loopStarts.push({
                    type: 'while',
                    line: currentLine,
                    char: currentChar,
                    braceDepth: braceDepth
                });
            }
            // Do-while loop
            else if (textFromHere.match(/^do\s*\{/i)) {
                loopStarts.push({
                    type: 'do-while',
                    line: currentLine,
                    char: currentChar,
                    braceDepth: braceDepth
                });
            }
        }

        return loops;
    }

    /**
     * Check if a for loop is a for-each style loop
     */
    private isForEachLoop(text: string): boolean {
        // for-each pattern: for (Type var : collection)
        const match = text.match(/^for\s*\(\s*\w+\s+\w+\s*:/i);
        return match !== null;
    }

    /**
     * Find all SOQL queries in the code
     */
    private findSOQLQueries(): SOQLInfo[] {
        const queries: SOQLInfo[] = [];

        // Match SOQL in brackets: [SELECT ... FROM ...]
        const bracketPattern = /\[\s*(SELECT\s+[\s\S]*?FROM\s+[\s\S]*?)\]/gi;
        let match;

        while ((match = bracketPattern.exec(this.text)) !== null) {
            const query = match[1];
            const startPosition = this.getLineAndChar(match.index);
            const endPosition = this.getLineAndChar(match.index + match[0].length);
            const hasLimit = /\bLIMIT\s+\d+/i.test(query);

            queries.push({
                query: query,
                line: startPosition.line,
                endLine: endPosition.line,
                startChar: startPosition.char,
                endChar: endPosition.char,
                hasLimit: hasLimit
            });
        }

        // Match Database.query()
        const dbQueryPattern = /Database\.query\s*\(/gi;
        while ((match = dbQueryPattern.exec(this.text)) !== null) {
            const position = this.getLineAndChar(match.index);
            // For Database.query, we can't easily determine if it has LIMIT
            queries.push({
                query: 'Database.query(...)',
                line: position.line,
                endLine: position.line,
                startChar: position.char,
                endChar: position.char + match[0].length,
                hasLimit: true // Assume true since we can't check dynamic queries
            });
        }

        return queries;
    }

    /**
     * Find all DML operations in the code
     */
    private findDMLOperations(): DMLInfo[] {
        const operations: DMLInfo[] = [];
        const dmlKeywords = ['insert', 'update', 'delete', 'upsert', 'merge', 'undelete'];

        for (const keyword of dmlKeywords) {
            // Match DML keyword followed by variable/expression (not in comments or strings)
            const pattern = new RegExp(`\\b(${keyword})\\s+([^;]+);`, 'gi');
            let match;

            while ((match = pattern.exec(this.text)) !== null) {
                // Skip if it's part of a larger word or in a comment
                const beforeChar = this.text[match.index - 1] || '';
                if (/\w/.test(beforeChar)) {
                    continue;
                }

                const position = this.getLineAndChar(match.index);

                // Check if this is inside a string or comment
                if (this.isInStringOrComment(match.index)) {
                    continue;
                }

                // Extract target variable name
                const targetExpr = match[2].trim();
                // Get the first word as the variable name (handles expressions like "accounts" or "new Account()")
                const targetMatch = targetExpr.match(/^(\w+)/);
                const targetVariable = targetMatch ? targetMatch[1] : undefined;

                operations.push({
                    operation: keyword as DMLInfo['operation'],
                    line: position.line,
                    startChar: position.char,
                    endChar: position.char + match[0].length,
                    targetVariable: targetVariable
                });
            }
        }

        // Also detect Database.insert(), Database.update(), etc.
        for (const keyword of dmlKeywords) {
            const pattern = new RegExp(`Database\\.${keyword}\\s*\\(([^)]+)\\)`, 'gi');
            let match;

            while ((match = pattern.exec(this.text)) !== null) {
                const position = this.getLineAndChar(match.index);

                if (this.isInStringOrComment(match.index)) {
                    continue;
                }

                // Extract target variable from Database.operation(target, ...)
                const argsStr = match[1].trim();
                const firstArg = argsStr.split(',')[0].trim();
                const targetMatch = firstArg.match(/^(\w+)/);
                const targetVariable = targetMatch ? targetMatch[1] : undefined;

                operations.push({
                    operation: keyword as DMLInfo['operation'],
                    line: position.line,
                    startChar: position.char,
                    endChar: position.char + match[0].length,
                    targetVariable: targetVariable
                });
            }
        }

        return operations;
    }

    /**
     * Find all method definitions in the code
     */
    private findMethods(): MethodInfo[] {
        const methods: MethodInfo[] = [];

        // Pattern to match method definitions
        // Handles: public void methodName(), private static String getX(), etc.
        // Captures: method name and parameter string
        // Represents the most complex regex I haveever written
        // test with https://regex101.com/
        const methodPattern = /(?:(?:public|private|protected|global)\s+)?(?:(?:static|virtual|abstract|override)\s+)*(?:\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*\(([^)]*)\)\s*\{/gi;

        let match;
        while ((match = methodPattern.exec(this.text)) !== null) {
            const methodName = match[1];
            const paramString = match[2];
            const startPosition = this.getLineAndChar(match.index);

            // Find the end of the method by counting braces
            const methodStart = match.index + match[0].length - 1; // Position of opening brace
            const methodEnd = this.findMatchingBrace(methodStart);

            if (methodEnd === -1) {
                continue;
            }

            const endPosition = this.getLineAndChar(methodEnd);
            const methodBody = this.text.substring(methodStart, methodEnd + 1);

            // Parse method body for SOQL, DML, and method calls
            const bodyParser = new ApexParser(methodBody);
            const bodyParsed = {
                soql: bodyParser.findSOQLQueries(),
                dml: bodyParser.findDMLOperations(),
                calls: bodyParser.findMethodCallsInText(methodBody)
            };

            // Parse method parameters
            const parameters = this.parseMethodParameters(paramString);

            // Find annotations before this method
            const annotations = this.findMethodAnnotations(match.index);

            methods.push({
                name: methodName,
                startLine: startPosition.line,
                endLine: endPosition.line,
                startChar: startPosition.char,
                endChar: endPosition.char,
                containsSOQL: bodyParsed.soql,
                containsDML: bodyParsed.dml,
                callsMethodsNames: bodyParsed.calls,
                parameters: parameters,
                annotations: annotations
            });
        }

        return methods;
    }

    /**
     * Find method calls in a text block
     */
    private findMethodCallsInText(text: string): string[] {
        const calls: string[] = [];

        // Match method calls: methodName( or this.methodName(
        const pattern = /(?:this\.)?(\w+)\s*\(/g;
        let match;

        while ((match = pattern.exec(text)) !== null) {
            const methodName = match[1];

            // Skip common keywords that look like method calls
            // kind of a hacky way to do this
            const skipKeywords = ['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'throw'];
            if (skipKeywords.includes(methodName.toLowerCase())) {
                continue;
            }

            // Skip SOQL keywords
            if (['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'LIMIT'].includes(methodName.toUpperCase())) {
                continue;
            }

            if (!calls.includes(methodName)) {
                calls.push(methodName);
            }
        }

        return calls;
    }

    /**
     * Find all method calls in the code (with position info)
     */
    private findMethodCalls(): MethodCallInfo[] {
        const calls: MethodCallInfo[] = [];

        // Match method calls: methodName( or this.methodName(
        const pattern = /(?:this\.)?(\w+)\s*\(/g;
        let match;

        while ((match = pattern.exec(this.text)) !== null) {
            const methodName = match[1];

            // Skip common keywords
            // kind of a hacky way to do this
            const skipKeywords = ['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'throw', 'class', 'interface'];
            if (skipKeywords.includes(methodName.toLowerCase())) {
                continue;
            }

            if (this.isInStringOrComment(match.index)) {
                continue;
            }

            const position = this.getLineAndChar(match.index);

            calls.push({
                methodName: methodName,
                line: position.line,
                startChar: position.char,
                endChar: position.char + match[0].length
            });
        }
        return calls;
    }

    /**
     * Find all hardcoded Salesforce IDs in the code
     */
    private findHardcodedIds(): HardcodedIdInfo[] {
        const ids: HardcodedIdInfo[] = [];

        // Match 15 or 18 character Salesforce IDs in strings
        const pattern = /['"]([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})['"]/g;
        let match;

        while ((match = pattern.exec(this.text)) !== null) {
            const id = match[1];

            // Verify it looks like a Salesforce ID (starts with valid key prefix)
            // Key prefixes are 3 alphanumeric characters
            if (!/^[a-zA-Z0-9]{3}/.test(id)) {
                continue;
            }

            // Skip if it's all numbers (probably not an ID)
            if (/^\d+$/.test(id)) {
                continue;
            }

            // Skip common false positives
            if (id.toLowerCase() === 'abortedjobsummary' || id.length === 15 && /^[a-f0-9]+$/i.test(id)) {
                continue;
            }

            const position = this.getLineAndChar(match.index);

            ids.push({
                id: id,
                line: position.line,
                startChar: position.char,
                endChar: position.char + match[0].length
            });
        }

        return ids;
    }

    /**
     * Find the matching closing brace for an opening brace
     * An insane way to do a simple thing, run this past chatgpt someday
     * to see if there is a better way
     */
    private findMatchingBrace(openBraceIndex: number): number {
        let depth = 1;
        let inString = false;
        let stringChar = '';
        let inLineComment = false;
        let inBlockComment = false;

        for (let i = openBraceIndex + 1; i < this.text.length; i++) {
            const char = this.text[i];
            const nextChar = this.text[i + 1] || '';
            const prevChar = this.text[i - 1] || '';

            // Handle newlines
            if (char === '\n') {
                inLineComment = false;
                continue;
            }

            // Handle comments
            // I use this code in several places now, maybe refactor later
            if (!inString && !inBlockComment && char === '/' && nextChar === '/') {
                inLineComment = true;
                continue;
            }
            if (!inString && !inLineComment && char === '/' && nextChar === '*') {
                inBlockComment = true;
                continue;
            }
            if (inBlockComment && char === '*' && nextChar === '/') {
                inBlockComment = false;
                i++;
                continue;
            }
            if (inLineComment || inBlockComment) {
                continue;
            }

            // Handle strings
            if (!inString && (char === '"' || char === '\'')) {
                inString = true;
                stringChar = char;
                continue;
            }
            if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
                continue;
            }
            if (inString) {
                continue;
            }

            // Track braces
            if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }

        return -1;
    }

    /**
     * Convert a character offset to line and character position
     */
    private getLineAndChar(offset: number): { line: number; char: number } {
        let line = 0;
        let char = 0;

        for (let i = 0; i < offset && i < this.text.length; i++) {
            if (this.text[i] === '\n') {
                line++;
                char = 0;
            } else {
                char++;
            }
        }

        return { line, char };
    }

    /**
     * Check if a position is inside a string or comment
     */
    private isInStringOrComment(offset: number): boolean {
        let inString = false;
        let stringChar = '';
        let inLineComment = false;
        let inBlockComment = false;

        for (let i = 0; i < offset; i++) {
            const char = this.text[i];
            const nextChar = this.text[i + 1] || '';
            const prevChar = this.text[i - 1] || '';

            if (char === '\n') {
                inLineComment = false;
                continue;
            }

            if (!inString && !inBlockComment && char === '/' && nextChar === '/') {
                inLineComment = true;
                continue;
            }
            if (!inString && !inLineComment && char === '/' && nextChar === '*') {
                inBlockComment = true;
                continue;
            }
            if (inBlockComment && char === '*' && nextChar === '/') {
                inBlockComment = false;
                i++;
                continue;
            }

            if (!inString && !inLineComment && !inBlockComment && (char === '"' || char === '\'')) {
                inString = true;
                stringChar = char;
                continue;
            }
            if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
                continue;
            }
        }

        return inString || inLineComment || inBlockComment;
    }

    /**
     * Check if this is a test class
     */
    private checkIsTestClass(): boolean {
        // Look for @isTest annotation or testMethod keyword
        return /@isTest/i.test(this.text) || /\btestMethod\b/i.test(this.text);
    }

    /**
     * Find the class name
     */
    private findClassName(): string {
        // Match class or interface declaration
        const classMatch = this.text.match(/(?:public|private|global)\s+(?:with\s+sharing\s+|without\s+sharing\s+|inherited\s+sharing\s+)?(?:virtual\s+|abstract\s+)?class\s+(\w+)/i);
        if (classMatch) {
            return classMatch[1];
        }
        return '';
    }

    /**
     * Find all field references in the code (custom fields with __c suffix and standard fields)
     */
    private findFieldReferences(): FieldReferenceInfo[] {
        const fields: FieldReferenceInfo[] = [];
        const seenFields = new Set<string>();

        // First, identify "bulk query" ranges (SOQL with >15 fields) to skip
        const bulkQueryRanges = this.findBulkQueryRanges();

        // Pattern 1: Custom fields with __c suffix (e.g., Account_Billing_Country__c, My_Field__c)
        const customFieldPattern = /\b(\w+__c)\b/gi;
        let match;

        while ((match = customFieldPattern.exec(this.text)) !== null) {
            const fieldName = match[1];

            // Skip if inside a bulk query
            if (this.isInRanges(match.index, bulkQueryRanges)) {
                continue;
            }

            // Skip if in string or comment (but allow in SOQL which uses brackets)
            if (this.isInStringOrComment(match.index) && !this.isInSOQLBrackets(match.index)) {
                continue;
            }

            // Skip duplicates
            const normalizedName = fieldName.toLowerCase();
            if (seenFields.has(normalizedName)) {
                continue;
            }
            seenFields.add(normalizedName);

            const position = this.getLineAndChar(match.index);
            fields.push({
                fieldName: fieldName,
                line: position.line,
                startChar: position.char,
                endChar: position.char + fieldName.length
            });
        }

        // Pattern 2: Relationship fields (e.g., Account.Sales_Region_Override__c, Contact.Account.Name)
        const relationshipPattern = /\b(\w+)\.(\w+__c|\w+__r)\b/gi;

        while ((match = relationshipPattern.exec(this.text)) !== null) {
            const objectName = match[1];
            const fieldName = match[2];

            // Skip if inside a bulk query
            if (this.isInRanges(match.index, bulkQueryRanges)) {
                continue;
            }

            // Skip common non-field patterns
            if (['System', 'Database', 'Test', 'Math', 'String', 'Integer', 'Date', 'DateTime', 'Decimal', 'Boolean', 'Schema', 'JSON', 'Type'].includes(objectName)) {
                continue;
            }

            if (this.isInStringOrComment(match.index) && !this.isInSOQLBrackets(match.index)) {
                continue;
            }

            const normalizedName = `${objectName}.${fieldName}`.toLowerCase();
            if (seenFields.has(normalizedName)) {
                continue;
            }
            seenFields.add(normalizedName);

            const position = this.getLineAndChar(match.index);
            fields.push({
                fieldName: fieldName,
                objectName: objectName,
                line: position.line,
                startChar: position.char,
                endChar: position.char + match[0].length
            });
        }

        // Pattern 3: Fields in SOQL SELECT clauses and WHERE clauses
        // Only extract custom fields (__c) from SOQL - standard fields don't need tracking
        const soqlFieldPattern = /\[\s*SELECT\s+([\s\S]*?)\s+FROM\s+(\w+)([\s\S]*?)\]/gi;

        while ((match = soqlFieldPattern.exec(this.text)) !== null) {
            const selectClause = match[1];
            const fromObject = match[2];
            const restOfQuery = match[3] || '';
            const soqlStartIndex = match.index;

            // Extract fields from SELECT clause
            const selectFields = selectClause.split(',').map(f => f.trim());

            // Skip "bulk select" queries with many fields (likely data sync/ETL)
            if (selectFields.length > 15) {
                continue;
            }
            for (const field of selectFields) {
                // Handle relationship fields like Account.Name
                const fieldParts = field.split('.');
                const actualField = fieldParts[fieldParts.length - 1];

                // Only track custom fields (__c) - standard fields don't need test coverage warnings
                if (actualField && actualField.endsWith('__c')) {
                    const normalizedName = actualField.toLowerCase();
                    if (!seenFields.has(normalizedName)) {
                        seenFields.add(normalizedName);
                        // Find the actual position of this field in the text
                        const fieldPosition = this.findFieldPosition(actualField, soqlStartIndex);
                        fields.push({
                            fieldName: actualField,
                            objectName: fieldParts.length > 1 ? fieldParts[fieldParts.length - 2] : fromObject,
                            line: fieldPosition.line,
                            startChar: fieldPosition.startChar,
                            endChar: fieldPosition.endChar
                        });
                    }
                }
            }

            // Extract custom fields from WHERE clause
            const whereMatch = restOfQuery.match(/WHERE\s+([\s\S]*?)(?:ORDER|GROUP|LIMIT|$)/i);
            if (whereMatch) {
                const whereClause = whereMatch[1];
                // Find custom field references in WHERE clause (only __c fields)
                const whereFieldPattern = /\b(\w+__c)\s*(?:=|!=|<|>|<=|>=|LIKE|IN|NOT\s+IN)\s*/gi;
                let whereField;
                while ((whereField = whereFieldPattern.exec(whereClause)) !== null) {
                    const fieldRef = whereField[1];
                    const normalizedName = fieldRef.toLowerCase();
                    if (!seenFields.has(normalizedName)) {
                        seenFields.add(normalizedName);
                        // Find the actual position of this field in the text
                        const fieldPosition = this.findFieldPosition(fieldRef, soqlStartIndex);
                        fields.push({
                            fieldName: fieldRef,
                            objectName: fromObject,
                            line: fieldPosition.line,
                            startChar: fieldPosition.startChar,
                            endChar: fieldPosition.endChar
                        });
                    }
                }
            }
        }

        return fields;
    }

    /**
     * Find ranges of "bulk queries" (SOQL with more than 15 fields in SELECT)
     */
    private findBulkQueryRanges(): Array<{ start: number; end: number }> {
        const ranges: Array<{ start: number; end: number }> = [];
        const soqlPattern = /\[\s*SELECT\s+([\s\S]*?)\s+FROM\s+\w+[\s\S]*?\]/gi;
        let match;

        while ((match = soqlPattern.exec(this.text)) !== null) {
            const selectClause = match[1];
            const fieldCount = selectClause.split(',').length;

            if (fieldCount > 15) {
                ranges.push({
                    start: match.index,
                    end: match.index + match[0].length
                });
            }
        }

        return ranges;
    }

    /**
     * Check if a position falls within any of the given ranges
     */
    private isInRanges(position: number, ranges: Array<{ start: number; end: number }>): boolean {
        for (const range of ranges) {
            if (position >= range.start && position < range.end) {
                return true;
            }
        }
        return false;
    }

    /**
     * Find the actual position of a field name in the text, starting from a given offset
     */
    private findFieldPosition(fieldName: string, startOffset: number): { line: number; startChar: number; endChar: number } {
        // Search for the field name starting from the given offset
        const searchPattern = new RegExp(`\\b${fieldName}\\b`, 'gi');
        searchPattern.lastIndex = startOffset;
        const match = searchPattern.exec(this.text);

        if (match) {
            const position = this.getLineAndChar(match.index);
            return {
                line: position.line,
                startChar: position.char,
                endChar: position.char + fieldName.length
            };
        }

        // Fallback: search from the beginning
        searchPattern.lastIndex = 0;
        const fallbackMatch = searchPattern.exec(this.text);
        if (fallbackMatch) {
            const position = this.getLineAndChar(fallbackMatch.index);
            return {
                line: position.line,
                startChar: position.char,
                endChar: position.char + fieldName.length
            };
        }

        // If not found, return position 0
        return { line: 0, startChar: 0, endChar: fieldName.length };
    }

    /**
     * Check if a keyword is a SOQL reserved word
     */
    private isSOQLKeyword(word: string): boolean {
        const keywords = [
            'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE',
            'ORDER', 'BY', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
            'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'FOR', 'UPDATE', 'VIEW',
            'REFERENCE', 'TRUE', 'FALSE', 'NULL', 'YESTERDAY', 'TODAY',
            'TOMORROW', 'LAST_WEEK', 'THIS_WEEK', 'NEXT_WEEK', 'LAST_MONTH',
            'THIS_MONTH', 'NEXT_MONTH', 'LAST_90_DAYS', 'NEXT_90_DAYS',
            'LAST_N_DAYS', 'NEXT_N_DAYS', 'THIS_QUARTER', 'LAST_QUARTER',
            'NEXT_QUARTER', 'THIS_YEAR', 'LAST_YEAR', 'NEXT_YEAR', 'ALL', 'ROWS'
        ];
        return keywords.includes(word.toUpperCase());
    }

    /**
     * Check if a type is an SObject type
     */
    private isSObjectType(typeName: string): boolean {
        // Remove any generic type parameters
        const baseType = typeName.split('<')[0].trim();

        // Check standard objects
        if (STANDARD_SOBJECTS.has(baseType)) {
            return true;
        }

        // Check custom objects (__c), custom metadata (__mdt), platform events (__e),
        // external objects (__x), big objects (__b)
        if (/__c$/i.test(baseType) || /__mdt$/i.test(baseType) ||
            /__e$/i.test(baseType) || /__x$/i.test(baseType) || /__b$/i.test(baseType)) {
            return true;
        }

        return false;
    }

    /**
     * Parse a type string to detect if it's a collection and extract the base type
     */
    private parseCollectionType(typeStr: string): { isCollection: boolean; baseType: string } {
        const trimmed = typeStr.trim();

        // Check for List<Type>
        const listMatch = trimmed.match(/^List\s*<\s*(.+)\s*>$/i);
        if (listMatch) {
            return { isCollection: true, baseType: listMatch[1].trim() };
        }

        // Check for Set<Type>
        const setMatch = trimmed.match(/^Set\s*<\s*(.+)\s*>$/i);
        if (setMatch) {
            return { isCollection: true, baseType: setMatch[1].trim() };
        }

        // Check for Map<Key, Value> - extract value type as base
        const mapMatch = trimmed.match(/^Map\s*<\s*[^,]+\s*,\s*(.+)\s*>$/i);
        if (mapMatch) {
            return { isCollection: true, baseType: mapMatch[1].trim() };
        }

        // Check for array notation Type[]
        const arrayMatch = trimmed.match(/^(.+)\[\s*\]$/);
        if (arrayMatch) {
            return { isCollection: true, baseType: arrayMatch[1].trim() };
        }

        return { isCollection: false, baseType: trimmed };
    }

    /**
     * Split parameter string respecting nested generics
     */
    private splitParameters(paramString: string): string[] {
        const params: string[] = [];
        let current = '';
        let depth = 0;

        for (const char of paramString) {
            if (char === '<') {
                depth++;
                current += char;
            } else if (char === '>') {
                depth--;
                current += char;
            } else if (char === ',' && depth === 0) {
                if (current.trim()) {
                    params.push(current.trim());
                }
                current = '';
            } else {
                current += char;
            }
        }

        if (current.trim()) {
            params.push(current.trim());
        }

        return params;
    }

    /**
     * Parse method parameters from a parameter string
     */
    private parseMethodParameters(paramString: string): MethodParameter[] {
        const params: MethodParameter[] = [];
        const paramList = this.splitParameters(paramString);

        for (const param of paramList) {
            // Match: [final] Type paramName
            const match = param.match(/^(?:final\s+)?(.+?)\s+(\w+)$/);
            if (match) {
                const fullType = match[1].trim();
                const paramName = match[2];
                const { isCollection, baseType } = this.parseCollectionType(fullType);
                const isSObject = this.isSObjectType(baseType);

                params.push({
                    name: paramName,
                    type: fullType,
                    baseType: baseType,
                    isCollection: isCollection,
                    isSObject: isSObject
                });
            }
        }

        return params;
    }

    /**
     * Find annotations before a method definition
     */
    private findMethodAnnotations(methodStartIndex: number): MethodAnnotation[] {
        const annotations: MethodAnnotation[] = [];

        // Look backwards from the method start to find annotations
        // We need to search the text before the method
        const textBefore = this.text.substring(0, methodStartIndex);

        // Find the last non-whitespace content before the method
        // Annotations should be on the lines immediately before
        const lines = textBefore.split('\n');

        // Start from the last line and work backwards
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();

            // Skip empty lines
            if (!line) {
                continue;
            }

            // Check for annotation
            const annotationMatch = line.match(/^@(\w+)(?:\s*\([^)]*\))?/);
            if (annotationMatch) {
                const annotationName = annotationMatch[1];
                const lineIndex = i;
                const lineStart = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
                const position = this.getLineAndChar(lineStart);

                annotations.push({
                    name: annotationName,
                    line: position.line,
                    startChar: lines[i].indexOf('@'),
                    endChar: lines[i].indexOf('@') + annotationMatch[0].length
                });
            } else {
                // If we hit a non-annotation, non-empty line, stop looking
                // (unless it's a modifier like public, private, etc.)
                if (!/^(public|private|protected|global|static|virtual|abstract|override|with\s+sharing|without\s+sharing|inherited\s+sharing)/.test(line)) {
                    break;
                }
            }
        }

        return annotations;
    }

    /**
     * Check if a position is inside SOQL brackets
     */
    private isInSOQLBrackets(offset: number): boolean {
        let bracketDepth = 0;
        let inSOQL = false;

        for (let i = 0; i < offset; i++) {
            const char = this.text[i];

            if (char === '[') {
                bracketDepth++;
                // Check if this starts a SOQL query
                const ahead = this.text.substring(i + 1, i + 20);
                if (/^\s*SELECT/i.test(ahead)) {
                    inSOQL = true;
                }
            } else if (char === ']') {
                bracketDepth--;
                if (bracketDepth === 0) {
                    inSOQL = false;
                }
            }
        }

        return inSOQL && bracketDepth > 0;
    }

    /**
     * Find trigger definition and check for recursion guard
     */
    private findTriggerInfo(): TriggerInfo | null {
        // Match trigger definition: trigger TriggerName on ObjectName (events) {
        const triggerPattern = /\btrigger\s+(\w+)\s+on\s+(\w+)\s*\(([^)]+)\)\s*\{/i;
        const match = triggerPattern.exec(this.text);

        if (!match) {
            return null;
        }

        const triggerName = match[1];
        const objectName = match[2];
        const eventsString = match[3];
        const startPosition = this.getLineAndChar(match.index);

        // Parse events (before insert, after update, etc.)
        const events = eventsString.split(',').map(e => e.trim().toLowerCase());

        // Find the end of the trigger by counting braces
        const triggerStart = match.index + match[0].length - 1;
        const triggerEnd = this.findMatchingBrace(triggerStart);

        if (triggerEnd === -1) {
            return null;
        }

        const endPosition = this.getLineAndChar(triggerEnd);
        const triggerBody = this.text.substring(triggerStart, triggerEnd + 1);

        // Find DML operations in the trigger body
        const bodyParser = new ApexParser(triggerBody);
        const dmlOperations = bodyParser.findDMLOperations();

        // Check for recursion guard patterns
        const hasRecursionGuard = this.detectRecursionGuard(triggerBody);

        return {
            name: triggerName,
            objectName: objectName,
            events: events,
            startLine: startPosition.line,
            endLine: endPosition.line,
            startChar: startPosition.char,
            endChar: endPosition.char,
            containsDML: dmlOperations,
            hasRecursionGuard: hasRecursionGuard
        };
    }

    /**
     * Detect if code contains a recursion guard pattern
     */
    private detectRecursionGuard(code: string): boolean {
        // Pattern 1: Static boolean check - if (RecursionHandler.isFirstRun) or if (!hasRun)
        const staticBooleanPattern = /\bif\s*\(\s*!?\s*\w+\s*\.\s*(isFirstRun|hasRun|isRunning|isExecuting|firstRun|hasExecuted|isRecursive|runOnce)\b/i;
        if (staticBooleanPattern.test(code)) {
            return true;
        }

        // Pattern 2: Static Set/Map check - if (!processedIds.contains(
        const staticSetPattern = /\bif\s*\(\s*!?\s*\w+\s*\.\s*(contains|containsKey|hasProcessed|isProcessed|isEmpty)\s*\(/i;
        if (staticSetPattern.test(code)) {
            return true;
        }

        // Pattern 3: Direct static variable check - if (TriggerHandler.hasRun == false)
        const staticEqualityPattern = /\bif\s*\(\s*\w+\s*\.\s*\w+\s*(==|!=)\s*(true|false)\s*\)/i;
        if (staticEqualityPattern.test(code)) {
            return true;
        }

        // Pattern 4: Trigger.isExecuting combined with custom flag
        const triggerExecutingPattern = /Trigger\s*\.\s*isExecuting/i;
        if (triggerExecutingPattern.test(code)) {
            return true;
        }

        // Pattern 5: Early return with static check - return if already processed
        const earlyReturnPattern = /\breturn\s*;\s*\}?\s*\n\s*\w+\s*\.\s*\w+\s*=/i;
        if (earlyReturnPattern.test(code)) {
            return true;
        }

        // Pattern 6: Class reference that looks like a recursion handler
        const handlerClassPattern = /\b(RecursionHandler|TriggerRecursionHandler|RecursionControl|TriggerControl|RecursionGuard|TriggerGuard|RecursionPrevention)\b/i;
        if (handlerClassPattern.test(code)) {
            return true;
        }

        // Pattern 7: Setting a static variable at start (hasRun = true, isExecuting = true)
        const setStaticPattern = /\b\w+\s*\.\s*(isFirstRun|hasRun|isRunning|isExecuting|firstRun|hasExecuted)\s*=\s*(true|false)\s*;/i;
        if (setStaticPattern.test(code)) {
            return true;
        }

        return false;
    }

    /**
     * Find deeply nested code blocks
     */
    private findDeepNestings(): DeepNestingInfo[] {
        const deepNestings: DeepNestingInfo[] = [];

        // Track nesting using brace depth - this is more reliable
        // We track the depth at each opening brace and report when we see
        // control structures at deep levels

        let inString = false;
        let inLineComment = false;
        let inBlockComment = false;
        let stringChar = '';
        let currentLine = 0;
        let currentChar = 0;
        let braceDepth = 0;

        // Stack to track control structure depths with their brace level
        const controlStack: Array<{ type: string; braceDepth: number; hasBrace: boolean }> = [];

        // Track which lines we've already reported
        const reportedLines = new Set<number>();

        for (let i = 0; i < this.text.length; i++) {
            const char = this.text[i];
            const nextChar = this.text[i + 1] || '';
            const prevChar = this.text[i - 1] || '';

            // Track line and character position
            if (char === '\n') {
                currentLine++;
                currentChar = 0;
                inLineComment = false;
                continue;
            }
            currentChar++;

            // Handle comments
            if (!inString && !inBlockComment && char === '/' && nextChar === '/') {
                inLineComment = true;
                continue;
            }
            if (!inString && !inLineComment && char === '/' && nextChar === '*') {
                inBlockComment = true;
                continue;
            }
            if (inBlockComment && char === '*' && nextChar === '/') {
                inBlockComment = false;
                i++;
                continue;
            }
            if (inLineComment || inBlockComment) {
                continue;
            }

            // Handle strings
            if (!inString && (char === '"' || char === '\'')) {
                inString = true;
                stringChar = char;
                continue;
            }
            if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
                continue;
            }
            if (inString) {
                continue;
            }

            // Track braces
            if (char === '{') {
                braceDepth++;
                // Mark any pending control structures as having a brace
                for (let j = controlStack.length - 1; j >= 0; j--) {
                    if (!controlStack[j].hasBrace && controlStack[j].braceDepth === braceDepth - 1) {
                        controlStack[j].hasBrace = true;
                        break;
                    }
                }
            } else if (char === '}') {
                // Pop any control structures at this brace level
                while (controlStack.length > 0 &&
                       controlStack[controlStack.length - 1].hasBrace &&
                       controlStack[controlStack.length - 1].braceDepth === braceDepth - 1) {
                    controlStack.pop();
                }
                braceDepth--;
            }

            // Handle semicolons - they end single-statement control structures
            if (char === ';') {
                // Pop any control structures without braces at current level
                while (controlStack.length > 0 && !controlStack[controlStack.length - 1].hasBrace) {
                    controlStack.pop();
                }
            }

            // Look for control structure keywords
            const textFromHere = this.text.substring(i);
            let blockType: string | null = null;

            // Match control structures
            if (textFromHere.match(/^if\s*\(/i)) {
                blockType = 'if';
            } else if (textFromHere.match(/^else\s+if\s*\(/i)) {
                // else if continues at same level, don't add
                blockType = null;
            } else if (textFromHere.match(/^else\b/i)) {
                // else continues at same level
                blockType = null;
            } else if (textFromHere.match(/^for\s*\(/i)) {
                blockType = 'for';
            } else if (textFromHere.match(/^while\s*\(/i)) {
                // Check if it's the while of a do-while (ends with semicolon)
                if (!textFromHere.match(/^while\s*\([^)]*\)\s*;/i)) {
                    blockType = 'while';
                }
            } else if (textFromHere.match(/^do\s*\{/i)) {
                blockType = 'do-while';
            } else if (textFromHere.match(/^try\s*\{/i)) {
                blockType = 'try';
            } else if (textFromHere.match(/^catch\s*\(/i)) {
                // catch is at same level as try
                blockType = null;
            } else if (textFromHere.match(/^finally\s*\{/i)) {
                // finally is at same level as try
                blockType = null;
            } else if (textFromHere.match(/^switch\s+on\s+/i)) {
                blockType = 'switch';
            }

            if (blockType) {
                controlStack.push({
                    type: blockType,
                    braceDepth: braceDepth,
                    hasBrace: false
                });

                // Calculate actual nesting depth based on control stack
                const nestingDepth = controlStack.length;

                // Report if too deep and not already reported for this line
                if (nestingDepth > 3 && !reportedLines.has(currentLine)) {
                    reportedLines.add(currentLine);
                    deepNestings.push({
                        depth: nestingDepth,
                        line: currentLine,
                        startChar: currentChar,
                        endChar: currentChar + blockType.length,
                        blockType: blockType
                    });
                }
            }
        }

        return deepNestings;
    }
}
