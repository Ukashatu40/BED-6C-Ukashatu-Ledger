// src/reporting/income-statement.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@database/database.service';
import Decimal from 'decimal.js';
import { toDecimal } from '@common/types/money.type';

export interface IncomeStatementLine {
  accountCode: string;
  accountName: string;
  subType: string;
  amount: string;
}

export interface IncomeStatement {
  fromDate: string;
  toDate: string;
  generatedAt: string;
  revenue: IncomeStatementLine[];
  expenses: IncomeStatementLine[];
  totalRevenue: string;
  totalExpenses: string;
  netIncome: string;
}

interface PnlRow {
  account_code: string;
  account_name: string;
  sub_type: string;
  account_type: string;
  net: string;
}

@Injectable()
export class IncomeStatementService {
  constructor(private readonly db: DatabaseService) {}

  async generate(from: Date, to: Date): Promise<IncomeStatement> {
    const rows = await this.db.$queryRaw<PnlRow[]>`
      SELECT
        a.code      AS account_code,
        a.name      AS account_name,
        a.sub_type,
        a.type      AS account_type,
        COALESCE(SUM(
          CASE WHEN le.entry_type = 'CREDIT' THEN le.amount
               ELSE -le.amount END
        ), 0)::TEXT AS net
      FROM accounts a
      LEFT JOIN ledger_entries le
        ON le.account_id = a.id
        AND le.status = 'POSTED'
        AND le.effective_date >= ${from}
        AND le.effective_date <= ${to}
      WHERE a.type IN ('REVENUE', 'EXPENSE', 'CONTRA_REVENUE')
      GROUP BY a.code, a.name, a.sub_type, a.type
      ORDER BY a.type, a.code
    `;

    let totalRevenue = new Decimal(0);
    let totalExpenses = new Decimal(0);
    const revenue: IncomeStatementLine[] = [];
    const expenses: IncomeStatementLine[] = [];

    for (const row of rows) {
      const amount = toDecimal(row.net).abs();

      if (row.account_type === 'REVENUE') {
        totalRevenue = totalRevenue.plus(toDecimal(row.net));
        revenue.push({
          accountCode: row.account_code,
          accountName: row.account_name,
          subType: row.sub_type,
          amount: amount.toFixed(4),
        });
      } else {
        totalExpenses = totalExpenses.plus(toDecimal(row.net).abs());
        expenses.push({
          accountCode: row.account_code,
          accountName: row.account_name,
          subType: row.sub_type,
          amount: amount.toFixed(4),
        });
      }
    }

    return {
      fromDate: from.toISOString(),
      toDate: to.toISOString(),
      generatedAt: new Date().toISOString(),
      revenue,
      expenses,
      totalRevenue: totalRevenue.toFixed(4),
      totalExpenses: totalExpenses.toFixed(4),
      netIncome: totalRevenue.minus(totalExpenses).toFixed(4),
    };
  }
}
