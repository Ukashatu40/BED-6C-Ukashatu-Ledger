// src/reversals/reversals.module.ts
import { Module } from '@nestjs/common';
import { ReversalsController } from './reversals.controller';
import { ReversalsService } from './reversals.service';
import { LedgerModule } from '@ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  controllers: [ReversalsController],
  providers: [ReversalsService],
  exports: [ReversalsService],
})
export class ReversalsModule {}
