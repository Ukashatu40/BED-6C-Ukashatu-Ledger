// tests/integration/jest.setup.ts
const testUrl =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://ledger_user:ledger_pass@localhost:5433/ledger_test_db?schema=public';

// Remap so DatabaseService ConfigModule reads the test DB
process.env['DATABASE_URL'] = testUrl;

console.log(`[jest.setup] Using test database: ${testUrl.replace(/:[^:@]+@/, ':***@')}`);
