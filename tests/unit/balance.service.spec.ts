// tests/unit/balance.service.spec.ts
import { BalanceService } from '@ledger/balance.service';
import { DatabaseService } from '@database/database.service';
import Decimal from 'decimal.js';

function makeMockDb(queryResult: unknown[]): DatabaseService {
  return {
    $queryRaw: jest.fn().mockResolvedValue(queryResult),
    account: {
      findUnique: jest.fn().mockResolvedValue({ currency: 'INR' }),
    },
    balanceSnapshot: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as unknown as DatabaseService;
}

describe('BalanceService', () => {
  describe('deriveBalance', () => {
    it('returns 0.0000 when account has no entries', async () => {
      const db = makeMockDb([]);
      const service = new BalanceService(db);

      const result = await service.deriveBalance('account-uuid');
      expect(result.balance).toBe('0.0000');
      expect(result.currency).toBe('INR');
    });

    it('returns correct balance from ledger entries', async () => {
      const db = makeMockDb([
        {
          account_id: 'account-uuid',
          currency: 'INR',
          balance: '50000.0000',
        },
      ]);
      const service = new BalanceService(db);

      const result = await service.deriveBalance('account-uuid');
      expect(result.balance).toBe('50000.0000');
    });

    it('returns balance with exactly 4 decimal places', async () => {
      const db = makeMockDb([
        {
          account_id: 'account-uuid',
          currency: 'INR',
          balance: '1234.5',
        },
      ]);
      const service = new BalanceService(db);

      const result = await service.deriveBalance('account-uuid');
      expect(result.balance).toBe('1234.5000');
    });

    it('handles negative balance correctly', async () => {
      const db = makeMockDb([
        {
          account_id: 'account-uuid',
          currency: 'INR',
          balance: '-500.0000',
        },
      ]);
      const service = new BalanceService(db);

      const result = await service.deriveBalance('account-uuid');
      expect(result.balance).toBe('-500.0000');
    });
  });

  describe('deriveBalanceLocked', () => {
    it('returns a Decimal instance', async () => {
      const db = makeMockDb([
        {
          account_id: 'account-uuid',
          currency: 'INR',
          balance: '10000.0000',
        },
      ]);
      const service = new BalanceService(db);
      const mockTx = db;

      const balance = await service.deriveBalanceLocked(mockTx as never, 'account-uuid');
      expect(balance).toBeInstanceOf(Decimal);
      expect(balance.toFixed(4)).toBe('10000.0000');
    });
  });

  describe('updateSnapshot', () => {
    it('calls balanceSnapshot.create after deriving balance', async () => {
      const createMock = jest.fn().mockResolvedValue({});
      const db = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            account_id: 'acct-1',
            currency: 'INR',
            balance: '5000.0000',
          },
        ]),
        balanceSnapshot: { create: createMock, findFirst: jest.fn() },
      } as unknown as DatabaseService;

      const service = new BalanceService(db);
      await service.updateSnapshot('acct-1', 'entry-uuid');

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: 'acct-1',
            balance: '5000.0000',
            triggeredBy: 'entry-uuid',
          }),
        }),
      );
    });
  });
});
