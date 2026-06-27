// src/fx/fx.module.ts
import { Module } from '@nestjs/common';
import { FxController } from './fx.controller';
import { FxRateService } from './fx-rate.service';
import { FxRateRepository } from './fx-rate.repository';

@Module({
  controllers: [FxController],
  providers: [FxRateService, FxRateRepository],
  exports: [FxRateService, FxRateRepository],
})
export class FxModule {}
