# Incident Response: Day 4 — Trial Balance Discrepancy INR 2,47,000

## Incident Summary

Trial balance showed INR 2,47,000 discrepancy. Finance could not close
monthly books. RBI notice risk due to delayed regulatory filing.

## Root Cause

Multiple root causes in the legacy system:

1. Different product teams used inconsistent journal entry patterns for the
   same transaction types (cashback reversals posted as credits without
   corresponding debits).
2. Floating-point amounts accumulated sub-paisa rounding differences.
3. No automated trial balance verification — discrepancy went undetected
   for 3–5 days.

## Our Design Solution

### 1. assertBalanced() — Pre-Commit Validation

Every journal entry is validated before the database transaction is committed:

```typescript
assertBalanced(lines.map((l) => ({ entryType: l.entryType, amount: l.amountDecimal })));
// Throws if SUM(debits) ≠ SUM(credits) — transaction rolls back
```

An unbalanced journal entry **cannot reach the database**.

### 2. NUMERIC(19,4) — No Floating Point

All amounts stored as PostgreSQL NUMERIC(19,4). All arithmetic uses decimal.js.
IEEE 754 rounding is impossible.

### 3. Automated Trial Balance Monitoring

`TrialBalanceService.generate()` logs ERROR if discrepancy > 0:

```typescript
if (!isBalanced) {
  this.logger.error(`Trial balance DISCREPANCY: diff=${discrepancy.toFixed(4)}`);
}
```

This fires on every `GET /api/v1/reports/trial-balance` call and on the
scheduled end-of-day batch.

### 4. CLI Verification

```bash
npm run trial-balance
# Exits with code 1 if unbalanced — integrates with CI/CD pipeline
```

### 5. Transaction Handler Registry

All 20 transaction types use dedicated handlers with fixed journal patterns.
No ad-hoc journal entries are possible through the API — the pattern is
enforced in code.
