// seeds/exchange-rates.seed.ts
import type { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { uuidv7 } from 'uuidv7';

const RATES = [
  { base: 'USD', quote: 'INR', rate: '83.42150000' },
  { base: 'EUR', quote: 'INR', rate: '90.15200000' },
  { base: 'GBP', quote: 'INR', rate: '105.73400000' },
  { base: 'JPY', quote: 'INR', rate: '0.54320000' },
  { base: 'AED', quote: 'INR', rate: '22.71000000' },
  { base: 'SGD', quote: 'INR', rate: '61.88000000' },
];

export async function seedExchangeRates(prisma: PrismaClient): Promise<void> {
  console.log('🌱 Seeding exchange rates...');

  const now = new Date();
  const validFrom = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago

  for (const r of RATES) {
    const existing = await prisma.exchangeRateSnapshot.findFirst({
      where: { baseCurrency: r.base, quoteCurrency: r.quote, validUntil: null },
    });

    if (existing) {
      console.log(`  ⏭  Rate ${r.base}/${r.quote} already active — skipping`);
      continue;
    }

    const rate = new Decimal(r.rate);
    const inverseRate = new Decimal(1).dividedBy(rate).toDecimalPlaces(8);

    await prisma.exchangeRateSnapshot.create({
      data: {
        id: uuidv7(),
        baseCurrency: r.base,
        quoteCurrency: r.quote,
        rate: rate.toFixed(8),
        inverseRate: inverseRate.toFixed(8),
        source: 'SEED_DATA',
        capturedAt: now,
        validFrom,
        validUntil: null,
      },
    });

    console.log(`  ✅ Seeded ${r.base}/${r.quote} = ${r.rate}`);
  }

  console.log('📈 Exchange rates seeded\n');
}
