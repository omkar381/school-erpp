import { Injectable } from '@nestjs/common';
import { AdmissionEnquiryStatus, AuditAction, Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { SequenceService } from '../../common/services/sequence.service';
import { parseDateOnly, todayInZone } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { StudentsService } from '../students/students.service';
import type { CreateStudentDto } from '../students/dto/student.dto';
import { AdmissionAuditEntity, type AdmissionEnquiryRecord } from './admissions.types';
import type {
  AssignEnquiryDto,
  ConvertEnquiryDto,
  CreateEnquiryDto,
  EnquiryQueryDto,
  UpdateEnquiryDto,
  UpdateEnquiryStatusDto,
} from './dto/admissions.dto';

/**
 * Statuses an enquiry can move to from each status.
 *
 * ADMITTED is deliberately absent everywhere: it is only ever reached by
 * actually converting the enquiry into a student, so the pipeline cannot claim
 * an admission that has no student record behind it.
 */
const ALLOWED_TRANSITIONS: Record<AdmissionEnquiryStatus, AdmissionEnquiryStatus[]> = {
  NEW: ['CONTACTED', 'FOLLOW_UP', 'APPLIED', 'REJECTED', 'LOST'],
  CONTACTED: ['FOLLOW_UP', 'APPLIED', 'REJECTED', 'LOST'],
  FOLLOW_UP: ['CONTACTED', 'APPLIED', 'REJECTED', 'LOST'],
  APPLIED: ['FOLLOW_UP', 'REJECTED', 'LOST'],
  ADMITTED: [],
  REJECTED: ['FOLLOW_UP'],
  LOST: ['FOLLOW_UP'],
};

/** Statuses that count as still in play for the funnel. */
const OPEN_STATUSES: AdmissionEnquiryStatus[] = ['NEW', 'CONTACTED', 'FOLLOW_UP', 'APPLIED'];

@Injectable()
export class AdmissionsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('AdmissionsService');
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async statistics(schoolId: string) {
    const today = todayInZone();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [byStatus, thisMonth, overdue, bySource] = await Promise.all([
      this.prisma.admissionEnquiry.groupBy({
        by: ['status'],
        where: { schoolId },
        _count: { _all: true },
      }),
      this.prisma.admissionEnquiry.count({
        where: { schoolId, createdAt: { gte: monthStart } },
      }),
      this.prisma.admissionEnquiry.count({
        where: {
          schoolId,
          status: { in: OPEN_STATUSES },
          followUpDate: { lt: today },
        },
      }),
      this.prisma.admissionEnquiry.groupBy({
        by: ['source'],
        where: { schoolId },
        _count: { _all: true },
      }),
    ]);

    const counts = Object.fromEntries(
      byStatus.map((row) => [row.status, row._count._all]),
    ) as Record<AdmissionEnquiryStatus, number | undefined>;

    const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);
    const admitted = counts.ADMITTED ?? 0;

    return {
      total,
      open: OPEN_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0),
      newEnquiries: counts.NEW ?? 0,
      contacted: counts.CONTACTED ?? 0,
      followUp: counts.FOLLOW_UP ?? 0,
      applied: counts.APPLIED ?? 0,
      admitted,
      rejected: counts.REJECTED ?? 0,
      lost: counts.LOST ?? 0,
      thisMonth,
      overdueFollowUps: overdue,
      // Expressed against every enquiry ever raised, which is the number an
      // admissions head is actually asked for.
      conversionRate: total > 0 ? Math.round((admitted / total) * 1000) / 10 : 0,
      bySource: bySource
        .map((row) => ({ source: row.source, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async list(schoolId: string, query: EnquiryQueryDto) {
    const where: Prisma.AdmissionEnquiryWhereInput = {
      schoolId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.seekingClass ? { seekingClass: query.seekingClass } : {}),
      ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
      ...(query.overdueOnly
        ? { status: { in: OPEN_STATUSES }, followUpDate: { lt: todayInZone() } }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              ...(query.to ? { lte: endOfDay(parseDateOnly(query.to)) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { enquiryNumber: { contains: query.search, mode: 'insensitive' } },
              { studentFirstName: { contains: query.search, mode: 'insensitive' } },
              { studentLastName: { contains: query.search, mode: 'insensitive' } },
              { parentName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.admissionEnquiry.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(
          ['createdAt', 'followUpDate', 'studentFirstName', 'status'] as const,
          'createdAt',
        ),
        include: {
          academicYear: { select: { id: true, name: true } },
          _count: { select: { attachments: true } },
        },
      }),
      this.prisma.admissionEnquiry.count({ where }),
    ]);

    const today = todayInZone();

    return buildPaginatedResult(
      items.map(({ _count, ...enquiry }) => this.decorate(enquiry, today, _count.attachments)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const enquiry = await this.prisma.admissionEnquiry.findFirst({
      where: { id, schoolId },
      include: {
        academicYear: { select: { id: true, name: true } },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!enquiry) throw new NotFoundError('Enquiry');

    const { attachments, ...rest } = enquiry;
    const assignee = rest.assignedToId ? await this.loadAssignee(rest.assignedToId) : null;
    const converted = rest.convertedStudentId
      ? await this.prisma.student.findFirst({
          where: { id: rest.convertedStudentId, schoolId },
          select: { id: true, admissionNumber: true, firstName: true, lastName: true },
        })
      : null;

    return {
      ...this.decorate(rest, todayInZone(), attachments.length),
      attachments,
      assignee,
      convertedStudent: converted,
      allowedTransitions: ALLOWED_TRANSITIONS[rest.status],
    };
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  async create(schoolId: string, dto: CreateEnquiryDto) {
    if (dto.academicYearId) await this.assertAcademicYear(schoolId, dto.academicYearId);
    if (dto.assignedToId) await this.assertAssignee(schoolId, dto.assignedToId);

    const enquiry = await this.prisma.transaction(async (tx) => {
      const enquiryNumber = await this.sequences.next(schoolId, 'ENQUIRY', {}, tx);

      return tx.admissionEnquiry.create({
        data: {
          schoolId,
          enquiryNumber,
          academicYearId: dto.academicYearId ?? null,
          studentFirstName: dto.studentFirstName,
          studentLastName: dto.studentLastName ?? null,
          dateOfBirth: dto.dateOfBirth ? parseDateOnly(dto.dateOfBirth) : null,
          gender: dto.gender ?? null,
          seekingClass: dto.seekingClass,
          previousSchool: dto.previousSchool ?? null,
          parentName: dto.parentName,
          relation: dto.relation ?? 'FATHER',
          phone: dto.phone,
          email: dto.email ?? null,
          addressLine1: dto.addressLine1 ?? null,
          city: dto.city ?? null,
          source: dto.source ?? 'WALK_IN',
          notes: dto.notes ?? null,
          followUpDate: dto.followUpDate ? parseDateOnly(dto.followUpDate) : null,
          assignedToId: dto.assignedToId ?? null,
        },
      });
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'admissions',
      entity: AdmissionAuditEntity,
      entityId: enquiry.id,
      description: `Raised enquiry ${enquiry.enquiryNumber} for ${enquiry.studentFirstName} (${enquiry.seekingClass})`,
      schoolId,
    });

    return this.findOne(schoolId, enquiry.id);
  }

  async update(schoolId: string, id: string, dto: UpdateEnquiryDto) {
    const existing = await this.load(schoolId, id);

    if (existing.status === AdmissionEnquiryStatus.ADMITTED) {
      throw new ConflictError(
        'This enquiry has already been converted into a student. Edit the student record instead.',
      );
    }

    if (dto.academicYearId) await this.assertAcademicYear(schoolId, dto.academicYearId);
    if (dto.assignedToId) await this.assertAssignee(schoolId, dto.assignedToId);

    await this.prisma.admissionEnquiry.update({
      where: { id },
      data: {
        ...(dto.studentFirstName !== undefined ? { studentFirstName: dto.studentFirstName } : {}),
        ...(dto.studentLastName !== undefined ? { studentLastName: dto.studentLastName } : {}),
        ...(dto.dateOfBirth !== undefined ? { dateOfBirth: parseDateOnly(dto.dateOfBirth) } : {}),
        ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
        ...(dto.seekingClass !== undefined ? { seekingClass: dto.seekingClass } : {}),
        ...(dto.previousSchool !== undefined ? { previousSchool: dto.previousSchool } : {}),
        ...(dto.parentName !== undefined ? { parentName: dto.parentName } : {}),
        ...(dto.relation !== undefined ? { relation: dto.relation } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.addressLine1 !== undefined ? { addressLine1: dto.addressLine1 } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.source !== undefined ? { source: dto.source } : {}),
        ...(dto.academicYearId !== undefined ? { academicYearId: dto.academicYearId } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.followUpDate !== undefined
          ? { followUpDate: parseDateOnly(dto.followUpDate) }
          : {}),
        ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId } : {}),
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'admissions',
      entity: AdmissionAuditEntity,
      entityId: id,
      description: `Updated enquiry ${existing.enquiryNumber}`,
      schoolId,
    });

    return this.findOne(schoolId, id);
  }

  async updateStatus(schoolId: string, id: string, dto: UpdateEnquiryStatusDto, userId: string) {
    const existing = await this.load(schoolId, id);

    if (existing.status === dto.status) {
      throw new BadRequestError(`This enquiry is already marked ${humaniseStatus(dto.status)}.`);
    }

    if (dto.status === AdmissionEnquiryStatus.ADMITTED) {
      throw new BadRequestError(
        'Mark an enquiry as admitted by converting it into a student, not by changing its status.',
      );
    }

    if (!ALLOWED_TRANSITIONS[existing.status].includes(dto.status)) {
      throw new ConflictError(
        `An enquiry that is ${humaniseStatus(existing.status)} cannot move to ${humaniseStatus(dto.status)}.`,
      );
    }

    if (dto.status === AdmissionEnquiryStatus.REJECTED && !dto.rejectionReason) {
      throw new BadRequestError('A reason is required when rejecting an enquiry.');
    }

    await this.prisma.admissionEnquiry.update({
      where: { id },
      data: {
        status: dto.status,
        rejectionReason:
          dto.status === AdmissionEnquiryStatus.REJECTED ? (dto.rejectionReason ?? null) : null,
        // A follow-up date only makes sense while the enquiry is still open;
        // closing it clears the reminder so it stops appearing as overdue.
        followUpDate: dto.followUpDate
          ? parseDateOnly(dto.followUpDate)
          : OPEN_STATUSES.includes(dto.status)
            ? existing.followUpDate
            : null,
        notes: dto.note ? appendNote(existing.notes, dto.note, dto.status) : existing.notes,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'admissions',
      entity: AdmissionAuditEntity,
      entityId: id,
      description: `Moved enquiry ${existing.enquiryNumber} from ${humaniseStatus(existing.status)} to ${humaniseStatus(dto.status)}`,
      oldValue: { status: existing.status },
      newValue: { status: dto.status },
      userId,
      schoolId,
    });

    return this.findOne(schoolId, id);
  }

  async assign(schoolId: string, id: string, dto: AssignEnquiryDto) {
    const existing = await this.load(schoolId, id);
    if (dto.assignedToId) await this.assertAssignee(schoolId, dto.assignedToId);

    await this.prisma.admissionEnquiry.update({
      where: { id },
      data: { assignedToId: dto.assignedToId ?? null },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'admissions',
      entity: AdmissionAuditEntity,
      entityId: id,
      description: dto.assignedToId
        ? `Assigned enquiry ${existing.enquiryNumber}`
        : `Cleared the owner of enquiry ${existing.enquiryNumber}`,
      schoolId,
    });

    return this.findOne(schoolId, id);
  }

  // -------------------------------------------------------------------------
  // Conversion
  // -------------------------------------------------------------------------

  /**
   * Turns an enquiry into a real student.
   *
   * The student is created through StudentsService so admission from the
   * pipeline goes through exactly the same seat-capacity, subscription-limit
   * and numbering rules as admission from the student form. The enquiry is only
   * stamped as converted once that has succeeded.
   */
  async convert(schoolId: string, id: string, dto: ConvertEnquiryDto, userId: string) {
    const enquiry = await this.load(schoolId, id);

    if (enquiry.convertedStudentId) {
      throw new ConflictError(
        `Enquiry ${enquiry.enquiryNumber} was already converted on ${enquiry.convertedAt?.toISOString().slice(0, 10)}.`,
      );
    }
    if (enquiry.status === AdmissionEnquiryStatus.REJECTED) {
      throw new ConflictError('A rejected enquiry cannot be converted. Reopen it first.');
    }

    const dateOfBirth = dto.dateOfBirth ?? enquiry.dateOfBirth?.toISOString().slice(0, 10);
    if (!dateOfBirth) {
      throw new BadRequestError(
        'This enquiry has no date of birth. Supply one to admit the student.',
      );
    }

    const gender = dto.gender ?? enquiry.gender;
    if (!gender) {
      throw new BadRequestError('This enquiry has no gender recorded. Supply one to admit the student.');
    }

    const guardians =
      dto.guardians && dto.guardians.length > 0
        ? dto.guardians
        : [buildGuardianFromEnquiry(enquiry)];

    const admission: CreateStudentDto = {
      firstName: enquiry.studentFirstName,
      lastName: enquiry.studentLastName ?? undefined,
      dateOfBirth,
      gender: gender as Gender,
      previousSchool: enquiry.previousSchool ?? undefined,
      addressLine1: enquiry.addressLine1 ?? undefined,
      city: enquiry.city ?? undefined,
      phone: enquiry.phone,
      email: enquiry.email ?? undefined,
      admissionNumber: dto.admissionNumber,
      admissionDate: dto.admissionDate,
      classId: dto.classId,
      sectionId: dto.sectionId,
      academicYearId: dto.academicYearId ?? enquiry.academicYearId ?? undefined,
      guardians,
      createLogin: dto.createLogin ?? false,
      // Keeps the trail visible from the student record, not only the audit log.
      metadata: { admittedFromEnquiry: enquiry.enquiryNumber },
    };

    const student = await this.students.create(schoolId, admission);

    await this.prisma.admissionEnquiry.update({
      where: { id },
      data: {
        status: AdmissionEnquiryStatus.ADMITTED,
        convertedStudentId: student.id,
        convertedAt: new Date(),
        followUpDate: null,
        rejectionReason: null,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'admissions',
      entity: AdmissionAuditEntity,
      entityId: id,
      description: `Converted enquiry ${enquiry.enquiryNumber} into student ${student.admissionNumber}`,
      newValue: { studentId: student.id, admissionNumber: student.admissionNumber },
      userId,
      schoolId,
    });

    this.log.info('Admission enquiry converted', {
      schoolId,
      enquiryId: id,
      enquiryNumber: enquiry.enquiryNumber,
      studentId: student.id,
    });

    return { enquiry: await this.findOne(schoolId, id), student };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async load(schoolId: string, id: string): Promise<AdmissionEnquiryRecord> {
    const enquiry = await this.prisma.admissionEnquiry.findFirst({ where: { id, schoolId } });
    if (!enquiry) throw new NotFoundError('Enquiry');
    return enquiry;
  }

  private async assertAcademicYear(schoolId: string, academicYearId: string): Promise<void> {
    const year = await this.prisma.academicYear.count({ where: { id: academicYearId, schoolId } });
    if (year === 0) throw new BadRequestError('The selected academic year does not exist.');
  }

  private async assertAssignee(schoolId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.count({
      where: { id: userId, schoolId, deletedAt: null },
    });
    if (user === 0) throw new BadRequestError('The selected staff member does not exist.');
  }

  private async loadAssignee(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  }

  /** Adds the derived fields every enquiry view needs. */
  private decorate(
    enquiry: AdmissionEnquiryRecord & { academicYear?: { id: string; name: string } | null },
    today: Date,
    attachmentCount: number,
  ) {
    const isOpen = OPEN_STATUSES.includes(enquiry.status);

    return {
      ...enquiry,
      studentName: [enquiry.studentFirstName, enquiry.studentLastName].filter(Boolean).join(' '),
      attachmentCount,
      isOpen,
      isConverted: enquiry.convertedStudentId !== null,
      isFollowUpOverdue: isOpen && enquiry.followUpDate !== null && enquiry.followUpDate < today,
      ageInDays: Math.max(
        0,
        Math.floor((today.getTime() - enquiry.createdAt.getTime()) / 86_400_000),
      ),
    };
  }
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function humaniseStatus(status: AdmissionEnquiryStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

/** Prepends a dated line so the newest note is the first thing read. */
function appendNote(existing: string | null, note: string, status: AdmissionEnquiryStatus): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `[${stamp}] ${humaniseStatus(status)}: ${note}`;
  return existing ? `${line}\n${existing}` : line;
}

function buildGuardianFromEnquiry(enquiry: AdmissionEnquiryRecord) {
  const [firstName, ...rest] = enquiry.parentName.trim().split(/\s+/);
  return {
    firstName: firstName || enquiry.parentName,
    lastName: rest.join(' ') || undefined,
    relation: enquiry.relation,
    phone: enquiry.phone,
    email: enquiry.email ?? undefined,
  };
}
