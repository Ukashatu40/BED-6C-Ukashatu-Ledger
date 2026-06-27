// src/ledger/ledger.module.ts
import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { LedgerRepository } from './ledger.repository';
import { HashChainService } from './hash-chain.service';
import { BalanceService } from './balance.service';

@Module({
  controllers: [LedgerController],
  providers: [LedgerService, LedgerRepository, HashChainService, BalanceService],
  exports: [LedgerService, LedgerRepository, HashChainService, BalanceService],
})
export class LedgerModule {}
