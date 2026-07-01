// src/transactions/idempotency.service.ts
import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { DatabaseService } from '@database/database.service';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@config/app.config';
import type { IdempotencyKey } from '@prisma/client';

export interface IdempotencyResult {
  isNew: boolean;
  keyRecord: IdempotencyKey;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlHours: number;

  constructor(
    private readonly db: DatabaseService,
    configService: ConfigService,
  ) {
    const appConfig = configService.get<AppConfig>('app');
    if (!appConfig) throw new Error('App config missing');
    this.ttlHours = appConfig.idempotencyTtlHours;
  }

  /**
   * Hash the request body for conflict detection.
   * If a client reuses an idempotency key with a DIFFERENT body,
   * we return HTTP 409 — same key, different intent is a client bug.
   */
  private hashRequestBody(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
  }

  /**
   * Check and reserve an idempotency key atomically.
   *
   * Flow:
   *   - Key not found → insert with PROCESSING, return isNew=true
   *   - Key found, same body hash, COMPLETED → return isNew=false (replay stored response)
   *   - Key found, same body hash, PROCESSING → still in flight, return isNew=false
   *   - Key found, different body hash → throw 409 (key reused with different request)
   *
   * The entire check-and-insert is wrapped in a serializable transaction
   * to prevent race conditions on concurrent requests with the same key.
   */
  async checkAndReserve(
    key: string,
    userId: string,
    endpoint: string,
    requestBody: unknown,
  ): Promise<IdempotencyResult> {
    const requestHash = this.hashRequestBody(requestBody);
    const expiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);
    const maxRetries = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.db.withSerializableTransaction(async (tx) => {
          const client = tx as DatabaseService;

          const existing = await client.idempotencyKey.findUnique({
            where: { key_userId: { key, userId } },
          });

          if (existing) {
            if (existing.requestHash !== requestHash) {
              throw new ConflictException(
                `Idempotency key "${key}" was already used for a different request. ` +
                  `Use a new idempotency key for this request.`,
              );
            }
            this.logger.log(
              `Idempotency key "${key}" already exists for user ${userId} — replaying`,
            );
            return { isNew: false, keyRecord: existing };
          }

          const keyRecord = await client.idempotencyKey.create({
            data: {
              id: uuidv7(),
              key,
              userId,
              endpoint,
              requestHash,
              status: 'PROCESSING',
              expiresAt,
            },
          });

          return { isNew: true, keyRecord };
        });
      } catch (error) {
        // ConflictException is a business error — never retry
        if (error instanceof ConflictException) throw error;

        const msg = error instanceof Error ? error.message : String(error);
        const isRetryable =
          msg.includes('write conflict') ||
          msg.includes('TransactionWriteConflict') ||
          msg.includes('deadlock') ||
          msg.includes('could not serialize') ||
          msg.includes('Transaction failed due to a write conflict');

        if (isRetryable && attempt < maxRetries) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(2, attempt - 1)));
          this.logger.warn(
            `Idempotency write conflict attempt ${attempt.toString()}/${maxRetries.toString()} — retrying key "${key}"`,
          );
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Mark an idempotency key as COMPLETED and store the response.
   * Called after a transaction is successfully posted.
   */
  async markCompleted(
    keyId: string,
    transactionId: string,
    response: StoredResponse,
  ): Promise<void> {
    await this.db.idempotencyKey.update({
      where: { id: keyId },
      data: {
        status: 'COMPLETED',
        transactionId,
        responseStatus: response.status,
        responseBody: response.body as never,
      },
    });
  }

  /**
   * Mark an idempotency key as FAILED.
   * A FAILED key allows retry with the same key and same body.
   */
  async markFailed(keyId: string, error: string): Promise<void> {
    await this.db.idempotencyKey.update({
      where: { id: keyId },
      data: {
        status: 'FAILED',
        responseBody: { error } as never,
      },
    });
  }

  /**
   * Cleanup job: mark stale PROCESSING keys as FAILED.
   * A key stuck in PROCESSING for >5 minutes indicates a crashed process.
   * Called by a scheduled task — allows the client to retry.
   */
  async cleanupStaleKeys(): Promise<number> {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

    const result = await this.db.idempotencyKey.updateMany({
      where: {
        status: 'PROCESSING',
        createdAt: { lt: staleThreshold },
      },
      data: { status: 'FAILED' },
    });

    if (result.count > 0) {
      this.logger.warn(`Cleaned up ${result.count.toString()} stale idempotency keys`);
    }

    return result.count;
  }
}
