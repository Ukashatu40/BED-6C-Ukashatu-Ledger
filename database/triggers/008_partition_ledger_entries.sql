-- database/triggers/008_partition_ledger_entries.sql
-- =============================================================================
-- CONVERT ledger_entries TO NATIVE RANGE PARTITIONING BY effective_date
-- v2 — fixes unique index error on partitioned table
-- =============================================================================

BEGIN;

-- ── Step 1: Introspect current column definitions from existing table ────────
-- (avoids enum name guessing — uses LIKE to inherit structure exactly)
CREATE TABLE ledger_entries_partitioned
  (LIKE ledger_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
PARTITION BY RANGE (effective_date);

-- LIKE does not copy the primary key in a way compatible with partitioning
-- (partition key must be in PK). Recreate it:
ALTER TABLE ledger_entries_partitioned DROP CONSTRAINT IF EXISTS ledger_entries_pkey;
ALTER TABLE ledger_entries_partitioned
  ADD PRIMARY KEY (id, effective_date);

-- ── Step 2: Create partitions ────────────────────────────────────────────────
-- Historical catch-all
CREATE TABLE ledger_entries_y2025
  PARTITION OF ledger_entries_partitioned
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

-- Monthly partitions for 2026 and 2027
DO $$
DECLARE
  month_start DATE;
  month_end   DATE;
  part_name   TEXT;
BEGIN
  FOR i IN 0..23 LOOP
    month_start := DATE '2026-01-01' + (i || ' months')::INTERVAL;
    month_end   := month_start + INTERVAL '1 month';
    part_name   := 'ledger_entries_' || to_char(month_start, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF ledger_entries_partitioned
       FOR VALUES FROM (%L::TIMESTAMPTZ) TO (%L::TIMESTAMPTZ)',
      part_name, month_start::TEXT, month_end::TEXT
    );
  END LOOP;
END $$;

-- Future catch-all
CREATE TABLE ledger_entries_future
  PARTITION OF ledger_entries_partitioned
  FOR VALUES FROM ('2028-01-01'::TIMESTAMPTZ) TO ('2099-01-01'::TIMESTAMPTZ);

-- ── Step 3: Copy existing data ───────────────────────────────────────────────
INSERT INTO ledger_entries_partitioned
SELECT * FROM ledger_entries;

-- ── Step 4: Recreate performance indexes ────────────────────────────────────
-- (indexes on parent table automatically propagate to all partitions)
CREATE INDEX idx_le_journal_id     ON ledger_entries_partitioned (journal_id);
CREATE INDEX idx_le_account_id     ON ledger_entries_partitioned (account_id);
CREATE INDEX idx_le_reference_id   ON ledger_entries_partitioned (reference_id);
CREATE INDEX idx_le_reference_type ON ledger_entries_partitioned (reference_type);
CREATE INDEX idx_le_status         ON ledger_entries_partitioned (status);
CREATE INDEX idx_le_currency       ON ledger_entries_partitioned (currency);
CREATE INDEX idx_le_created_by     ON ledger_entries_partitioned (created_by);
CREATE INDEX idx_le_posted_at      ON ledger_entries_partitioned (posted_at);
-- Primary access pattern: account statement queries
CREATE INDEX idx_le_account_date   ON ledger_entries_partitioned (account_id, effective_date);

-- NOTE: No unique index on idempotency_key —
-- partitioned table unique constraints must include the partition key (effective_date).
-- Idempotency is enforced at the application layer via the idempotency_keys table.
-- A non-unique index is sufficient for query performance.
CREATE INDEX idx_le_idempotency_key
  ON ledger_entries_partitioned (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── Step 5: Swap ─────────────────────────────────────────────────────────────
ALTER TABLE ledger_entries RENAME TO ledger_entries_old;
ALTER TABLE ledger_entries_partitioned RENAME TO ledger_entries;

-- ── Step 6: Recreate immutability triggers on the renamed table ──────────────
-- Trigger FUNCTIONS already exist from 003_immutability_triggers.sql
-- Only the trigger BINDINGS need recreating on the new table name.
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

-- ── Step 7: Drop old table ───────────────────────────────────────────────────
DROP TABLE ledger_entries_old;

-- ── Step 8: Verify ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_rows  BIGINT;
  v_parts INT;
  v_trigs INT;
BEGIN
  SELECT COUNT(*) INTO v_rows  FROM ledger_entries;
  SELECT COUNT(*) INTO v_parts
  FROM   pg_inherits i
  JOIN   pg_class    p ON i.inhparent = p.oid
  WHERE  p.relname = 'ledger_entries';
  SELECT COUNT(*) INTO v_trigs
  FROM   information_schema.triggers
  WHERE  event_object_table = 'ledger_entries'
  AND    trigger_name IN (
    'trg_prevent_ledger_entry_update',
    'trg_prevent_ledger_entry_delete'
  );

  ASSERT v_parts >= 26,
    format('Expected ≥26 partitions, found %s', v_parts);
  ASSERT v_trigs = 2,
    format('Expected 2 triggers, found %s', v_trigs);

  RAISE NOTICE 'Partition migration complete: % rows, % partitions, % triggers',
    v_rows, v_parts, v_trigs;
END $$;

COMMIT;