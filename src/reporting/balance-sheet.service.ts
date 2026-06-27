// src/reporting/balance-sheet.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@database/database.service';
import Decimal from 'decimal.js';
import { toDecimal } from '@common/types/money.type';

export interface BalanceSheetLine {
  accountCode: string;
  accountName: string;
  balance: string;
}

export interface BalanceSheet {
  asOfDate: string;
  generatedAt: string;
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  isBalanced: boolean;
  discrepancy: string;
}

interface BalanceSheetRow {
  account_code: string;
  account_name: string;
  account_type: string;
  balance: string;
}

@Injectable()
export class BalanceSheetService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Generate a balance sheet satisfying: Assets = Liabilities + Equity
   * As of any historical date.
   */
  async generate(asOf: Date): Promise<BalanceSheet> {
    const rows = await this.db.$queryRaw<BalanceSheetRow[]>`
      SELECT
        a.code     AS account_code,
        a.name     AS account_name,
        a.type     AS account_type,
        COALESCE(SUM(
          CASE
            WHEN a.type IN ('ASSET', 'EXPENSE', 'CONTRA_REVENUE')
              THEN CASE WHEN le.entry_type = 'DEBIT' THEN le.amount ELSE -le.amount END
            ELSE
              CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE -le.amount END
          END
        ), 0)::TEXT AS balance
      FROM accounts a
      LEFT JOIN ledger_entries le
        ON le.account_id = a.id
        AND le.status = 'POSTED'
        AND le.effective_date <= ${asOf}
      WHERE a.type IN ('ASSET', 'LIABILITY', 'EQUITY', 'CONTRA_ASSET')
      GROUP BY a.code, a.name, a.type
      ORDER BY a.type, a.code
    `;

    let totalAssets = new Decimal(0);
    let totalLiabilities = new Decimal(0);
    let totalEquity = new Decimal(0);
    const assets: BalanceSheetLine[] = [];
    const liabilities: BalanceSheetLine[] = [];
    const equity: BalanceSheetLine[] = [];

    for (const row of rows) {
      const balance = toDecimal(row.balance);
      const line: BalanceSheetLine = {
        accountCode: row.account_code,
        accountName: row.account_name,
        balance: balance.toFixed(4),
      };

      switch (row.account_type) {
        case 'ASSET':
        case 'CONTRA_ASSET':
          totalAssets = totalAssets.plus(balance);
          assets.push(line);
          break;
        case 'LIABILITY':
          totalLiabilities = totalLiabilities.plus(balance);
          liabilities.push(line);
          break;
        case 'EQUITY':
          totalEquity = totalEquity.plus(balance);
          equity.push(line);
          break;
      }
    }

    // A = L + E
    const rhs = totalLiabilities.plus(totalEquity);
    const discrepancy = totalAssets.minus(rhs);
    const isBalanced = discrepancy.abs().lte(new Decimal('0.0001'));

    return {
      asOfDate: asOf.toISOString(),
      generatedAt: new Date().toISOString(),
      assets,
      liabilities,
      equity,
      totalAssets: totalAssets.toFixed(4),
      totalLiabilities: totalLiabilities.toFixed(4),
      totalEquity: totalEquity.toFixed(4),
      isBalanced,
      discrepancy: discrepancy.toFixed(4),
    };
  }
}
