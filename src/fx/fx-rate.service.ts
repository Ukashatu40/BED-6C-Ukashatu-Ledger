// src/fx/fx-rate.service.ts
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExchangeRateSnapshot } from '@prisma/client';
import Decimal from 'decimal.js';
import { FxRateRepository } from './fx-rate.repository';
import type { CreateExchangeRateDto } from './dto/exchange-rate.dto';
import type { AppConfig } from '@config/app.config';

export interface ConversionResult {
  sourceAmount: Decimal;
  targetAmount: Decimal; // gross before markup
  netTargetAmount: Decimal; // after 0.5% markup
  markupAmount: Decimal;
  rate: Decimal;
  inverseRate: Decimal;
  snapshotId: string;
}

@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);
  private readonly maxAgeMinutes: number;
  private static readonly MARKUP_RATE = new Decimal('0.005');

  constructor(
    private readonly repo: FxRateRepository,
    configService: ConfigService,
  ) {
    const appConfig = configService.get<AppConfig>('app');
    if (!appConfig) throw new Error('App config missing');
    this.maxAgeMinutes = appConfig.fxRateMaxAgeMinutes;
  }

  async ingestRate(dto: CreateExchangeRateDto): Promise<ExchangeRateSnapshot> {
    this.logger.log(
      `Ingesting FX rate: ${dto.baseCurrency}/${dto.quoteCurrency} = ${dto.rate} from ${dto.source}`,
    );
    return this.repo.create(dto);
  }

  /**
   * Fetch the current valid rate and validate it is not stale.
   *
   * Incident Card Day 6 fix: rates older than FX_RATE_MAX_AGE_MINUTES
   * are rejected. The caller must ingest a fresh rate before retrying.
   *
   * This directly addresses the spec incident where a USD deposit was
   * converted at a 48-hour-old rate, costing the customer INR 4,200.
   */
  async getCurrentRate(baseCurrency: string, quoteCurrency: string): Promise<ExchangeRateSnapshot> {
    const snapshot = await this.repo.findCurrent(baseCurrency, quoteCurrency);

    if (!snapshot) {
      throw new NotFoundException(
        `No exchange rate found for ${baseCurrency}/${quoteCurrency}. ` +
          `Please ingest a rate before attempting conversion.`,
      );
    }

    this.assertNotStale(snapshot);
    return snapshot;
  }

  /**
   * Compute conversion amounts using NUMERIC arithmetic throughout.
   * This is the Revolut rounding incident fix — no floating point ever.
   */
  async computeConversion(
    baseCurrency: string,
    quoteCurrency: string,
    sourceAmount: Decimal,
  ): Promise<ConversionResult> {
    const snapshot = await this.getCurrentRate(baseCurrency, quoteCurrency);

    const rate = new Decimal(snapshot.rate.toString());
    const inverseRate = new Decimal(snapshot.inverseRate.toString());

    const grossTarget = sourceAmount.times(rate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    const markupAmount = grossTarget
      .times(FxRateService.MARKUP_RATE)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    const netTargetAmount = grossTarget.minus(markupAmount);

    this.logger.log(
      `FX conversion: ${sourceAmount.toFixed(4)} ${baseCurrency} → ` +
        `${netTargetAmount.toFixed(4)} ${quoteCurrency} ` +
        `(rate=${rate.toFixed(8)} markup=${markupAmount.toFixed(4)})`,
    );

    return {
      sourceAmount,
      targetAmount: grossTarget,
      netTargetAmount,
      markupAmount,
      rate,
      inverseRate,
      snapshotId: snapshot.id,
    };
  }

  async getRateAtTime(
    baseCurrency: string,
    quoteCurrency: string,
    asOf: Date,
  ): Promise<ExchangeRateSnapshot> {
    const snapshot = await this.repo.findAtTime(baseCurrency, quoteCurrency, asOf);
    if (!snapshot) {
      throw new NotFoundException(
        `No exchange rate found for ${baseCurrency}/${quoteCurrency} at ${asOf.toISOString()}`,
      );
    }
    return snapshot;
  }

  async listRates(baseCurrency?: string, quoteCurrency?: string): Promise<ExchangeRateSnapshot[]> {
    return this.repo.findAll(baseCurrency, quoteCurrency);
  }

  /**
   * Assert a rate snapshot is not stale.
   * Stale = capturedAt is older than FX_RATE_MAX_AGE_MINUTES.
   */
  private assertNotStale(snapshot: ExchangeRateSnapshot): void {
    const ageMs = Date.now() - snapshot.capturedAt.getTime();
    const ageMinutes = ageMs / 60_000;

    if (ageMinutes > this.maxAgeMinutes) {
      throw new UnprocessableEntityException(
        `Exchange rate for ${snapshot.baseCurrency}/${snapshot.quoteCurrency} is stale: ` +
          `captured ${ageMinutes.toFixed(1)} minutes ago, ` +
          `maximum allowed is ${this.maxAgeMinutes.toString()} minutes. ` +
          `Please ingest a fresh rate before retrying. (Incident Day 6 safeguard)`,
      );
    }
  }
}
