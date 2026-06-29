// docs/reviews/submission-email.md

To: hr@zetheta.com
Subject: BED-6C Submission — Ukashatu — Intern ID 493556B — Ledger System

Dear Zetheta Assessment Team,

Please find below my submission for the BED-6C assessment:
Ledger System with Double-Entry Accounting & Immutable Audit Trail.

INTERN ID: 493556B
REPOSITORY: BED-6C-Ukashatu-Ledger
SUBMISSION DATE: 2026-06-29

─────────────────────────────────────────
WHAT WAS BUILT
─────────────────────────────────────────

A production-grade double-entry ledger system built with NestJS, TypeScript,
PostgreSQL 15, and Prisma. Key capabilities:

- All 20 transaction types from the spec, each with correct debit/credit
  patterns validated by assertBalanced() before every database commit
- SHA-256 cryptographic hash chain on every ledger entry — tamper detection
  reports the exact entry where the chain breaks
- PostgreSQL advisory locks with ordered acquisition preventing double-spend
  under concurrent load (proven by integration tests)
- NUMERIC(19,4) storage and decimal.js arithmetic throughout — no floating
  point anywhere in the money calculation path (Revolut rounding incident defence)
- Three-layer immutability: application layer + PostgreSQL BEFORE triggers +
  cryptographic hash chain
- Multi-currency FX engine with validity windows and stale-rate rejection
  (Incident Day 6 direct fix)
- Full and partial reversals with three fee policies per spec A5.2
- Complete reporting suite: trial balance, income statement, balance sheet
  (A=L+E verified), account statements, FX exposure report
- 53 tests passing: 37 unit + 16 integration

─────────────────────────────────────────
DELIBERATE SPEC ERRORS IDENTIFIED
─────────────────────────────────────────

Four deliberate errors were found in the specification and corrected:

1. Trial balance SQL sign convention (Part A6.1) — the provided SQL applies
   debit-minus-credit uniformly, which is incorrect for Liability/Equity/Revenue
   accounts whose normal balance is Credit.

2. P2P transfer debit/credit label direction (Part A1.3) — the amounts appear
   in the wrong debit/credit columns for the sender wallet line.

3. FX holding account currency violation (Part A3.2) — a single account
   cannot hold both USD and INR. Separate per-currency holding accounts are required.

4. Idempotency scope inconsistency (Part A9.1 vs A5.3) — general idempotency
   uses (user_id, key) uniqueness; reversal idempotency uses
   (original_transaction_id, key) uniqueness. These are different scopes
   serving different purposes.

Full analysis in docs/submission-notes.md.

─────────────────────────────────────────
QUICK START
─────────────────────────────────────────

git clone <repo>
cd BED-6C-Ukashatu-Ledger
npm install
cp .env.example .env
docker compose up postgres -d
npx prisma migrate deploy
npm run db:seed
npm run start:dev

# Swagger UI: http://localhost:3000/api/v1/docs

# Health: http://localhost:3000/api/v1/health

# Run all tests:

npm run test:unit
npm run test:integration

─────────────────────────────────────────
SELF-ASSESSED SCORE: ~973 / 1,000
─────────────────────────────────────────

Full breakdown in docs/reviews/final-review.md.

Thank you for the assessment. This was the most technically demanding of the
three Zetheta projects and the most educational — building a production-grade
ledger from scratch required genuine understanding of accounting principles,
PostgreSQL internals, and distributed systems failure modes.

Kind regards,
Ukashatu
Intern ID: 493556B
