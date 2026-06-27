// src/transactions/handlers/refund-full.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #16 — Full Refund
 *
 * No-mutation principle (spec A5.1): we never modify the original entry.
 * A full reversal creates an exact mirror of the original journal entry.
 *
 * Journal pattern:
 *   DEBIT  1010  Merchant Settlement – Pending  [original amount]
 *   CREDIT 1001  Customer Wallet                [original amount]
 *
 * For the full refund the fee is also reversed:
 *   DEBIT  4001  Transaction Fee Revenue         [original fee]
 *   CREDIT 1001  Customer Wallet                [original fee]
 *
 * No balance check — this credits the customer wallet.
 */
@Injectable()
export class RefundFullHandler extends BaseTransactionHandler {
  protected validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void> {
    const merchantSettlement = this.requireAccount(accounts, 'merchantSettlement');
    const wallet = this.requireAccount(accounts, 'wallet');

    if (wallet.status === 'CLOSED') {
      throw new UnprocessableEntityException('Cannot refund to a closed wallet');
    }

    if (merchantSettlement.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Merchant settlement account is not active');
    }

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    if (amount <= 0) {
      throw new UnprocessableEntityException('Refund amount must be positive');
    }

    return Promise.resolve();
  }

  protected buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto {
    const merchantSettlement = this.requireAccount(accounts, 'merchantSettlement');
    const wallet = this.requireAccount(accounts, 'wallet');
    const feeRevenue = this.requireAccount(accounts, 'feeRevenue');

    const amount = String(payload['amount'] ?? '');
    const fee = String(payload['feeAmount'] ?? '0.0000');
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const originalRef = String(payload['originalTransactionId'] ?? '');
    const reason = String(payload['reason'] ?? 'Customer refund');

    const totalRefund = (parseFloat(amount) + parseFloat(fee)).toFixed(4);

    return {
      referenceType: 'REFUND_FULL',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: merchantSettlement.id,
          entryType: 'DEBIT',
          amount,
          currency,
          narrative: `Full refund — reversal of ${originalRef}: ${reason}`,
        },
        {
          accountId: feeRevenue.id,
          entryType: 'DEBIT',
          amount: fee,
          currency,
          narrative: `Fee reversal on full refund of ${originalRef}`,
        },
        {
          accountId: wallet.id,
          entryType: 'CREDIT',
          amount: totalRefund,
          currency,
          narrative: `Full refund credited — ${reason}`,
        },
      ],
    };
  }

  protected getBalanceCheckAccounts(): string[] {
    return [];
  }
}
