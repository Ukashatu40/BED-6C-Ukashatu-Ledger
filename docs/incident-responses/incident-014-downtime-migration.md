# Incident Response: Day 14 — 4-Hour Outage During Schema Migration

## Incident Summary

Database maintenance window required a 4-hour outage for schema migration.
All transactions failed during window. Revenue loss and customer trust impact.

## Root Cause

The migration used `ALTER TABLE ... ALTER TYPE` to change an enum column type.
In PostgreSQL, this requires a full table rewrite with an ACCESS EXCLUSIVE lock,
blocking all reads and writes for the duration of the rewrite.

## Our Design Solution

### 1. Non-Blocking Column Addition

```sql
-- PostgreSQL 11+: ADD COLUMN with DEFAULT is instant (no table rewrite)
ALTER TABLE ledger_entries ADD COLUMN risk_score NUMERIC(5,2) DEFAULT NULL;
```

### 2. Concurrent Index Creation

```sql
-- CREATE INDEX CONCURRENTLY does not lock the table
CREATE INDEX CONCURRENTLY idx_ledger_entries_risk ON ledger_entries(risk_score);
```

### 3. Avoid ALTER TYPE

Enum changes use new column + backfill + rename:

```sql
-- Step 1: Add new column with new type (non-blocking)
ALTER TABLE t ADD COLUMN status_v2 VARCHAR(50);
-- Step 2: Backfill (batched, non-blocking)
UPDATE t SET status_v2 = status::TEXT WHERE id > $cursor LIMIT 1000;
-- Step 3: Swap (fast, brief lock)
ALTER TABLE t RENAME COLUMN status TO status_deprecated;
ALTER TABLE t RENAME COLUMN status_v2 TO status;
```

### 4. Zero-Downtime Proof

`tests/load/migration-during-load.js` runs continuous traffic while a
migration is applied. Zero failed requests is the acceptance criterion.

### 5. Prisma Migration Safety

All Prisma migrations use additive operations only in production.
Destructive operations require explicit `--create-only` flag for manual review
before deployment.
