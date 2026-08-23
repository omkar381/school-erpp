import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-codes';
import { AppLogger } from '../logger/app-logger.service';

interface NormalizedError {
  statusCode: number;
  message: string;
  code: string;
  errors?: Array<{ field: string; message: string; rule?: string }>;
}

/**
 * Converts every thrown value into the platform's error envelope.
 * Raw driver errors and stack traces never reach the client.
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppLogger,
    private readonly config: ConfigService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isProduction = this.config.get<string>('app.env') === 'production';

    const normalized = this.normalize(exception);
    const requestId = (request as Request & { id?: string }).id;

    if (normalized.statusCode >= 500) {
      this.logger.error('Unhandled request failure', exception, {
        requestId,
        path: request.originalUrl,
        method: request.method,
        code: normalized.code,
      });
    } else if (normalized.statusCode >= 400) {
      this.logger.debug('Request rejected', {
        requestId,
        path: request.originalUrl,
        method: request.method,
        statusCode: normalized.statusCode,
        code: normalized.code,
      });
    }

    response.status(normalized.statusCode).json({
      success: false,
      message: normalized.message,
      code: normalized.code,
      statusCode: normalized.statusCode,
      ...(normalized.errors?.length ? { errors: normalized.errors } : {}),
      requestId,
      timestamp: new Date().toISOString(),
      ...(isProduction ? {} : { path: request.originalUrl }),
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      const body = exception.getResponse() as Record<string, unknown>;
      return {
        statusCode: exception.getStatus(),
        message: String(body.message ?? exception.message),
        code: exception.code,
        errors: exception.fieldErrors,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'The request could not be processed due to invalid data',
        code: ErrorCode.BAD_REQUEST,
      };
    }

    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
        code: ErrorCode.SERVICE_UNAVAILABLE,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred. Please try again.',
      code: ErrorCode.INTERNAL_ERROR,
    };
  }

  private fromHttpException(exception: HttpException): NormalizedError {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { statusCode: status, message: payload, code: this.codeForStatus(status) };
    }

    const body = payload as Record<string, unknown>;

    // class-validator produces `message: string[]` via the global pipe.
    if (Array.isArray(body.message)) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Validation failed',
        code: ErrorCode.VALIDATION_ERROR,
        errors: (body.message as string[]).map((message) => ({
          field: message.split(' ')[0] ?? 'unknown',
          message,
        })),
      };
    }

    return {
      statusCode: status,
      message: String(body.message ?? exception.message),
      code: String(body.code ?? this.codeForStatus(status)),
      errors: body.errors as NormalizedError['errors'],
    };
  }

  private fromPrismaError(error: Prisma.PrismaClientKnownRequestError): NormalizedError {
    const target = this.formatTarget(error.meta?.target);

    switch (error.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: target
            ? `A record with this ${target} already exists`
            : 'A record with these details already exists',
          code: ErrorCode.CONFLICT,
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'This record is linked to other data and cannot be changed',
          code: ErrorCode.CONFLICT,
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'The requested record was not found',
          code: ErrorCode.NOT_FOUND,
        };
      case 'P2014':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'This change would break a required relationship between records',
          code: ErrorCode.CONFLICT,
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred. Please try again.',
          code: ErrorCode.INTERNAL_ERROR,
        };
    }
  }

  private formatTarget(target: unknown): string | null {
    if (Array.isArray(target)) {
      return target.filter((t) => t !== 'schoolId').join(', ') || null;
    }
    return typeof target === 'string' ? target : null;
  }

  private codeForStatus(status: number): string {
    const map: Record<number, ErrorCode> = {
      400: ErrorCode.BAD_REQUEST,
      401: ErrorCode.UNAUTHORIZED,
      403: ErrorCode.FORBIDDEN,
      404: ErrorCode.NOT_FOUND,
      409: ErrorCode.CONFLICT,
      413: ErrorCode.PAYLOAD_TOO_LARGE,
      422: ErrorCode.VALIDATION_ERROR,
      429: ErrorCode.RATE_LIMITED,
      503: ErrorCode.SERVICE_UNAVAILABLE,
    };
    return map[status] ?? ErrorCode.INTERNAL_ERROR;
  }
}
