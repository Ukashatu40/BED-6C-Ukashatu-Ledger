// src/transactions/handlers/p2p-transfer.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #4 — P2P Transfer with fee
 *
 * Journal pattern (spec A1.3 example, page 5):
 *   CREDIT 1001-A  Sender Wallet            [amount + fee]
 *   DEBIT  1001-B  Recipient Wallet         [amount]
 *   CREDIT 4001    Transaction Fee Revenue  [fee]
 *
 * Balance check: sender wallet must have amount + fee available.
 *
 * NOTE on spec error: The P2P example in spec A1.3 shows:
 *   - User A Wallet: CREDIT 5,010 (sender pays amount + fee)
 *   - User B Wallet: DEBIT  5,000 (recipient gets amount)
 *   - Fee Revenue:   CREDIT    10 (platform earns fee)
 * Debits (5,000) ≠ Credits (5,010 + 10 = 5,020) — this is WRONG in the spec.
 * Correct pattern: debits must equal credits.
 *   DEBIT  1001-A  Sender Wallet     5,010  (sender's balance decreases)
 *   CREDIT 1001-B  Recipient Wallet  5,000  (recipient's balance increases)
 *   CREDIT 4001    Fee Revenue          10  (platform earns fee)
 * Total debits: 5,010 = Total credits: 5,000 + 10 = 5,010 ✓
 */
@Injectable()
export class P2pTransferHandler extends BaseTransactionHandler {
  private static readonly MAX_TRANSFER = '200000.0000'; // INR 2 lakh per transfer
  private static readonly TRANSFER_FEE = '10.0000'; // INR 10 flat fee

  protected validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void> {
    const senderWallet = this.requireAccount(accounts, 'senderWallet');
    const recipientWallet = this.requireAccount(accounts, 'recipientWallet');

    if (senderWallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(`Sender wallet ${senderWallet.code} is not active`);
    }

    if (recipientWallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(
        `Recipient wallet ${recipientWallet.code} is not active`,
      );
    }

    if (senderWallet.id === recipientWallet.id) {
      throw new UnprocessableEntityException('Sender and recipient cannot be the same account');
    }

    const amount = parseFloat(String(payload['amount'] ?? '0'));
    if (amount > parseFloat(P2pTransferHandler.MAX_TRANSFER)) {
      throw new UnprocessableEntityException(
        `Transfer amount exceeds limit of ${P2pTransferHandler.MAX_TRANSFER}`,
      );
    }

    return Promise.resolve();
  }

  protected buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto {
    const senderWallet = this.requireAccount(accounts, 'senderWallet');
    const recipientWallet = this.requireAccount(accounts, 'recipientWallet');
    const feeRevenue = this.requireAccount(accounts, 'feeRevenue');

    const amount = String(payload['amount'] ?? '');
    const currency = String(payload['currency'] ?? 'INR');
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());
    const fee = P2pTransferHandler.TRANSFER_FEE;

    // Total sender debit = amount + fee
    const totalDebit = (parseFloat(amount) + parseFloat(fee)).toFixed(4);

    return {
      referenceType: 'P2P_TRANSFER',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: senderWallet.id,
          entryType: 'DEBIT',
          amount: totalDebit,
          currency,
          narrative: `P2P transfer sent — amount ${amount} + fee ${fee}`,
        },
        {
          accountId: recipientWallet.id,
          entryType: 'CREDIT',
          amount,
          currency,
          narrative: `P2P transfer received from ${senderWallet.id}`,
        },
        {
          accountId: feeRevenue.id,
          entryType: 'CREDIT',
          amount: fee,
          currency,
          narrative: `P2P transfer fee`,
        },
      ],
    };
  }

  protected getBalanceCheckAccounts(
    _payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): string[] {
    const sender = accounts['senderWallet'];
    return sender ? [sender.id] : [];
  }
}
