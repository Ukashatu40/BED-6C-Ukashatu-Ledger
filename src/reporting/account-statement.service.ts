// src/reporting/account-statement.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@database/database.service';
import Decimal from 'decimal.js';
import { normalBalanceSign, toDecimal } from '@common/types/money.type';
import type { AccountType } from '@prisma/client';

export interface StatementLine {
  entryId: string;
  date: string;
  narrative: string;
  debit: string | null;
  credit: string | null;
  runningBalance: string;
  referenceType: string;
  referenceId: string;
}

export interface AccountStatement {
  accountId: string;
  accountCode: string;
  accountName: string;
  currency: string;
  fromDate: string;
  toDate: string;
  openingBalance: string;
  closingBalance: string;
  totalDebits: string;
  totalCredits: string;
  lines: StatementLine[];
}

interface StatementRow {
  entry_id: string;
  effective_date: Date;
  narrative: string;
  entry_type: string;
  amount: string;
  reference_type: string;
  reference_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  currency: string;
  account_type: string;
}

@Injectable()
export class AccountStatementService {
  constructor(private readonly db: DatabaseService) {}

  async generate(
    accountId: string,
    from: Date,
    to: Date,
    page = 1,
    pageSize = 50,
  ): Promise<AccountStatement> {
    const offset = (page - 1) * pageSize;

    // Opening balance — all entries BEFORE the from date
    const openingRows = await this.db.$queryRaw<[{ balance: string; account_type: string }]>`
      SELECT
        COALESCE(SUM(
          CASE WHEN le.entry_type = 'DEBIT' THEN le.amount ELSE -le.amount END
        ), 0)::TEXT AS balance,
        a.type AS account_type
      FROM ledger_entries le
      JOIN accounts a ON a.id = le.account_id
      WHERE le.account_id = ${accountId}
        AND le.status = 'POSTED'
        AND le.effective_date < ${from}
      GROUP BY a.type
    `;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const accountType = (openingRows[0]?.account_type ?? 'ASSET') as AccountType;
    const sign = normalBalanceSign(accountType);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const openingRaw = toDecimal(openingRows[0]?.balance ?? '0');
    const openingBalance = openingRaw.times(sign);

    // Statement lines within date range
    const rows = await this.db.$queryRaw<StatementRow[]>`
      SELECT
        le.id            AS entry_id,
        le.effective_date,
        le.narrative,
        le.entry_type,
        le.amount::TEXT  AS amount,
        le.reference_type,
        le.reference_id,
        a.id             AS account_id,
        a.code           AS account_code,
        a.name           AS account_name,
        a.currency,
        a.type           AS account_type
      FROM ledger_entries le
      JOIN accounts a ON a.id = le.account_id
      WHERE le.account_id = ${accountId}
        AND le.status = 'POSTED'
        AND le.effective_date >= ${from}
        AND le.effective_date <= ${to}
      ORDER BY le.effective_date ASC, le.posted_at ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    let runningBalance = openingBalance;
    let totalDebits = new Decimal(0);
    let totalCredits = new Decimal(0);

    const lines: StatementLine[] = rows.map((row) => {
      const amount = toDecimal(row.amount);

      if (row.entry_type === 'DEBIT') {
        runningBalance = runningBalance.plus(amount.times(sign));
        totalDebits = totalDebits.plus(amount);
        return {
          entryId: row.entry_id,
          date: new Date(row.effective_date).toISOString(),
          narrative: row.narrative,
          debit: amount.toFixed(4),
          credit: null,
          runningBalance: runningBalance.toFixed(4),
          referenceType: row.reference_type,
          referenceId: row.reference_id,
        };
      } else {
        runningBalance = runningBalance.minus(amount.times(sign));
        totalCredits = totalCredits.plus(amount);
        return {
          entryId: row.entry_id,
          date: new Date(row.effective_date).toISOString(),
          narrative: row.narrative,
          debit: null,
          credit: amount.toFixed(4),
          runningBalance: runningBalance.toFixed(4),
          referenceType: row.reference_type,
          referenceId: row.reference_id,
        };
      }
    });

    return {
      accountId,
      accountCode: rows[0]?.account_code ?? '',
      accountName: rows[0]?.account_name ?? '',
      currency: rows[0]?.currency ?? 'INR',
      fromDate: from.toISOString(),
      toDate: to.toISOString(),
      openingBalance: openingBalance.toFixed(4),
      closingBalance: runningBalance.toFixed(4),
      totalDebits: totalDebits.toFixed(4),
      totalCredits: totalCredits.toFixed(4),
      lines,
    };
  }
}
