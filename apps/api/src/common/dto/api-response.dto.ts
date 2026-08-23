import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The single success envelope used by every endpoint.
 * Controllers return plain data; ResponseInterceptor wraps it in this shape.
 */
export class ApiSuccessResponse<T> {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty()
  data!: T;

  @ApiPropertyOptional({ example: 'Operation completed successfully' })
  message?: string;

  @ApiPropertyOptional({ description: 'Correlation id for this request' })
  requestId?: string;

  @ApiProperty({ example: '2026-08-23T10:15:00.000Z' })
  timestamp!: string;
}

export class ApiFieldError {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ example: 'email must be a valid email address' })
  message!: string;

  @ApiPropertyOptional({ example: 'isEmail' })
  rule?: string;
}

export class ApiErrorResponse {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 422 })
  statusCode!: number;

  @ApiPropertyOptional({ type: [ApiFieldError] })
  errors?: ApiFieldError[];

  @ApiPropertyOptional()
  requestId?: string;

  @ApiProperty({ example: '2026-08-23T10:15:00.000Z' })
  timestamp!: string;

  @ApiPropertyOptional({ description: 'Present only outside production' })
  path?: string;
}

export class PaginationMeta {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  limit!: number;

  @ApiProperty({ example: 137 })
  total!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage!: boolean;
}

export class PaginatedResult<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiProperty({ type: PaginationMeta })
  meta!: PaginationMeta;
}

export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  const safeLimit = limit > 0 ? limit : 1;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return {
    items,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}
