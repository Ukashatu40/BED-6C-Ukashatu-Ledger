import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

dotenv.config();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

/**
 * Wipe all transactional data between tests.
 * Accounts and exchange rates are preserved (they are reference data).
 * Deletion order respects foreign key constraints.
 */
export async function cleanDatabase(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM balance_snapshots`;
  await prisma.$executeRaw`DELETE FROM idempotency_keys`;
  await prisma.$executeRaw`DELETE FROM reversals`;
  await prisma.$executeRaw`DELETE FROM audit_events`;
  await prisma.$executeRaw`DELETE FROM ledger_entries`;
  await prisma.$executeRaw`DELETE FROM transactions`;
}

export async function closePrisma(): Promise<void> {
  await prisma.$disconnect();
}

export { prisma };
