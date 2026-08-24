import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { formatDateTime, todayInZone } from '../../common/utils/date.util';
import { isModuleEnabled } from '../../common/constants/modules';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PdfService } from '../pdf/pdf.service';
import { tabularReportTemplate } from '../pdf/templates/report.template';
import { ExportService, type ExportFormat, type ExportedFile } from './export.service';
import {
  REPORTS_BY_KEY,
  REPORT_DEFINITIONS,
  type ReportDefinition,
  type ReportResult,
} from './report-definitions';

/** Rows above this are only offered as a spreadsheet, never as a PDF table. */
const PDF_ROW_CAP = 2_000;

/** Hard ceiling on any single report run, so one query cannot exhaust memory. */
const MAX_ROWS = 50_000;

export interface RunReportOptions {
  key: string;
  filters: Record<string, string | undefined>;
  academicYearId?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ReportsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exports: ExportService,
    private readonly pdf: PdfService,
    logger: AppLogger,
  ) {
    this.log = logger.child('ReportsService');
  }

  /**
   * The report catalogue, filtered to what this user may actually run.
   *
   * A report the caller cannot run is hidden rather than shown and refused —
   * an accountant has no use for seeing a staff attendance report they will
   * only be denied.
   */
  async catalogue(schoolId: string, user: AuthenticatedUser) {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { enabledModules: true },
    });

    return REPORT_DEFINITIONS.filter(
      (definition) =>
        (user.isSuperAdmin || user.permissions.includes(definition.permission)) &&
        isModuleEnabled(school.enabledModules, definition.module),
    ).map((definition) => ({
      key: definition.key,
      name: definition.name,
      description: definition.description,
      module: definition.module,
      filters: definition.filters,
      columns: definition.columns.map((column) => ({
        key: column.key,
        label: column.label,
        type: column.type ?? 'text',
      })),
    }));
  }

  /** Runs a report and returns one page of it, for on-screen review. */
  async preview(schoolId: string, user: AuthenticatedUser, options: RunReportOptions) {
    const { definition, result, academicYear } = await this.execute(schoolId, user, options);

    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const start = (page - 1) * limit;

    return {
      key: definition.key,
      name: definition.name,
      academicYear: academicYear.name,
      columns: definition.columns,
      summary: result.summary ?? [],
      totals: result.totals ?? null,
      items: result.rows.slice(start, start + limit),
      page,
      limit,
      total: result.rows.length,
      totalPages: Math.max(1, Math.ceil(result.rows.length / limit)),
    };
  }

  /** Runs a report and renders it as a spreadsheet, CSV or PDF. */
  async export(
    schoolId: string,
    user: AuthenticatedUser,
    options: RunReportOptions,
    format: ExportFormat,
  ): Promise<ExportedFile> {
    const { definition, result, academicYear, brandTimezone } = await this.execute(
      schoolId,
      user,
      options,
    );

    const generatedOn = formatDateTime(new Date(), brandTimezone);
    const generatedBy = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const filters = this.describeFilters(definition, options.filters, academicYear.name);
    const stem = `${definition.key}-${todayInZone(brandTimezone).toISOString().slice(0, 10)}`;

    if (format === 'pdf') {
      const brand = await this.pdf.brandFor(schoolId);
      const capped = result.rows.length > PDF_ROW_CAP;

      const rendered = await this.pdf.render(
        tabularReportTemplate(brand, {
          title: definition.name,
          subtitle: definition.description,
          generatedOn,
          generatedBy,
          filters,
          columns: definition.columns.map((column) => ({
            key: column.key,
            label: column.label,
            align:
              column.type === 'number' || column.type === 'currency' || column.type === 'percent'
                ? 'right'
                : 'left',
          })),
          rows: capped ? result.rows.slice(0, PDF_ROW_CAP) : result.rows,
          summary: result.summary,
          totals: result.totals,
          truncatedAt: capped ? PDF_ROW_CAP : undefined,
          landscape: definition.landscape,
        }),
        schoolId,
        { folder: `schools/${schoolId}/reports`, fileName: `${stem}.pdf`, ephemeral: true },
      );

      return {
        buffer: rendered.buffer,
        fileName: rendered.fileName,
        mimeType: 'application/pdf',
        sizeBytes: rendered.sizeBytes,
      };
    }

    const sheet = {
      name: definition.name,
      title: definition.name,
      subtitle: definition.description,
      meta: [['Generated', generatedOn], ['By', generatedBy], ...filters] as Array<
        [string, string]
      >,
      columns: definition.columns,
      rows: result.rows,
      totals: result.totals,
    };

    return format === 'csv'
      ? this.exports.toCsv(sheet, stem)
      : this.exports.toExcel([sheet], stem);
  }

  // -------------------------------------------------------------------------

  private async execute(
    schoolId: string,
    user: AuthenticatedUser,
    options: RunReportOptions,
  ): Promise<{
    definition: ReportDefinition;
    result: ReportResult;
    academicYear: { id: string; name: string };
    brandTimezone: string;
  }> {
    const definition = REPORTS_BY_KEY.get(options.key);
    if (!definition) throw new NotFoundError('Report');

    if (!user.isSuperAdmin && !user.permissions.includes(definition.permission)) {
      throw new ForbiddenError(`You do not have permission to run the ${definition.name} report`);
    }

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true, enabledModules: true },
    });

    if (!isModuleEnabled(school.enabledModules, definition.module)) {
      throw new ForbiddenError(`The ${definition.module} module is not enabled for this school`);
    }

    const missing = definition.filters
      .filter((filter) => filter.required && !options.filters[filter.key])
      .map((filter) => filter.label);

    if (missing.length > 0) {
      throw new BadRequestError(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} required for this report`);
    }

    const academicYear = options.academicYearId
      ? await this.prisma.academicYear.findFirst({
          where: { id: options.academicYearId, schoolId },
          select: { id: true, name: true },
        })
      : await this.prisma.academicYear.findFirst({
          where: { schoolId, isCurrent: true },
          select: { id: true, name: true },
        });

    if (!academicYear) throw new NotFoundError('Academic year');

    const started = Date.now();
    const result = await definition.run({
      prisma: this.prisma,
      schoolId,
      filters: options.filters,
      academicYearId: academicYear.id,
      timezone: school.timezone,
    });

    if (result.rows.length > MAX_ROWS) {
      throw new BadRequestError(
        `This report returned ${result.rows.length.toLocaleString('en-IN')} rows. ` +
          'Narrow the date range or filter by class and run it again.',
      );
    }

    this.log.info('Report run', {
      schoolId,
      report: definition.key,
      rows: result.rows.length,
      durationMs: Date.now() - started,
    });

    return { definition, result, academicYear, brandTimezone: school.timezone };
  }

  /** Renders the filters a report was run with, for the header block. */
  private describeFilters(
    definition: ReportDefinition,
    filters: Record<string, string | undefined>,
    academicYearName: string,
  ): Array<[string, string]> {
    const described: Array<[string, string]> = [['Academic Year', academicYearName]];

    for (const filter of definition.filters) {
      const value = filters[filter.key];
      // A UUID in a header teaches the reader nothing; the row data already
      // names the class or route it was filtered to.
      if (!value || filter.type === 'uuid') continue;
      described.push([filter.label, value]);
    }

    return described;
  }
}
