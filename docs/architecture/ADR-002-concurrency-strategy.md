# ADR-002: Concurrency Strategy — Double-Spend Prevention

**Status:** Accepted  
**Date:** 2026-06-26

## Context

A ledger must prevent double-spend: two concurrent transactions must not both
read the same balance and both succeed, resulting in a negative balance. The
spec (Part A4.3, Incident Card Day 10, Case Study 4) requires a demonstrated
concurrency control strategy.

## Decision

**Primary: PostgreSQL Advisory Locks (`pg_advisory_xact_lock`)**

Before any balance check and debit, the service acquires a transaction-scoped
advisory lock keyed on the account UUID (converted to bigint). The lock is
automatically released at COMMIT or ROLLBACK.

```sql
SELECT pg_advisory_xact_lock($1);  -- blocks until acquired
```

**Deadlock Prevention:** When multiple accounts are involved (P2P transfer),
locks are always acquired in ascending UUID order. This canonical ordering
prevents the circular wait condition that causes deadlocks.

**Secondary: Derived Balance (never stored)**

Account balances are never stored as mutable columns. The authoritative balance
is always:

```sql
SUM(CASE WHEN entry_type = 'DEBIT' THEN amount ELSE -amount END)
FROM ledger_entries WHERE account_id = $1 AND status = 'POSTED'
```

This eliminates the UPDATE contention that would occur if balance were a column.

**Why Not SERIALIZABLE Isolation:**

SERIALIZABLE provides the strongest guarantee but has a higher abort rate. For
a high-throughput ledger, advisory locks give equivalent protection for the
specific case of account-level balance checks with lower overhead. SERIALIZABLE
is used for idempotency key reservation where phantom reads would cause
duplicate processing.

## Consequences

- Advisory locks are connection-scoped; lost connection releases the lock automatically.
- Lock ordering must be maintained consistently across all transaction handlers.
- The `checkBalanceOn` parameter in `LedgerService.postJournalEntry` must be
  passed correctly by each transaction handler — deposit handlers pass `[]`,
  withdrawal/payment handlers pass the wallet account ID.
