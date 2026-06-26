// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { DatabaseService } from '@database/database.service';

interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  database: {
    connected: boolean;
    version?: string;
  };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({
    summary: 'System health check',
    description:
      'Returns database connectivity status and system uptime. ' +
      'Used by load balancers and monitoring systems.',
  })
  @ApiOkResponse({ description: 'System is healthy' })
  async check(): Promise<HealthResponse> {
    const dbHealthy = await this.db.isHealthy();
    const dbVersion = dbHealthy ? await this.db.getPostgresVersion() : undefined;

    return {
      status: dbHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        connected: dbHealthy,
        version: dbVersion ?? 'unknown',
      },
    };
  }
}
