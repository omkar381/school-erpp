import { Injectable, LoggerService, Scope } from '@nestjs/common';
import pino, { Logger } from 'pino';
import { RequestContext } from '../context/request-context';

const REDACTED = '[REDACTED]';

/**
 * Field names whose values must never reach the log stream, at any nesting
 * depth. Matching is case-insensitive and substring based.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'privatekey',
  'signature',
  'otp',
  'code',
  'cardnumber',
  'cvv',
  'aadhaarnumber',
  'pannumber',
  'bankaccountnumber',
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  }

  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { name: value.name, message: value.message };

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      output[key] = SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive))
        ? REDACTED
        : redact(entry, depth + 1);
    }
    return output;
  }

  return value;
}

/**
 * Structured logger. Every line automatically carries the ambient requestId,
 * userId and schoolId taken from the AsyncLocalStorage request context.
 */
@Injectable({ scope: Scope.DEFAULT })
export class AppLogger implements LoggerService {
  private readonly logger: Logger;

  constructor() {
    const pretty = (process.env.LOG_PRETTY ?? 'true') !== 'false';
    const level = process.env.LOG_LEVEL ?? 'info';

    this.logger = pino({
      level,
      base: { service: 'school-erp-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      ...(pretty && process.env.NODE_ENV !== 'production'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' },
            },
          }
        : {}),
    });
  }

  private enrich(meta?: Record<string, unknown>): Record<string, unknown> {
    const store = RequestContext.get();
    return {
      ...(store
        ? { requestId: store.requestId, userId: store.userId, schoolId: store.schoolId }
        : {}),
      ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
    };
  }

  log(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(this.enrich(meta), message);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(this.enrich(meta), message);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(this.enrich(meta), message);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(this.enrich(meta), message);
  }

  verbose(message: string, meta?: Record<string, unknown>): void {
    this.logger.trace(this.enrich(meta), message);
  }

  error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const details =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
        : error !== undefined
          ? { error: redact(error) }
          : {};

    this.logger.error({ ...this.enrich(meta), ...details }, message);
  }

  /** Returns a child logger tagged with a fixed context name. */
  child(context: string): AppLogger {
    const child = Object.create(this) as AppLogger;
    const base = this.logger.child({ context });
    Object.defineProperty(child, 'logger', { value: base, writable: false });
    return child;
  }

  get raw(): Logger {
    return this.logger;
  }
}
