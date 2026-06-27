// src/audit/audit.module.ts
import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { LedgerModule } from '@ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
