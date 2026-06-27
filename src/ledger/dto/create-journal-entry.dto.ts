// src/ledger/dto/create-journal-entry.dto.ts
import {
  IsEnum,
  IsString,
  IsUUID,
  IsDateString,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsObject,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryType, TransactionType } from '@prisma/client';

export class JournalLineDto {
  @ApiProperty({ description: 'Account UUID to post this line to' })
  @IsUUID('4')
  accountId!: string;

  @ApiProperty({ enum: EntryType })
  @IsEnum(EntryType)
  entryType!: EntryType;

  @ApiProperty({
    description: 'Amount as a string — never pass a float. e.g. "5000.0000"',
    example: '5000.0000',
  })
  @IsString()
  @MinLength(1)
  amount!: string;

  @ApiProperty({ example: 'INR' })
  @IsString()
  currency!: string;

  @ApiProperty({ example: 'Customer deposit via NEFT' })
  @IsString()
  @MinLength(1)
  narrative!: string;
}

export class CreateJournalEntryDto {
  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  referenceType!: TransactionType;

  @ApiProperty({ description: 'UUID of the originating transaction' })
  @IsUUID('4')
  referenceId!: string;

  @ApiProperty({ description: 'Economic effective date (ISO 8601)' })
  @IsDateString()
  effectiveDate!: string;

  @ApiProperty({ type: [JournalLineDto], minItems: 2 })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];

  @ApiPropertyOptional({ description: 'Additional context: IP, deviceId, etc.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
