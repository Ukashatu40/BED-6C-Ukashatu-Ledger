// src/accounts/dto/account-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Account, AccountType, AccountSubType, AccountStatus } from '@prisma/client';

export class AccountResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() type!: AccountType;
  @ApiProperty() subType!: AccountSubType;
  @ApiProperty() currency!: string;
  @ApiProperty() status!: AccountStatus;
  @ApiPropertyOptional() parentId?: string | null;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static fromPrisma(account: Account): AccountResponseDto {
    const dto = new AccountResponseDto();
    dto.id = account.id;
    dto.code = account.code;
    dto.name = account.name;
    dto.type = account.type;
    dto.subType = account.subType;
    dto.currency = account.currency;
    dto.status = account.status;
    dto.parentId = account.parentId;
    dto.description = account.description;
    dto.createdAt = account.createdAt.toISOString();
    dto.updatedAt = account.updatedAt.toISOString();
    return dto;
  }
}
