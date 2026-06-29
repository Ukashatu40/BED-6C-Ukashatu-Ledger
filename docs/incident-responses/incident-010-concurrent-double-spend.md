# Incident Response: Day 10 — Concurrent Withdrawals Left Account at -INR 8,500

## Incident Summary

Two concurrent withdrawals on the same account both succeeded, leaving the
account with a negative INR 8,500 balance. Actual financial loss.

## Root Cause

Classic TOCTOU (Time-of-Check-to-Time-of-Update) race condition:

1. Transaction A reads balance: INR 8,500. Sufficient for INR 5,000 withdrawal.
2. Transaction B reads balance: INR 8,500. Sufficient for INR 5,000 withdrawal.
3. Transaction A commits debit. Balance: INR 3,500.
4. Transaction B commits debit. Balance: INR -1,500. ❌

## Our Design Solution

### 1. Advisory Locks

```typescript
await this.db.acquireAdvisoryLocks(tx, [walletAccountId]);
// pg_advisory_xact_lock blocks Transaction B until Transaction A commits
```

### 2. Lock Ordering

Multiple account locks always acquired in ascending UUID order:

```typescript
const sorted = [...accountIds].sort(); // ascending string sort
for (const id of sorted) {
  await acquireLock(tx, id);
}
```

This prevents deadlock when Transaction A locks [account1, account2] and
Transaction B locks [account2, account1] simultaneously.

### 3. Derived Balance Inside Lock

Balance is re-derived from ledger entries after the lock is acquired,
inside the same transaction. This eliminates the TOCTOU window.

### 4. Test Proof

```typescript
// 20 concurrent withdrawal attempts of INR 1,000 against INR 10,000 balance
const results = await Promise.allSettled(20 attempts);
// Maximum 10 succeed; balance never goes negative
expect(successes).toBeLessThanOrEqual(10);
expect(parseFloat(finalBalance)).toBeGreaterThanOrEqual(0);
```
