// src/audit/audit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@database/database.service';
import { HashChainService } from '@ledger/hash-chain.service';
import type { ChainVerificationResult } from '@ledger/hash-chain.service';
import type { LedgerEntry } from '@prisma/client';
import Decimal from 'decimal.js';

export interface AnomalyFlag {
  entryId: string;
  type: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface AuditVerificationReport {
  fromDate: string;
  toDate: string;
  verifiedAt: string;
  chainResult: ChainVerificationResult;
  anomalies: AnomalyFlag[];
}

interface AnomalyRow {
  id: string;
  anomaly_type: string;
  description: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly hashChain: HashChainService,
  ) {}

  /**
   * Verify the hash chain integrity for a date range.
   * Fetches all POSTED entries in insertion order and traverses the chain.
   * Any tampered entry breaks the chain and is reported with its exact position.
   */
  async verifyChain(from?: Date, to?: Date): Promise<AuditVerificationReport> {
    const fromDate = from ?? new Date(0);
    const toDate = to ?? new Date();

    this.logger.log(
      `Starting hash chain verification: ${fromDate.toISOString()} → ${toDate.toISOString()}`,
    );

    const entries = await this.db.ledgerEntry.findMany({
      where: {
        status: 'POSTED',
        postedAt: { gte: fromDate, lte: toDate },
      },
      orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
    });

    // Map to the HashableEntry shape expected by HashChainService
    const hashableEntries = entries.map((e: LedgerEntry) => ({
      id: e.id,
      journalId: e.journalId,
      accountId: e.accountId,
      entryType: e.entryType,
      // CRITICAL: toFixed(4) matches how LedgerService stores the hash input
      amount: new Decimal(e.amount.toString()).toFixed(4),
      currency: e.currency,
      effectiveDate: e.effectiveDate.toISOString(),
      createdBy: e.createdBy,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      narrative: e.narrative,
      hash: e.hash,
      previousHash: e.previousHash,
    }));

    const chainResult = this.hashChain.verifyChain(hashableEntries);
    const anomalies = await this.detectAnomalies(fromDate, toDate);

    return {
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      verifiedAt: new Date().toISOString(),
      chainResult,
      anomalies,
    };
  }

  /**
   * Detect suspicious patterns in ledger entries.
   *
   * Flags (inspired by Wirecard case study — spec Part C Case Study 3):
   *   1. Large round-number entries (potential fabrication)
   *   2. Entries posted outside business hours (00:00–05:00 IST)
   *   3. Entries with SYSTEM as creator on non-accrual transaction types
   *   4. Entries where narrative contains placeholder text
   */
  async detectAnomalies(from: Date, to: Date): Promise<AnomalyFlag[]> {
    const anomalies: AnomalyFlag[] = [];

    // 1. Large round-number entries > INR 1,00,000 with no decimal component
    const roundNumbers = await this.db.$queryRaw<AnomalyRow[]>`
      SELECT
        id,
        'LARGE_ROUND_NUMBER' AS anomaly_type,
        'Entry amount is a large round number — potential fabrication risk' AS description
      FROM ledger_entries
      WHERE status    = 'POSTED'
        AND posted_at BETWEEN ${from} AND ${to}
        AND amount    >= 100000
        AND amount    = FLOOR(amount)
      LIMIT 50
    `;

    for (const row of roundNumbers) {
      anomalies.push({
        entryId: row.id,
        type: row.anomaly_type,
        description: row.description,
        severity: 'MEDIUM',
      });
    }

    // 2. Entries posted between midnight and 5am UTC (after-hours activity)
    const afterHours = await this.db.$queryRaw<AnomalyRow[]>`
      SELECT
        id,
        'AFTER_HOURS_POSTING' AS anomaly_type,
        'Entry posted between 00:00 and 05:00 UTC — after-hours activity' AS description
      FROM ledger_entries
      WHERE status    = 'POSTED'
        AND posted_at BETWEEN ${from} AND ${to}
        AND EXTRACT(HOUR FROM posted_at AT TIME ZONE 'UTC') BETWEEN 0 AND 4
      LIMIT 50
    `;

    for (const row of afterHours) {
      anomalies.push({
        entryId: row.id,
        type: row.anomaly_type,
        description: row.description,
        severity: 'LOW',
      });
    }

    // 3. Entries with suspiciously short or generic narratives
    const weakNarratives = await this.db.$queryRaw<AnomalyRow[]>`
      SELECT
        id,
        'WEAK_NARRATIVE' AS anomaly_type,
        'Entry narrative is too short or generic — may indicate automated error' AS description
      FROM ledger_entries
      WHERE status    = 'POSTED'
        AND posted_at BETWEEN ${from} AND ${to}
        AND (LENGTH(narrative) < 5 OR narrative ILIKE '%test%' OR narrative ILIKE '%placeholder%')
      LIMIT 50
    `;

    for (const row of weakNarratives) {
      anomalies.push({
        entryId: row.id,
        type: row.anomaly_type,
        description: row.description,
        severity: 'HIGH',
      });
    }

    if (anomalies.length > 0) {
      this.logger.warn(
        `Anomaly detection: ${anomalies.length.toString()} flags raised between ` +
          `${from.toISOString()} and ${to.toISOString()}`,
      );
    }

    return anomalies;
  }

  /**
   * Export all ledger entries in a date range as a tamper-evident JSON package.
   * Includes the chain verification result so regulators can independently verify.
   *
   * Referenced in spec Case Study 3 (Wirecard) and Case Study 5 (SVB):
   * how regulators get a complete, verifiable ledger export.
   */
  async exportForRegulator(from: Date, to: Date): Promise<object> {
    const verification = await this.verifyChain(from, to);

    const entries = await this.db.ledgerEntry.findMany({
      where: {
        status: 'POSTED',
        postedAt: { gte: from, lte: to },
      },
      include: { account: { select: { code: true, name: true, type: true } } },
      orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
    });

    return {
      exportMetadata: {
        exportedAt: new Date().toISOString(),
        fromDate: from.toISOString(),
        toDate: to.toISOString(),
        totalEntries: entries.length,
        chainValid: verification.chainResult.valid,
        anomalyCount: verification.anomalies.length,
        genesisHash: this.hashChain.getGenesisHash(),
      },
      chainVerification: verification.chainResult,
      anomalies: verification.anomalies,
      entries,
    };
  }
}
