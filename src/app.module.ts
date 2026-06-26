// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DatabaseModule } from '@database/database.module';
import { HealthModule } from '@health/health.module';
import appConfig from '@config/app.config';
import databaseConfig from '@config/database.config';
import { uuidv7 } from 'uuidv7';

@Module({
  imports: [
    // ── Config — load before everything else ───
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, databaseConfig],
      cache: true,
    }),

    // ── Structured logging with Pino ────────────
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
        // Redact sensitive fields from logs — never log amounts in plaintext in production
        redact: {
          paths: ['req.headers["x-api-key"]', 'req.headers.authorization'],
          remove: true,
        },
        // Assign unique request ID to every request
        genReqId: () => {
          return `req_${uuidv7()}`;
        },
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

    // ── Core infrastructure ──────────────────────
    DatabaseModule,

    // ── Feature modules (added as we build) ─────
    HealthModule,
    // AccountsModule        ← Session 3
    // LedgerModule          ← Session 3
    // TransactionsModule    ← Session 4
    // FxModule              ← Session 6
    // ReversalsModule       ← Session 7
    // AuditModule           ← Session 9
    // ReportingModule       ← Session 10
  ],
})
export class AppModule {}
