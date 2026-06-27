// src/transactions/handlers/bill-payment.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #7 — Bill Payment
 *
 * Journal pattern (spec A4.2):
 *   DEBIT  1001  Customer Wallet                [bill amount + convenience fee]
 *   CREDIT 1010  Merchant Settlement – Pending  [bill amount]
 *   CREDIT 4001  Transaction Fee Revenue         [convenience fee]
 *
 * Balance check: customer wallet must have bill amount + fee available.
 *
 * Validation:
 *   - Biller account must be ACTIVE
 *   - Bill amount must be positive
 *   - Convenience fee is flat INR 5 for utility bills
 */
@Injectable()
export class BillPaymentHandler extends BaseTransactionHandler {
  private static readonly CONVENIENCE_FEE = '5.0000';
  private static readonly MAX_AMOUNT = '1000000.0000'; // INR 10 lakh

  protected validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void> {
    const wallet = this.requireAccount(accounts, 'wallet');
    const biller = this.requireAccount(accounts, 'biller');

    if (wallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(`Customer wallet is not active`);
    }

    if (biller.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(`Biller settlement account is not active`);
    }

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    if (amount <= 0) {
      throw new UnprocessableEntityException('Bill amount must be positive');
    }

    if (amount > parseFloat(BillPaymentHandler.MAX_AMOUNT)) {
      throw new UnprocessableEntityException(
        `Bill amount exceeds limit of ${BillPaymentHandler.MAX_AMOUNT}`,
      );
    }

    return Promise.resolve();
  }

  protected buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto {
    const wallet = this.requireAccount(accounts, 'wallet');
    const biller = this.requireAccount(accounts, 'biller');
    const feeRevenue = this.requireAccount(accounts, 'feeRevenue');

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const billerName = String(payload['billerName'] ?? 'Utility Biller');
    const billRef = String(payload['billReference'] ?? '');
    const fee = BillPaymentHandler.CONVENIENCE_FEE;
    const totalDebit = (amount + parseFloat(fee)).toFixed(4);
    const amountStr = amount.toFixed(4);

    return {
      referenceType: 'BILL_PAYMENT',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: wallet.id,
          entryType: 'DEBIT',
          amount: totalDebit,
          currency,
          narrative: `Bill payment to ${billerName}${billRef ? ` ref:${billRef}` : ''}`,
        },
        {
          accountId: biller.id,
          entryType: 'CREDIT',
          amount: amountStr,
          currency,
          narrative: `Bill settlement to ${billerName}`,
        },
        {
          accountId: feeRevenue.id,
          entryType: 'CREDIT',
          amount: fee,
          currency,
          narrative: `Bill payment convenience fee`,
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
