import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Base query parameters shared by every list endpoint.
 * Extend this in module DTOs to add domain-specific filters.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: DEFAULT_PAGE_SIZE, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ description: 'Free-text search term' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ description: 'Field to sort by' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';

  get skip(): number {
    return (this.page - 1) * this.limit;
  }

  get take(): number {
    return this.limit;
  }

  /**
   * Builds a Prisma `orderBy` clause, rejecting any column not explicitly
   * allow-listed by the calling service. This keeps user input from reaching
   * the query planner as an arbitrary column name.
   */
  buildOrderBy<T extends string>(
    allowedFields: readonly T[],
    fallback: T,
  ): Record<string, 'asc' | 'desc'> {
    const field = allowedFields.includes(this.sortBy as T) ? (this.sortBy as T) : fallback;
    return { [field]: this.sortOrder };
  }
}

export class DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'ISO date (inclusive)', example: '2026-04-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)', example: '2026-04-30' })
  @IsOptional()
  @IsString()
  to?: string;
}
