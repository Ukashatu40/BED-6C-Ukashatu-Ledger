// src/accounts/accounts.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Patch,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
} from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AccountQueryDto } from './dto/account-query.dto';
import { AccountResponseDto } from './dto/account-response.dto';

@ApiTags('accounts')
@ApiSecurity('api-key')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new account',
    description:
      'Add a new account to the Chart of Accounts. ' +
      'Account codes must be unique. Currency is immutable after creation.',
  })
  @ApiCreatedResponse({ type: AccountResponseDto })
  async create(@Body() dto: CreateAccountDto): Promise<AccountResponseDto> {
    const account = await this.service.create(dto);
    return AccountResponseDto.fromPrisma(account);
  }

  @Get()
  @ApiOperation({
    summary: 'List all accounts',
    description:
      'Returns the full Chart of Accounts, optionally filtered by type, status, or currency.',
  })
  @ApiOkResponse({ type: [AccountResponseDto] })
  async findAll(@Query() query: AccountQueryDto): Promise<AccountResponseDto[]> {
    const accounts = await this.service.findAll(query);
    return accounts.map(AccountResponseDto.fromPrisma);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get account by ID' })
  @ApiParam({ name: 'id', description: 'Account UUID' })
  @ApiOkResponse({ type: AccountResponseDto })
  async findById(@Param('id', new ParseUUIDPipe()) id: string): Promise<AccountResponseDto> {
    const account = await this.service.findById(id);
    return AccountResponseDto.fromPrisma(account);
  }

  @Get('code/:code')
  @ApiOperation({ summary: 'Get account by code', description: 'e.g. GET /accounts/code/1001' })
  @ApiParam({ name: 'code', example: '1001' })
  @ApiOkResponse({ type: AccountResponseDto })
  async findByCode(@Param('code') code: string): Promise<AccountResponseDto> {
    const account = await this.service.findByCode(code);
    return AccountResponseDto.fromPrisma(account);
  }

  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Deactivate an account',
    description:
      'Marks an account as INACTIVE. The account and all its ledger entries ' +
      'remain permanently — immutability is never violated.',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  async deactivate(@Param('id', new ParseUUIDPipe()) id: string): Promise<AccountResponseDto> {
    const account = await this.service.deactivate(id);
    return AccountResponseDto.fromPrisma(account);
  }
}
