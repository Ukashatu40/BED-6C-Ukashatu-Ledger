# Incident Response: Day 8 — Refund Processed as New Credit

## Incident Summary

Refund for a merchant payment was processed as a new credit instead of a
reversal. Revenue was double-counted. P&L overstated. Auditor flagged.

## Root Cause

The refund handler created a new credit to the customer wallet without
debiting the merchant settlement account. This looked like a new income
event rather than a cancellation of the original transaction.

## Our Design Solution

### 1. No-Mutation Principle (spec A5.1)

Refunds never modify the original journal entry. They create new mirror
entries that economically negate the original.

### 2. Full Reversal Pattern

**Original:** DEBIT Customer Wallet / CREDIT Merchant Settlement / CREDIT Fee Revenue

**Reversal:** CREDIT Customer Wallet / DEBIT Merchant Settlement / DEBIT Fee Revenue

Every debit becomes a credit and vice versa. The net effect across both
journal entries is zero.

### 3. Original Transaction Reference

Every reversal entry stores `referenceId = reversalTransactionId` and
`metadata.originalTransactionId`. Auditors can trace the complete lifecycle.

### 4. Reversal Table

The `reversals` table records every reversal with:

- `original_transaction_id` — what was reversed
- `reversal_transaction_id` — the new corrective journal
- `fee_policy` — PROPORTIONAL / FULL / NONE
- `UNIQUE(original_transaction_id, idempotency_key)` — prevents double-reversal

### 5. Cumulative Guard

```typescript
// Total refunded across all partial refunds must never exceed original
if (totalAfterThisRefund.gt(originalAmount)) {
  throw new UnprocessableEntityException('Cumulative refunds exceed original');
}
```
