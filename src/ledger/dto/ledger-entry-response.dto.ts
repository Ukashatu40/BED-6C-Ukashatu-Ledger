// src/ledger/dto/ledger-entry-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { LedgerEntry, EntryType, EntryStatus, TransactionType } from '@prisma/client';

export class LedgerEntryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() journalId!: string;
  @ApiProperty() accountId!: string;
  @ApiProperty() entryType!: EntryType;
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() status!: EntryStatus;
  @ApiProperty() effectiveDate!: string;
  @ApiPropertyOptional() postedAt?: string | null;
  @ApiProperty() createdBy!: string;
  @ApiProperty() referenceType!: TransactionType;
  @ApiProperty() referenceId!: string;
  @ApiProperty() narrative!: string;
  @ApiProperty() hash!: string;
  @ApiProperty() previousHash!: string;
  @ApiPropertyOptional() metadata?: unknown;

  static fromPrisma(entry: LedgerEntry): LedgerEntryResponseDto {
    const dto = new LedgerEntryResponseDto();
    dto.id = entry.id;
    dto.journalId = entry.journalId;
    dto.accountId = entry.accountId;
    dto.entryType = entry.entryType;
    // Prisma returns NUMERIC as string — pass through as-is, never convert to float
    dto.amount = entry.amount.toString();
    dto.currency = entry.currency;
    dto.status = entry.status;
    dto.effectiveDate = entry.effectiveDate.toISOString();
    dto.postedAt = entry.postedAt?.toISOString() ?? null;
    dto.createdBy = entry.createdBy;
    dto.referenceType = entry.referenceType;
    dto.referenceId = entry.referenceId;
    dto.narrative = entry.narrative;
    dto.hash = entry.hash;
    dto.previousHash = entry.previousHash;
    dto.metadata = entry.metadata;
    return dto;
  }
}
