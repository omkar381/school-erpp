/**
 * The wire contract between the API and its clients.
 *
 * These mirror `apps/api/src/common/dto/api-response.dto.ts`. Every endpoint
 * answers in one of these two shapes, so a client never has to guess whether a
 * response carries data or an error.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
  requestId?: string;
  timestamp: string;
}

export interface ApiFieldError {
  field: string;
  message: string;
  rule?: string;
}

export interface ApiError {
  success: false;
  message: string;
  code: string;
  statusCode: number;
  errors?: ApiFieldError[];
  requestId?: string;
  timestamp: string;
  path?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Query parameters every list endpoint accepts. */
export interface PaginationQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

/**
 * Error codes the client branches on.
 *
 * Anything not listed here is shown to the user as its `message`; these are the
 * ones the UI has to actually react to.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  MODULE_DISABLED: 'MODULE_DISABLED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function isApiError<T>(response: ApiResponse<T>): response is ApiError {
  return response.success === false;
}
