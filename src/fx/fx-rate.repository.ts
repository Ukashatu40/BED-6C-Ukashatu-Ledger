// src/fx/fx-rate.repository.ts
import { Injectable } from '@nestjs/common';
import type { ExchangeRateSnapshot } from '@prisma/client';
import { DatabaseService } from '@database/database.service';
import type { CreateExchangeRateDto } from './dto/exchange-rate.dto';
import Decimal from 'decimal.js';
import { uuidv7 } from 'uuidv7';
import { Prisma } from '@prisma/client';

@Injectable()
export class FxRateRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateExchangeRateDto): Promise<ExchangeRateSnapshot> {
    const rate = new Decimal(dto.rate);
    const inverseRate = new Decimal(1).dividedBy(rate).toDecimalPlaces(8);
    const now = new Date();

    const data: Prisma.ExchangeRateSnapshotUncheckedCreateInput = {
      id: uuidv7(),
      baseCurrency: dto.baseCurrency,
      quoteCurrency: dto.quoteCurrency,
      rate: rate.toFixed(8),
      inverseRate: inverseRate.toFixed(8),
      source: dto.source,
      capturedAt: now,
      validFrom: new Date(dto.validFrom),
    };

    if (dto.validUntil !== undefined) {
      data.validUntil = new Date(dto.validUntil);
    }

    // Close the previous active rate for this pair
    await this.db.exchangeRateSnapshot.updateMany({
      where: {
        baseCurrency: dto.baseCurrency,
        quoteCurrency: dto.quoteCurrency,
        validUntil: null,
      },
      data: { validUntil: new Date(dto.validFrom) },
    });

    return this.db.exchangeRateSnapshot.create({ data });
  }

  /**
   * Fetch the currently valid rate for a currency pair.
   * A rate is valid if validFrom <= now AND (validUntil IS NULL OR validUntil > now).
   */
  async findCurrent(
    baseCurrency: string,
    quoteCurrency: string,
  ): Promise<ExchangeRateSnapshot | null> {
    const now = new Date();

    return this.db.exchangeRateSnapshot.findFirst({
      where: {
        baseCurrency,
        quoteCurrency,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      orderBy: { validFrom: 'desc' },
    });
  }

  /**
   * Fetch the rate that was valid at a specific point in time.
   * Used by the audit service to reconstruct historical FX conversions.
   */
  async findAtTime(
    baseCurrency: string,
    quoteCurrency: string,
    asOf: Date,
  ): Promise<ExchangeRateSnapshot | null> {
    return this.db.exchangeRateSnapshot.findFirst({
      where: {
        baseCurrency,
        quoteCurrency,
        validFrom: { lte: asOf },
        OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
      },
      orderBy: { validFrom: 'desc' },
    });
  }

  async findAll(baseCurrency?: string, quoteCurrency?: string): Promise<ExchangeRateSnapshot[]> {
    return this.db.exchangeRateSnapshot.findMany({
      where: {
        ...(baseCurrency !== undefined && { baseCurrency }),
        ...(quoteCurrency !== undefined && { quoteCurrency }),
      },
      orderBy: { capturedAt: 'desc' },
      take: 100,
    });
  }
}
