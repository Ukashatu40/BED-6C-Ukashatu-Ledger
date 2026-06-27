// src/accounts/accounts.module.ts
import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AccountsRepository } from './accounts.repository';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, AccountsRepository],
  // Export both so LedgerModule, TransactionsModule etc. can inject them
  exports: [AccountsService, AccountsRepository],
})
export class AccountsModule {}
