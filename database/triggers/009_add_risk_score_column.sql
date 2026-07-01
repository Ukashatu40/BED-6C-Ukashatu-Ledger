-- database/triggers/009_add_risk_score_column.sql
-- Zero-downtime migration proof — used by migration-during-load.js
-- This is the same pattern from ADR-006 and Incident Day 14 response.
-- ADD COLUMN with DEFAULT NULL is non-blocking in PostgreSQL 11+.
-- CREATE INDEX CONCURRENTLY does not lock the table.

-- Non-blocking column addition (instant in PostgreSQL 11+)
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,2) DEFAULT NULL;

-- Non-blocking index creation (runs in background, no table lock)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_le_risk_score
  ON ledger_entries (risk_score)
  WHERE risk_score IS NOT NULL;

-- Verify
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name   = 'ledger_entries'
    AND   column_name  = 'risk_score'
  ) = 1, 'risk_score column not found';
  RAISE NOTICE 'Zero-downtime migration applied: risk_score column added';
END $$;