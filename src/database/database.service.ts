// src/database/database.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { DatabaseConfig } from '@config/database.config';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result row from a raw SQL query.
 * We use `unknown` and narrow at the call site for type safety.
 */
export type RawQueryResult = Record<string, unknown>;

/**
 * Transaction client type — used for passing the active transaction
 * context through the call stack so all operations in a journal entry
 * share the same BEGIN...COMMIT boundary.
 */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Isolation levels supported by Prisma interactive transactions.
 */
export type IsolationLevel =
  | 'ReadUncommitted'
  | 'ReadCommitted'
  | 'RepeatableRead'
  | 'Serializable';

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(configService: ConfigService) {
    const dbConfig = configService.get<DatabaseConfig>('database');

    if (!dbConfig) {
      throw new Error('Database configuration is missing');
    }

    super({
      datasources: {
        db: { url: dbConfig.url },
      },
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
    await this.verifyPostgresVersion();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Raw SQL Helpers
  //
  // These are used for operations Prisma's query builder cannot express:
  //   - SELECT ... FOR UPDATE (pessimistic locking)
  //   - pg_advisory_xact_lock (advisory locks)
  //   - Complex aggregation for trial balance
  //   - Window functions for account statements
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute a raw SELECT query and return typed rows.
   * Use for read operations: trial balance, statements, reporting.
   *
   * USAGE — always use the Prisma.sql tagged template literal:
   *   const rows = await this.db.queryRaw<MyType>(
   *     Prisma.sql`SELECT * FROM accounts WHERE id = ${accountId}`
   *   );
   */
  async queryRaw<T extends RawQueryResult>(
    sql: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> {
    // Prisma.$queryRawUnsafe accepts a string + params — safer than
    // building raw strings; we keep parameterisation at the call site.
    const result = (await this.$queryRawUnsafe(
      sql.reduce((acc, part, i) => acc + (i < values.length ? `$${i + 1}` : '') + part),
      ...values,
    )) as T[];

    return result;
  }

  /**
   * Execute a raw SQL statement (DDL / DML).
   * Returns the number of affected rows.
   */
  async executeRaw(sql: TemplateStringsArray, ...values: unknown[]): Promise<number> {
    const result = await this.$executeRawUnsafe(
      sql.reduce((acc, part, i) => acc + (i < values.length ? `$${i + 1}` : '') + part),
      ...values,
    );
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Transaction Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Run a callback inside a PostgreSQL transaction (BEGIN ... COMMIT).
   * On any exception, automatically rolls back.
   *
   * CRITICAL: All journal entry operations MUST use this. The double-entry
   * invariant (debits = credits) is only guaranteed if all lines of a
   * journal entry are committed atomically.
   *
   * @example
   * await this.db.withTransaction(async (tx) => {
   *   await this.ledgerRepo.insertEntry(tx, debitLine);
   *   await this.ledgerRepo.insertEntry(tx, creditLine);
   * });
   */
  async withTransaction<T>(
    callback: (tx: TransactionClient) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: IsolationLevel;
    },
  ): Promise<T> {
    return this.$transaction(callback, {
      maxWait: options?.maxWait ?? 5_000,
      timeout: options?.timeout ?? 30_000,
      isolationLevel: options?.isolationLevel ?? 'ReadCommitted',
    });
  }

  /**
   * Run a callback inside a SERIALIZABLE transaction.
   * Use for: balance checks before large withdrawals, refund deduplication.
   * Higher abort rate — caller must handle retries.
   */
  async withSerializableTransaction<T>(
    callback: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.withTransaction(callback, {
      isolationLevel: 'Serializable',
      timeout: 15_000,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Advisory Lock Helpers
  //
  // pg_advisory_xact_lock acquires a transaction-level lock automatically
  // released at COMMIT/ROLLBACK. Primary tool for double-spend prevention.
  //
  // Lock ordering: ALWAYS sort accountIds ascending before acquiring to
  // prevent deadlock when multiple accounts are involved in one transaction.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Acquire PostgreSQL advisory locks for one or more accounts.
   * Must be called INSIDE a withTransaction callback.
   *
   * @param tx    - The active transaction client
   * @param accountIds - Account UUIDs to lock (sorted internally)
   */
  async acquireAdvisoryLocks(tx: TransactionClient, accountIds: string[]): Promise<void> {
    // Sort ascending — consistent order prevents deadlock
    const sorted = [...accountIds].sort();

    for (const accountId of sorted) {
      const lockKey = this.uuidToLockKey(accountId);
      // pg_advisory_xact_lock blocks until the lock is acquired.
      // It is automatically released when the transaction ends.
      await (tx as PrismaClient).$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock($1)`,
        lockKey.toString(),
      );
    }
  }

  /**
   * Convert a UUID string to a stable bigint for advisory lock keys.
   * Uses first 15 hex chars to stay within PostgreSQL bigint range.
   */
  private uuidToLockKey(uuid: string): bigint {
    const hex = uuid.replace(/-/g, '').slice(0, 15);
    return BigInt(`0x${hex}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Health & Diagnostics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ping the database. Used by the health endpoint.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return the PostgreSQL server version string.
   */
  async getPostgresVersion(): Promise<string> {
    const result = await this.$queryRaw<[{ version: string }]>`
      SELECT version()
    `;
    return result[0]?.version ?? 'unknown';
  }

  /**
   * Verify PostgreSQL >= 15. Throws on startup if version is too old.
   */
  private async verifyPostgresVersion(): Promise<void> {
    const result = await this.$queryRaw<[{ server_version_num: string }]>`
      SHOW server_version_num
    `;

    const versionNum = parseInt(result[0]?.server_version_num ?? '0', 10);

    // 150000 = PG 15.0, 160000 = PG 16.0
    if (versionNum < 150_000) {
      throw new Error(
        `PostgreSQL 15+ is required. Detected version number: ${versionNum.toString()}`,
      );
    }

    this.logger.log(`PostgreSQL version OK (${versionNum.toString()})`);
  }
}
