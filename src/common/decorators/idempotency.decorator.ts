// src/common/decorators/idempotency.decorator.ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * Parameter decorator that extracts the X-Idempotency-Key header.
 * Every state-mutating endpoint must include this header.
 *
 * The idempotency service validates and records this key before
 * any transaction processing begins.
 *
 * @example
 * async deposit(
 *   @Body() dto: DepositDto,
 *   @IdempotencyKey() idempotencyKey: string,
 * ) { ... }
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const key = request.headers['x-idempotency-key'];
    return typeof key === 'string' ? key.trim() : undefined;
  },
);
