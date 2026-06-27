// src/common/guards/api-key.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '@config/app.config';

/**
 * Decorator to mark a route as publicly accessible (no API key required).
 * Used on the health endpoint and Swagger UI.
 */
export const IS_PUBLIC_KEY = 'isPublic';
import { SetMetadata } from '@nestjs/common';
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * API Key guard — validates X-API-Key header against configured keys.
 *
 * Applied globally in app.module.ts so every route is protected by default.
 * Routes that should be public (health check, Swagger) are marked with @Public().
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly validKeys: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    configService: ConfigService,
  ) {
    const appConfig = configService.get<AppConfig>('app');
    if (!appConfig) throw new Error('App configuration missing');
    this.validKeys = new Set(appConfig.apiKeys);
  }

  canActivate(context: ExecutionContext): boolean {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const apiKey = request.headers['x-api-key'];

    if (typeof apiKey !== 'string' || !this.validKeys.has(apiKey)) {
      throw new UnauthorizedException('Missing or invalid X-API-Key header');
    }

    return true;
  }
}
