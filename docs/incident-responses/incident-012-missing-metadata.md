# Incident Response: Day 12 — 340 Entries Without Creator Metadata

## Incident Summary

Compliance audit found 340 ledger entries without `created_by` metadata.
Cannot trace who initiated these transactions. Audit finding raised.
Remediation required.

## Root Cause

The `created_by` field was nullable in the legacy schema. Some integration
paths did not pass the actor identity, resulting in NULL values that make
the audit trail incomplete and legally inadmissible.

## Our Design Solution

### 1. NOT NULL Constraint

```sql
created_by VARCHAR(255) NOT NULL
```

The database schema itself prevents NULL `created_by` on any ledger entry.

### 2. @AuditActor() Decorator

```typescript
@AuditActor() actor: string
// Extracts X-User-ID header; falls back to API key identity; defaults to 'SYSTEM'
// Never returns null or undefined
```

Every controller method that writes to the ledger receives `actor` as a
typed non-nullable string.

### 3. Application Enforcement

`LedgerService.postJournalEntry` requires `createdBy: string` as a parameter.
TypeScript strict mode prevents passing `undefined` or `null`.

### 4. Anomaly Detection

The `AuditService.detectAnomalies()` method flags entries where `created_by`
matches suspicious patterns, complementing the structural enforcement.
