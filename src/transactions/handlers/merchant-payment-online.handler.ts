// src/transactions/handlers/merchant-payment-online.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #6 — Merchant Payment (Online / Payment Page)
 *
 * Journal pattern (spec A4.2) — similar to QR but includes gateway fee:
 *   DEBIT  1001  Customer Wallet                [amount + platform fee]
 *   CREDIT 1010  Merchant Settlement – Pending  [amount - gateway fee]
 *   CREDIT 4001  Transaction Fee Revenue         [platform fee]
 *   DEBIT  5001  Payment Gateway Fees Expense    [gateway fee]
 *   CREDIT 2002  Merchant Payable – Pending      [gateway fee]
 *
 * Balance check: customer wallet must have amount + platform fee available.
 *
 * Gateway fee is borne by the merchant (deducted from settlement).
 * Platform fee is borne by the customer (added to debit).
 */
@Injectable()
export class MerchantPaymentOnlineHandler extends BaseTransactionHandler {
  private static readonly PLATFORM_FEE_RATE = 0.005; // 0.5% charged to customer
  private static readonly GATEWAY_FEE_RATE = 0.002; // 0.2% charged to merchant
  private static readonly MIN_FEE = '1.0000';
  private static readonly MAX_AMOUNT = '500000.0000';

  private calculatePlatformFee(amount: number): string {
    const fee = Math.max(
      amount * MerchantPaymentOnlineHandler.PLATFORM_FEE_RATE,
      parseFloat(MerchantPaymentOnlineHandler.MIN_FEE),
    );
    return fee.toFixed(4);
  }

  private calculateGatewayFee(amount: number): string {
    const fee = Math.max(
      amount * MerchantPaymentOnlineHandler.GATEWAY_FEE_RATE,
      parseFloat(MerchantPaymentOnlineHandler.MIN_FEE),
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
      throw new UnprocessableEntityException(`Customer wallet is not active`);
    }

    if (merchant.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(`Merchant settlement account is not active`);
    }

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    if (amount <= 0) {
      throw new UnprocessableEntityException('Payment amount must be positive');
    }

    if (amount > parseFloat(MerchantPaymentOnlineHandler.MAX_AMOUNT)) {
      throw new UnprocessableEntityException(
        `Amount exceeds online payment limit of ${MerchantPaymentOnlineHandler.MAX_AMOUNT}`,
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
    const gatewayExp = this.requireAccount(accounts, 'gatewayExpense');
    const merchantPayable = this.requireAccount(accounts, 'merchantPayable');

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const merchantName = String(payload['merchantName'] ?? 'Online Merchant');
    const orderId = String(payload['orderId'] ?? '');

    const platformFee = this.calculatePlatformFee(amount);
    const gatewayFee = this.calculateGatewayFee(amount);
    const totalDebit = (amount + parseFloat(platformFee)).toFixed(4);
    const netToMerchant = (amount - parseFloat(gatewayFee)).toFixed(4);
    const amountStr = amount.toFixed(4);

    return {
      referenceType: 'MERCHANT_PAYMENT_ONLINE',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: wallet.id,
          entryType: 'DEBIT',
          amount: totalDebit,
          currency,
          narrative: `Online payment to ${merchantName}${orderId ? ` order:${orderId}` : ''}`,
        },
        {
          accountId: merchant.id,
          entryType: 'CREDIT',
          amount: netToMerchant,
          currency,
          narrative: `Online payment settlement (net of gateway fee)`,
        },
        {
          accountId: feeRevenue.id,
          entryType: 'CREDIT',
          amount: platformFee,
          currency,
          narrative: `Online payment platform fee — 0.5% of ${amountStr}`,
        },
        {
          accountId: gatewayExp.id,
          entryType: 'DEBIT',
          amount: gatewayFee,
          currency,
          narrative: `Payment gateway cost — 0.2% of ${amountStr}`,
        },
        {
          accountId: merchantPayable.id,
          entryType: 'CREDIT',
          amount: gatewayFee,
          currency,
          narrative: `Gateway fee payable to provider`,
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
