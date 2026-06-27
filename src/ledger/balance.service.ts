// src/ledger/balance.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService, type TransactionClient } from '@database/database.service';
import { toDecimal } from '@common/types/money.type';
import Decimal from 'decimal.js';

export interface AccountBalance {
  accountId: string;
  currency: string;
  balance: string; // NUMERIC string — always 4dp
  computedAt: string;
}

interface BalanceRow {
  account_id: string;
  currency: string;
  balance: string;
}

@Injectable()
export class BalanceService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Derive the current balance for an account by summing all posted entries.
   *
   * balance = SUM(amount WHERE entry_type = 'DEBIT')
   *         - SUM(amount WHERE entry_type = 'CREDIT')
   *
   * This is the AUTHORITATIVE balance. Never use balance_snapshots for
   * write decisions — always re-derive inside a locked transaction.
   *
   * The sign gives a raw debit-minus-credit value. Whether this is positive
   * or negative for a "healthy" account depends on the account type:
   *   - Asset/Expense: positive raw balance = money in the account (normal)
   *   - Liability/Equity/Revenue: negative raw balance = money in the account (normal)
   *
   * For display purposes, callers apply normalBalanceSign() from money.type.ts.
   */
  async deriveBalance(accountId: string, tx?: TransactionClient): Promise<AccountBalance> {
    const client = (tx as DatabaseService | undefined) ?? this.db;

    const rows = await client.$queryRaw<BalanceRow[]>`
      SELECT
        account_id,
        currency,
        SUM(
          CASE WHEN entry_type = 'DEBIT' THEN amount
               ELSE -amount
          END
        )::TEXT AS balance
      FROM ledger_entries
      WHERE account_id = ${accountId}
        AND status = 'POSTED'
      GROUP BY account_id, currency
    `;

    if (rows.length === 0) {
      // Account exists but has no entries — balance is zero
      const account = await this.db.account.findUnique({
        where: { id: accountId },
        select: { currency: true },
      });

      return {
        accountId,
        currency: account?.currency ?? 'INR',
        balance: '0.0000',
        computedAt: new Date().toISOString(),
      };
    }

    const row = rows[0]!;
    return {
      accountId: row.account_id,
      currency: row.currency,
      balance: toDecimal(row.balance).toFixed(4),
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Derive balance INSIDE a locked transaction.
   * This is the version called before every debit to prevent double-spend.
   *
   * Flow:
   *   1. Acquire advisory lock on accountId
   *   2. Call this method to get the current balance
   *   3. Validate sufficient funds
   *   4. Insert the debit entry
   *   5. Commit (lock released automatically)
   */
  async deriveBalanceLocked(tx: TransactionClient, accountId: string): Promise<Decimal> {
    const result = await this.deriveBalance(accountId, tx);
    return toDecimal(result.balance);
  }

  /**
   * Update the balance snapshot after a journal entry is committed.
   * Called at the end of every successful withTransaction block.
   *
   * The snapshot is a read-optimised cache only — it is never the
   * source of truth for write decisions.
   */
  async updateSnapshot(
    accountId: string,
    triggeredBy: string, // ledger entry ID that triggered this update
  ): Promise<void> {
    const { balance, currency } = await this.deriveBalance(accountId);

    await this.db.balanceSnapshot.create({
      data: {
        accountId,
        balance,
        currency,
        snapshotAt: new Date(),
        triggeredBy,
      },
    });
  }

  /**
   * Get the latest balance snapshot for fast reads.
   * Used by the account statement and balance endpoints.
   */
  async getLatestSnapshot(accountId: string): Promise<AccountBalance | null> {
    const snapshot = await this.db.balanceSnapshot.findFirst({
      where: { accountId },
      orderBy: { snapshotAt: 'desc' },
    });

    if (!snapshot) return null;

    return {
      accountId,
      currency: snapshot.currency,
      balance: snapshot.balance.toString(),
      computedAt: snapshot.snapshotAt.toISOString(),
    };
  }
}
