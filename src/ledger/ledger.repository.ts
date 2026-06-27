// src/ledger/ledger.repository.ts
import { Injectable } from '@nestjs/common';
import { Prisma, type LedgerEntry } from '@prisma/client';
import { DatabaseService, type TransactionClient } from '@database/database.service';

export interface InsertEntryInput {
  id: string;
  journalId: string;
  accountId: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: string;
  currency: string;
  effectiveDate: Date;
  createdBy: string;
  idempotencyKey?: string;
  referenceType: Prisma.LedgerEntryCreateInput['referenceType'];
  referenceId: string;
  narrative: string;
  hash: string;
  previousHash: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class LedgerRepository {
  constructor(private readonly db: DatabaseService) {}

  async insertEntry(tx: TransactionClient, input: InsertEntryInput): Promise<LedgerEntry> {
    const client = tx as DatabaseService;

    // Build the data object without optional fields first,
    // then spread them conditionally — required by exactOptionalPropertyTypes
    const data: Prisma.LedgerEntryUncheckedCreateInput = {
      id: input.id,
      journalId: input.journalId,
      accountId: input.accountId,
      entryType: input.entryType,
      amount: input.amount,
      currency: input.currency,
      status: 'POSTED',
      effectiveDate: input.effectiveDate,
      postedAt: new Date(),
      createdBy: input.createdBy,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      narrative: input.narrative,
      hash: input.hash,
      previousHash: input.previousHash,
    };

    if (input.idempotencyKey !== undefined) {
      data.idempotencyKey = input.idempotencyKey;
    }

    if (input.metadata !== undefined) {
      // Cast to Prisma.InputJsonValue — Record<string, unknown> satisfies this
      // but TypeScript needs the explicit cast due to Prisma's branded types
      data.metadata = input.metadata as Prisma.InputJsonValue;
    }

    return client.ledgerEntry.create({ data });
  }

  async getLastPostedEntry(tx: TransactionClient): Promise<LedgerEntry | null> {
    const client = tx as DatabaseService;

    const rows = await client.$queryRaw<LedgerEntry[]>`
      SELECT * FROM ledger_entries
      WHERE status = 'POSTED'
      ORDER BY posted_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    `;

    return rows[0] ?? null;
  }

  async findByJournalId(journalId: string): Promise<LedgerEntry[]> {
    return this.db.ledgerEntry.findMany({
      where: { journalId },
      orderBy: { postedAt: 'asc' },
    });
  }

  async findByAccountId(accountId: string, from?: Date, to?: Date): Promise<LedgerEntry[]> {
    const where: Prisma.LedgerEntryWhereInput = {
      accountId,
      status: 'POSTED',
    };

    if (from !== undefined || to !== undefined) {
      where.effectiveDate = {};
      if (from !== undefined) where.effectiveDate.gte = from;
      if (to !== undefined) where.effectiveDate.lte = to;
    }

    return this.db.ledgerEntry.findMany({
      where,
      orderBy: { effectiveDate: 'asc' },
    });
  }

  async findAllForVerification(from?: Date, to?: Date): Promise<LedgerEntry[]> {
    const where: Prisma.LedgerEntryWhereInput = { status: 'POSTED' };

    if (from !== undefined || to !== undefined) {
      where.postedAt = {};
      if (from !== undefined) where.postedAt.gte = from;
      if (to !== undefined) where.postedAt.lte = to;
    }

    return this.db.ledgerEntry.findMany({
      where,
      orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
    });
  }
}
