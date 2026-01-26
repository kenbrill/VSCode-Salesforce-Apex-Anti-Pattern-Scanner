import {
    ParsedApexFile,
    LoopInfo,
    SOQLInfo,
    DMLInfo,
    MethodInfo,
    MethodCallInfo,
    HardcodedIdInfo
} from '../types';

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
        return {
            loops: this.findLoops(),
            soqlQueries: this.findSOQLQueries(),
            dmlOperations: this.findDMLOperations(),
            methods: this.findMethods(),
            methodCalls: this.findMethodCalls(),
            hardcodedIds: this.findHardcodedIds()
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

            // Track braces
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
            const position = this.getLineAndChar(match.index);
            const hasLimit = /\bLIMIT\s+\d+/i.test(query);

            queries.push({
                query: query,
                line: position.line,
                startChar: position.char,
                endChar: position.char + match[0].length,
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
            const pattern = new RegExp(`\\b(${keyword})\\s+[^;]+;`, 'gi');
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

                operations.push({
                    operation: keyword as DMLInfo['operation'],
                    line: position.line,
                    startChar: position.char,
                    endChar: position.char + match[0].length
                });
            }
        }

        // Also detect Database.insert(), Database.update(), etc.
        for (const keyword of dmlKeywords) {
            const pattern = new RegExp(`Database\\.${keyword}\\s*\\(`, 'gi');
            let match;

            while ((match = pattern.exec(this.text)) !== null) {
                const position = this.getLineAndChar(match.index);

                if (this.isInStringOrComment(match.index)) {
                    continue;
                }

                operations.push({
                    operation: keyword as DMLInfo['operation'],
                    line: position.line,
                    startChar: position.char,
                    endChar: position.char + match[0].length
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
        const methodPattern = /(?:(?:public|private|protected|global)\s+)?(?:(?:static|virtual|abstract|override)\s+)*(?:\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*\([^)]*\)\s*\{/gi;

        let match;
        while ((match = methodPattern.exec(this.text)) !== null) {
            const methodName = match[1];
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

            methods.push({
                name: methodName,
                startLine: startPosition.line,
                endLine: endPosition.line,
                startChar: startPosition.char,
                endChar: endPosition.char,
                containsSOQL: bodyParsed.soql,
                containsDML: bodyParsed.dml,
                callsMethodsNames: bodyParsed.calls
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
}
