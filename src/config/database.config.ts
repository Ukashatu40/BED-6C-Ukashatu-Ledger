// src/config/database.config.ts
import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  url: string;
  testUrl: string;
  poolMin: number;
  poolMax: number;
}

export default registerAs('database', (): DatabaseConfig => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const testUrl = process.env.TEST_DATABASE_URL ?? url.replace('/ledger_db', '/ledger_test_db');

  const poolMin = parseInt(process.env.DATABASE_POOL_MIN ?? '2', 10);
  const poolMax = parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10);

  if (poolMin < 1 || poolMax < poolMin) {
    throw new Error(
      `Invalid pool config: DATABASE_POOL_MIN=${poolMin.toString()} DATABASE_POOL_MAX=${poolMax.toString()}`,
    );
  }

  return {
    url,
    testUrl,
    poolMin,
    poolMax,
  };
});
