# Incident Response: Day 6 — USD Conversion at 48-Hour Stale Rate

## Incident Summary

USD deposit converted at 48-hour-old rate. Customer received INR 4,200 less
than market rate. Customer complaint and social media escalation.

## Root Cause

The FX engine fetched the "current" rate without checking its age.
A 48-hour-old rate was returned as current because `valid_until` was NULL
and no staleness check existed.

## Our Design Solution

### 1. Rate Validity Windows

Every rate snapshot has `valid_from` and `valid_until` timestamps.
When a new rate is ingested, the previous rate's `valid_until` is set to
the new rate's `valid_from`.

### 2. Staleness Rejection

```typescript
// FxRateService.assertNotStale()
const ageMinutes = (Date.now() - snapshot.capturedAt.getTime()) / 60_000;
if (ageMinutes > this.maxAgeMinutes) {
  throw new UnprocessableEntityException(
    `Exchange rate is stale: ${ageMinutes.toFixed(1)} minutes old, ` +
      `maximum allowed is ${this.maxAgeMinutes} minutes.`,
  );
}
```

### 3. Configuration

`FX_RATE_MAX_AGE_MINUTES=60` in `.env`. Configurable per environment.
Production would set this to 15 minutes for real-time rate feeds.

### 4. Graceful Degradation

If the rate provider is unavailable, the most recent cached rate is used
with an explicit warning in the response and a wider spread applied to
compensate for staleness risk (circuit breaker pattern from spec A10.4).

### 5. Audit Trail

Every FX conversion ledger entry stores the `rateSnapshotId` in metadata,
allowing historical reconstruction of exactly which rate was applied.
