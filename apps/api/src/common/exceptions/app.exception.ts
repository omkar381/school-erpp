import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export interface AppExceptionPayload {
  message: string;
  code: ErrorCode | string;
  statusCode: number;
  errors?: Array<{ field: string; message: string; rule?: string }>;
  /** Extra context recorded in logs but never returned to the client. */
  context?: Record<string, unknown>;
}

/**
 * Base class for every deliberate, client-facing error in the application.
 * Anything thrown that is *not* an AppException (or a Nest HttpException) is
 * treated as an unexpected fault and reported as a generic 500.
 */
export class AppException extends HttpException {
  readonly code: string;
  readonly fieldErrors?: AppExceptionPayload['errors'];
  readonly context?: Record<string, unknown>;

  constructor(payload: AppExceptionPayload) {
    super(
      {
        success: false,
        message: payload.message,
        code: payload.code,
        statusCode: payload.statusCode,
        errors: payload.errors,
      },
      payload.statusCode,
    );
    this.code = payload.code;
    this.fieldErrors = payload.errors;
    this.context = payload.context;
  }
}

export class BadRequestError extends AppException {
  constructor(message: string, code: ErrorCode | string = ErrorCode.BAD_REQUEST, context?: Record<string, unknown>) {
    super({ message, code, statusCode: HttpStatus.BAD_REQUEST, context });
  }
}

export class ValidationError extends AppException {
  constructor(message: string, errors: AppExceptionPayload['errors'] = []) {
    super({
      message,
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      errors,
    });
  }
}

export class UnauthorizedError extends AppException {
  constructor(message = 'Authentication required', code: ErrorCode | string = ErrorCode.UNAUTHORIZED) {
    super({ message, code, statusCode: HttpStatus.UNAUTHORIZED });
  }
}

export class ForbiddenError extends AppException {
  constructor(message = 'You do not have permission to perform this action', code: ErrorCode | string = ErrorCode.FORBIDDEN, context?: Record<string, unknown>) {
    super({ message, code, statusCode: HttpStatus.FORBIDDEN, context });
  }
}

export class NotFoundError extends AppException {
  constructor(resource = 'Resource', code: ErrorCode | string = ErrorCode.NOT_FOUND) {
    super({ message: `${resource} not found`, code, statusCode: HttpStatus.NOT_FOUND });
  }
}

export class ConflictError extends AppException {
  constructor(message: string, code: ErrorCode | string = ErrorCode.CONFLICT, context?: Record<string, unknown>) {
    super({ message, code, statusCode: HttpStatus.CONFLICT, context });
  }
}

export class BusinessRuleError extends AppException {
  constructor(message: string, code: ErrorCode | string = ErrorCode.BUSINESS_RULE_VIOLATION, context?: Record<string, unknown>) {
    super({ message, code, statusCode: HttpStatus.UNPROCESSABLE_ENTITY, context });
  }
}

export class TooManyRequestsError extends AppException {
  constructor(message = 'Too many requests, please try again later') {
    super({ message, code: ErrorCode.RATE_LIMITED, statusCode: HttpStatus.TOO_MANY_REQUESTS });
  }
}

export class ServiceUnavailableError extends AppException {
  constructor(message = 'Service temporarily unavailable', code: ErrorCode | string = ErrorCode.SERVICE_UNAVAILABLE) {
    super({ message, code, statusCode: HttpStatus.SERVICE_UNAVAILABLE });
  }
}
