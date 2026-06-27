// src/transactions/handlers/interest-payout.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #9 — Interest Payout (Monthly)
 *
 * Journal pattern (spec A4.2):
 *   DEBIT  2010  Interest Payable – Savings  [gross interest]
 *   CREDIT 1001  Customer Wallet             [net interest after TDS]
 *   CREDIT 2020  TCS / TDS Payable           [TDS amount]
 *
 * TDS rate: 10% under Section 194A of IT Act (interest > INR 40,000/year).
 * For simplicity we apply 10% TDS on all payouts — handlers can be
 * extended with threshold logic in production.
 *
 * No balance check — reduces a liability and increases an asset.
 */
@Injectable()
export class InterestPayoutHandler extends BaseTransactionHandler {
  private static readonly TDS_RATE = new Decimal('0.10');

  protected validateBusinessRules(
    payload: Record<string, unknown>,
    _accounts: Record<string, Account>,
  ): Promise<void> {
    const grossInterest = parseFloat(String(payload['grossInterest'] ?? '0'));
    if (grossInterest <= 0) {
      throw new UnprocessableEntityException('Gross interest amount must be positive');
    }
    return Promise.resolve();
  }

  protected buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto {
    const interestPayable = this.requireAccount(accounts, 'interestPayable');
    const wallet = this.requireAccount(accounts, 'wallet');
    const tdsPayable = this.requireAccount(accounts, 'tdsPayable');

    const gross = new Decimal(String(payload['grossInterest'] ?? '0'));
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const period = String(payload['period'] ?? '');

    const tds = gross
      .times(InterestPayoutHandler.TDS_RATE)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const net = gross.minus(tds);

    return {
      referenceType: 'INTEREST_PAYOUT',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: interestPayable.id,
          entryType: 'DEBIT',
          amount: gross.toFixed(4),
          currency,
          narrative: `Monthly interest payout${period ? ` for ${period}` : ''}`,
        },
        {
          accountId: wallet.id,
          entryType: 'CREDIT',
          amount: net.toFixed(4),
          currency,
          narrative: `Interest credited net of TDS (10%)`,
        },
        {
          accountId: tdsPayable.id,
          entryType: 'CREDIT',
          amount: tds.toFixed(4),
          currency,
          narrative: `TDS deducted u/s 194A — 10% of ${gross.toFixed(4)}`,
        },
      ],
    };
  }

  protected getBalanceCheckAccounts(): string[] {
    return [];
  }
}
