// scripts/trial-balance-check.ts
// Usage: npm run trial-balance
// Usage: npm run trial-balance -- --as-of 2026-06-27
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

dotenv.config();

interface TbRow {
  account_code: string;
  account_name: string;
  account_type: string;
  total_debits: string;
  total_credits: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asOfIdx = args.indexOf('--as-of');
  const asOf = asOfIdx >= 0 ? new Date(args[asOfIdx + 1] ?? '') : new Date();

  console.log('\n📊 Trial Balance Check');
  console.log('═'.repeat(60));
  console.log(`As of: ${asOf.toISOString()}`);
  console.log('═'.repeat(60) + '\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);

  const prisma = new PrismaClient({ adapter });

  try {
    const rows = await prisma.$queryRaw<TbRow[]>`
      SELECT
        a.code AS account_code,
        a.name AS account_name,
        a.type AS account_type,
        COALESCE(SUM(
          CASE WHEN le.entry_type = 'DEBIT' THEN le.amount ELSE 0 END
        ), 0)::TEXT AS total_debits,
        COALESCE(SUM(
          CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END
        ), 0)::TEXT AS total_credits
      FROM accounts a
      LEFT JOIN ledger_entries le
        ON le.account_id = a.id
        AND le.status = 'POSTED'
        AND le.effective_date <= ${asOf}
      GROUP BY a.code, a.name, a.type
      HAVING COALESCE(SUM(le.amount), 0) > 0
      ORDER BY a.code
    `;

    let grandDebits = new Decimal(0);
    let grandCredits = new Decimal(0);

    const colWidth = 40;
    console.log(
      'Code'.padEnd(8) +
        'Account'.padEnd(colWidth) +
        'Debits'.padStart(16) +
        'Credits'.padStart(16),
    );
    console.log('─'.repeat(8 + colWidth + 32));

    for (const row of rows) {
      const d = new Decimal(row.total_debits);
      const c = new Decimal(row.total_credits);
      grandDebits = grandDebits.plus(d);
      grandCredits = grandCredits.plus(c);

      console.log(
        row.account_code.padEnd(8) +
          row.account_name.slice(0, colWidth - 1).padEnd(colWidth) +
          d.toFixed(2).padStart(16) +
          c.toFixed(2).padStart(16),
      );
    }

    console.log('─'.repeat(8 + colWidth + 32));
    console.log(
      'TOTAL'.padEnd(8 + colWidth) +
        grandDebits.toFixed(2).padStart(16) +
        grandCredits.toFixed(2).padStart(16),
    );

    const balanced = grandDebits.equals(grandCredits);
    console.log('\n' + '═'.repeat(60));

    if (balanced) {
      console.log(`✅ BALANCED — Debits = Credits = ${grandDebits.toFixed(4)}\n`);
    } else {
      const diff = grandDebits.minus(grandCredits);
      console.error(`❌ UNBALANCED — Discrepancy: ${diff.toFixed(4)}`);
      console.error(`   Debits:  ${grandDebits.toFixed(4)}`);
      console.error(`   Credits: ${grandCredits.toFixed(4)}\n`);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
