// src/config/app.config.ts
import { registerAs } from '@nestjs/config';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  apiKeys: string[];
  genesisHash: string;
  idempotencyTtlHours: number;
  fxRateMaxAgeMinutes: number;
  logLevel: string;
  logPretty: boolean;
  metricsEnabled: boolean;
}

export default registerAs('app', (): AppConfig => {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const idempotencyTtlHours = parseInt(process.env.IDEMPOTENCY_TTL_HOURS ?? '24', 10);
  const fxRateMaxAgeMinutes = parseInt(process.env.FX_RATE_MAX_AGE_MINUTES ?? '60', 10);

  const apiKeysRaw = process.env.API_KEYS ?? '';
  const apiKeys = apiKeysRaw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error('API_KEYS environment variable must contain at least one key');
  }

  const genesisHash =
    process.env.GENESIS_HASH ?? '0000000000000000000000000000000000000000000000000000000000000000';

  if (genesisHash.length !== 64) {
    throw new Error('GENESIS_HASH must be exactly 64 hex characters (SHA-256 zero hash)');
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port,
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    apiKeys,
    genesisHash,
    idempotencyTtlHours,
    fxRateMaxAgeMinutes,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    logPretty: process.env.LOG_PRETTY === 'true',
    metricsEnabled: process.env.METRICS_ENABLED !== 'false',
  };
});
