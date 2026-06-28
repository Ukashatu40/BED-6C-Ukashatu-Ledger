// tests/unit/decimal-math.spec.ts
import {
  toDecimal,
  formatMoney,
  assertBalanced,
  normalBalanceSign,
} from '@common/types/money.type';
import { Currency } from '@common/types/currency.type';
import Decimal from 'decimal.js';

describe('toDecimal', () => {
  it('converts a string to Decimal', () => {
    const d = toDecimal('5000.0000');
    expect(d.toFixed(4)).toBe('5000.0000');
  });

  it('converts a number to Decimal', () => {
    const d = toDecimal(1234);
    expect(d.toFixed(4)).toBe('1234.0000');
  });

  it('returns the same Decimal instance if already Decimal', () => {
    const original = new Decimal('99.9999');
    const result = toDecimal(original);
    expect(result).toBe(original);
  });

  it('preserves 4 decimal places without rounding loss', () => {
    const d = toDecimal('0.0001');
    expect(d.toFixed(4)).toBe('0.0001');
  });

  it('handles large amounts without precision loss', () => {
    const large = '999999999999999.9999';
    const d = toDecimal(large);
    expect(d.toFixed(4)).toBe(large);
  });

  it('never uses floating point — 0.1 + 0.2 === 0.3', () => {
    const result = toDecimal('0.1').plus(toDecimal('0.2'));
    // JavaScript: 0.1 + 0.2 = 0.30000000000000004 — Decimal.js is exact
    expect(result.toFixed(1)).toBe('0.3');
    expect(result.equals(new Decimal('0.3'))).toBe(true);
  });
});

describe('formatMoney', () => {
  it('formats INR to 2 decimal places', () => {
    expect(formatMoney(new Decimal('1000.0000'), Currency.INR)).toBe('1000.00');
  });

  it('formats USD to 2 decimal places', () => {
    expect(formatMoney(new Decimal('99.5000'), Currency.USD)).toBe('99.50');
  });

  it('formats JPY to 0 decimal places', () => {
    expect(formatMoney(new Decimal('1500.0000'), Currency.JPY)).toBe('1500');
  });
});

describe('assertBalanced', () => {
  it('does not throw when debits equal credits', () => {
    expect(() =>
      assertBalanced([
        { entryType: 'DEBIT', amount: new Decimal('1000.0000') },
        { entryType: 'CREDIT', amount: new Decimal('1000.0000') },
      ]),
    ).not.toThrow();
  });

  it('does not throw for multi-line balanced entry', () => {
    expect(() =>
      assertBalanced([
        { entryType: 'DEBIT', amount: new Decimal('5010.0000') },
        { entryType: 'CREDIT', amount: new Decimal('5000.0000') },
        { entryType: 'CREDIT', amount: new Decimal('10.0000') },
      ]),
    ).not.toThrow();
  });

  it('throws when debits exceed credits', () => {
    expect(() =>
      assertBalanced([
        { entryType: 'DEBIT', amount: new Decimal('1000.0000') },
        { entryType: 'CREDIT', amount: new Decimal('999.0000') },
      ]),
    ).toThrow('Unbalanced journal entry');
  });

  it('throws when credits exceed debits', () => {
    expect(() =>
      assertBalanced([
        { entryType: 'DEBIT', amount: new Decimal('500.0000') },
        { entryType: 'CREDIT', amount: new Decimal('600.0000') },
      ]),
    ).toThrow('Unbalanced journal entry');
  });

  it('throws with the correct discrepancy amount in the message', () => {
    expect(() =>
      assertBalanced([
        { entryType: 'DEBIT', amount: new Decimal('1000.0000') },
        { entryType: 'CREDIT', amount: new Decimal('999.9999') },
      ]),
    ).toThrow('0.0001');
  });

  it('handles sub-paise precision correctly', () => {
    expect(() =>
      assertBalanced([
        { entryType: 'DEBIT', amount: new Decimal('8342.0000') },
        { entryType: 'CREDIT', amount: new Decimal('8300.2900') },
        { entryType: 'CREDIT', amount: new Decimal('41.7100') },
      ]),
    ).not.toThrow();
  });

  it('rejects a single-line entry (cannot be balanced)', () => {
    expect(() =>
      assertBalanced([{ entryType: 'DEBIT', amount: new Decimal('1000.0000') }]),
    ).toThrow('Unbalanced journal entry');
  });
});

describe('normalBalanceSign', () => {
  it('returns +1 for ASSET accounts', () => {
    expect(normalBalanceSign('ASSET')).toBe(1);
  });

  it('returns +1 for EXPENSE accounts', () => {
    expect(normalBalanceSign('EXPENSE')).toBe(1);
  });

  it('returns -1 for LIABILITY accounts', () => {
    expect(normalBalanceSign('LIABILITY')).toBe(-1);
  });

  it('returns -1 for EQUITY accounts', () => {
    expect(normalBalanceSign('EQUITY')).toBe(-1);
  });

  it('returns -1 for REVENUE accounts', () => {
    expect(normalBalanceSign('REVENUE')).toBe(-1);
  });

  it('returns +1 for CONTRA_REVENUE', () => {
    expect(normalBalanceSign('CONTRA_REVENUE')).toBe(1);
  });

  it('returns -1 for CONTRA_ASSET', () => {
    expect(normalBalanceSign('CONTRA_ASSET')).toBe(-1);
  });
});
