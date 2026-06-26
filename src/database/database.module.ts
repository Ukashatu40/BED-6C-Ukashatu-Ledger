// src/database/database.module.ts
import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

// @Global() means every module in the app gets DatabaseService
// without needing to import DatabaseModule explicitly.
// This is appropriate here because the database is a true cross-cutting
// infrastructure concern used by every feature module.
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
