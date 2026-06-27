// src/transactions/dto/create-transaction.dto.ts
import { IsEnum, IsString, IsObject, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';

export class CreateTransactionDto {
  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type!: TransactionType;

  @ApiProperty({
    description: 'ISO 8601 effective date',
    example: '2026-06-26T00:00:00Z',
  })
  @IsDateString()
  effectiveDate!: string;

  @ApiProperty({
    description:
      'Transaction-type-specific payload. ' +
      'See handler documentation for required fields per type.',
    example: {
      amount: '5000.0000',
      currency: 'INR',
      walletAccountId: 'uuid-here',
      liabilityAccountId: 'uuid-here',
    },
  })
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
