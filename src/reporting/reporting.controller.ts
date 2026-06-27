// src/reporting/reporting.controller.ts
import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { TrialBalanceService } from './trial-balance.service';
import { AccountStatementService } from './account-statement.service';
import { IncomeStatementService } from './income-statement.service';
import { BalanceSheetService } from './balance-sheet.service';
import { FxExposureService } from './fx-exposure.service';

@ApiTags('reporting')
@ApiSecurity('api-key')
@Controller('reports')
export class ReportingController {
  constructor(
    private readonly trialBalance: TrialBalanceService,
    private readonly accountStatement: AccountStatementService,
    private readonly incomeStatement: IncomeStatementService,
    private readonly balanceSheet: BalanceSheetService,
    private readonly fxExposure: FxExposureService,
  ) {}

  @Get('trial-balance')
  @ApiOperation({ summary: 'Trial balance as of any date' })
  @ApiQuery({ name: 'asOf', required: false, example: '2026-06-27T23:59:59Z' })
  async trialBalances(@Query('asOf') asOf?: string): Promise<object> {
    return this.trialBalance.generate(asOf ? new Date(asOf) : undefined);
  }

  @Get('accounts/:id/statement')
  @ApiOperation({ summary: 'Account statement with running balance' })
  @ApiParam({ name: 'id', description: 'Account UUID' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'pageSize', required: false, example: '50' })
  async accountStatements(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<object> {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();
    return this.accountStatement.generate(
      id,
      fromDate,
      toDate,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('income-statement')
  @ApiOperation({ summary: 'Income statement (P&L) for a period' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async incomeStatements(@Query('from') from?: string, @Query('to') to?: string): Promise<object> {
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(to) : new Date();
    return this.incomeStatement.generate(fromDate, toDate);
  }

  @Get('balance-sheet')
  @ApiOperation({
    summary: 'Balance sheet — verifies A = L + E',
    description: 'isBalanced must always be true. Any discrepancy is a ledger integrity issue.',
  })
  @ApiQuery({ name: 'asOf', required: false })
  async balanceSheets(@Query('asOf') asOf?: string): Promise<object> {
    return this.balanceSheet.generate(asOf ? new Date(asOf) : new Date());
  }

  @Get('fx-exposure')
  @ApiOperation({ summary: 'Foreign currency exposure with INR equivalents' })
  @ApiQuery({ name: 'asOf', required: false })
  async fxExposures(@Query('asOf') asOf?: string): Promise<object> {
    return this.fxExposure.generate(asOf ? new Date(asOf) : new Date());
  }
}
