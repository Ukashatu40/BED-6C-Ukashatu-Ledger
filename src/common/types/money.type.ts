// src/common/types/money.type.ts
import Decimal from 'decimal.js';
import { CURRENCY_DECIMALS, type Currency } from './currency.type';

// Configure Decimal.js globally for financial arithmetic
// ROUND_HALF_UP matches standard banking rounding convention
Decimal.set({
  precision: 28, // More than enough for NUMERIC(19,4)
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -28,
  toExpPos: 28,
});

/**
 * Parse any incoming amount value to a Decimal.
 * Accepts string (from Prisma NUMERIC fields), number, or Decimal.
 * NEVER accept raw JavaScript number for money — this is the single
 * entry point for all monetary values entering the system.
 */
export function toDecimal(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(String(value));
}

/**
 * Format a Decimal to a fixed-decimal string for API responses.
 * Uses the currency's standard decimal places.
 */
export function formatMoney(amount: Decimal, currency: Currency): string {
  const decimals = CURRENCY_DECIMALS[currency];
  return amount.toFixed(decimals);
}

/**
 * Assert that debits === credits for a set of journal lines.
 * This is the golden rule of double-entry bookkeeping.
 * Called before every database commit in the journal entry service.
 *
 * @throws Error if the journal entry is unbalanced
 */
export function assertBalanced(
  lines: Array<{ entryType: 'DEBIT' | 'CREDIT'; amount: Decimal }>,
): void {
  let totalDebits = new Decimal(0);
  let totalCredits = new Decimal(0);

  for (const line of lines) {
    if (line.entryType === 'DEBIT') {
      totalDebits = totalDebits.plus(line.amount);
    } else {
      totalCredits = totalCredits.plus(line.amount);
    }
  }

  if (!totalDebits.equals(totalCredits)) {
    throw new Error(
      `Unbalanced journal entry: debits=${totalDebits.toFixed(4)} credits=${totalCredits.toFixed(4)} ` +
        `difference=${totalDebits.minus(totalCredits).toFixed(4)}`,
    );
  }
}

/**
 * Compute the normal balance sign for an account type.
 * Assets and Expenses have a debit normal balance (positive = debit).
 * Liabilities, Equity, and Revenue have a credit normal balance.
 *
 * Used by the trial balance service to compute net balances correctly.
 */
export function normalBalanceSign(
  accountType:
    | 'ASSET'
    | 'LIABILITY'
    | 'EQUITY'
    | 'REVENUE'
    | 'EXPENSE'
    | 'CONTRA_ASSET'
    | 'CONTRA_REVENUE',
): 1 | -1 {
  switch (accountType) {
    case 'ASSET':
    case 'EXPENSE':
    case 'CONTRA_REVENUE':
      return 1; // Debit increases these accounts
    case 'LIABILITY':
    case 'EQUITY':
    case 'REVENUE':
    case 'CONTRA_ASSET':
      return -1; // Credit increases these accounts
  }
}
