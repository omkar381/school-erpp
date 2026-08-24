import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiSchoolHeader, CurrentSchool, CurrentUser } from '../../common/decorators';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SearchService } from './search.service';

export class GlobalSearchDto {
  @ApiPropertyOptional({ description: 'At least two characters' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({
    description: 'Restrict to these entity types; omit to search everything',
    example: 'student,invoice',
  })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((part: string) => part.trim()).filter(Boolean)
      : value,
  )
  @IsString({ each: true })
  types?: string[];

  @ApiPropertyOptional({ default: 5, maximum: 25, description: 'Hits per entity type' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;
}

@ApiTags('Search')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Search across every record this user is allowed to read' })
  query(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: GlobalSearchDto,
  ) {
    return this.search.search(this.school(schoolId), user, dto.q ?? '', dto.types, dto.limit);
  }

  @Get('sources')
  @ApiOperation({ summary: 'The entity types this user can search' })
  sources(@CurrentSchool() schoolId: string | null, @CurrentUser() user: AuthenticatedUser) {
    return this.search.sources(this.school(schoolId), user);
  }

  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError(
        'Select a school first. Super administrators must pass the X-School-Id header.',
      );
    }
    return schoolId;
  }
}
