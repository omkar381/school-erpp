import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { parseDateOnly } from '../../../common/utils/date.util';
import { AuditService } from '../../audit/audit.service';
import type { CreateAcademicYearDto, UpdateAcademicYearDto } from '../dto/academics.dto';

@Injectable()
export class AcademicYearService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('AcademicYearService');
  }

  async findAll(schoolId: string) {
    const years = await this.prisma.academicYear.findMany({
      where: { schoolId },
      orderBy: { startDate: 'desc' },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        isCurrent: true,
        isLocked: true,
        createdAt: true,
        _count: { select: { classes: true, enrollments: true, exams: true } },
      },
    });

    return years.map(({ _count, ...year }) => ({
      ...year,
      classCount: _count.classes,
      studentCount: _count.enrollments,
      examCount: _count.exams,
    }));
  }

  async findOne(schoolId: string, id: string) {
    const year = await this.prisma.academicYear.findFirst({
      where: { id, schoolId },
      include: {
        classes: {
          orderBy: { level: 'asc' },
          select: {
            id: true,
            name: true,
            level: true,
            stream: true,
            _count: { select: { sections: true, enrollments: true } },
          },
        },
      },
    });
    if (!year) throw new NotFoundError('Academic year');
    return year;
  }

  /** The active academic year. Most queries default to this. */
  async getCurrent(schoolId: string) {
    const year = await this.prisma.academicYear.findFirst({
      where: { schoolId, isCurrent: true },
    });

    if (!year) {
      throw new BadRequestError(
        'No academic year is marked as current. Set one before continuing.',
        ErrorCode.BAD_REQUEST,
      );
    }
    return year;
  }

  /** Resolves an optional academic year id, falling back to the current year. */
  async resolveId(schoolId: string, academicYearId?: string): Promise<string> {
    if (academicYearId) {
      const exists = await this.prisma.academicYear.count({
        where: { id: academicYearId, schoolId },
      });
      if (exists === 0) throw new NotFoundError('Academic year');
      return academicYearId;
    }
    return (await this.getCurrent(schoolId)).id;
  }

  async create(schoolId: string, dto: CreateAcademicYearDto) {
    const startDate = parseDateOnly(dto.startDate);
    const endDate = parseDateOnly(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestError('The end date must be after the start date');
    }

    const duplicate = await this.prisma.academicYear.count({
      where: { schoolId, name: dto.name },
    });
    if (duplicate > 0) {
      throw new ConflictError(`An academic year named "${dto.name}" already exists`);
    }

    // Academic years must not overlap, or an enrollment would be ambiguous.
    const overlap = await this.prisma.academicYear.findFirst({
      where: { schoolId, startDate: { lte: endDate }, endDate: { gte: startDate } },
      select: { name: true },
    });
    if (overlap) {
      throw new ConflictError(`These dates overlap the "${overlap.name}" academic year`);
    }

    const year = await this.prisma.transaction(async (tx) => {
      if (dto.isCurrent) {
        await tx.academicYear.updateMany({
          where: { schoolId, isCurrent: true },
          data: { isCurrent: false },
        });
      }

      const created = await tx.academicYear.create({
        data: { schoolId, name: dto.name, startDate, endDate, isCurrent: dto.isCurrent ?? false },
      });

      if (dto.copyStructureFromId) {
        await this.copyStructure(tx, schoolId, dto.copyStructureFromId, created.id);
      }

      return created;
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'academics',
      entity: 'AcademicYear',
      entityId: year.id,
      description: `Created academic year "${year.name}"`,
      schoolId,
    });

    return year;
  }

  async update(schoolId: string, id: string, dto: UpdateAcademicYearDto) {
    const existing = await this.prisma.academicYear.findFirst({ where: { id, schoolId } });
    if (!existing) throw new NotFoundError('Academic year');

    if (existing.isLocked && (dto.startDate || dto.endDate)) {
      throw new BadRequestError(
        'This academic year is locked. Unlock it before changing its dates.',
        ErrorCode.ACADEMIC_YEAR_LOCKED,
      );
    }

    const updated = await this.prisma.academicYear.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        startDate: dto.startDate ? parseDateOnly(dto.startDate) : undefined,
        endDate: dto.endDate ? parseDateOnly(dto.endDate) : undefined,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'academics',
      entity: 'AcademicYear',
      entityId: id,
      description: 'Updated academic year',
      ...this.audit.diff(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      ),
      schoolId,
    });

    return updated;
  }

  /** Exactly one academic year is current at a time. */
  async setCurrent(schoolId: string, id: string) {
    const year = await this.prisma.academicYear.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true },
    });
    if (!year) throw new NotFoundError('Academic year');

    await this.prisma.$transaction([
      this.prisma.academicYear.updateMany({
        where: { schoolId, isCurrent: true },
        data: { isCurrent: false },
      }),
      this.prisma.academicYear.update({ where: { id }, data: { isCurrent: true } }),
    ]);

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'academics',
      entity: 'AcademicYear',
      entityId: id,
      description: `Set "${year.name}" as the current academic year`,
      schoolId,
    });

    this.log.info('Current academic year changed', { schoolId, academicYearId: id });
    return { id, isCurrent: true };
  }

  /**
   * Locking freezes results and finances for a completed year so that historical
   * report cards and ledgers cannot drift.
   */
  async setLocked(schoolId: string, id: string, isLocked: boolean) {
    const year = await this.prisma.academicYear.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, isCurrent: true },
    });
    if (!year) throw new NotFoundError('Academic year');

    if (isLocked && year.isCurrent) {
      throw new BadRequestError('The current academic year cannot be locked');
    }

    const updated = await this.prisma.academicYear.update({
      where: { id },
      data: { isLocked },
      select: { id: true, name: true, isLocked: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'academics',
      entity: 'AcademicYear',
      entityId: id,
      description: `${isLocked ? 'Locked' : 'Unlocked'} academic year "${year.name}"`,
      schoolId,
    });

    return updated;
  }

  async remove(schoolId: string, id: string) {
    const year = await this.prisma.academicYear.findFirst({
      where: { id, schoolId },
      select: {
        id: true,
        name: true,
        isCurrent: true,
        _count: { select: { enrollments: true, invoices: true, exams: true } },
      },
    });
    if (!year) throw new NotFoundError('Academic year');

    if (year.isCurrent) {
      throw new BadRequestError('The current academic year cannot be deleted');
    }

    const dependents =
      year._count.enrollments + year._count.invoices + year._count.exams;
    if (dependents > 0) {
      throw new ConflictError(
        `This academic year has ${year._count.enrollments} enrollment(s), ` +
          `${year._count.invoices} invoice(s) and ${year._count.exams} exam(s). ` +
          'Historical data cannot be deleted; lock the year instead.',
      );
    }

    await this.prisma.academicYear.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'academics',
      entity: 'AcademicYear',
      entityId: id,
      description: `Deleted academic year "${year.name}"`,
      schoolId,
    });

    return { deleted: true };
  }

  /**
   * Duplicates the class, section and subject structure of one year into
   * another, so a new session can start from last year's setup.
   * Enrollments, marks and finances are never copied.
   */
  private async copyStructure(
    tx: Parameters<Parameters<PrismaService['transaction']>[0]>[0],
    schoolId: string,
    fromYearId: string,
    toYearId: string,
  ): Promise<void> {
    const source = await tx.class.findMany({
      where: { schoolId, academicYearId: fromYearId },
      include: {
        sections: { select: { name: true, capacity: true, roomId: true } },
        classSubjects: {
          select: {
            subjectId: true,
            weeklyPeriods: true,
            maxMarks: true,
            passMarks: true,
            isOptional: true,
          },
        },
      },
    });

    for (const sourceClass of source) {
      const created = await tx.class.create({
        data: {
          schoolId,
          academicYearId: toYearId,
          name: sourceClass.name,
          level: sourceClass.level,
          stream: sourceClass.stream,
          medium: sourceClass.medium,
          description: sourceClass.description,
          sections: {
            create: sourceClass.sections.map((section) => ({
              schoolId,
              name: section.name,
              capacity: section.capacity,
              roomId: section.roomId,
            })),
          },
        },
        select: { id: true },
      });

      if (sourceClass.classSubjects.length > 0) {
        await tx.classSubject.createMany({
          data: sourceClass.classSubjects.map((entry) => ({
            classId: created.id,
            subjectId: entry.subjectId,
            weeklyPeriods: entry.weeklyPeriods,
            maxMarks: entry.maxMarks,
            passMarks: entry.passMarks,
            isOptional: entry.isOptional,
          })),
          skipDuplicates: true,
        });
      }
    }

    this.log.info('Copied academic structure between years', {
      schoolId,
      fromYearId,
      toYearId,
      classes: source.length,
    });
  }
}
