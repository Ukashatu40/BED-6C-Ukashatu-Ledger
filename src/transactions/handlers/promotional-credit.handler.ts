// src/transactions/handlers/promotional-credit.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #12 — Promotional Credit
 *
 * Journal pattern (spec A4.2):
 *   DEBIT  5002  Cashback / Marketing Expense  [promo amount]
 *   CREDIT 1001  Customer Wallet                [promo amount]
 *
 * Validation:
 *   - Promo code must be present
 *   - Amount must be positive
 */
@Injectable()
export class PromotionalCreditHandler extends BaseTransactionHandler {
  protected validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void> {
    const wallet = this.requireAccount(accounts, 'wallet');

    if (wallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Customer wallet is not active');
    }

    const promoCode = String(payload['promoCode'] ?? '');
    if (!promoCode) {
      throw new UnprocessableEntityException('promoCode is required for promotional credits');
    }

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    if (amount <= 0) {
      throw new UnprocessableEntityException('Promotional credit amount must be positive');
    }

    return Promise.resolve();
  }

  protected buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto {
    const marketingExpense = this.requireAccount(accounts, 'cashbackExpense');
    const wallet = this.requireAccount(accounts, 'wallet');

    const amount = String(payload['amount'] ?? '');
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const promoCode = String(payload['promoCode'] ?? '');

    return {
      referenceType: 'PROMOTIONAL_CREDIT',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: marketingExpense.id,
          entryType: 'DEBIT',
          amount,
          currency,
          narrative: `Promotional credit — code:${promoCode}`,
        },
        {
          accountId: wallet.id,
          entryType: 'CREDIT',
          amount,
          currency,
          narrative: `Promo credit applied — code:${promoCode}`,
        },
      ],
    };
  }

  protected getBalanceCheckAccounts(): string[] {
    return [];
  }
}
