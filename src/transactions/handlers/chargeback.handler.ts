// src/transactions/handlers/chargeback.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #18 — Chargeback
 *
 * Journal pattern (spec A4.2):
 *   DEBIT  1010  Merchant Settlement – Pending  [chargeback amount]
 *   CREDIT 1001  Customer Wallet                [chargeback amount]
 *   DEBIT  1010  Merchant Settlement – Pending  [chargeback fee]
 *   CREDIT 4030  Chargeback Fee Revenue          [chargeback fee]
 *
 * The merchant bears both the chargeback amount and the chargeback fee.
 * No balance check — credits the customer.
 */
@Injectable()
export class ChargebackHandler extends BaseTransactionHandler {
  private static readonly CHARGEBACK_FEE = new Decimal('500.0000'); // INR 500 flat

  protected validateBusinessRules(
    payload: Record<string, unknown>,
    _accounts: Record<string, Account>,
  ): Promise<void> {
    const amount = parseFloat(String(payload['amount'] ?? '0'));
    if (amount <= 0) {
      throw new UnprocessableEntityException('Chargeback amount must be positive');
    }

    const disputeCode = String(payload['disputeCode'] ?? '');
    if (!disputeCode) {
      throw new UnprocessableEntityException('disputeCode is required for chargeback processing');
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
    const chargebackFeeRevenue = this.requireAccount(accounts, 'chargebackFeeRevenue');

    const amount = new Decimal(String(payload['amount'] ?? '0'));
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const disputeCode = String(payload['disputeCode'] ?? '');
    const arn = String(payload['arn'] ?? '');

    const chargebackFee = ChargebackHandler.CHARGEBACK_FEE;
    const totalMerchantDebit = amount.plus(chargebackFee);

    return {
      referenceType: 'CHARGEBACK',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: merchantSettlement.id,
          entryType: 'DEBIT',
          amount: totalMerchantDebit.toFixed(4),
          currency,
          narrative: `Chargeback — code:${disputeCode}${arn ? ` ARN:${arn}` : ''}`,
        },
        {
          accountId: wallet.id,
          entryType: 'CREDIT',
          amount: amount.toFixed(4),
          currency,
          narrative: `Chargeback credited to customer — code:${disputeCode}`,
        },
        {
          accountId: chargebackFeeRevenue.id,
          entryType: 'CREDIT',
          amount: chargebackFee.toFixed(4),
          currency,
          narrative: `Chargeback fee charged to merchant`,
        },
      ],
    };
  }

  protected getBalanceCheckAccounts(): string[] {
    return [];
  }
}
