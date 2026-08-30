import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  CertificateType,
  EnrollmentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { SequenceService } from '../../common/services/sequence.service';
import { formatDate, parseDateOnly, todayInZone } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import type {
  BulkIssueCertificateDto,
  CertificateQueryDto,
  CreateTemplateDto,
  IdCardQueryDto,
  IssueCertificateDto,
  IssueIdCardDto,
  RevokeCertificateDto,
  UpdateTemplateDto,
} from './dto/certificates.dto';

/** Placeholders every template can rely on without declaring them. */
const BUILT_IN_VARIABLES = [
  'studentName',
  'admissionNumber',
  'rollNumber',
  'className',
  'sectionName',
  'dateOfBirth',
  'guardianName',
  'academicYear',
  'schoolName',
  'issuedOn',
] as const;

const STUDENT_INCLUDE = Prisma.validator<Prisma.StudentInclude>()({
  enrollments: {
    where: { status: EnrollmentStatus.ACTIVE },
    take: 1,
    orderBy: { createdAt: 'desc' },
    include: {
      class: { select: { name: true } },
      section: { select: { name: true } },
      academicYear: { select: { name: true } },
    },
  },
  guardians: {
    where: { isPrimary: true },
    take: 1,
    include: { guardian: { select: { firstName: true, lastName: true, phone: true } } },
  },
});

