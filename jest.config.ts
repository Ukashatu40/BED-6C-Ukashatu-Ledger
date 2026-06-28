//jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s', '!src/main.ts'],
  coverageDirectory: './docs/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    },
  },
  moduleNameMapper: {
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@accounts/(.*)$': '<rootDir>/src/accounts/$1',
    '^@ledger/(.*)$': '<rootDir>/src/ledger/$1',
    '^@transactions/(.*)$': '<rootDir>/src/transactions/$1',
    '^@fx/(.*)$': '<rootDir>/src/fx/$1',
    '^@reversals/(.*)$': '<rootDir>/src/reversals/$1',
    '^@audit/(.*)$': '<rootDir>/src/audit/$1',
    '^@reporting/(.*)$': '<rootDir>/src/reporting/$1',
    '^@health/(.*)$': '<rootDir>/src/health/$1',
  },
  // Separate projects for unit and integration — run independently
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.spec.ts'],
      moduleNameMapper: {
        '^@config/(.*)$': '<rootDir>/src/config/$1',
        '^@common/(.*)$': '<rootDir>/src/common/$1',
        '^@database/(.*)$': '<rootDir>/src/database/$1',
        '^@accounts/(.*)$': '<rootDir>/src/accounts/$1',
        '^@ledger/(.*)$': '<rootDir>/src/ledger/$1',
        '^@transactions/(.*)$': '<rootDir>/src/transactions/$1',
        '^@fx/(.*)$': '<rootDir>/src/fx/$1',
        '^@reversals/(.*)$': '<rootDir>/src/reversals/$1',
        '^@audit/(.*)$': '<rootDir>/src/audit/$1',
        '^@reporting/(.*)$': '<rootDir>/src/reporting/$1',
        '^@health/(.*)$': '<rootDir>/src/health/$1',
      },
      transform: {
        '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
      },
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.spec.ts'],
      // Integration tests run serially — never in parallel
      // (they share the test database and the hash chain must be sequential)
      runner: 'jest-runner',
      testEnvironment: 'node',
      moduleNameMapper: {
        '^@config/(.*)$': '<rootDir>/src/config/$1',
        '^@common/(.*)$': '<rootDir>/src/common/$1',
        '^@database/(.*)$': '<rootDir>/src/database/$1',
        '^@accounts/(.*)$': '<rootDir>/src/accounts/$1',
        '^@ledger/(.*)$': '<rootDir>/src/ledger/$1',
        '^@transactions/(.*)$': '<rootDir>/src/transactions/$1',
        '^@fx/(.*)$': '<rootDir>/src/fx/$1',
        '^@reversals/(.*)$': '<rootDir>/src/reversals/$1',
        '^@audit/(.*)$': '<rootDir>/src/audit/$1',
        '^@reporting/(.*)$': '<rootDir>/src/reporting/$1',
        '^@health/(.*)$': '<rootDir>/src/health/$1',
      },
      transform: {
        '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
      },
      // Give integration tests more time — they hit a real database
      testTimeout: 30_000,
      // CRITICAL: run integration tests serially to preserve hash chain order
      maxWorkers: 1,
    },
  ],
};

export default config;
