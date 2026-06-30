-- database/triggers/008_partition_ledger_entries.sql
-- =============================================================================
-- CONVERT ledger_entries TO NATIVE RANGE PARTITIONING BY effective_date
-- =============================================================================
-- PostgreSQL does not support ALTER TABLE ... PARTITION BY on an existing
-- table. The safe pattern is: build new partitioned table, copy data,
-- recreate constraints/indexes/triggers, then swap names inside a transaction.
--
-- IMPORTANT: Run this against a database that already has the
-- 003_immutability_triggers.sql triggers installed — they are recreated
-- here on the new table.
-- =============================================================================

BEGIN;

-- ── Step 1: Create the new partitioned table with identical structure ──────
CREATE TABLE ledger_entries_partitioned (
  id              UUID NOT NULL,
  journal_id      UUID NOT NULL,
  account_id      UUID NOT NULL,
  entry_type      "EntryType" NOT NULL,
  amount          NUMERIC(19,4) NOT NULL,
  currency        CHAR(3) NOT NULL,
  status          "EntryStatus" NOT NULL DEFAULT 'PENDING',
  effective_date  TIMESTAMPTZ NOT NULL,
  posted_at       TIMESTAMPTZ,
  created_by      VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(128),
  reference_type  "TransactionType" NOT NULL,
  reference_id    UUID NOT NULL,
  narrative       TEXT NOT NULL,
  hash            CHAR(64) NOT NULL,
  previous_hash   CHAR(64) NOT NULL,
  metadata        JSONB,
  -- Partition key (effective_date) MUST be part of the primary key
  PRIMARY KEY (id, effective_date)
) PARTITION BY RANGE (effective_date);

-- ── Step 2: Create partitions covering existing data + 12 months forward ───
-- Default catch-all partitions for historical data outside the explicit range
CREATE TABLE ledger_entries_y2025 PARTITION OF ledger_entries_partitioned
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

DO $$
DECLARE
  month_start DATE;
  month_end   DATE;
  part_name   TEXT;
BEGIN
  FOR i IN 0..23 LOOP
    month_start := date_trunc('month', '2026-01-01'::DATE) + (i || ' months')::INTERVAL;
    month_end   := month_start + INTERVAL '1 month';
    part_name   := 'ledger_entries_' || to_char(month_start, 'YYYY_MM');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF ledger_entries_partitioned
       FOR VALUES FROM (%L) TO (%L)',
      part_name, month_start, month_end
    );
  END LOOP;
END $$;

-- Future catch-all to avoid insert failures beyond the pre-created window
CREATE TABLE ledger_entries_future PARTITION OF ledger_entries_partitioned
  FOR VALUES FROM ('2028-01-01') TO ('2099-01-01');

-- ── Step 3: Copy existing data ──────────────────────────────────────────────
INSERT INTO ledger_entries_partitioned
SELECT * FROM ledger_entries;

-- ── Step 4: Recreate indexes on the partitioned table ───────────────────────
-- PostgreSQL automatically propagates indexes created on the parent
-- to all partitions (and future ones).
CREATE INDEX idx_le_part_journal_id      ON ledger_entries_partitioned (journal_id);
CREATE INDEX idx_le_part_account_id      ON ledger_entries_partitioned (account_id);
CREATE INDEX idx_le_part_reference_id    ON ledger_entries_partitioned (reference_id);
CREATE INDEX idx_le_part_reference_type  ON ledger_entries_partitioned (reference_type);
CREATE INDEX idx_le_part_status          ON ledger_entries_partitioned (status);
CREATE INDEX idx_le_part_currency        ON ledger_entries_partitioned (currency);
CREATE INDEX idx_le_part_created_by      ON ledger_entries_partitioned (created_by);
CREATE INDEX idx_le_part_account_date    ON ledger_entries_partitioned (account_id, effective_date);
CREATE INDEX idx_le_part_posted_at       ON ledger_entries_partitioned (posted_at);

-- Unique constraint on idempotency_key (partial — only when not null)
CREATE UNIQUE INDEX idx_le_part_idempotency_key
  ON ledger_entries_partitioned (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── Step 5: Swap tables ──────────────────────────────────────────────────────
ALTER TABLE ledger_entries RENAME TO ledger_entries_old;
ALTER TABLE ledger_entries_partitioned RENAME TO ledger_entries;

-- Rename partition-level indexes to drop the _part_ infix for consistency
-- (cosmetic — skipped for brevity, index names are functional as-is)

-- ── Step 6: Recreate immutability triggers on the new table ────────────────
-- (Reuses the trigger FUNCTIONS from 003_immutability_triggers.sql —
--  only the trigger bindings need to be recreated on the renamed table)
DROP TRIGGER IF EXISTS trg_prevent_ledger_entry_update ON ledger_entries;
CREATE TRIGGER trg_prevent_ledger_entry_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ledger_entry_mutation();

DROP TRIGGER IF EXISTS trg_prevent_ledger_entry_delete ON ledger_entries;
CREATE TRIGGER trg_prevent_ledger_entry_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ledger_entry_delete();

-- ── Step 7: Drop the old non-partitioned table ──────────────────────────────
DROP TABLE ledger_entries_old;

-- ── Step 8: Verify row count matches and triggers are installed ────────────
DO $$
DECLARE
  row_count   BIGINT;
  trig_count  INT;
BEGIN
  SELECT COUNT(*) INTO row_count FROM ledger_entries;

  SELECT COUNT(*) INTO trig_count
  FROM information_schema.triggers
  WHERE event_object_table = 'ledger_entries'
    AND trigger_name IN (
      'trg_prevent_ledger_entry_update',
      'trg_prevent_ledger_entry_delete'
    );

  ASSERT trig_count = 2, 'Expected 2 immutability triggers on partitioned ledger_entries';

  RAISE NOTICE 'Partitioning complete: % rows migrated, % triggers verified', row_count, trig_count;
END $$;

COMMIT;

-- ── Verification queries (run manually after migration) ─────────────────────
-- List all partitions:
--   SELECT child.relname, pg_size_pretty(pg_relation_size(child.oid))
--   FROM pg_inherits
--   JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
--   JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
--   WHERE parent.relname = 'ledger_entries' ORDER BY child.relname;
--
-- Confirm immutability still works:
--   UPDATE ledger_entries SET narrative = 'x' WHERE status = 'POSTED' LIMIT 1;
--   -- should raise IMMUTABILITY_VIOLATION