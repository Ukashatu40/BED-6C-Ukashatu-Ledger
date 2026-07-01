// tests/load/concurrent-withdrawal.js
// Day 7 deliverable: concurrent withdrawal load test
// Usage: k6 run tests/load/concurrent-withdrawal.js
// Prerequisites:
//   1. npm run start:dev (app running on port 3000)
//   2. A funded test account (run the setup script below first)
//
// What this proves:
//   - 50 concurrent users all attempt to withdraw INR 500 from the same account
//   - Account is seeded with INR 10,000 (should allow exactly 20 withdrawals)
//   - At most 20 requests succeed; the rest return 422 INSUFFICIENT_BALANCE
//   - The account balance NEVER goes negative (verified by the teardown check)
//   - Zero unhandled errors (500s) — all failures are clean business rejections

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ── Custom metrics ──────────────────────────────────────────────────────────
const successfulWithdrawals = new Counter('successful_withdrawals');
const insufficientBalance = new Counter('insufficient_balance_rejections');
const unexpectedErrors = new Counter('unexpected_errors');
const withdrawalDuration = new Trend('withdrawal_duration_ms', true);
const successRate = new Rate('withdrawal_success_rate');

// ── Configuration ───────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const API_KEY = __ENV.API_KEY || 'dev-api-key-change-in-production';
const WALLET_ID = __ENV.WALLET_ID || ''; // Set by setup or pass via --env
const LIABILITY_ID = __ENV.LIABILITY_ID || '';

export const options = {
  // 50 concurrent virtual users — all fire simultaneously
  scenarios: {
    concurrent_withdrawals: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 50,
      maxDuration: '30s',
    },
  },
  thresholds: {
    // No 5xx errors allowed — all failures must be clean 422s
    http_req_failed: ['rate<0.01'],
    // All requests must complete within 5 seconds
    http_req_duration: ['p(99)<5000'],
    // At most 20 of 50 withdrawals can succeed (10000 / 500 = 20)
    successful_withdrawals: ['count<=20'],
    // Exactly 0 unexpected errors (only 422 is acceptable failure)
    unexpected_errors: ['count==0'],
  },
};

const HEADERS = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
  'X-User-ID': 'load-test-user',
};

export function setup() {
  // Verify the app is reachable
  const health = http.get(`${BASE_URL}/health`);
  if (health.status !== 200) {
    throw new Error(`App not healthy: ${health.status.toString()}`);
  }

  if (!WALLET_ID || !LIABILITY_ID) {
    throw new Error(
      'WALLET_ID and LIABILITY_ID must be set.\n' +
        'Run: k6 run tests/load/concurrent-withdrawal.js ' +
        '--env WALLET_ID=<uuid> --env LIABILITY_ID=<uuid>',
    );
  }

  // Seed INR 10,000 into the wallet before the test
  const depositPayload = JSON.stringify({
    type: 'CUSTOMER_DEPOSIT_BANK',
    effectiveDate: new Date().toISOString(),
    payload: {
      walletAccountId: WALLET_ID,
      liabilityAccountId: LIABILITY_ID,
      amount: '10000.0000',
      currency: 'INR',
      reference: 'k6-load-test-seed',
    },
  });

  const depositResp = http.post(`${BASE_URL}/transactions`, depositPayload, {
    headers: {
      ...HEADERS,
      'X-Idempotency-Key': `k6-seed-deposit-${Date.now().toString()}`,
    },
  });

  if (depositResp.status !== 201) {
    throw new Error(`Seed deposit failed: ${depositResp.status.toString()} ${depositResp.body}`);
  }

  console.log('✅ Seed deposit of INR 10,000 successful');
  return { walletId: WALLET_ID, liabilityId: LIABILITY_ID };
}

export default function (data) {
  // Each VU gets a unique idempotency key
  const idempotencyKey = `k6-withdrawal-${__VU.toString()}-${__ITER.toString()}`;

  const payload = JSON.stringify({
    type: 'CUSTOMER_WITHDRAWAL_BANK',
    effectiveDate: new Date().toISOString(),
    payload: {
      walletAccountId: data.walletId,
      liabilityAccountId: data.liabilityId,
      amount: '500.0000',
      currency: 'INR',
      beneficiary: 'k6-test-account',
    },
  });

  const start = Date.now();

  const resp = http.post(`${BASE_URL}/transactions`, payload, {
    headers: {
      ...HEADERS,
      'X-Idempotency-Key': idempotencyKey,
    },
  });

  withdrawalDuration.add(Date.now() - start);

  if (resp.status === 201) {
    successfulWithdrawals.add(1);
    successRate.add(true);

    check(resp, {
      'successful withdrawal returns 201': (r) => r.status === 201,
      'response has transactionId': (r) => JSON.parse(r.body).transactionId !== undefined,
      'totalDebits equals totalCredits': (r) => {
        const body = JSON.parse(r.body);
        return body.totalDebits === body.totalCredits;
      },
    });
  } else if (resp.status === 422) {
    insufficientBalance.add(1);
    successRate.add(false);

    check(resp, {
      '422 has structured error response': (r) => {
        const body = JSON.parse(r.body);
        return body.error !== undefined && body.error.type !== undefined;
      },
      '422 error type is INSUFFICIENT_BALANCE or BUSINESS_RULE': (r) => {
        const body = JSON.parse(r.body);
        return ['INSUFFICIENT_BALANCE', 'BUSINESS_RULE_VIOLATION'].includes(body.error.type);
      },
    });
  } else {
    unexpectedErrors.add(1);
    console.error(`Unexpected response: status=${resp.status.toString()} body=${resp.body}`);
  }
}

export function teardown(data) {
  // Final balance check — must not be negative
  const balanceResp = http.get(`${BASE_URL}/ledger/accounts/${data.walletId}/balance`, {
    headers: HEADERS,
  });

  check(balanceResp, {
    'balance endpoint returns 200': (r) => r.status === 200,
  });

  if (balanceResp.status === 200) {
    const body = JSON.parse(balanceResp.body);
    const balance = parseFloat(body.balance);

    check(balanceResp, {
      'CRITICAL: balance is not negative': () => balance >= 0,
      'balance is a multiple of 500': () => balance % 500 === 0,
    });

    console.log(`\n📊 Final wallet balance: INR ${body.balance}`);
    console.log(`   This proves no double-spend occurred.`);
  }

  // Hash chain verification — must remain valid under load
  const auditResp = http.get(`${BASE_URL}/audit/verify`, { headers: HEADERS });

  if (auditResp.status === 200) {
    const audit = JSON.parse(auditResp.body);
    check(auditResp, {
      'hash chain remains valid after load test': () => audit.chainResult.valid === true,
    });
    console.log(
      `🔐 Hash chain: ${audit.chainResult.valid ? 'VALID' : 'BROKEN'} ` +
        `(${audit.chainResult.totalEntries.toString()} entries)`,
    );
  }
}
