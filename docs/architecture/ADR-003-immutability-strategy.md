# ADR-003: Immutability Strategy

**Status:** Accepted  
**Date:** 2026-06-26

## Context

Financial regulations (RBI Master Directions, SOX Section 802, PSD2) mandate
that posted accounting records cannot be modified or deleted. The spec (Part A2)
requires at least two immutability mechanisms.

## Decision

**Three-layer immutability:**

### Layer 1 — Application (service layer)

`LedgerService.postJournalEntry` only ever calls `INSERT`. There is no
`UPDATE` or `DELETE` path for ledger entries in the application code.
Corrections use the reversal pattern (new offsetting journal entries).

### Layer 2 — Database Triggers

Two PostgreSQL triggers on `ledger_entries`:

```sql
-- Blocks all updates on POSTED entries except PENDING→POSTED transition
CREATE TRIGGER trg_prevent_ledger_entry_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();

-- Blocks all deletes unconditionally
CREATE TRIGGER trg_prevent_ledger_entry_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_delete();
```

Even direct database access (bypassing the application) cannot mutate posted
entries. The trigger raises `IMMUTABILITY_VIOLATION` with the entry ID and
references the relevant regulation.

### Layer 3 — Cryptographic Hash Chain

Each entry stores a SHA-256 hash of its own data concatenated with the previous
entry's hash. Any tampering breaks the chain at the tampered entry. The
`AuditService.verifyChain()` traverses all entries and recomputes each hash,
reporting the exact break point.

Hash input fields (pipe-delimited):
`id|journalId|accountId|entryType|amount|currency|effectiveDate|createdBy|referenceType|referenceId|narrative|previousHash`

The genesis entry's `previousHash` is 64 zero characters, making the chain
origin verifiable.

## Alternatives Rejected

- **Row-level security (RLS)**: Revokable by superusers; triggers cannot be bypassed by the application user.
- **Append-only table via GRANT**: Protects against application bugs but not DBA access.
- **Event sourcing**: Complete audit trail but adds complexity not required at this scale.

## Consequences

- Errors in posted entries must be corrected via reversal journals (no-mutation principle).
- The hash chain requires sequential insertion — bulk historical loads require re-hashing.
- `exchange_rate_snapshots` applies the same immutability pattern: rates are never updated, only new snapshots inserted.
