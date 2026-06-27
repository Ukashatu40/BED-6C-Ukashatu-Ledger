// src/transactions/handlers/refund-partial.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #17 — Partial Refund
 *
 * Supports three fee refund policies (spec A5.2):
 *   PROPORTIONAL — fee refund = (refund / original) × original_fee
 *   FULL         — entire fee refunded regardless of partial amount
 *   NONE         — fee retained, customer gets only the partial amount
 *
 * Journal pattern (PROPORTIONAL example):
 *   DEBIT  1010  Merchant Settlement – Pending  [partial amount]
 *   DEBIT  4001  Transaction Fee Revenue         [proportional fee refund]
 *   CREDIT 1001  Customer Wallet                [partial amount + fee refund]
 */
@Injectable()
export class RefundPartialHandler extends BaseTransactionHandler {
  protected validateBusinessRules(
    payload: Record<string, unknown>,
    _accounts: Record<string, Account>,
  ): Promise<void> {
    const refundAmount = parseFloat(String(payload['refundAmount'] ?? '0'));
    const originalAmount = parseFloat(String(payload['originalAmount'] ?? '0'));

    if (refundAmount <= 0) {
      throw new UnprocessableEntityException('Refund amount must be positive');
    }

    if (refundAmount > originalAmount) {
      throw new UnprocessableEntityException(
        `Refund amount ${refundAmount.toFixed(4)} exceeds original ` +
          `transaction amount ${originalAmount.toFixed(4)}`,
      );
    }

    const policy = String(payload['feePolicy'] ?? '');
    if (!['PROPORTIONAL', 'FULL', 'NONE'].includes(policy)) {
      throw new UnprocessableEntityException(
        `Invalid fee policy "${policy}" — must be PROPORTIONAL, FULL, or NONE`,
      );
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

    const refundAmount = new Decimal(String(payload['refundAmount'] ?? '0'));
    const originalAmount = new Decimal(String(payload['originalAmount'] ?? '0'));
    const originalFee = new Decimal(String(payload['originalFee'] ?? '0'));
    const policy = String(payload['feePolicy'] ?? 'PROPORTIONAL');
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const originalRef = String(payload['originalTransactionId'] ?? '');
    const reason = String(payload['reason'] ?? 'Partial refund');

    let feeRefund: Decimal;
    switch (policy) {
      case 'FULL':
        feeRefund = originalFee;
        break;
      case 'NONE':
        feeRefund = new Decimal(0);
        break;
      default: // PROPORTIONAL
        feeRefund = refundAmount
          .dividedBy(originalAmount)
          .times(originalFee)
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    }

    const totalCredit = refundAmount.plus(feeRefund);
    const lines: CreateJournalEntryDto['lines'] = [
      {
        accountId: merchantSettlement.id,
        entryType: 'DEBIT',
        amount: refundAmount.toFixed(4),
        currency,
        narrative: `Partial refund (${policy} fee policy) — ref:${originalRef}: ${reason}`,
      },
      {
        accountId: wallet.id,
        entryType: 'CREDIT',
        amount: totalCredit.toFixed(4),
        currency,
        narrative: `Partial refund credited — ${reason}`,
      },
    ];

    // Only add fee reversal line if fee is actually being refunded
    if (feeRefund.gt(0)) {
      lines.splice(1, 0, {
        accountId: feeRevenue.id,
        entryType: 'DEBIT',
        amount: feeRefund.toFixed(4),
        currency,
        narrative: `Fee reversal — ${policy} policy on partial refund`,
      });
    }

    return {
      referenceType: 'REFUND_PARTIAL',
      referenceId: transactionId,
      effectiveDate,
      lines,
    };
  }

  protected getBalanceCheckAccounts(): string[] {
    return [];
  }
}
