// src/ledger/hash-chain.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@config/app.config';
import Decimal from 'decimal.js'; // Or your specific 'decimal.js' import path

/**
 * The fields that contribute to each entry's hash.
 * Changing ANY of these fields after posting breaks the chain —
 * that is exactly what makes tampering detectable.
 */
export interface HashableEntry {
  id: string;
  journalId: string;
  accountId: string;
  entryType: string;
  amount: string; // string representation of NUMERIC(19,4)
  currency: string;
  effectiveDate: string; // ISO 8601 UTC string
  createdBy: string;
  referenceType: string;
  referenceId: string;
  narrative: string;
}

export interface HashChainResult {
  hash: string;
  previousHash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  firstBreakAt?: string; // entry ID where the chain breaks
  brokenHash?: string; // the stored hash that doesn't match
  expectedHash?: string; // what the hash should be
}

// Interface for unformatted inputs containing raw Decimal or Date types from the DB
export interface RawLedgerEntry {
  id: string;
  journalId: string;
  accountId: string;
  entryType: string;
  amount: { toString(): string } | Decimal | number;
  currency: string;
  effectiveDate: Date | string;
  createdBy: string;
  referenceType: string;
  referenceId: string;
  narrative: string;
  hash: string;
  previousHash: string;
}

@Injectable()
export class HashChainService {
  private readonly logger = new Logger(HashChainService.name);
  private readonly genesisHash: string;

  constructor(configService: ConfigService) {
    const appConfig = configService.get<AppConfig>('app');
    if (!appConfig) throw new Error('App config missing');
    this.genesisHash = appConfig.genesisHash;
  }

  /**
   * Compute the SHA-256 hash for a new ledger entry.
   */
  computeHash(entry: HashableEntry, previousHash: string): HashChainResult {
    const input = [
      entry.id,
      entry.journalId,
      entry.accountId,
      entry.entryType,
      entry.amount,
      entry.currency,
      entry.effectiveDate,
      entry.createdBy,
      entry.referenceType,
      entry.referenceId,
      entry.narrative,
      previousHash,
    ].join('|');

    const hash = createHash('sha256').update(input, 'utf8').digest('hex');

    return { hash, previousHash };
  }

  /**
   * Get the genesis hash — the previousHash for the very first entry.
   */
  getGenesisHash(): string {
    return this.genesisHash;
  }

  /**
   * Verify the integrity of a sequence of ledger entries.
   * Traverses every entry in insertion order and recomputes each hash.
   *
   * @param entries - Raw, unsanitized ledger records directly from the database layer
   */
  verifyChain(entries: RawLedgerEntry[]): ChainVerificationResult {
    if (entries.length === 0) {
      return { valid: true, totalEntries: 0 };
    }

    // Transform raw DB values into standard strings to fix string representation issues
    const hashableEntries = entries.map((e: RawLedgerEntry) => ({
      id: e.id,
      journalId: e.journalId,
      accountId: e.accountId,
      entryType: e.entryType,
      // CRITICAL: always toFixed(4) — Prisma Decimal.toString() omits trailing zeros
      amount: new Decimal(e.amount.toString()).toFixed(4),
      currency: e.currency,
      effectiveDate:
        typeof e.effectiveDate === 'string' ? e.effectiveDate : e.effectiveDate.toISOString(),
      createdBy: e.createdBy,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      narrative: e.narrative,
      hash: e.hash,
      previousHash: e.previousHash,
    }));

    let expectedPreviousHash = this.genesisHash;

    for (const entry of hashableEntries) {
      // Verify the stored previousHash matches what we expect
      if (entry.previousHash !== expectedPreviousHash) {
        this.logger.warn(
          `Hash chain break detected at entry ${entry.id}: ` +
            `stored previousHash=${entry.previousHash} ` +
            `expected=${expectedPreviousHash}`,
        );
        return {
          valid: false,
          totalEntries: hashableEntries.length,
          firstBreakAt: entry.id,
          brokenHash: entry.previousHash,
          expectedHash: expectedPreviousHash,
        };
      }

      // Recompute this entry's hash and compare to stored
      const { hash: recomputed } = this.computeHash(
        {
          id: entry.id,
          journalId: entry.journalId,
          accountId: entry.accountId,
          entryType: entry.entryType,
          amount: entry.amount,
          currency: entry.currency,
          effectiveDate: entry.effectiveDate,
          createdBy: entry.createdBy,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          narrative: entry.narrative,
        },
        entry.previousHash,
      );

      if (recomputed !== entry.hash) {
        this.logger.warn(
          `Hash mismatch at entry ${entry.id}: ` + `stored=${entry.hash} recomputed=${recomputed}`,
        );
        return {
          valid: false,
          totalEntries: hashableEntries.length,
          firstBreakAt: entry.id,
          brokenHash: entry.hash,
          expectedHash: recomputed,
        };
      }

      // This entry is valid — its hash becomes the next entry's expectedPreviousHash
      expectedPreviousHash = entry.hash;
    }

    this.logger.log(`Hash chain verified: ${hashableEntries.length.toString()} entries, all valid`);
    return { valid: true, totalEntries: hashableEntries.length };
  }
}
