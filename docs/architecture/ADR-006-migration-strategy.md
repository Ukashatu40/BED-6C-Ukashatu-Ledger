# ADR-006: Schema Migration and Data Retention Strategy

**Status:** Accepted  
**Date:** 2026-06-26

## Context

The spec (Part A7) requires versioned migrations, zero-downtime deployment,
and a 10-year data retention policy (RBI mandate for banking records).
Incident Card Day 14 documents a 4-hour outage caused by a blocking migration.

## Decision

**Migration tool:** Prisma Migrate for standard DDL. Raw SQL files in
`database/triggers/` for PostgreSQL-specific features (triggers, partitioning)
that Prisma cannot express declaratively.

**Zero-downtime principles:**

- `ALTER TABLE ... ADD COLUMN` with a DEFAULT is non-blocking in PostgreSQL 11+.
- Never use `ALTER TABLE ... ALTER TYPE` (requires full table rewrite).
- New indexes use `CREATE INDEX CONCURRENTLY` — non-blocking, no table lock.
- Enum additions use a new column + backfill + rename pattern.

**Table partitioning:** `ledger_entries` is range-partitioned by `effective_date`
(monthly partitions). Benefits:

- Partition pruning on date-range queries (trial balance, statements).
- Efficient archival: detach old partitions without touching the main table.
- Parallel query execution across partitions.

**Data retention tiers:**

| Tier               | Age               | Storage                                          | Access                   |
| ------------------ | ----------------- | ------------------------------------------------ | ------------------------ |
| Hot                | 0–90 days         | Primary PostgreSQL                               | Real-time, full indexing |
| Warm               | 90 days – 7 years | Read replica / archive partitions                | Slightly slower          |
| Cold               | 7+ years          | S3 Parquet (exported via `archive-partition.ts`) | Athena/Trino             |
| Regulatory minimum | 10 years          | All tiers combined                               | RBI compliance           |

**Rollback strategy:** Every Prisma migration has a corresponding down migration.
Additive changes (ADD COLUMN, ADD INDEX) are rolled back by DROP. Destructive
changes are prohibited in production without a prior deprecation cycle.

## Consequences

- Partition creation is automated via `scripts/manage-partitions.ts --action create`.
- The `scripts/archive-partition.ts` script exports a partition to CSV before detaching.
- Prisma Migrate tracks applied migrations in `_prisma_migrations` table.
- Raw SQL migrations (triggers, partitions) are tracked manually in `database/triggers/`.
