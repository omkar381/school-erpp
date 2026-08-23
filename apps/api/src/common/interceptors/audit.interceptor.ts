import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditAction } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';
import { AUDIT_KEY, type AuditOptions } from '../decorators';

/**
 * Writes an audit entry for routes annotated with `@Audit(...)`, but only after
 * the handler has completed successfully — a rejected request is not an action.
 *
 * Services that need before/after values write their own richer entries via
 * AuditService directly; this interceptor covers the routine cases.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditOptions>(AUDIT_KEY, context.getHandler());
    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap((result) => {
        this.audit.record({
          action: (options.action as AuditAction) ?? AuditAction.UPDATE,
          module: options.module,
          entity: options.entity,
          entityId: this.resolveEntityId(options.entityIdFrom, request, result),
          description: options.description,
        });
      }),
    );
  }

  private resolveEntityId(
    source: string | undefined,
    request: { params?: Record<string, string>; body?: Record<string, unknown> },
    result: unknown,
  ): string | null {
    if (!source) {
      return (result as { id?: string })?.id ?? request.params?.id ?? null;
    }
    if (request.params?.[source]) return request.params[source];

    const fromResult = source
      .split('.')
      .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], result);

    return typeof fromResult === 'string' ? fromResult : null;
  }
}
