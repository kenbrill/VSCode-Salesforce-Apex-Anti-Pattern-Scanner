# Salesforce Apex Anti-Pattern Scanner

A Visual Studio Code extension that detects common Apex anti-patterns in real-time, helping you write better Salesforce code and avoid governor limit issues.

## Features

### Anti-Pattern Detection

| Anti-Pattern | Severity | Description |
|-------------|----------|-------------|
| SOQL in Loops | Error | Detects SOQL queries executed inside `for`, `while`, or `do-while` loops |
| DML in Loops | Error | Detects DML operations (`insert`, `update`, `delete`, `upsert`, `merge`, `undelete`) inside loops |
| SOQL via Method Calls | Error | Detects methods containing SOQL that are called from within loops |
| DML via Method Calls | Error | Detects methods containing DML that are called from within loops |
| Hardcoded IDs | Warning | Detects hardcoded Salesforce record IDs that break between environments |
| Missing LIMIT | Warning | Detects SOQL queries without a `LIMIT` clause (disabled by default) |

### Real-Time Analysis

- Scans Apex files as you type (debounced for performance)
- Scans on file save
- Scans when files are opened
- Provides inline diagnostics in the editor

### Workspace Scanning

Scan your entire workspace for anti-patterns with a single command.

## Installation

1. Open VS Code
2. Press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (Mac) to open Extensions
3. Search for "Salesforce Apex Anti-Pattern Scanner"
4. Click Install

## Usage

### Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

- **Salesforce: Scan File for Anti-Patterns** - Scan the currently open Apex file
- **Salesforce: Scan Workspace for Anti-Patterns** - Scan all `.cls` files in the workspace

### Viewing Issues

Issues appear in:
- The editor as squiggly underlines (red for errors, yellow for warnings, blue for info)
- The Problems panel (`Ctrl+Shift+M` / `Cmd+Shift+M`)

## Configuration

Configure the extension in VS Code settings (`Ctrl+,` / `Cmd+,`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `sfAntipattern.enableOnSave` | boolean | `true` | Scan for anti-patterns when saving Apex files |
| `sfAntipattern.enableRealTime` | boolean | `true` | Scan for anti-patterns in real-time as you type |
| `sfAntipattern.detectSOQLInLoops` | boolean | `true` | Detect SOQL queries inside loops |
| `sfAntipattern.detectDMLInLoops` | boolean | `true` | Detect DML operations inside loops |
| `sfAntipattern.detectHardcodedIds` | boolean | `true` | Detect hardcoded Salesforce IDs |
| `sfAntipattern.detectMissingLimits` | boolean | `false` | Detect SOQL queries without LIMIT clause |
| `sfAntipattern.followMethodCalls` | boolean | `true` | Follow method calls to detect SOQL/DML in called methods |

### Example settings.json

```json
{
  "sfAntipattern.enableRealTime": true,
  "sfAntipattern.detectMissingLimits": true,
  "sfAntipattern.followMethodCalls": true
}
```

## Examples

### SOQL in Loop (Error)

```apex
// BAD - Will trigger an error
for (Account acc : accounts) {
    List<Contact> contacts = [SELECT Id FROM Contact WHERE AccountId = :acc.Id];
}

// GOOD - Query outside the loop
Map<Id, List<Contact>> contactsByAccount = new Map<Id, List<Contact>>();
for (Contact c : [SELECT Id, AccountId FROM Contact WHERE AccountId IN :accountIds]) {
    if (!contactsByAccount.containsKey(c.AccountId)) {
        contactsByAccount.put(c.AccountId, new List<Contact>());
    }
    contactsByAccount.get(c.AccountId).add(c);
}
```

### DML in Loop (Error)

```apex
// BAD - Will trigger an error
for (Account acc : accounts) {
    acc.Name = 'Updated';
    update acc;
}

// GOOD - Collect and update outside the loop
for (Account acc : accounts) {
    acc.Name = 'Updated';
}
update accounts;
```

### Hardcoded ID (Warning)

```apex
// BAD - Will trigger a warning
Account acc = [SELECT Id FROM Account WHERE Id = '001000000000001'];

// GOOD - Use Custom Settings or Custom Metadata
Account acc = [SELECT Id FROM Account WHERE Id = :MyCustomSetting__c.getInstance().AccountId__c];
```

## Why These Patterns Matter

Salesforce enforces [governor limits](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm) to ensure efficient use of shared resources:

- **100 SOQL queries** per synchronous transaction
- **150 DML statements** per transaction
- **10,000 records** retrieved by SOQL queries

Code that executes SOQL or DML inside loops can easily exceed these limits when processing bulk data, causing runtime failures.

## Requirements

- Visual Studio Code 1.85.0 or higher
- Apex language support (Salesforce Extension Pack recommended)

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT
