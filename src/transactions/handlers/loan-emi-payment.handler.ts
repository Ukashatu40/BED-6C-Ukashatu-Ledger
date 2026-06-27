// src/transactions/handlers/loan-emi-payment.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #14 — Loan EMI Payment
 *
 * Journal pattern (spec A4.2):
 *   DEBIT  1001  Customer Wallet             [total EMI = principal + interest]
 *   CREDIT 1020  Loan Receivable – Personal  [principal component]
 *   CREDIT 4002  Interest Income – Loans     [interest component]
 *
 * Balance check: customer wallet must have the full EMI amount.
 * Principal and interest split must be provided by caller (from amortisation schedule).
 */
@Injectable()
export class LoanEmiPaymentHandler extends BaseTransactionHandler {
  protected validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void> {
    const wallet = this.requireAccount(accounts, 'wallet');

    if (wallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Customer wallet is not active');
    }

    const principal = parseFloat(String(payload['principalComponent'] ?? '0'));
    const interest = parseFloat(String(payload['interestComponent'] ?? '0'));

    if (principal < 0) {
      throw new UnprocessableEntityException('Principal component cannot be negative');
    }

    if (interest < 0) {
      throw new UnprocessableEntityException('Interest component cannot be negative');
    }

    if (principal + interest <= 0) {
      throw new UnprocessableEntityException('EMI amount must be positive');
    }

    return Promise.resolve();
  }

  protected buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto {
    const wallet = this.requireAccount(accounts, 'wallet');
    const loanReceivable = this.requireAccount(accounts, 'loanReceivable');
    const interestIncome = this.requireAccount(accounts, 'interestIncome');

    const principal = new Decimal(String(payload['principalComponent'] ?? '0'));
    const interest = new Decimal(String(payload['interestComponent'] ?? '0'));
    const totalEmi = principal.plus(interest);
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const emiNumber = String(payload['emiNumber'] ?? '');
    const loanRef = String(payload['loanReference'] ?? '');

    return {
      referenceType: 'LOAN_EMI_PAYMENT',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: wallet.id,
          entryType: 'DEBIT',
          amount: totalEmi.toFixed(4),
          currency,
          narrative: `EMI payment${emiNumber ? ` #${emiNumber}` : ''}${loanRef ? ` — loan:${loanRef}` : ''}`,
        },
        {
          accountId: loanReceivable.id,
          entryType: 'CREDIT',
          amount: principal.toFixed(4),
          currency,
          narrative: `Principal repayment`,
        },
        {
          accountId: interestIncome.id,
          entryType: 'CREDIT',
          amount: interest.toFixed(4),
          currency,
          narrative: `Interest income on loan`,
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
