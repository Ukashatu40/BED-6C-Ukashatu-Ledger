// src/reporting/reporting.module.ts
import { Module } from '@nestjs/common';
import { TrialBalanceService } from './trial-balance.service';
import { ReportingController } from './reporting.controller';

@Module({
  controllers: [ReportingController],
  providers: [TrialBalanceService],
  exports: [TrialBalanceService],
})
export class ReportingModule {}
