// src/reporting/reporting.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { TrialBalanceService } from './trial-balance.service';

@ApiTags('reporting')
@ApiSecurity('api-key')
@Controller('reports')
export class ReportingController {
  constructor(private readonly trialBalance: TrialBalanceService) {}

  @Get('trial-balance')
  @ApiOperation({
    summary: 'Generate trial balance',
    description:
      'Returns the trial balance as of any historical date. ' +
      'grandTotalDebits must always equal grandTotalCredits — ' +
      'any discrepancy indicates a ledger integrity issue.',
  })
  @ApiQuery({
    name: 'asOf',
    required: false,
    description: 'ISO 8601 date — defaults to now',
    example: '2026-06-26T23:59:59Z',
  })
  @ApiOkResponse({ description: 'Trial balance report' })
  async trialBalances(@Query('asOf') asOf?: string): Promise<object> {
    const asOfDate = asOf !== undefined ? new Date(asOf) : undefined;
    return this.trialBalance.generate(asOfDate);
  }
}
