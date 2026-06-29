// tests/integration/concurrency.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaClient, type LedgerEntry } from '@prisma/client';
import { DatabaseModule } from '@database/database.module';
import { LedgerModule } from '@ledger/ledger.module';
import { LedgerService } from '@ledger/ledger.service';
import { DatabaseService } from '@database/database.service';
import { cleanDatabase, closePrisma } from './setup';
import appConfig from '@config/app.config';
import databaseConfig from '@config/database.config';

describe('Concurrency — double-spend prevention (integration)', () => {
  let app: TestingModule;
  let ledger: LedgerService;
  let db: DatabaseService;
  let walletId: string;
  let liabilityId: string;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
          load: [appConfig, databaseConfig],
        }),
        LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        DatabaseModule,
        LedgerModule,
      ],
    }).compile();

    ledger = app.get(LedgerService);
    db = app.get(DatabaseService);

    const prisma = db as unknown as PrismaClient;
    const wallet = await prisma.account.findUnique({ where: { code: '1001' } });
    const liability = await prisma.account.findUnique({ where: { code: '2001' } });

    if (!wallet || !liability) throw new Error('Seed accounts missing');
    walletId = wallet.id;
    liabilityId = liability.id;
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await app.close();
    await closePrisma();
  });

  async function postDeposit(amount: string, refId: string): Promise<void> {
    await ledger.postJournalEntry(
      {
        referenceType: 'CUSTOMER_DEPOSIT_BANK',
        referenceId: refId,
        effectiveDate: '2026-01-01T00:00:00Z',
        lines: [
          {
            accountId: walletId,
            entryType: 'DEBIT',
            amount,
            currency: 'INR',
            narrative: 'Deposit',
          },
          {
            accountId: liabilityId,
            entryType: 'CREDIT',
            amount,
            currency: 'INR',
            narrative: 'Liability',
          },
        ],
      },
      'system',
      undefined,
      { checkBalanceOn: [] },
    );
  }

  async function attemptWithdrawal(
    amount: string,
    refId: string,
  ): Promise<'success' | 'insufficient'> {
    try {
      await ledger.postJournalEntry(
        {
          referenceType: 'CUSTOMER_WITHDRAWAL_BANK',
          referenceId: refId,
          effectiveDate: '2026-01-01T00:00:00Z',
          lines: [
            {
              accountId: liabilityId,
              entryType: 'DEBIT',
              amount,
              currency: 'INR',
              narrative: 'Withdrawal',
            },
            {
              accountId: walletId,
              entryType: 'CREDIT',
              amount,
              currency: 'INR',
              narrative: 'Withdrawal',
            },
          ],
        },
        'system',
        undefined,
        // CRITICAL: pass walletId so balance check fires on the wallet
        // regardless of it being a CREDIT line
        { checkBalanceOn: [walletId] },
      );
      return 'success';
    } catch {
      return 'insufficient';
    }
  }

  it('prevents double-spend: balance never goes negative', async () => {
    await postDeposit('10000.0000', '01932a1b-0000-7000-8000-000000000400');

    // 20 concurrent withdrawal attempts of INR 1000 each
    const attempts = Array.from({ length: 20 }, (_, i) =>
      attemptWithdrawal(
        '1000.0000',
        `01932a1b-0000-7000-8000-0000000004${i.toString().padStart(2, '0')}`,
      ),
    );

    const results = await Promise.allSettled(attempts);
    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : 'error'));
    const successes = outcomes.filter((o) => o === 'success').length;

    // Never more than 10 should succeed (10000 / 1000 = 10 max)
    expect(successes).toBeLessThanOrEqual(10);

    // THE critical invariant: balance must never be negative
    const finalBalance = await ledger.getAccountBalance(walletId);
    expect(parseFloat(finalBalance)).toBeGreaterThanOrEqual(0);

    // Total withdrawn must not exceed deposited
    const totalWithdrawn = successes * 1000;
    expect(totalWithdrawn).toBeLessThanOrEqual(10000);
  });

  it('account balance never goes negative under concurrent load', async () => {
    await postDeposit('5000.0000', '01932a1b-0000-7000-8000-000000000500');

    const attempts = Array.from({ length: 30 }, (_, i) =>
      attemptWithdrawal(
        '500.0000',
        `01932a1b-0000-7000-8000-0000000005${i.toString().padStart(2, '0')}`,
      ),
    );

    await Promise.allSettled(attempts);

    const balance = await ledger.getAccountBalance(walletId);
    const balanceNum = parseFloat(balance);

    // Core invariant — never negative
    expect(balanceNum).toBeGreaterThanOrEqual(0);

    // At most 10 withdrawals of 500 can succeed against 5000 balance
    const entries = await (db as unknown as PrismaClient).ledgerEntry.findMany({
      where: { status: 'POSTED', referenceType: 'CUSTOMER_WITHDRAWAL_BANK' },
    });
    expect(entries.length).toBeLessThanOrEqual(20); // 10 withdrawals × 2 lines each
  });

  it('trial balance remains balanced after concurrent transactions', async () => {
    // Seed multiple deposits concurrently
    const deposits = Array.from({ length: 5 }, (_, i) =>
      postDeposit(
        '2000.0000',
        `01932a1b-0000-7000-8000-0000000006${i.toString().padStart(2, '0')}`,
      ),
    );
    await Promise.allSettled(deposits);

    // Check trial balance
    const prisma2 = db as unknown as PrismaClient;

    const entries: LedgerEntry[] = await prisma2.ledgerEntry.findMany({
      where: { status: 'POSTED' },
    });
    const totalDebits = entries
      .filter((e: LedgerEntry) => e.entryType === 'DEBIT')
      .reduce((sum: number, e: LedgerEntry) => sum + parseFloat(e.amount.toString()), 0);

    const totalCredits = entries
      .filter((e: LedgerEntry) => e.entryType === 'CREDIT')
      .reduce((sum: number, e: LedgerEntry) => sum + parseFloat(e.amount.toString()), 0);
    expect(totalDebits).toBe(totalCredits);
  });
});
