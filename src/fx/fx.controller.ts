// src/fx/fx.controller.ts
import { Controller, Get, Post, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { FxRateService } from './fx-rate.service';
import { CreateExchangeRateDto, ExchangeRateResponseDto } from './dto/exchange-rate.dto';

@ApiTags('fx')
@ApiSecurity('api-key')
@Controller('fx')
export class FxController {
  constructor(private readonly service: FxRateService) {}

  @Post('rates')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ingest a new exchange rate snapshot',
    description:
      'Records a new rate and closes the previous active rate for the pair. ' +
      'Rates older than FX_RATE_MAX_AGE_MINUTES are rejected at conversion time.',
  })
  @ApiCreatedResponse({ type: ExchangeRateResponseDto })
  async ingestRate(@Body() dto: CreateExchangeRateDto): Promise<ExchangeRateResponseDto> {
    const snapshot = await this.service.ingestRate(dto);
    return ExchangeRateResponseDto.fromPrisma(snapshot);
  }

  @Get('rates/current')
  @ApiOperation({ summary: 'Get the current valid rate for a currency pair' })
  @ApiQuery({ name: 'base', example: 'USD' })
  @ApiQuery({ name: 'quote', example: 'INR' })
  @ApiOkResponse({ type: ExchangeRateResponseDto })
  async getCurrent(
    @Query('base') base: string,
    @Query('quote') quote: string,
  ): Promise<ExchangeRateResponseDto> {
    const snapshot = await this.service.getCurrentRate(base, quote);
    return ExchangeRateResponseDto.fromPrisma(snapshot);
  }

  @Get('rates')
  @ApiOperation({ summary: 'List rate snapshots' })
  @ApiQuery({ name: 'base', required: false })
  @ApiQuery({ name: 'quote', required: false })
  @ApiOkResponse({ type: [ExchangeRateResponseDto] })
  async listRates(
    @Query('base') base?: string,
    @Query('quote') quote?: string,
  ): Promise<ExchangeRateResponseDto[]> {
    const snapshots = await this.service.listRates(base, quote);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    return snapshots.map(ExchangeRateResponseDto.fromPrisma);
  }

  @Get('convert')
  @ApiOperation({
    summary: 'Preview a conversion amount',
    description: 'Computes the converted amount without posting any journal entries.',
  })
  @ApiQuery({ name: 'base', example: 'USD' })
  @ApiQuery({ name: 'quote', example: 'INR' })
  @ApiQuery({ name: 'amount', example: '100.0000' })
  async preview(
    @Query('base') base: string,
    @Query('quote') quote: string,
    @Query('amount') amount: string,
  ): Promise<object> {
    const Decimal = (await import('decimal.js')).default;
    const result = await this.service.computeConversion(base, quote, new Decimal(amount));
    return {
      baseCurrency: base,
      quoteCurrency: quote,
      sourceAmount: result.sourceAmount.toFixed(4),
      grossAmount: result.targetAmount.toFixed(4),
      markupAmount: result.markupAmount.toFixed(4),
      netAmount: result.netTargetAmount.toFixed(4),
      rate: result.rate.toFixed(8),
      rateSnapshotId: result.snapshotId,
    };
  }
}
