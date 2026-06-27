// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { uuidv7 } from 'uuidv7';
import { DatabaseModule } from '@database/database.module';
import { HealthModule } from '@health/health.module';
import { AccountsModule } from '@accounts/accounts.module';
import { LedgerModule } from '@ledger/ledger.module';
import { TransactionsModule } from '@transactions/transactions.module';
import { ReportingModule } from '@reporting/reporting.module';
import { GlobalExceptionFilter } from '@common/filters/global-exception.filter';
import { RequestIdInterceptor } from '@common/interceptors/request-id.interceptor';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import appConfig from '@config/app.config';
import databaseConfig from '@config/database.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, databaseConfig],
      cache: true,
    }),

    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.LOG_PRETTY === 'true'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: false,
                  translateTime: 'SYS:standard',
                  ignore: 'pid,hostname',
                },
              }
            : undefined,
        redact: {
          paths: ['req.headers["x-api-key"]', 'req.headers.authorization'],
          remove: true,
        },
        genReqId: () => `req_${uuidv7()}`,
        serializers: {
          req: (req: { method: string; url: string; id: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: { statusCode: number }) => ({
            statusCode: res.statusCode,
          }),
        },
      } as any,
    }),

    DatabaseModule,
    HealthModule,
    AccountsModule,
    LedgerModule,
    TransactionsModule,
    ReportingModule,

    // Feature modules added session by session:
    // AccountsModule     ← next
    // LedgerModule
    // TransactionsModule
    // FxModule
    // ReversalsModule
    // AuditModule
    // ReportingModule
  ],
  providers: [
    // Global exception filter — structured error responses on every route
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Global request ID — every request gets X-Request-ID header
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },

    // Global API key guard — every route protected unless @Public()
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
