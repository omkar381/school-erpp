import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../context/request-context';
import { AppLogger } from '../logger/app-logger.service';

/**
 * Opens the AsyncLocalStorage scope for the request and emits one structured
 * access-log line per response. Runs before the guards, so the request id is
 * available even on requests that are rejected during authentication.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLogger) {}

  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();

    req.id = requestId;
    res.setHeader('X-Request-Id', requestId);

    const startedAt = Date.now();
    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;

    RequestContext.run(
      {
        requestId,
        ipAddress,
        userAgent: req.headers['user-agent'],
        startedAt,
      },
      () => {
        res.on('finish', () => {
          const durationMs = Date.now() - startedAt;
          const store = RequestContext.get();

          this.logger.info('request', {
            method: req.method,
            path: req.originalUrl.split('?')[0],
            statusCode: res.statusCode,
            durationMs,
            userId: store?.userId,
            schoolId: store?.schoolId,
            ip: ipAddress,
          });
        });

        next();
      },
    );
  }
}
