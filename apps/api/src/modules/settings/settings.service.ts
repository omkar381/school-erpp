import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { BadRequestError, NotFoundError } from '../../common/exceptions/app.exception';
import { ALL_MODULES, MODULE_LABELS, isModuleEnabled } from '../../common/constants/modules';
import { AuditService } from '../audit/audit.service';
import { SEQUENCE_KINDS, type UpdateSequencesDto } from './dto/settings.dto';

/** What each counter numbers, shown next to it in the settings screen. */
const SEQUENCE_LABELS: Record<string, string> = {
  INVOICE: 'Fee invoices',
  RECEIPT: 'Payment receipts',
  REFUND: 'Refunds',
  ADMISSION: 'Admission numbers',
  ENQUIRY: 'Admission enquiries',
  CERTIFICATE: 'Certificates',
  TICKET: 'Support tickets',
  ID_CARD: 'Identity cards',
  PURCHASE: 'Purchase orders',
  ACCESSION: 'Library accessions',
  LIBRARY_CARD: 'Library cards',
  EMPLOYEE: 'Employee codes',
};

const DEFAULT_PREFIXES: Record<string, string> = {
  INVOICE: 'INV',
  RECEIPT: 'RCP',
  REFUND: 'REF',
  ADMISSION: 'ADM',
  ENQUIRY: 'ENQ',
  CERTIFICATE: 'CRT',
  TICKET: 'TKT',
  ID_CARD: 'IDC',
  PURCHASE: 'PO',
  ACCESSION: 'ACC',
  LIBRARY_CARD: 'LIB',
  EMPLOYEE: 'EMP',
};

@Injectable()
export class SettingsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('SettingsService');
  }

  /**
   * Everything the settings screen needs, in one request.
   *
   * The school row, which modules are live, the document counters and the
   * counts that tell an admin whether the school is actually set up — six
   * round trips collapsed into one.
   */
  async overview(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        code: true,
        slug: true,
        timezone: true,
        currency: true,
        enabledModules: true,
        settings: true,
        status: true,
        onboardingStep: true,
      },
    });
    if (!school) throw new NotFoundError('School');

    const [sequences, currentYear, counts] = await Promise.all([
      this.listSequences(schoolId),
      this.prisma.academicYear.findFirst({
        where: { schoolId, isCurrent: true },
        select: { id: true, name: true, startDate: true, endDate: true, isLocked: true },
      }),
      this.setupCounts(schoolId),
    ]);

    return {
      school,
      modules: ALL_MODULES.map((module) => ({
        key: module,
        label: MODULE_LABELS[module],
        enabled: isModuleEnabled(school.enabledModules, module),
      })),
      sequences,
      currentAcademicYear: currentYear,
      setup: counts,
    };
  }

  /**
   * The document counters, including the ones never used yet.
   *
   * A counter row only appears once a number has been allocated, so unused
   * kinds are filled in from the defaults — otherwise an admin could not set
   * an invoice prefix until after the first invoice had already been numbered
   * with the wrong one.
   */
  async listSequences(schoolId: string) {
    const rows = await this.prisma.numberSequence.findMany({
      where: { schoolId },
      orderBy: [{ kind: 'asc' }, { period: 'asc' }],
    });

    const byKind = new Map(rows.filter((row) => row.period === '').map((row) => [row.kind, row]));

    return SEQUENCE_KINDS.map((kind) => {
      const row = byKind.get(kind);
      const prefix = row?.prefix || DEFAULT_PREFIXES[kind] || '';
      const padding = row?.padding ?? 5;
      const nextValue = row?.nextValue ?? 1;

      return {
        kind,
        label: SEQUENCE_LABELS[kind] ?? kind,
        prefix,
        padding,
        nextValue,
        // Shows the admin exactly what the next document will be called.
        preview: [prefix, String(nextValue).padStart(padding, '0')].filter(Boolean).join('/'),
        isConfigured: row !== undefined,
        // Counters scoped by year are listed so a year-scoped series is visible,
        // but they are not editable here.
        periodScoped: rows
          .filter((other) => other.kind === kind && other.period !== '')
          .map((other) => ({
            period: other.period,
            nextValue: other.nextValue,
            prefix: other.prefix,
          })),
      };
    });
  }

  /**
   * Updates the counters.
   *
   * `nextValue` may only move forwards: rewinding it would re-issue a number
   * that is already printed on an invoice or a certificate, and the unique
   * constraint would then reject the document rather than the setting.
   */
  async updateSequences(schoolId: string, dto: UpdateSequencesDto, userId: string) {
    if (dto.sequences.length === 0) {
      throw new BadRequestError('Nothing to update.');
    }

    const existing = await this.prisma.numberSequence.findMany({
      where: { schoolId, period: '', kind: { in: dto.sequences.map((entry) => entry.kind) } },
    });
    const byKind = new Map(existing.map((row) => [row.kind, row]));

    for (const entry of dto.sequences) {
      const current = byKind.get(entry.kind);
      if (entry.nextValue !== undefined && current && entry.nextValue < current.nextValue) {
        throw new BadRequestError(
          `${SEQUENCE_LABELS[entry.kind] ?? entry.kind} is already at ${current.nextValue}. ` +
            'A counter can only be moved forwards, never back over numbers already issued.',
        );
      }
    }

    await this.prisma.transaction(async (tx) => {
      for (const entry of dto.sequences) {
        const current = byKind.get(entry.kind);
        await tx.numberSequence.upsert({
          where: { schoolId_kind_period: { schoolId, kind: entry.kind, period: '' } },
          create: {
            schoolId,
            kind: entry.kind,
            period: '',
            prefix: entry.prefix ?? DEFAULT_PREFIXES[entry.kind] ?? '',
            padding: entry.padding ?? 5,
            nextValue: entry.nextValue ?? 1,
          },
          update: {
            ...(entry.prefix !== undefined ? { prefix: entry.prefix } : {}),
            ...(entry.padding !== undefined ? { padding: entry.padding } : {}),
            ...(entry.nextValue !== undefined ? { nextValue: entry.nextValue } : {}),
          },
        });

        if (current && entry.nextValue !== undefined && entry.nextValue > current.nextValue) {
          this.log.warn('Document counter advanced by hand', {
            schoolId,
            kind: entry.kind,
            from: current.nextValue,
            to: entry.nextValue,
          });
        }
      }
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'settings',
      entity: 'NumberSequence',
      description: `Updated document numbering for ${dto.sequences.map((entry) => entry.kind).join(', ')}`,
      userId,
      schoolId,
    });

    return this.listSequences(schoolId);
  }

  /** The counts that tell an admin whether the school is ready to run. */
  private async setupCounts(schoolId: string) {
    const [academicYears, classes, sections, subjects, students, staff, feeStructures, roles] =
      await Promise.all([
        this.prisma.academicYear.count({ where: { schoolId } }),
        this.prisma.class.count({ where: { schoolId } }),
        this.prisma.section.count({ where: { schoolId } }),
        this.prisma.subject.count({ where: { schoolId } }),
        this.prisma.student.count({ where: { schoolId, deletedAt: null } }),
        this.prisma.staff.count({ where: { schoolId, deletedAt: null } }),
        this.prisma.feeStructure.count({ where: { schoolId } }),
        this.prisma.role.count({ where: { schoolId } }),
      ]);

    return { academicYears, classes, sections, subjects, students, staff, feeStructures, roles };
  }
}
