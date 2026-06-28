// tests/unit/hash-chain.service.spec.ts
import { HashChainService } from '@ledger/hash-chain.service';
import { ConfigService } from '@nestjs/config';

const GENESIS_HASH = '0'.repeat(64);

function makeConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'app') return { genesisHash: GENESIS_HASH };
      return undefined;
    },
  } as unknown as ConfigService;
}

function makeEntry(
  overrides: Partial<{
    id: string;
    journalId: string;
    accountId: string;
    entryType: string;
    amount: string;
    currency: string;
    effectiveDate: string;
    createdBy: string;
    referenceType: string;
    referenceId: string;
    narrative: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 'entry-id-001',
    journalId: overrides.journalId ?? 'journal-id-001',
    accountId: overrides.accountId ?? 'account-id-001',
    entryType: overrides.entryType ?? 'DEBIT',
    amount: overrides.amount ?? '1000.0000',
    currency: overrides.currency ?? 'INR',
    effectiveDate: overrides.effectiveDate ?? '2026-01-01T00:00:00.000Z',
    createdBy: overrides.createdBy ?? 'user_001',
    referenceType: overrides.referenceType ?? 'CUSTOMER_DEPOSIT_BANK',
    referenceId: overrides.referenceId ?? 'ref-id-001',
    narrative: overrides.narrative ?? 'Test deposit',
  };
}

describe('HashChainService', () => {
  let service: HashChainService;

  beforeEach(() => {
    service = new HashChainService(makeConfigService());
  });

  describe('getGenesisHash', () => {
    it('returns 64 zero characters', () => {
      expect(service.getGenesisHash()).toBe(GENESIS_HASH);
      expect(service.getGenesisHash()).toHaveLength(64);
    });
  });

  describe('computeHash', () => {
    it('returns a 64-character hex SHA-256 hash', () => {
      const entry = makeEntry();
      const { hash } = service.computeHash(entry, GENESIS_HASH);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns the provided previousHash in the result', () => {
      const entry = makeEntry();
      const { previousHash } = service.computeHash(entry, GENESIS_HASH);
      expect(previousHash).toBe(GENESIS_HASH);
    });

    it('produces different hashes for different amounts', () => {
      const entry1 = makeEntry({ amount: '1000.0000' });
      const entry2 = makeEntry({ amount: '2000.0000' });
      const { hash: h1 } = service.computeHash(entry1, GENESIS_HASH);
      const { hash: h2 } = service.computeHash(entry2, GENESIS_HASH);
      expect(h1).not.toBe(h2);
    });

    it('produces different hashes for different previousHash values', () => {
      const entry = makeEntry();
      const { hash: h1 } = service.computeHash(entry, GENESIS_HASH);
      const { hash: h2 } = service.computeHash(entry, 'a'.repeat(64));
      expect(h1).not.toBe(h2);
    });

    it('is deterministic — same input always produces same hash', () => {
      const entry = makeEntry();
      const { hash: h1 } = service.computeHash(entry, GENESIS_HASH);
      const { hash: h2 } = service.computeHash(entry, GENESIS_HASH);
      expect(h1).toBe(h2);
    });

    it('changes hash when any field changes', () => {
      const fields: Array<keyof ReturnType<typeof makeEntry>> = [
        'id',
        'journalId',
        'accountId',
        'entryType',
        'amount',
        'currency',
        'effectiveDate',
        'createdBy',
        'referenceType',
        'referenceId',
        'narrative',
      ];

      const base = makeEntry();
      const { hash: baseHash } = service.computeHash(base, GENESIS_HASH);

      for (const field of fields) {
        const modified = makeEntry({ [field]: 'MODIFIED_VALUE' });
        const { hash: modifiedHash } = service.computeHash(modified, GENESIS_HASH);
        expect(modifiedHash).not.toBe(baseHash);
      }
    });
  });

  describe('verifyChain', () => {
    it('returns valid=true for empty chain', () => {
      const result = service.verifyChain([]);
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
    });

    it('verifies a single-entry chain', () => {
      const entry = makeEntry();
      const { hash } = service.computeHash(entry, GENESIS_HASH);

      const result = service.verifyChain([{ ...entry, hash, previousHash: GENESIS_HASH }]);

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(1);
    });

    it('verifies a multi-entry chain', () => {
      const entries = [];
      let previousHash = GENESIS_HASH;

      for (let i = 0; i < 5; i++) {
        const entry = makeEntry({
          id: `entry-${i.toString()}`,
          referenceId: `ref-${i.toString()}`,
          amount: `${((i + 1) * 1000).toString()}.0000`,
        });
        const { hash } = service.computeHash(entry, previousHash);
        entries.push({ ...entry, hash, previousHash });
        previousHash = hash;
      }

      const result = service.verifyChain(entries);
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(5);
    });

    it('detects tampering with the amount field', () => {
      const entry = makeEntry();
      const { hash } = service.computeHash(entry, GENESIS_HASH);

      // Tamper with the amount after hash is computed
      const tampered = { ...entry, amount: '9999999.0000', hash, previousHash: GENESIS_HASH };

      const result = service.verifyChain([tampered]);
      expect(result.valid).toBe(false);
      expect(result.firstBreakAt).toBe(entry.id);
    });

    it('detects tampering with the narrative field', () => {
      const entry = makeEntry();
      const { hash } = service.computeHash(entry, GENESIS_HASH);
      const tampered = { ...entry, narrative: 'backdated entry', hash, previousHash: GENESIS_HASH };

      const result = service.verifyChain([tampered]);
      expect(result.valid).toBe(false);
    });

    it('detects a broken previousHash link between entries', () => {
      const entry1 = makeEntry({ id: 'e1' });
      const { hash: hash1 } = service.computeHash(entry1, GENESIS_HASH);

      const entry2 = makeEntry({ id: 'e2', referenceId: 'ref-2' });
      // Use wrong previous hash (simulates insertion of a forged entry)
      const { hash: hash2 } = service.computeHash(entry2, 'wrong'.padEnd(64, '0'));

      const result = service.verifyChain([
        { ...entry1, hash: hash1, previousHash: GENESIS_HASH },
        { ...entry2, hash: hash2, previousHash: 'wrong'.padEnd(64, '0') },
      ]);

      expect(result.valid).toBe(false);
      expect(result.firstBreakAt).toBe('e2');
    });

    it('reports the exact entry where the chain breaks', () => {
      const entries = [];
      let previousHash = GENESIS_HASH;

      for (let i = 0; i < 10; i++) {
        const entry = makeEntry({
          id: `entry-${i.toString()}`,
          referenceId: `ref-${i.toString()}`,
        });
        const { hash } = service.computeHash(entry, previousHash);
        entries.push({ ...entry, hash, previousHash });
        previousHash = hash;
      }

      // Tamper entry at index 5
      entries[5] = { ...entries[5]!, narrative: 'TAMPERED' };

      const result = service.verifyChain(entries);
      expect(result.valid).toBe(false);
      expect(result.firstBreakAt).toBe('entry-5');
    });
  });
});
