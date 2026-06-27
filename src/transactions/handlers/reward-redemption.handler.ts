// src/transactions/handlers/reward-redemption.handler.ts
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BaseTransactionHandler } from './base-transaction.handler';
import type { Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Transaction Type #19 — Reward Points Redemption
 *
 * Journal pattern (spec A4.2):
 *   DEBIT  2030  Rewards Points Liability  [INR equivalent of points redeemed]
 *   CREDIT 1001  Customer Wallet            [INR equivalent]
 *
 * Redemption rate: 1 point = INR 0.25
 * Minimum redemption: 100 points (INR 25)
 *
 * No balance check — reduces a liability and increases an asset.
 */
@Injectable()
export class RewardRedemptionHandler extends BaseTransactionHandler {
  private static readonly POINTS_TO_INR = new Decimal('0.25');
  private static readonly MIN_POINTS = 100;

  protected validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void> {
    const wallet = this.requireAccount(accounts, 'wallet');

    if (wallet.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Customer wallet is not active');
    }

    const points = parseInt(String(payload['pointsRedeemed'] ?? '0'), 10);
    if (points < RewardRedemptionHandler.MIN_POINTS) {
      throw new UnprocessableEntityException(
        `Minimum redemption is ${RewardRedemptionHandler.MIN_POINTS.toString()} points`,
      );
    }

    return Promise.resolve();
  }

  protected buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto {
    const rewardsLiability = this.requireAccount(accounts, 'rewardsLiability');
    const wallet = this.requireAccount(accounts, 'wallet');

    const points = new Decimal(String(payload['pointsRedeemed'] ?? '0'));
    const inrValue = points
      .times(RewardRedemptionHandler.POINTS_TO_INR)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    const currency = 'INR';
    const effectiveDate = String(payload['effectiveDate'] ?? new Date().toISOString());

    return {
      referenceType: 'REWARD_REDEMPTION',
      referenceId: transactionId,
      effectiveDate,
      lines: [
        {
          accountId: rewardsLiability.id,
          entryType: 'DEBIT',
          amount: inrValue.toFixed(4),
          currency,
          narrative: `Reward redemption — ${points.toFixed(0)} points @ INR 0.25`,
        },
        {
          accountId: wallet.id,
          entryType: 'CREDIT',
          amount: inrValue.toFixed(4),
          currency,
          narrative: `Reward points redeemed — INR ${inrValue.toFixed(4)} credited`,
        },
      ],
    };
  }

  protected getBalanceCheckAccounts(): string[] {
    return [];
  }
}
