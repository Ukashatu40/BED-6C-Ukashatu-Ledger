// src/transactions/handlers/fee-deduction.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #10 — Monthly Maintenance Fee Deduction
 *
 * Journal pattern (spec A4.2):
 *   DEBIT  1001  Customer Wallet       [fee amount]
 *   CREDIT 4001  Transaction Fee Revenue [fee amount]
 *
 * Balance check: wallet must have sufficient balance to cover the fee.
 */
@Injectable()
export class FeeDeductionHandler extends BaseTransactionHandler {
  protected validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void> {
    const wallet = this.requireAccount(accounts, 'wallet');

    if (wallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(
        `Wallet account is not active — fee deduction skipped`,
      );
    }

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    if (amount <= 0) {
      throw new UnprocessableEntityException('Fee amount must be positive');
    }

    return Promise.resolve();
  }

  protected buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto {
    const wallet = this.requireAccount(accounts, 'wallet');
    const feeRevenue = this.requireAccount(accounts, 'feeRevenue');
    const amount = String(payload['amount'] ?? '');
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const feeType = String(payload['feeType'] ?? 'Monthly Maintenance Fee');

    return {
      referenceType: 'FEE_DEDUCTION_MONTHLY',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: wallet.id,
          entryType: 'DEBIT',
          amount,
          currency,
          narrative: `${feeType} deducted`,
        },
        {
          accountId: feeRevenue.id,
          entryType: 'CREDIT',
          amount,
          currency,
          narrative: `${feeType} revenue`,
        },
      ],
    };
  }

  protected getBalanceCheckAccounts(
    _payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): string[] {
    const wallet = accounts['wallet'];
    return wallet ? [wallet.id] : [];
  }
}
