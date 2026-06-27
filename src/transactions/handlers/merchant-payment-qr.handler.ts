// src/transactions/handlers/merchant-payment-qr.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #5 — Merchant Payment (QR Code)
 *
 * Journal pattern (spec A4.2):
 *   DEBIT  1001  Customer Wallet                [amount + fee]
 *   CREDIT 1010  Merchant Settlement – Pending  [amount]
 *   CREDIT 4001  Transaction Fee Revenue         [fee]
 *
 * Balance check: customer wallet must have amount + fee available.
 *
 * Additional validation:
 *   - Merchant account must be ACTIVE
 *   - Amount must be within transaction limits
 *   - Fee is calculated as 0.5% of transaction amount (min INR 1)
 */
@Injectable()
export class MerchantPaymentQrHandler extends BaseTransactionHandler {
  private static readonly FEE_RATE = 0.005; // 0.5%
  private static readonly MIN_FEE = '1.0000';
  private static readonly MAX_AMOUNT = '500000.0000';

  private calculateFee(amount: number): string {
    const fee = Math.max(
      amount * MerchantPaymentQrHandler.FEE_RATE,
      parseFloat(MerchantPaymentQrHandler.MIN_FEE),
    );
    return fee.toFixed(4);
  }

  protected validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void> {
    const wallet = this.requireAccount(accounts, 'wallet');
    const merchant = this.requireAccount(accounts, 'merchant');

    if (wallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(`Customer wallet ${wallet.code} is not active`);
    }

    if (merchant.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(`Merchant settlement account is not active`);
    }

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    if (amount <= 0) {
      throw new UnprocessableEntityException('Payment amount must be positive');
    }

    if (amount > parseFloat(MerchantPaymentQrHandler.MAX_AMOUNT)) {
      throw new UnprocessableEntityException(
        `Amount exceeds QR payment limit of ${MerchantPaymentQrHandler.MAX_AMOUNT}`,
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
    const merchant = this.requireAccount(accounts, 'merchant');
    const feeRevenue = this.requireAccount(accounts, 'feeRevenue');

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const merchantName = String(payload['merchantName'] ?? 'Merchant');
    const qrRef = String(payload['qrReference'] ?? '');

    const fee = this.calculateFee(amount);
    const totalDebit = (amount + parseFloat(fee)).toFixed(4);
    const amountStr = amount.toFixed(4);

    return {
      referenceType: 'MERCHANT_PAYMENT_QR',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: wallet.id,
          entryType: 'DEBIT',
          amount: totalDebit,
          currency,
          narrative: `QR payment to ${merchantName}${qrRef ? ` ref:${qrRef}` : ''}`,
        },
        {
          accountId: merchant.id,
          entryType: 'CREDIT',
          amount: amountStr,
          currency,
          narrative: `QR payment from customer — pending settlement`,
        },
        {
          accountId: feeRevenue.id,
          entryType: 'CREDIT',
          amount: fee,
          currency,
          narrative: `QR payment fee — 0.5% of ${amountStr}`,
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
