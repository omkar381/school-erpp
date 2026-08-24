import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { SkipEnvelope } from '../../common/interceptors/response.interceptor';
import { BadRequestError, ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ReportsService } from './reports.service';
import type { ExportFormat } from './export.service';

export class RunReportDto {
  @ApiProperty({ example: 'outstanding-fees' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  key!: string;

  @ApiPropertyOptional({
    description: 'Report-specific filters; the catalogue describes what each report accepts',
    example: { from: '2026-04-01', to: '2026-04-30', classId: null },
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, string | undefined>;

  @ApiPropertyOptional({ description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ExportReportDto extends RunReportDto {
  @ApiProperty({ enum: ['xlsx', 'csv', 'pdf'] })
  @IsIn(['xlsx', 'csv', 'pdf'])
  format!: ExportFormat;
}

@ApiTags('Reports')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'The reports this user can run, with their filters and columns' })
  catalogue(@CurrentSchool() schoolId: string | null, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.catalogue(this.school(schoolId), user);
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'Run a report and return one page of results' })
  run(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RunReportDto,
  ) {
    return this.reports.preview(this.school(schoolId), user, {
      key: dto.key,
      filters: dto.filters ?? {},
      academicYearId: dto.academicYearId,
      page: dto.page,
      limit: dto.limit,
    });
  }

  @Post('export')
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Run a report and download it as Excel, CSV or PDF' })
  async export(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ExportReportDto,
    @Res() response: Response,
  ) {
    const file = await this.reports.export(
      this.school(schoolId),
      user,
      {
        key: dto.key,
        filters: dto.filters ?? {},
        academicYearId: dto.academicYearId,
      },
      dto.format,
    );

    response
      .status(200)
      .set({
        'Content-Type': file.mimeType,
        'Content-Length': String(file.sizeBytes),
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
      })
      .end(file.buffer);
  }

  /**
   * Convenience GET for the same export, so a report can be opened straight
   * from a link. Filters arrive as repeated query parameters.
   */
  @Get('export')
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Download a report by URL' })
  async exportByUrl(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string>,
    @Res() response: Response,
  ) {
    const { key, format = 'xlsx', academicYearId, ...filters } = query;

    if (!key) throw new BadRequestError('A report key is required');
    if (!['xlsx', 'csv', 'pdf'].includes(format)) {
      throw new BadRequestError('format must be one of xlsx, csv or pdf');
    }

    const file = await this.reports.export(
      this.school(schoolId),
      user,
      { key, filters, academicYearId },
      format as ExportFormat,
    );

    response
      .status(200)
      .set({
        'Content-Type': file.mimeType,
        'Content-Length': String(file.sizeBytes),
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
      })
      .end(file.buffer);
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
