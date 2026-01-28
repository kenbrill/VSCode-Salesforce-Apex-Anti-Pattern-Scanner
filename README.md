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
| Untested Fields | Warning | Detects fields referenced in source classes that are not used in corresponding test classes |
| RecordType Query | Warning | Detects SOQL queries on RecordType object and suggests using Schema methods instead |
| Single SObject Parameter | Warning | Detects methods that accept a single SObject and perform DML on it |
| Non-Bulkified Invocable | Error | Detects `@InvocableMethod` methods that don't accept a List parameter |

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
| `sfAntipattern.detectUntestedFields` | boolean | `true` | Detect fields in source classes not referenced in test classes |
| `sfAntipattern.detectRecordTypeQueries` | boolean | `true` | Detect SOQL queries on RecordType and suggest Schema methods |
| `sfAntipattern.detectNonBulkifiedMethods` | boolean | `true` | Detect single SObject parameters with DML and non-bulkified @InvocableMethod |

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

### Untested Field (Warning)

If your source class queries fields that aren't referenced in the test class, you may have gaps in test coverage:

```apex
// MyClass.cls - Source class
public class MyClass {
    public void cleanup() {
        List<Opportunity> opps = [
            SELECT Id FROM Opportunity
            WHERE Account_Billing_Country__c != 'US'    // <-- Warning: not in test
            AND Account.Sales_Region_Override__c != 'NA' // <-- Warning: not in test
        ];
    }
}

// MyClassTest.cls - Test class (missing field references)
@isTest
private class MyClassTest {
    @isTest
    static void testCleanup() {
        // Test data doesn't set Account_Billing_Country__c or Sales_Region_Override__c
        // This means those filter conditions aren't being tested!
        Account acc = new Account(Name = 'Test');
        insert acc;
        // ...
    }
}
```

The scanner will flag `Account_Billing_Country__c` and `Sales_Region_Override__c` as untested fields, reminding you to add test cases that verify these conditions work correctly.

### RecordType Query (Warning)

SOQL queries on the RecordType object should be replaced with Schema methods:

```apex
// BAD - Uses SOQL (counts against limits)
Map<String, Id> recordTypeMap = new Map<String, Id>();
for (RecordType rt : [SELECT Id, Name FROM RecordType WHERE SObjectType = 'Case']) {
    recordTypeMap.put(rt.Name, rt.Id);
}

// GOOD - Uses Schema (cached, no SOQL limits)
Map<String, Id> recordTypeMap = new Map<String, Id>();
for (Schema.RecordTypeInfo rtInfo : Schema.SObjectType.Case.getRecordTypeInfosByDeveloperName().values()) {
    if (rtInfo.isActive()) {
        recordTypeMap.put(rtInfo.getDeveloperName(), rtInfo.getRecordTypeId());
    }
}

// GOOD - Single RecordType lookup
Id supportRecordTypeId = Schema.SObjectType.Case.getRecordTypeInfosByDeveloperName()
    .get('Support').getRecordTypeId();
```

### Single SObject Parameter (Warning)

Methods that accept a single SObject and perform DML should be bulkified:

```apex
// BAD - Will trigger a warning
public void saveAccount(Account acc) {
    insert acc;  // DML on single record
}

// GOOD - Accept a List for bulk processing
public void saveAccounts(List<Account> accounts) {
    insert accounts;
}
```

### Non-Bulkified Invocable (Error)

`@InvocableMethod` methods must accept a List parameter because they receive bulk input from Flow:

```apex
// BAD - Will trigger an error
@InvocableMethod(label='Create Account')
public static void createAccount(Account acc) {
    insert acc;
}

// BAD - Will trigger an error (non-List collection)
@InvocableMethod(label='Create Account')
public static void createAccount(Set<String> names) {
    // ...
}

// GOOD - Accepts List parameter
@InvocableMethod(label='Create Accounts')
public static void createAccounts(List<Account> accounts) {
    insert accounts;
}

// GOOD - Using request wrapper class
@InvocableMethod(label='Create Accounts')
public static List<Result> createAccounts(List<Request> requests) {
    // Process requests in bulk
}
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
