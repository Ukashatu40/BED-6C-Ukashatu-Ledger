// tests/integration/ledger.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DatabaseModule } from '@database/database.module';
import { LedgerModule } from '@ledger/ledger.module';
import { LedgerService } from '@ledger/ledger.service';
import { DatabaseService } from '@database/database.service';
import { cleanDatabase } from './setup';
import appConfig from '@config/app.config';
import databaseConfig from '@config/database.config';
import { PrismaClient } from '@prisma/client'; // Added PrismaClient import

describe('LedgerService (integration)', () => {
  let app: TestingModule;
  let ledger: LedgerService;
  let db: DatabaseService;

  // Real account IDs seeded in the test database
  let walletAccountId: string;
  let liabilityAccountId: string;

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

    // Replaced db.account calls with explicit PrismaClient casting
    const prisma = db as unknown as PrismaClient;
    const wallet = await prisma.account.findUnique({ where: { code: '1001' } });
    const liability = await prisma.account.findUnique({ where: { code: '2001' } });

    if (!wallet || !liability) {
      throw new Error('Required seed accounts not found — run npm run db:seed first');
    }

    walletAccountId = wallet.id;
    liabilityAccountId = liability.id;
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('postJournalEntry', () => {
    it('posts a balanced two-line deposit entry', async () => {
      const result = await ledger.postJournalEntry(
        {
          referenceType: 'CUSTOMER_DEPOSIT_BANK',
          referenceId: '01932a1b-0000-7000-8000-000000000001',
          effectiveDate: '2026-01-01T00:00:00Z',
          lines: [
            {
              accountId: walletAccountId,
              entryType: 'DEBIT',
              amount: '10000.0000',
              currency: 'INR',
              narrative: 'Test deposit',
            },
            {
              accountId: liabilityAccountId,
              entryType: 'CREDIT',
              amount: '10000.0000',
              currency: 'INR',
              narrative: 'Deposit liability',
            },
          ],
        },
        'test_actor',
        undefined,
        { checkBalanceOn: [] },
      );

      expect(result.totalDebits).toBe('10000.0000');
      expect(result.totalCredits).toBe('10000.0000');
      expect(result.entries).toHaveLength(2);
      expect(result.journalId).toBeDefined();
    });

    it('rejects an unbalanced journal entry', async () => {
      await expect(
        ledger.postJournalEntry(
          {
            referenceType: 'CUSTOMER_DEPOSIT_BANK',
            referenceId: '01932a1b-0000-7000-8000-000000000002',
            effectiveDate: '2026-01-01T00:00:00Z',
            lines: [
              {
                accountId: walletAccountId,
                entryType: 'DEBIT',
                amount: '10000.0000',
                currency: 'INR',
                narrative: 'Unbalanced debit',
              },
              {
                accountId: liabilityAccountId,
                entryType: 'CREDIT',
                amount: '9999.0000',
                currency: 'INR',
                narrative: 'Unbalanced credit',
              },
            ],
          },
          'test_actor',
          undefined,
          { checkBalanceOn: [] },
        ),
      ).rejects.toThrow('Unbalanced journal entry');
    });

    it('rejects a zero-amount entry', async () => {
      await expect(
        ledger.postJournalEntry(
          {
            referenceType: 'CUSTOMER_DEPOSIT_BANK',
            referenceId: '01932a1b-0000-7000-8000-000000000003',
            effectiveDate: '2026-01-01T00:00:00Z',
            lines: [
              {
                accountId: walletAccountId,
                entryType: 'DEBIT',
                amount: '0.0000',
                currency: 'INR',
                narrative: 'Zero amount',
              },
              {
                accountId: liabilityAccountId,
                entryType: 'CREDIT',
                amount: '0.0000',
                currency: 'INR',
                narrative: 'Zero amount',
              },
            ],
          },
          'test_actor',
          undefined,
          { checkBalanceOn: [] },
        ),
      ).rejects.toThrow('Amount must be positive');
    });

    it('builds a valid hash chain across multiple journals', async () => {
      // Post three deposits sequentially
      for (let i = 0; i < 3; i++) {
        await ledger.postJournalEntry(
          {
            referenceType: 'CUSTOMER_DEPOSIT_BANK',
            referenceId: `01932a1b-0000-7000-8000-00000000000${(i + 4).toString()}`,
            effectiveDate: '2026-01-01T00:00:00Z',
            lines: [
              {
                accountId: walletAccountId,
                entryType: 'DEBIT',
                amount: '1000.0000',
                currency: 'INR',
                narrative: `Deposit ${i.toString()}`,
              },
              {
                accountId: liabilityAccountId,
                entryType: 'CREDIT',
                amount: '1000.0000',
                currency: 'INR',
                narrative: `Liability ${i.toString()}`,
              },
            ],
          },
          'test_actor',
          undefined,
          { checkBalanceOn: [] },
        );
      }

      // Replaced db.ledgerEntry.findMany with explicit PrismaClient casting
      const prisma2 = db as unknown as PrismaClient;
      const entries = await prisma2.ledgerEntry.findMany({
        where: { status: 'POSTED' },
        orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
      });

      expect(entries).toHaveLength(6);

      // Each entry's previousHash should equal the hash of the entry before it
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i]!.previousHash).toBe(entries[i - 1]!.hash);
      }
    });

    it('prevents double-spend with insufficient balance', async () => {
      // First deposit INR 500
      await ledger.postJournalEntry(
        {
          referenceType: 'CUSTOMER_DEPOSIT_BANK',
          referenceId: '01932a1b-0000-7000-8000-000000000010',
          effectiveDate: '2026-01-01T00:00:00Z',
          lines: [
            {
              accountId: walletAccountId,
              entryType: 'DEBIT',
              amount: '500.0000',
              currency: 'INR',
              narrative: 'Seed deposit',
            },
            {
              accountId: liabilityAccountId,
              entryType: 'CREDIT',
              amount: '500.0000',
              currency: 'INR',
              narrative: 'Seed liability',
            },
          ],
        },
        'test_actor',
        undefined,
        { checkBalanceOn: [] },
      );

      // Attempt to withdraw INR 1000 — should fail
      await expect(
        ledger.postJournalEntry(
          {
            referenceType: 'CUSTOMER_WITHDRAWAL_BANK',
            referenceId: '01932a1b-0000-7000-8000-000000000011',
            effectiveDate: '2026-01-01T00:00:00Z',
            lines: [
              {
                accountId: liabilityAccountId,
                entryType: 'DEBIT',
                amount: '1000.0000',
                currency: 'INR',
                narrative: 'Overdraft attempt',
              },
              {
                accountId: walletAccountId,
                entryType: 'CREDIT',
                amount: '1000.0000',
                currency: 'INR',
                narrative: 'Overdraft attempt',
              },
            ],
          },
          'test_actor',
          undefined,
          { checkBalanceOn: [walletAccountId] },
        ),
      ).rejects.toThrow('Insufficient balance');
    });

    it('stores correct hash and previousHash on each entry', async () => {
      const result = await ledger.postJournalEntry(
        {
          referenceType: 'CUSTOMER_DEPOSIT_BANK',
          referenceId: '01932a1b-0000-7000-8000-000000000020',
          effectiveDate: '2026-01-01T00:00:00Z',
          lines: [
            {
              accountId: walletAccountId,
              entryType: 'DEBIT',
              amount: '5000.0000',
              currency: 'INR',
              narrative: 'Hash test deposit',
            },
            {
              accountId: liabilityAccountId,
              entryType: 'CREDIT',
              amount: '5000.0000',
              currency: 'INR',
              narrative: 'Hash test liability',
            },
          ],
        },
        'test_actor',
        undefined,
        { checkBalanceOn: [] },
      );

      for (const entry of result.entries) {
        expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.previousHash).toMatch(/^[0-9a-f]{64}$/);
      }

      // Second entry's previousHash must equal first entry's hash
      expect(result.entries[1]!.previousHash).toBe(result.entries[0]!.hash);
    });
  });

  describe('getAccountBalance', () => {
    it('returns 0.0000 for an account with no entries', async () => {
      const balance = await ledger.getAccountBalance(walletAccountId);
      expect(balance).toBe('0.0000');
    });

    it('returns correct balance after posting entries', async () => {
      await ledger.postJournalEntry(
        {
          referenceType: 'CUSTOMER_DEPOSIT_BANK',
          referenceId: '01932a1b-0000-7000-8000-000000000030',
          effectiveDate: '2026-01-01T00:00:00Z',
          lines: [
            {
              accountId: walletAccountId,
              entryType: 'DEBIT',
              amount: '25000.0000',
              currency: 'INR',
              narrative: 'Balance test',
            },
            {
              accountId: liabilityAccountId,
              entryType: 'CREDIT',
              amount: '25000.0000',
              currency: 'INR',
              narrative: 'Balance test liability',
            },
          ],
        },
        'test_actor',
        undefined,
        { checkBalanceOn: [] },
      );

      const balance = await ledger.getAccountBalance(walletAccountId);
      expect(balance).toBe('25000.0000');
    });
  });
});
