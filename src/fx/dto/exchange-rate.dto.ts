// src/fx/dto/exchange-rate.dto.ts
import {
  IsString,
  IsDateString,
  IsOptional,
  Length,
  Matches,
  IsNumberString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExchangeRateSnapshot } from '@prisma/client';

export class CreateExchangeRateDto {
  @ApiProperty({ example: 'USD', description: 'ISO 4217 base currency' })
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  baseCurrency!: string;

  @ApiProperty({ example: 'INR', description: 'ISO 4217 quote currency' })
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  quoteCurrency!: string;

  @ApiProperty({
    example: '83.42150000',
    description: '1 base = rate quote — must be a NUMERIC string',
  })
  @IsNumberString()
  rate!: string;

  @ApiProperty({
    example: 'RBI_REFERENCE',
    description: 'Rate provider: RBI_REFERENCE | OPEN_EXCHANGE_RATES | INTERNAL',
  })
  @IsString()
  source!: string;

  @ApiProperty({ example: '2026-06-26T09:00:00Z' })
  @IsDateString()
  validFrom!: string;

  @ApiPropertyOptional({ example: '2026-06-26T10:00:00Z' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}

export class ExchangeRateResponseDto {
  @ApiProperty() snapshotId!: string;
  @ApiProperty() baseCurrency!: string;
  @ApiProperty() quoteCurrency!: string;
  @ApiProperty() rate!: string;
  @ApiProperty() inverseRate!: string;
  @ApiProperty() source!: string;
  @ApiProperty() capturedAt!: string;
  @ApiProperty() validFrom!: string;
  @ApiPropertyOptional() validUntil?: string | null;

  static fromPrisma(r: ExchangeRateSnapshot): ExchangeRateResponseDto {
    const dto = new ExchangeRateResponseDto();
    dto.snapshotId = r.id;
    dto.baseCurrency = r.baseCurrency;
    dto.quoteCurrency = r.quoteCurrency;
    dto.rate = r.rate.toString();
    dto.inverseRate = r.inverseRate.toString();
    dto.source = r.source;
    dto.capturedAt = r.capturedAt.toISOString();
    dto.validFrom = r.validFrom.toISOString();
    dto.validUntil = r.validUntil?.toISOString() ?? null;
    return dto;
  }
}
