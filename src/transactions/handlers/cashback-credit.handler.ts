// src/transactions/handlers/cashback-credit.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #11 — Cashback Credit
 *
 * Journal pattern (spec A4.2):
 *   DEBIT  5002  Cashback Expense  [cashback amount]
 *   CREDIT 1001  Customer Wallet   [cashback amount]
 *
 * No balance check — funding transaction from platform to customer.
 */
@Injectable()
export class CashbackCreditHandler extends BaseTransactionHandler {
  private static readonly MAX_CASHBACK = '10000.0000';

  protected validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void> {
    const wallet = this.requireAccount(accounts, 'wallet');

    if (wallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Customer wallet is not active');
    }

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    if (amount <= 0) {
      throw new UnprocessableEntityException('Cashback amount must be positive');
    }

    if (amount > parseFloat(CashbackCreditHandler.MAX_CASHBACK)) {
      throw new UnprocessableEntityException(
        `Cashback amount exceeds per-transaction cap of ${CashbackCreditHandler.MAX_CASHBACK}`,
      );
    }

    return Promise.resolve();
  }

  protected buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto {
    const cashbackExpense = this.requireAccount(accounts, 'cashbackExpense');
    const wallet = this.requireAccount(accounts, 'wallet');

    const amount = String(payload['amount'] ?? '');
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const campaignId = String(payload['campaignId'] ?? '');
    const reason = String(payload['reason'] ?? 'Cashback reward');

    return {
      referenceType: 'CASHBACK_CREDIT',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: cashbackExpense.id,
          entryType: 'DEBIT',
          amount,
          currency,
          narrative: `${reason}${campaignId ? ` — campaign:${campaignId}` : ''}`,
        },
        {
          accountId: wallet.id,
          entryType: 'CREDIT',
          amount,
          currency,
          narrative: `Cashback credited to wallet`,
        },
      ],
    };
  }

  protected getBalanceCheckAccounts(): string[] {
    return [];
  }
}
