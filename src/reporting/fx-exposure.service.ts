// src/reporting/fx-exposure.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@database/database.service';
import Decimal from 'decimal.js';
import { toDecimal } from '@common/types/money.type';

export interface CurrencyExposureLine {
  currency: string;
  balance: string;
  inrEquivalent: string;
  exchangeRate: string;
}

export interface FxExposureReport {
  asOfDate: string;
  generatedAt: string;
  exposures: CurrencyExposureLine[];
  totalInrEquivalent: string;
}

interface ExposureRow {
  currency: string;
  balance: string;
}

interface RateRow {
  rate: string;
}

@Injectable()
export class FxExposureService {
  constructor(private readonly db: DatabaseService) {}

  async generate(asOf: Date): Promise<FxExposureReport> {
    const rows = await this.db.$queryRaw<ExposureRow[]>`
      SELECT
        le.currency,
        SUM(
          CASE WHEN le.entry_type = 'DEBIT' THEN le.amount ELSE -le.amount END
        )::TEXT AS balance
      FROM ledger_entries le
      JOIN accounts a ON a.id = le.account_id
      WHERE le.status = 'POSTED'
        AND le.effective_date <= ${asOf}
        AND a.type IN ('ASSET')
        AND le.currency != 'INR'
      GROUP BY le.currency
      HAVING SUM(
        CASE WHEN le.entry_type = 'DEBIT' THEN le.amount ELSE -le.amount END
      ) != 0
    `;

    let totalInr = new Decimal(0);
    const exposures: CurrencyExposureLine[] = [];

    for (const row of rows) {
      const balance = toDecimal(row.balance);

      // Fetch latest INR rate for this currency
      const rateRows = await this.db.$queryRaw<RateRow[]>`
        SELECT rate::TEXT
        FROM exchange_rate_snapshots
        WHERE base_currency  = ${row.currency}
          AND quote_currency = 'INR'
          AND valid_from     <= ${asOf}
          AND (valid_until IS NULL OR valid_until > ${asOf})
        ORDER BY valid_from DESC
        LIMIT 1
      `;

      const rate = rateRows[0] ? toDecimal(rateRows[0].rate) : new Decimal(1);
      const inrEquivalent = balance.times(rate).toDecimalPlaces(4);
      totalInr = totalInr.plus(inrEquivalent);

      exposures.push({
        currency: row.currency,
        balance: balance.toFixed(4),
        inrEquivalent: inrEquivalent.toFixed(4),
        exchangeRate: rate.toFixed(8),
      });
    }

    return {
      asOfDate: asOf.toISOString(),
      generatedAt: new Date().toISOString(),
      exposures,
      totalInrEquivalent: totalInr.toFixed(4),
    };
  }
}
