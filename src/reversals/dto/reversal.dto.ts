// src/reversals/dto/reversal.dto.ts
import { IsUUID, IsString, IsEnum, IsOptional, IsNumberString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum RefundFeePolicy {
  PROPORTIONAL = 'PROPORTIONAL',
  FULL = 'FULL',
  NONE = 'NONE',
}

export class FullReversalDto {
  @ApiProperty({ description: 'UUID of the original transaction to reverse' })
  @IsUUID('4')
  originalTransactionId!: string;

  @ApiProperty({ example: 'Customer dispute — item not received' })
  @IsString()
  @MinLength(5)
  reason!: string;
}

export class PartialRefundDto {
  @ApiProperty({ description: 'UUID of the original transaction' })
  @IsUUID('4')
  originalTransactionId!: string;

  @ApiProperty({
    example: '500.0000',
    description: 'Amount to refund — must not exceed original amount',
  })
  @IsNumberString()
  refundAmount!: string;

  @ApiProperty({ enum: RefundFeePolicy })
  @IsEnum(RefundFeePolicy)
  feePolicy!: RefundFeePolicy;

  @ApiProperty({ example: 'Partial return — 1 of 2 items returned' })
  @IsString()
  @MinLength(5)
  reason!: string;

  @ApiPropertyOptional({ description: 'Override original fee amount if known' })
  @IsOptional()
  @IsNumberString()
  originalFeeAmount?: string;
}
