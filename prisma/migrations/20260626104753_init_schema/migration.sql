-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CONTRA_ASSET', 'CONTRA_REVENUE');

-- CreateEnum
CREATE TYPE "AccountSubType" AS ENUM ('CURRENT_ASSET', 'NON_CURRENT_ASSET', 'CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY', 'RETAINED_EARNINGS', 'SHARE_CAPITAL', 'OPERATING_REVENUE', 'NON_OPERATING_REVENUE', 'OPERATING_EXPENSE', 'MARKETING_EXPENSE', 'FINANCIAL_EXPENSE', 'FX_HOLDING');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CUSTOMER_DEPOSIT_BANK', 'CUSTOMER_DEPOSIT_CARD', 'CUSTOMER_WITHDRAWAL_BANK', 'P2P_TRANSFER', 'MERCHANT_PAYMENT_QR', 'MERCHANT_PAYMENT_ONLINE', 'BILL_PAYMENT', 'INTEREST_ACCRUAL', 'INTEREST_PAYOUT', 'FEE_DEDUCTION_MONTHLY', 'CASHBACK_CREDIT', 'PROMOTIONAL_CREDIT', 'LOAN_DISBURSEMENT', 'LOAN_EMI_PAYMENT', 'FX_CONVERSION', 'REFUND_FULL', 'REFUND_PARTIAL', 'CHARGEBACK', 'REWARD_REDEMPTION', 'ACCOUNT_CLOSURE_SWEEP');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('INITIATED', 'PROCESSING', 'POSTED', 'FAILED', 'REJECTED', 'REVERSAL_PENDING', 'REVERSED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundFeePolicy" AS ENUM ('PROPORTIONAL', 'FULL', 'NONE');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "AccountType" NOT NULL,
    "sub_type" "AccountSubType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "parent_id" UUID,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "entry_type" "EntryType" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "effective_date" TIMESTAMPTZ NOT NULL,
    "posted_at" TIMESTAMPTZ,
    "created_by" VARCHAR(255) NOT NULL,
    "idempotency_key" VARCHAR(128),
    "reference_type" "TransactionType" NOT NULL,
    "reference_id" UUID NOT NULL,
    "narrative" TEXT NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "previous_hash" CHAR(64) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_snapshots" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "balance" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "snapshot_at" TIMESTAMPTZ NOT NULL,
    "triggered_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate_snapshots" (
    "id" UUID NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "inverse_rate" DECIMAL(18,8) NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL,
    "valid_from" TIMESTAMPTZ NOT NULL,
    "valid_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "endpoint" VARCHAR(255) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "response_status" INTEGER,
    "response_body" JSONB,
    "transaction_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "initiated_by" VARCHAR(255) NOT NULL,
    "idempotency_key" VARCHAR(128),
    "original_id" UUID,
    "exchange_rate_id" UUID,
    "failure_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "posted_at" TIMESTAMPTZ,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_limits" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "max_per_tx" DECIMAL(19,4),
    "max_per_day" DECIMAL(19,4),
    "max_per_month" DECIMAL(19,4),
    "currency" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "transaction_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reversals" (
    "id" UUID NOT NULL,
    "original_transaction_id" UUID NOT NULL,
    "reversal_transaction_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fee_policy" "RefundFeePolicy" NOT NULL,
    "fee_amount_reversed" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "initiated_by" VARCHAR(255) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor" VARCHAR(255) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "request_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE INDEX "accounts_type_idx" ON "accounts"("type");

-- CreateIndex
CREATE INDEX "accounts_currency_idx" ON "accounts"("currency");

-- CreateIndex
CREATE INDEX "accounts_status_idx" ON "accounts"("status");

-- CreateIndex
CREATE INDEX "accounts_parent_id_idx" ON "accounts"("parent_id");

-- CreateIndex
CREATE INDEX "ledger_entries_journal_id_idx" ON "ledger_entries"("journal_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_idx" ON "ledger_entries"("account_id");

-- CreateIndex
CREATE INDEX "ledger_entries_reference_id_idx" ON "ledger_entries"("reference_id");

-- CreateIndex
CREATE INDEX "ledger_entries_reference_type_idx" ON "ledger_entries"("reference_type");

-- CreateIndex
CREATE INDEX "ledger_entries_effective_date_idx" ON "ledger_entries"("effective_date");

-- CreateIndex
CREATE INDEX "ledger_entries_status_idx" ON "ledger_entries"("status");

-- CreateIndex
CREATE INDEX "ledger_entries_currency_idx" ON "ledger_entries"("currency");

-- CreateIndex
CREATE INDEX "ledger_entries_created_by_idx" ON "ledger_entries"("created_by");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_effective_date_idx" ON "ledger_entries"("account_id", "effective_date");

-- CreateIndex
CREATE INDEX "balance_snapshots_account_id_idx" ON "balance_snapshots"("account_id");

-- CreateIndex
CREATE INDEX "balance_snapshots_account_id_snapshot_at_idx" ON "balance_snapshots"("account_id", "snapshot_at");

-- CreateIndex
CREATE INDEX "exchange_rate_snapshots_base_currency_quote_currency_idx" ON "exchange_rate_snapshots"("base_currency", "quote_currency");

-- CreateIndex
CREATE INDEX "exchange_rate_snapshots_valid_from_idx" ON "exchange_rate_snapshots"("valid_from");

-- CreateIndex
CREATE INDEX "exchange_rate_snapshots_valid_until_idx" ON "exchange_rate_snapshots"("valid_until");

-- CreateIndex
CREATE INDEX "exchange_rate_snapshots_base_currency_quote_currency_valid__idx" ON "exchange_rate_snapshots"("base_currency", "quote_currency", "valid_from", "valid_until");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_status_idx" ON "idempotency_keys"("status");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_user_id_key" ON "idempotency_keys"("key", "user_id");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_initiated_by_idx" ON "transactions"("initiated_by");

-- CreateIndex
CREATE INDEX "transactions_original_id_idx" ON "transactions"("original_id");

-- CreateIndex
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at");

-- CreateIndex
CREATE INDEX "transaction_limits_account_id_idx" ON "transaction_limits"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_limits_account_id_transaction_type_key" ON "transaction_limits"("account_id", "transaction_type");

-- CreateIndex
CREATE INDEX "reversals_original_transaction_id_idx" ON "reversals"("original_transaction_id");

-- CreateIndex
CREATE INDEX "reversals_reversal_transaction_id_idx" ON "reversals"("reversal_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "reversals_original_transaction_id_idempotency_key_key" ON "reversals"("original_transaction_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "audit_events_actor_idx" ON "audit_events"("actor");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_original_id_fkey" FOREIGN KEY ("original_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_limits" ADD CONSTRAINT "transaction_limits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
