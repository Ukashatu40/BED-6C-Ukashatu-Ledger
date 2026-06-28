// jest.config.ts
import type { Config } from 'jest';

const sharedModuleNameMapper = {
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
};

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  testTimeout: 30_000,
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: sharedModuleNameMapper,
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
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.spec.ts'],
      transform: {
        '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
      },
      moduleNameMapper: sharedModuleNameMapper,
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.spec.ts'],
      transform: {
        '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
      },
      moduleNameMapper: sharedModuleNameMapper,
    },
  ],
};

export default config;
