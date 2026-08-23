import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import type { Request } from 'express';

export const RESPONSE_MESSAGE_KEY = 'response:message';
export const SKIP_ENVELOPE_KEY = 'response:skipEnvelope';

/** Overrides the default success message for a route. */
export const ResponseMessage = (message: string) =>
  Reflect.metadata(RESPONSE_MESSAGE_KEY, message);

/** Returns the handler's value verbatim (file downloads, webhooks, health checks). */
export const SkipEnvelope = () => Reflect.metadata(SKIP_ENVELOPE_KEY, true);

const DEFAULT_MESSAGES: Record<string, string> = {
  GET: 'Request completed successfully',
  POST: 'Created successfully',
  PATCH: 'Updated successfully',
  PUT: 'Updated successfully',
  DELETE: 'Deleted successfully',
};

/**
 * Wraps every controller return value in the platform's success envelope, so
 * clients can rely on a single response shape across the whole API.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request & { id?: string }>();
    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getHandler()) ??
      DEFAULT_MESSAGES[request.method] ??
      'Request completed successfully';

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data: data ?? null,
        message,
        requestId: request.id,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
