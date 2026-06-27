// src/common/decorators/audit-actor.decorator.ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * Parameter decorator that extracts the actor identity from the request.
 * Used in controllers to pass the initiating user/service to the
 * transaction engine — required for the created_by field on every
 * ledger entry (spec Part A2.3).
 *
 * For now, derived from the X-User-ID header.
 * In production this would come from a decoded JWT claim.
 *
 * @example
 * async createTransaction(
 *   @Body() dto: CreateTransactionDto,
 *   @AuditActor() actor: string,
 * ) { ... }
 */
export const AuditActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();

  const userId = request.headers['x-user-id'];
  if (typeof userId === 'string' && userId.trim().length > 0) {
    return userId.trim();
  }

  // Fall back to API key identity for service-to-service calls
  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string') {
    return `service:${apiKey.slice(0, 8)}`;
  }

  return 'SYSTEM';
});
