// scripts/verify-hashes.ts
// Usage: npm run hash:verify
// Usage: npm run hash:verify -- --from 2026-01-01 --to 2026-12-31
import * as dotenv from 'dotenv'; // This explicitly parses your local .env file

import { PrismaClient } from '@prisma/client';
import { HashChainService } from '../src/ledger/hash-chain.service';
import { type ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

dotenv.config();
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');

  const from = fromIdx >= 0 ? new Date(args[fromIdx + 1] ?? '') : undefined;
  const to = toIdx >= 0 ? new Date(args[toIdx + 1] ?? '') : undefined;

  console.log('\n🔐 Ledger Hash Chain Verifier');
  console.log('═'.repeat(50));
  console.log(`From: ${from?.toISOString() ?? 'genesis'}`);
  console.log(`To:   ${to?.toISOString() ?? 'now'}`);
  console.log('═'.repeat(50) + '\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);

  const prisma = new PrismaClient({ adapter });

  try {
    const where: Record<string, unknown> = { status: 'POSTED' };
    if (from ?? to) {
      where['postedAt'] = {};
      const dateFilter = where['postedAt'] as Record<string, Date>;
      if (from) dateFilter['gte'] = from;
      if (to) dateFilter['lte'] = to;
    }

    const entries = await prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
    });

    console.log(`📊 Entries to verify: ${entries.length.toString()}\n`);

    if (entries.length === 0) {
      console.log('✅ No entries in range — chain is trivially valid.\n');
      return;
    }

    // Bootstrap a minimal ConfigService for HashChainService
    const configService = {
      get: (key: string) => {
        if (key === 'app') {
          return {
            genesisHash:
              process.env.GENESIS_HASH ??
              '0000000000000000000000000000000000000000000000000000000000000000',
          };
        }
        return undefined;
      },
    } as unknown as ConfigService;

    const hashService = new HashChainService(configService);

    const hashableEntries = entries.map((e) => ({
      id: e.id,
      journalId: e.journalId,
      accountId: e.accountId,
      entryType: e.entryType,
      amount: new Decimal(e.amount.toString()).toFixed(4),
      currency: e.currency,
      effectiveDate: e.effectiveDate.toISOString(),
      createdBy: e.createdBy,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      narrative: e.narrative,
      hash: e.hash,
      previousHash: e.previousHash,
    }));

    const result = hashService.verifyChain(hashableEntries);

    if (result.valid) {
      console.log(`✅ CHAIN VALID`);
      console.log(`   ${result.totalEntries.toString()} entries verified`);
      console.log(`   No tampering detected\n`);
    } else {
      console.error(`❌ CHAIN BROKEN`);
      console.error(`   Break detected at entry: ${result.firstBreakAt ?? 'unknown'}`);
      console.error(`   Stored hash:             ${result.brokenHash ?? 'unknown'}`);
      console.error(`   Expected hash:           ${result.expectedHash ?? 'unknown'}`);
      console.error(`\n   ACTION REQUIRED: Investigate tampered entry and notify compliance.\n`);
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
