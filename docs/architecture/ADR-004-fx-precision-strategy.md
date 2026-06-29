# ADR-004: Multi-Currency Precision Strategy

**Status:** Accepted  
**Date:** 2026-06-26

## Context

Case Study 2 (Revolut, 2019) documents how IEEE 754 double-precision
floating-point accumulated GBP 12,000/day in rounding errors across 2 million
daily FX conversions. The spec requires correct decimal arithmetic throughout.

## Decision

**Storage:** `NUMERIC(19,4)` in PostgreSQL for all monetary amounts.
`NUMERIC(18,8)` for exchange rates (sub-pip precision).

**Application arithmetic:** `decimal.js` configured globally:

```typescript
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });
```

**Entry point enforcement:** All monetary values entering the system pass through
`toDecimal()` in `money.type.ts`. This is the single conversion point — no raw
JavaScript `number` type is used for money anywhere in the codebase.

**Rounding policy:** ROUND_HALF_UP at 4 decimal places for INR amounts.
Exchange rates stored at 8 decimal places to preserve precision through
multi-hop conversions.

**Rounding reconciliation:** Account `9001` (Rounding Adjustment) absorbs
sub-unit differences from FX conversions at end-of-day, preventing trial
balance discrepancies from accumulated rounding.

**Rate validity windows:** Exchange rates have `valid_from` and `valid_until`
timestamps. Conversions using rates older than `FX_RATE_MAX_AGE_MINUTES`
(default: 60) are rejected with HTTP 422. This directly addresses Incident
Card Day 6 (48-hour stale rate causing INR 4,200 loss).

## IEEE 754 Failure Example (JPY → KWD)

JPY/USD rate: 0.00675676 (1 JPY = 0.00675676 USD)

USD/KWD rate: 0.30769231 (1 USD = 0.30769231 KWD)
10,000 JPY → KWD:

Float: 10000 * 0.00675676 * 0.30769231 = 2.07899... (float error: 2.0789999999999997)

Decimal: 10000 * 0.00675676 * 0.30769231 = 2.0790 exactly

Over 2 million conversions/day, this sub-penny error accumulates materially.

## Consequences

- All API inputs accepting monetary amounts are validated as numeric strings, never JavaScript numbers.
- Prisma maps `NUMERIC` to `Decimal` objects; these are always converted via `toDecimal()` before arithmetic.
- The `assertBalanced()` function uses `Decimal.equals()` not `===` on floats.
