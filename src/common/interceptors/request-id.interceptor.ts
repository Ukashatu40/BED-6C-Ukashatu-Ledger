// src/common/interceptors/request-id.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { uuidv7 } from 'uuidv7';

/**
 * Attaches a unique request ID to every incoming request and outgoing response.
 *
 * The request ID is used to:
 *   - Correlate logs across the entire request lifecycle
 *   - Allow clients to reference a specific request in support tickets
 *   - Trace transactions through the audit log
 *
 * If the client sends an X-Request-ID header, we honour it (useful for
 * end-to-end tracing from a frontend or API gateway).
 * Otherwise we generate a UUID v7 (time-sortable, so log ordering is natural).
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    // Honour client-supplied ID or generate a new one
    const requestId = (request.headers['x-request-id'] as string | undefined) ?? `req_${uuidv7()}`;

    // Attach to request so other services can read it (e.g. audit logger)
    (request as FastifyRequest & { requestId: string }).requestId = requestId;

    // Return it in the response header so clients can correlate
    void reply.header('X-Request-ID', requestId);

    return next.handle();
  }
}
