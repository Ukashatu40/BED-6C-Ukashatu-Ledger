# ADR-005: Reporting Strategy

**Status:** Accepted  
**Date:** 2026-06-26

## Context

The spec requires trial balance, income statement, balance sheet, account
statements, FX exposure report, audit verification, and reconciliation reports.
These must be correct as of any historical date.

## Decision

**Source of truth:** All reports query `ledger_entries` directly with
`effective_date <= as_of_date`. There is no separate reporting database or
pre-aggregated summary table used as the source of truth.

**Balance snapshots** (`balance_snapshots` table) provide a fast read path
for current balance queries but are never used for historical reporting
(snapshot timestamps may not align with arbitrary as-of dates).

**Trial balance invariant:**

> SUM(all DEBIT amounts) = SUM(all CREDIT amounts) for all POSTED entries

This is verified in every trial balance generation. Any discrepancy is logged
as ERROR and included in the response `discrepancy` field.

**Sign convention correction (spec error):**
The trial balance SQL in spec Part A6.1 computes `net_balance` as
`SUM(DEBIT) - SUM(CREDIT)` uniformly. This is incorrect — the sign meaning
depends on account type. Our implementation stores raw debit and credit totals
separately, applies `normalBalanceSign()` per account type for display, and
uses the raw totals for the global balance check.

**Balance sheet identity:** `Assets = Liabilities + Equity`
Verified programmatically after every balance sheet generation. A discrepancy

> INR 0.0001 is flagged.

**Pagination:** Account statements support cursor-based pagination via
`page` and `pageSize` parameters with SQL `LIMIT/OFFSET`.

## Consequences

- Historical reports can be generated for any date without data migration.
- Report queries on large ledgers require the `(account_id, effective_date)` composite index.
- The `ledger_entries` table partitioned by `effective_date` enables partition pruning on date-range queries.
