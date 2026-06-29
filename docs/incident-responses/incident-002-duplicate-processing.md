# Incident Response: Day 2 — Duplicate P2P Transfer Processing

## Incident Summary

FinCore posted a P2P transfer twice due to network timeout retry.
Customer was charged INR 15,000 instead of INR 7,500. Escalated to Nodal Officer.

## Root Cause

The outgoing system had no idempotency layer. On network timeout, the client
retried the request. The server processed both requests independently, creating
two separate journal entries for the same economic event.

## Our Design Solution

### 1. Idempotency Key Enforcement

Every state-mutating API endpoint requires `X-Idempotency-Key` header.
Missing key returns HTTP 400 immediately.

### 2. Atomic Check-and-Reserve

```typescript
// IdempotencyService.checkAndReserve() runs inside SERIALIZABLE transaction
const existing = await client.idempotencyKey.findUnique({
  where: { key_userId: { key, userId } },
});
if (existing) return { isNew: false, keyRecord: existing }; // replay
```

### 3. Response Replay

On duplicate request: if `status = COMPLETED`, the stored `responseBody`
is returned immediately. No new processing occurs. The client receives
an identical response to the original request.

### 4. Stale Key Cleanup

Keys in `PROCESSING` state for > 5 minutes are marked `FAILED` by a
background job, allowing retry after a crash.

### 5. Database Constraint Backup

```sql
UNIQUE INDEX ON idempotency_keys (key, user_id)
```

Even if the application-level check has a race condition, the database
constraint prevents two rows with the same (key, user_id) from being inserted.

## Prevention Verification

```bash
# Post the same request twice with the same idempotency key
# Second response must be identical to first, no new ledger entries created
curl -H "X-Idempotency-Key: test-idem-001" -X POST .../transactions ...
curl -H "X-Idempotency-Key: test-idem-001" -X POST .../transactions ...
# Verify: only 2 ledger entries exist (not 4)
```