@Injectable()
export class CertificatesService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('CertificatesService');
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  /**
   * Lists the templates a school may use.
   *
   * Platform-level templates (schoolId null) are seeded defaults every school
   * inherits; a school's own template of the same type takes precedence in the
   * picker but both are returned so the difference is visible.
   */
  async listTemplates(schoolId: string, type?: CertificateType) {
    const templates = await this.prisma.certificateTemplate.findMany({
      where: {
        OR: [{ schoolId }, { schoolId: null }],
        ...(type ? { type } : {}),
      },
      orderBy: [{ type: 'asc' }, { schoolId: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { certificates: true } } },
    });

    return templates.map(({ _count, ...template }) => ({
      ...template,
      issuedCount: _count.certificates,
      isShared: template.schoolId === null,
      builtInVariables: [...BUILT_IN_VARIABLES],
    }));
  }

  async createTemplate(schoolId: string, dto: CreateTemplateDto) {
    const clash = await this.prisma.certificateTemplate.count({
      where: { schoolId, type: dto.type, name: dto.name },
    });
    if (clash > 0) {
      throw new ConflictError(`A "${dto.name}" template already exists for this certificate type.`);
    }

    const template = await this.prisma.certificateTemplate.create({
      data: {
        schoolId,
        type: dto.type,
        name: dto.name,
        bodyTemplate: dto.bodyTemplate,
        headerHtml: dto.headerHtml ?? null,
        footerHtml: dto.footerHtml ?? null,
        variables: dto.variables ?? extractVariables(dto.bodyTemplate),
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'certificates',
      entity: 'CertificateTemplate',
      entityId: template.id,
      description: `Created certificate template "${template.name}"`,
      schoolId,
    });

    return template;
  }

  async updateTemplate(schoolId: string, id: string, dto: UpdateTemplateDto) {
    const existing = await this.prisma.certificateTemplate.findFirst({
      where: { id, schoolId },
    });
    // A shared template is deliberately not editable from a school: changing it
    // would rewrite the wording for every other school on the platform.
    if (!existing) {
      const shared = await this.prisma.certificateTemplate.count({
        where: { id, schoolId: null },
      });
      if (shared > 0) {
        throw new ConflictError(
          'This is a shared platform template. Copy it into your school before editing.',
        );
      }
      throw new NotFoundError('Certificate template');
    }

    const template = await this.prisma.certificateTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.bodyTemplate !== undefined
          ? {
              bodyTemplate: dto.bodyTemplate,
              variables: dto.variables ?? extractVariables(dto.bodyTemplate),
            }
          : dto.variables !== undefined
            ? { variables: dto.variables }
            : {}),
        ...(dto.headerHtml !== undefined ? { headerHtml: dto.headerHtml } : {}),
        ...(dto.footerHtml !== undefined ? { footerHtml: dto.footerHtml } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'certificates',
      entity: 'CertificateTemplate',
      entityId: id,
      description: `Updated certificate template "${template.name}"`,
      schoolId,
    });

    return template;
  }

  async deleteTemplate(schoolId: string, id: string) {
    const template = await this.prisma.certificateTemplate.findFirst({
      where: { id, schoolId },
      include: { _count: { select: { certificates: true } } },
    });
    if (!template) throw new NotFoundError('Certificate template');

    // Certificates keep a reference so a reprint reproduces the original
    // wording; deleting the template would silently change issued documents.
    if (template._count.certificates > 0) {
      throw new ConflictError(
        `This template has issued ${template._count.certificates} certificate(s). Deactivate it instead of deleting it.`,
      );
    }

    await this.prisma.certificateTemplate.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'certificates',
      entity: 'CertificateTemplate',
      entityId: id,
      description: `Deleted certificate template "${template.name}"`,
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Certificates
  // -------------------------------------------------------------------------

  async statistics(schoolId: string) {
    const today = todayInZone();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [byType, total, thisMonth, revoked, idCards] = await Promise.all([
      this.prisma.certificate.groupBy({
        by: ['type'],
        where: { schoolId, isRevoked: false },
        _count: { _all: true },
      }),
      this.prisma.certificate.count({ where: { schoolId } }),
      this.prisma.certificate.count({ where: { schoolId, createdAt: { gte: monthStart } } }),
      this.prisma.certificate.count({ where: { schoolId, isRevoked: true } }),
      this.prisma.idCard.count({ where: { schoolId, isActive: true } }),
    ]);

    return {
      total,
      issuedThisMonth: thisMonth,
      revoked,
      activeIdCards: idCards,
      byType: byType.map((row) => ({ type: row.type, count: row._count._all })),
    };
  }

  async list(schoolId: string, query: CertificateQueryDto) {
    const where: Prisma.CertificateWhereInput = {
      schoolId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.includeRevoked ? {} : { isRevoked: false }),
      ...(query.from || query.to
        ? {
            issuedOn: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { certificateNumber: { contains: query.search, mode: 'insensitive' } },
              { student: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { student: { lastName: { contains: query.search, mode: 'insensitive' } } },
              { student: { admissionNumber: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.certificate.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(['issuedOn', 'createdAt', 'type'] as const, 'issuedOn'),
        include: {
          template: { select: { id: true, name: true } },
          student: {
            select: { id: true, firstName: true, lastName: true, admissionNumber: true },
          },
        },
      }),
      this.prisma.certificate.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map((certificate) => ({
        ...certificate,
        studentName: certificate.student
          ? [certificate.student.firstName, certificate.student.lastName]
              .filter(Boolean)
              .join(' ')
          : null,
        hasPdf: certificate.pdfStorageKey !== null,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const certificate = await this.prisma.certificate.findFirst({
      where: { id, schoolId },
      include: {
        template: { select: { id: true, name: true, bodyTemplate: true } },
        student: {
          select: { id: true, firstName: true, lastName: true, admissionNumber: true },
        },
      },
    });
    if (!certificate) throw new NotFoundError('Certificate');

    return {
      ...certificate,
      studentName: certificate.student
        ? [certificate.student.firstName, certificate.student.lastName].filter(Boolean).join(' ')
        : null,
      hasPdf: certificate.pdfStorageKey !== null,
    };
  }

  /**
   * Issues one certificate.
   *
   * The placeholder values are resolved here rather than at print time, so a
   * reprint years later still shows the class and section the student was in
   * on the day it was issued.
   */
  async issue(schoolId: string, dto: IssueCertificateDto, userId: string) {
    if (!dto.studentId && !dto.staffId) {
      throw new BadRequestError('A certificate must name either a student or a staff member.');
    }
    if (dto.studentId && dto.staffId) {
      throw new BadRequestError('A certificate names one holder, not both a student and staff.');
    }

    const template = await this.resolveTemplate(schoolId, dto.type, dto.templateId);
    const issuedOn = dto.issuedOn ? parseDateOnly(dto.issuedOn) : todayInZone();
    const autoFilled = await this.autoFill(schoolId, dto.studentId, dto.staffId, issuedOn);

    const certificate = await this.prisma.transaction(async (tx) => {
      const certificateNumber = await this.sequences.next(schoolId, 'CERTIFICATE', {}, tx);

      return tx.certificate.create({
        data: {
          schoolId,
          templateId: template?.id ?? null,
          studentId: dto.studentId ?? null,
          staffId: dto.staffId ?? null,
          type: dto.type,
          certificateNumber,
          data: { ...autoFilled, ...(dto.data ?? {}) } as Prisma.InputJsonValue,
          issuedOn,
          issuedById: userId,
        },
      });
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'certificates',
      entity: 'Certificate',
      entityId: certificate.id,
      description: `Issued ${humaniseType(dto.type)} ${certificate.certificateNumber}`,
      userId,
      schoolId,
    });

    return this.findOne(schoolId, certificate.id);
  }

  /** Issues the same certificate for a list of students in one pass. */
  async bulkIssue(schoolId: string, dto: BulkIssueCertificateDto, userId: string) {
    const uniqueIds = [...new Set(dto.studentIds)];
    if (uniqueIds.length === 0) {
      throw new BadRequestError('Select at least one student.');
    }

    const found = await this.prisma.student.count({
      where: { id: { in: uniqueIds }, schoolId, deletedAt: null },
    });
    if (found !== uniqueIds.length) {
      throw new BadRequestError('One or more of the selected students no longer exist.');
    }

    const template = await this.resolveTemplate(schoolId, dto.type, dto.templateId);
    const issuedOn = dto.issuedOn ? parseDateOnly(dto.issuedOn) : todayInZone();

    const payloads = await Promise.all(
      uniqueIds.map(async (studentId) => ({
        studentId,
        data: {
          ...(await this.autoFill(schoolId, studentId, undefined, issuedOn)),
          ...(dto.data ?? {}),
        },
      })),
    );

    const issued = await this.prisma.transaction(async (tx) => {
      const numbers = await this.sequences.nextBatch(
        schoolId,
        'CERTIFICATE',
        payloads.length,
        {},
        tx,
      );

      await tx.certificate.createMany({
        data: payloads.map((payload, index) => ({
          schoolId,
          templateId: template?.id ?? null,
          studentId: payload.studentId,
          type: dto.type,
          certificateNumber: numbers[index]!,
          data: payload.data as Prisma.InputJsonValue,
          issuedOn,
          issuedById: userId,
        })),
      });

      return numbers;
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'certificates',
      entity: 'Certificate',
      description: `Issued ${issued.length} ${humaniseType(dto.type)} certificates`,
      userId,
      schoolId,
    });

    this.log.info('Certificates issued in bulk', {
      schoolId,
      type: dto.type,
      count: issued.length,
    });

    return { issued: issued.length, certificateNumbers: issued };
  }

  /**
   * Revokes a certificate without deleting it.
   *
   * The row is kept because the number was handed out: a school asked to verify
   * it must be able to say "issued, then revoked on this date" rather than
   * "never issued".
   */
  async revoke(schoolId: string, id: string, dto: RevokeCertificateDto, userId: string) {
    const certificate = await this.prisma.certificate.findFirst({ where: { id, schoolId } });
    if (!certificate) throw new NotFoundError('Certificate');
    if (certificate.isRevoked) {
      throw new ConflictError('This certificate has already been revoked.');
    }

    await this.prisma.certificate.update({
      where: { id },
      data: { isRevoked: true, revokedAt: new Date(), revokeReason: dto.reason },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'certificates',
      entity: 'Certificate',
      entityId: id,
      description: `Revoked certificate ${certificate.certificateNumber}: ${dto.reason}`,
      userId,
      schoolId,
    });

    return this.findOne(schoolId, id);
  }

  // -------------------------------------------------------------------------
  // ID cards
  // -------------------------------------------------------------------------

  async listIdCards(schoolId: string, query: IdCardQueryDto) {
    const where: Prisma.IdCardWhereInput = {
      schoolId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search
        ? {
            OR: [
              { cardNumber: { contains: query.search, mode: 'insensitive' } },
              { student: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { student: { admissionNumber: { contains: query.search, mode: 'insensitive' } } },
              { staff: { employeeId: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.idCard.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(['issuedOn', 'cardNumber', 'validTill'] as const, 'issuedOn'),
        include: {
          student: {
            select: { id: true, firstName: true, lastName: true, admissionNumber: true },
          },
          staff: { select: { id: true, employeeId: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.idCard.count({ where }),
    ]);

    const today = todayInZone();

    return buildPaginatedResult(
      items.map((card) => ({
        ...card,
        holderName: card.student
          ? [card.student.firstName, card.student.lastName].filter(Boolean).join(' ')
          : [card.staff?.firstName, card.staff?.lastName].filter(Boolean).join(' '),
        holderIdentifier: card.student?.admissionNumber ?? card.staff?.employeeId ?? null,
        isExpired: card.validTill !== null && card.validTill < today,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * Issues an ID card.
   *
   * Any card the holder already has is deactivated first, so a reissue after a
   * lost card cannot leave two live cards scanning to the same person.
   */
  async issueIdCard(schoolId: string, dto: IssueIdCardDto, userId: string) {
    if (!dto.studentId && !dto.staffId) {
      throw new BadRequestError('An ID card must name either a student or a staff member.');
    }
    if (dto.studentId && dto.staffId) {
      throw new BadRequestError('An ID card names one holder, not both a student and staff.');
    }

    const holder = await this.assertHolder(schoolId, dto.studentId, dto.staffId);
    const issuedOn = dto.issuedOn ? parseDateOnly(dto.issuedOn) : todayInZone();
    const validTill = dto.validTill
      ? parseDateOnly(dto.validTill)
      : await this.currentYearEnd(schoolId);

    if (validTill && validTill < issuedOn) {
      throw new BadRequestError('The card cannot expire before the day it is issued.');
    }

    const card = await this.prisma.transaction(async (tx) => {
      await tx.idCard.updateMany({
        where: {
          schoolId,
          isActive: true,
          ...(dto.studentId ? { studentId: dto.studentId } : { staffId: dto.staffId }),
        },
        data: { isActive: false },
      });

      const cardNumber = await this.sequences.next(schoolId, 'ID_CARD', {}, tx);

      return tx.idCard.create({
        data: {
          schoolId,
          studentId: dto.studentId ?? null,
          staffId: dto.staffId ?? null,
          cardNumber,
          qrPayload: buildQrPayload(schoolId, cardNumber, holder.identifier),
          issuedOn,
          validTill,
        },
      });
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'certificates',
      entity: 'IdCard',
      entityId: card.id,
      description: `Issued ID card ${card.cardNumber} to ${holder.name}`,
      userId,
      schoolId,
    });

    return card;
  }

  async deactivateIdCard(schoolId: string, id: string, userId: string) {
    const card = await this.prisma.idCard.findFirst({ where: { id, schoolId } });
    if (!card) throw new NotFoundError('ID card');
    if (!card.isActive) throw new ConflictError('This card is already deactivated.');

    await this.prisma.idCard.update({ where: { id }, data: { isActive: false } });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'certificates',
      entity: 'IdCard',
      entityId: id,
      description: `Deactivated ID card ${card.cardNumber}`,
      userId,
      schoolId,
    });

    return { deactivated: true };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Prefers the school's own template, then a shared one, then none. */
  private async resolveTemplate(schoolId: string, type: CertificateType, templateId?: string) {
    if (templateId) {
      const chosen = await this.prisma.certificateTemplate.findFirst({
        where: { id: templateId, OR: [{ schoolId }, { schoolId: null }] },
      });
      if (!chosen) throw new NotFoundError('Certificate template');
      if (!chosen.isActive) {
        throw new ConflictError(`The "${chosen.name}" template is deactivated.`);
      }
      if (chosen.type !== type) {
        throw new BadRequestError(
          `The "${chosen.name}" template is for ${humaniseType(chosen.type)} certificates.`,
        );
      }
      return chosen;
    }

    return this.prisma.certificateTemplate.findFirst({
      where: { type, isActive: true, OR: [{ schoolId }, { schoolId: null }] },
      orderBy: { schoolId: 'desc' },
    });
  }

  private async autoFill(
    schoolId: string,
    studentId: string | undefined,
    staffId: string | undefined,
    issuedOn: Date,
  ): Promise<Record<string, string>> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, timezone: true },
    });

    const base: Record<string, string> = {
      schoolName: school?.name ?? '',
      issuedOn: formatDate(issuedOn),
    };

    if (studentId) {
      const student = await this.prisma.student.findFirst({
        where: { id: studentId, schoolId, deletedAt: null },
        include: STUDENT_INCLUDE,
      });
      if (!student) throw new NotFoundError('Student');

      const enrollment = student.enrollments[0];
      const guardian = student.guardians[0]?.guardian;

      return {
        ...base,
        studentName: [student.firstName, student.middleName, student.lastName]
          .filter(Boolean)
          .join(' '),
        admissionNumber: student.admissionNumber,
        rollNumber: enrollment?.rollNumber ?? student.rollNumber ?? '',
        className: enrollment?.class?.name ?? '',
        sectionName: enrollment?.section?.name ?? '',
        academicYear: enrollment?.academicYear?.name ?? '',
        dateOfBirth: formatDate(student.dateOfBirth),
        guardianName: guardian
          ? [guardian.firstName, guardian.lastName].filter(Boolean).join(' ')
          : '',
      };
    }

    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, schoolId, deletedAt: null },
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    if (!staff) throw new NotFoundError('Staff member');

    return {
      ...base,
      staffName: [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(' '),
      employeeId: staff.employeeId,
      designation: staff.designation?.name ?? '',
      department: staff.department?.name ?? '',
      joinedOn: formatDate(staff.joiningDate),
    };
  }

  private async assertHolder(
    schoolId: string,
    studentId?: string,
    staffId?: string,
  ): Promise<{ name: string; identifier: string }> {
    if (studentId) {
      const student = await this.prisma.student.findFirst({
        where: { id: studentId, schoolId, deletedAt: null },
        select: { firstName: true, lastName: true, admissionNumber: true },
      });
      if (!student) throw new NotFoundError('Student');
      return {
        name: [student.firstName, student.lastName].filter(Boolean).join(' '),
        identifier: student.admissionNumber,
      };
    }

    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, schoolId, deletedAt: null },
      select: { employeeId: true, firstName: true, lastName: true },
    });
    if (!staff) throw new NotFoundError('Staff member');
    return {
      name: [staff.firstName, staff.lastName].filter(Boolean).join(' '),
      identifier: staff.employeeId,
    };
  }

  private async currentYearEnd(schoolId: string): Promise<Date | null> {
    const year = await this.prisma.academicYear.findFirst({
      where: { schoolId, isCurrent: true },
      select: { endDate: true },
    });
    return year?.endDate ?? null;
  }
}

/** Reads `{{placeholder}}` names out of a template body. */
function extractVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

function humaniseType(type: CertificateType): string {
  return type.toLowerCase().replace(/_/g, ' ');
}

/**
 * The string encoded into a card's QR code.
 *
 * Deliberately opaque-ish and free of personal data: scanning a lost card
 * should identify the card, not reveal who the child is or where they live.
 */
function buildQrPayload(schoolId: string, cardNumber: string, identifier: string): string {
  return ['ERP1', schoolId.slice(0, 8), cardNumber, identifier].join('|');
}
