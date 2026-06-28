// src/ledger/balance.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DatabaseService, type TransactionClient } from '@database/database.service';
import { toDecimal } from '@common/types/money.type';
import Decimal from 'decimal.js';

export interface AccountBalance {
  accountId: string;
  currency: string;
  balance: string;
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

  async deriveBalance(accountId: string, tx?: TransactionClient): Promise<AccountBalance> {
    // Cast to PrismaClient to access $queryRaw and model accessors
    const client = (tx ?? this.db) as PrismaClient;

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
      const account = await (this.db as PrismaClient).account.findUnique({
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

  async deriveBalanceLocked(tx: TransactionClient, accountId: string): Promise<Decimal> {
    const result = await this.deriveBalance(accountId, tx);
    return toDecimal(result.balance);
  }

  async updateSnapshot(accountId: string, triggeredBy: string): Promise<void> {
    const { balance, currency } = await this.deriveBalance(accountId);
    const prisma = this.db as PrismaClient;

    await prisma.balanceSnapshot.create({
      data: {
        accountId,
        balance,
        currency,
        snapshotAt: new Date(),
        triggeredBy,
      },
    });
  }

  async getLatestSnapshot(accountId: string): Promise<AccountBalance | null> {
    const prisma = this.db as PrismaClient;
    const snapshot = await prisma.balanceSnapshot.findFirst({
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
