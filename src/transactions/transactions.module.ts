// src/transactions/transactions.module.ts
import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { IdempotencyService } from './idempotency.service';
import { LedgerModule } from '@ledger/ledger.module';
import { AccountsModule } from '@accounts/accounts.module';

@Module({
  imports: [LedgerModule, AccountsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, IdempotencyService],
  exports: [TransactionsService, IdempotencyService],
})
export class TransactionsModule {}
