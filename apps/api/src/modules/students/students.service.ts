import { Injectable } from '@nestjs/common';
import {
  AttendanceStatus,
  AuditAction,
  EnrollmentStatus,
  InvoiceStatus,
  Prisma,
  RoleType,
  StudentStatus,
} from '@prisma/client';
import { PrismaService, type TransactionClient } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { SequenceService } from '../../common/services/sequence.service';
import { parseDateOnly } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { AcademicYearService } from '../academics/services/academic-year.service';
import type {
  ChangeStudentStatusDto,
  CreateStudentDto,
  GuardianInputDto,
  LinkGuardianDto,
  PromoteStudentsDto,
  StudentQueryDto,
  TransferStudentDto,
  UpdateStudentDto,
} from './dto/student.dto';

const STUDENT_SORT_FIELDS = [
  'firstName',
  'lastName',
  'admissionNumber',
  'rollNumber',
  'admissionDate',
  'dateOfBirth',
  'status',
  'createdAt',
] as const;

const LIST_SELECT = {
  id: true,
  admissionNumber: true,
  rollNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  photoUrl: true,
  phone: true,
  email: true,
  status: true,
  admissionDate: true,
  createdAt: true,
} satisfies Prisma.StudentSelect;

@Injectable()
export class StudentsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly academicYears: AcademicYearService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('StudentsService');
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: StudentQueryDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, query.academicYearId);

    const where: Prisma.StudentWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.gender ? { gender: query.gender } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.classId || query.sectionId
        ? {
            enrollments: {
              some: {
                academicYearId,
                status: EnrollmentStatus.ACTIVE,
                ...(query.classId ? { classId: query.classId } : {}),
                ...(query.sectionId ? { sectionId: query.sectionId } : {}),
              },
            },
          }
        : {}),
      ...(query.hasDues
        ? {
            invoices: {
              some: {
                status: {
                  in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
                },
                balance: { gt: 0 },
              },
            },
          }
        : {}),
      ...(query.search ? this.searchFilter(query.search) : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(STUDENT_SORT_FIELDS, 'firstName'),
        select: {
          ...LIST_SELECT,
          enrollments: {
            where: { academicYearId },
            take: 1,
            select: {
              rollNumber: true,
              status: true,
              class: { select: { id: true, name: true, level: true } },
              section: { select: { id: true, name: true } },
            },
          },
          guardians: {
            where: { isPrimary: true },
            take: 1,
            select: {
              guardian: {
                select: { id: true, firstName: true, lastName: true, phone: true, relation: true },
              },
            },
          },
        },
      }),
      this.prisma.student.count({ where }),
    ]);

    // Outstanding balance is fetched in one grouped query rather than per row.
    const studentIds = items.map((student) => student.id);
    const dues = await this.outstandingByStudent(schoolId, studentIds);

    return buildPaginatedResult(
      items.map(({ enrollments, guardians, ...student }) => ({
        ...student,
        fullName: [student.firstName, student.middleName, student.lastName]
          .filter(Boolean)
          .join(' '),
        enrollment: enrollments[0] ?? null,
        primaryGuardian: guardians[0]?.guardian ?? null,
        outstandingAmount: dues.get(student.id) ?? 0,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        user: { select: { id: true, email: true, phone: true, status: true, lastLoginAt: true } },
        guardians: {
          orderBy: { isPrimary: 'desc' },
          include: {
            guardian: {
              include: {
                user: { select: { id: true, email: true, status: true, lastLoginAt: true } },
              },
            },
          },
        },
        enrollments: {
          orderBy: { enrolledOn: 'desc' },
          include: {
            academicYear: { select: { id: true, name: true, isCurrent: true } },
            class: { select: { id: true, name: true, level: true } },
            section: {
              select: {
                id: true,
                name: true,
                classTeacher: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        },
        transport: {
          where: { isActive: true },
          take: 1,
          include: {
            route: {
              select: {
                id: true,
                name: true,
                code: true,
                vehicle: { select: { registrationNumber: true } },
                driver: { select: { name: true, phone: true } },
              },
            },
            pickupStop: { select: { id: true, name: true, pickupTime: true, dropTime: true } },
          },
        },
        documents: {
          where: { deletedAt: null },
          select: {
            id: true,
            title: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            isVerified: true,
            expiryDate: true,
            createdAt: true,
            category: { select: { id: true, name: true } },
          },
        },
        discounts: {
          where: { isActive: true },
          include: { discount: { select: { id: true, name: true, type: true, value: true } } },
        },
      },
    });

    if (!student) throw new NotFoundError('Student');

    const currentEnrollment =
      student.enrollments.find((enrollment) => enrollment.academicYear.isCurrent) ?? null;

    const [outstanding, attendance] = await Promise.all([
      this.outstandingFor(schoolId, id),
      currentEnrollment ? this.attendanceSummary(schoolId, id) : null,
    ]);

    const { guardians, ...rest } = student;

    return {
      ...rest,
      fullName: [student.firstName, student.middleName, student.lastName]
        .filter(Boolean)
        .join(' '),
      guardians: guardians.map(({ guardian, ...link }) => ({ ...guardian, ...link })),
      currentEnrollment,
      outstandingAmount: outstanding,
      attendance,
    };
  }

  /** Compact profile used by the mobile apps and the parent portal. */
  async summary(schoolId: string, id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: {
        ...LIST_SELECT,
        bloodGroup: true,
        enrollments: {
          where: { academicYear: { isCurrent: true } },
          take: 1,
          select: {
            rollNumber: true,
            class: { select: { id: true, name: true } },
            section: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!student) throw new NotFoundError('Student');

    const { enrollments, ...rest } = student;
    return {
      ...rest,
      fullName: [student.firstName, student.middleName, student.lastName]
        .filter(Boolean)
        .join(' '),
      enrollment: enrollments[0] ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  /**
   * Admits a student: creates the person, their enrollment, any guardians and
   * the portal logins, all in one transaction. A partially admitted student
   * would break fee generation and attendance, so this is all-or-nothing.
   */
  async create(schoolId: string, dto: CreateStudentDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, classId: dto.classId, schoolId },
      select: {
        id: true,
        name: true,
        capacity: true,
        class: { select: { id: true, name: true } },
        _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
      },
    });

    if (!section) {
      throw new BadRequestError('The selected class and section do not match');
    }
    if (section._count.enrollments >= section.capacity) {
      throw new ConflictError(
        `${section.class.name} ${section.name} is full (${section.capacity} seats).`,
        ErrorCode.SECTION_CAPACITY_EXCEEDED,
      );
    }

    if (dto.admissionNumber) {
      const taken = await this.prisma.student.count({
        where: { schoolId, admissionNumber: dto.admissionNumber },
      });
      if (taken > 0) {
        throw new ConflictError(
          `Admission number "${dto.admissionNumber}" is already in use`,
          ErrorCode.DUPLICATE_ADMISSION_NUMBER,
        );
      }
    }

    const result = await this.prisma.transaction(
      async (tx) => {
        const admissionNumber =
          dto.admissionNumber ??
          (await this.sequences.next(schoolId, 'ADMISSION', { padding: 5 }, tx));

        const student = await tx.student.create({
          data: {
            schoolId,
            admissionNumber,
            rollNumber: dto.rollNumber ?? null,
            firstName: dto.firstName,
            middleName: dto.middleName ?? null,
            lastName: dto.lastName ?? null,
            dateOfBirth: parseDateOnly(dto.dateOfBirth),
            gender: dto.gender,
            bloodGroup: dto.bloodGroup ?? 'UNKNOWN',
            photoUrl: dto.photoUrl ?? null,
            nationality: dto.nationality ?? 'Indian',
            religion: dto.religion ?? null,
            category: dto.category ?? null,
            motherTongue: dto.motherTongue ?? null,
            aadhaarNumber: dto.aadhaarNumber ?? null,
            email: dto.email ?? null,
            phone: dto.phone ?? null,
            addressLine1: dto.addressLine1 ?? null,
            addressLine2: dto.addressLine2 ?? null,
            city: dto.city ?? null,
            state: dto.state ?? null,
            country: dto.country ?? 'India',
            postalCode: dto.postalCode ?? null,
            emergencyContactName: dto.emergencyContactName ?? null,
            emergencyContactPhone: dto.emergencyContactPhone ?? null,
            emergencyRelation: dto.emergencyRelation ?? null,
            medicalConditions: dto.medicalConditions ?? null,
            allergies: dto.allergies ?? null,
            medications: dto.medications ?? null,
            specialNeeds: dto.specialNeeds ?? null,
            previousSchool: dto.previousSchool ?? null,
            previousClass: dto.previousClass ?? null,
            transferCertificateNo: dto.transferCertificateNo ?? null,
            admissionDate: parseDateOnly(dto.admissionDate),
            status: StudentStatus.ACTIVE,
            metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
          },
        });

        await tx.enrollment.create({
          data: {
            schoolId,
            studentId: student.id,
            academicYearId,
            classId: dto.classId,
            sectionId: dto.sectionId,
            rollNumber: dto.rollNumber ?? null,
            status: EnrollmentStatus.ACTIVE,
            enrolledOn: parseDateOnly(dto.admissionDate),
          },
        });

        // The student's own portal login is optional; younger classes usually
        // rely on the parent account only.
        if (dto.createLogin && (dto.email || dto.phone)) {
          const account = await this.users.createLinkedAccount(tx, {
            schoolId,
            email: dto.email,
            phone: dto.phone,
            firstName: dto.firstName,
            middleName: dto.middleName,
            lastName: dto.lastName,
            roleType: RoleType.STUDENT,
          });
          await tx.student.update({
            where: { id: student.id },
            data: { userId: account.userId },
          });
        }

        const guardianLinks = await this.upsertGuardians(
          tx,
          schoolId,
          student.id,
          dto.guardians ?? [],
        );

        return { student, guardianCount: guardianLinks.length };
      },
      { timeout: 30_000 },
    );

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'students',
      entity: 'Student',
      entityId: result.student.id,
      description:
        `Admitted student "${[result.student.firstName, result.student.lastName].filter(Boolean).join(' ')}" ` +
        `(${result.student.admissionNumber})`,
      newValue: {
        admissionNumber: result.student.admissionNumber,
        classId: dto.classId,
        sectionId: dto.sectionId,
      },
      schoolId,
    });

    this.log.info('Student admitted', {
      schoolId,
      studentId: result.student.id,
      admissionNumber: result.student.admissionNumber,
    });

    return this.findOne(schoolId, result.student.id);
  }

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  async update(schoolId: string, id: string, dto: UpdateStudentDto) {
    const existing = await this.prisma.student.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Student');

    const updated = await this.prisma.student.update({
      where: { id },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? parseDateOnly(dto.dateOfBirth) : undefined,
        admissionDate: dto.admissionDate ? parseDateOnly(dto.admissionDate) : undefined,
        metadata: dto.metadata ? (dto.metadata as Prisma.InputJsonValue) : undefined,
      },
    });

    // Keep the linked login in step with the person's name and contacts.
    if (existing.userId && (dto.firstName || dto.lastName || dto.email || dto.phone)) {
      await this.prisma.user.update({
        where: { id: existing.userId },
        data: {
          firstName: dto.firstName ?? undefined,
          middleName: dto.middleName ?? undefined,
          lastName: dto.lastName ?? undefined,
          email: dto.email ?? undefined,
          phone: dto.phone ?? undefined,
        },
      });
    }

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'students',
      entity: 'Student',
      entityId: id,
      description: 'Updated student profile',
      ...this.audit.diff(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      ),
      schoolId,
    });

    return updated;
  }

  async changeStatus(schoolId: string, id: string, dto: ChangeStudentStatusDto) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, status: true, firstName: true, lastName: true, userId: true },
    });
    if (!student) throw new NotFoundError('Student');

    const leaving =
      dto.status === StudentStatus.TRANSFERRED ||
      dto.status === StudentStatus.ALUMNI ||
      dto.status === StudentStatus.DROPPED;

    await this.prisma.transaction(async (tx) => {
      await tx.student.update({
        where: { id },
        data: {
          status: dto.status,
          ...(leaving
            ? {
                leavingDate: dto.effectiveDate ? parseDateOnly(dto.effectiveDate) : new Date(),
                leavingReason: dto.reason ?? null,
              }
            : {}),
        },
      });

      // A student who has left keeps their history but stops occupying a seat.
      if (leaving) {
        await tx.enrollment.updateMany({
          where: { studentId: id, status: EnrollmentStatus.ACTIVE },
          data: {
            status:
              dto.status === StudentStatus.TRANSFERRED
                ? EnrollmentStatus.TRANSFERRED
                : EnrollmentStatus.WITHDRAWN,
            exitedOn: dto.effectiveDate ? parseDateOnly(dto.effectiveDate) : new Date(),
          },
        });
        await tx.studentTransport.updateMany({
          where: { studentId: id, isActive: true },
          data: { isActive: false, endDate: new Date() },
        });
      }

      // Suspended or departed students lose portal access.
      if (student.userId && dto.status !== StudentStatus.ACTIVE) {
        await tx.user.update({
          where: { id: student.userId },
          data: { status: 'INACTIVE' },
        });
        await tx.session.updateMany({
          where: { userId: student.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: `student_${dto.status.toLowerCase()}` },
        });
      } else if (student.userId && dto.status === StudentStatus.ACTIVE) {
        await tx.user.update({ where: { id: student.userId }, data: { status: 'ACTIVE' } });
      }
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'students',
      entity: 'Student',
      entityId: id,
      description: `Status changed to ${dto.status}${dto.reason ? `: ${dto.reason}` : ''}`,
      oldValue: { status: student.status },
      newValue: { status: dto.status },
      schoolId,
    });

    return { id, status: dto.status };
  }

  async transfer(schoolId: string, id: string, dto: TransferStudentDto) {
    const [enrollment, target] = await this.prisma.$transaction([
      this.prisma.enrollment.findFirst({
        where: { studentId: id, schoolId, status: EnrollmentStatus.ACTIVE },
        include: {
          section: { select: { name: true, class: { select: { name: true } } } },
        },
      }),
      this.prisma.section.findFirst({
        where: { id: dto.toSectionId, schoolId },
        select: {
          id: true,
          name: true,
          capacity: true,
          classId: true,
          class: { select: { id: true, name: true } },
          _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
        },
      }),
    ]);

    if (!enrollment) throw new NotFoundError('Active enrollment for this student');
    if (!target) throw new NotFoundError('Target section');

    if (enrollment.sectionId === target.id) {
      throw new BadRequestError('The student is already in this section');
    }
    if (target._count.enrollments >= target.capacity) {
      throw new ConflictError(
        `${target.class.name} ${target.name} is full.`,
        ErrorCode.SECTION_CAPACITY_EXCEEDED,
      );
    }

    const updated = await this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        classId: target.classId,
        sectionId: target.id,
        rollNumber: dto.rollNumber ?? null,
        remarks: dto.reason ?? null,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'students',
      entity: 'Enrollment',
      entityId: enrollment.id,
      description:
        `Moved from ${enrollment.section.class.name} ${enrollment.section.name} ` +
        `to ${target.class.name} ${target.name}`,
      oldValue: { sectionId: enrollment.sectionId, classId: enrollment.classId },
      newValue: { sectionId: target.id, classId: target.classId },
      schoolId,
    });

    return updated;
  }

  /**
   * Bulk promotion into the next academic year.
   *
   * Detained students are enrolled into the same class in the new year rather
   * than being left without an enrollment, so attendance and fees keep working.
   */
  async promote(schoolId: string, dto: PromoteStudentsDto) {
    const [fromSection, toSection, targetYear] = await this.prisma.$transaction([
      this.prisma.section.findFirst({
        where: { id: dto.fromSectionId, schoolId },
        select: { id: true, name: true, classId: true, class: { select: { name: true } } },
      }),
      this.prisma.section.findFirst({
        where: { id: dto.toSectionId, schoolId },
        select: {
          id: true,
          name: true,
          classId: true,
          capacity: true,
          class: { select: { name: true } },
        },
      }),
      this.prisma.academicYear.findFirst({
        where: { id: dto.toAcademicYearId, schoolId },
        select: { id: true, name: true, startDate: true, isLocked: true },
      }),
    ]);

    if (!fromSection) throw new NotFoundError('Source section');
    if (!toSection) throw new NotFoundError('Target section');
    if (!targetYear) throw new NotFoundError('Target academic year');
    if (targetYear.isLocked) {
      throw new BadRequestError(
        'The target academic year is locked',
        ErrorCode.ACADEMIC_YEAR_LOCKED,
      );
    }

    const candidates = await this.prisma.enrollment.findMany({
      where: {
        schoolId,
        sectionId: dto.fromSectionId,
        status: EnrollmentStatus.ACTIVE,
        ...(dto.studentIds?.length ? { studentId: { in: dto.studentIds } } : {}),
        student: { status: StudentStatus.ACTIVE, deletedAt: null },
      },
      select: {
        id: true,
        studentId: true,
        classId: true,
        student: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ student: { firstName: 'asc' } }, { student: { lastName: 'asc' } }],
    });

    if (candidates.length === 0) {
      throw new BadRequestError('No active students found in the source section');
    }

    const detained = new Set(dto.detainedStudentIds ?? []);
    const promoting = candidates.filter((entry) => !detained.has(entry.studentId));

    if (promoting.length > toSection.capacity) {
      throw new ConflictError(
        `${toSection.class.name} ${toSection.name} has ${toSection.capacity} seats but ` +
          `${promoting.length} students would be promoted into it.`,
        ErrorCode.SECTION_CAPACITY_EXCEEDED,
      );
    }

    // A student may already have been promoted by an earlier partial run.
    const alreadyEnrolled = await this.prisma.enrollment.findMany({
      where: {
        academicYearId: dto.toAcademicYearId,
        studentId: { in: candidates.map((entry) => entry.studentId) },
      },
      select: { studentId: true },
    });
    const skip = new Set(alreadyEnrolled.map((entry) => entry.studentId));

    const result = await this.prisma.transaction(
      async (tx) => {
        let promoted = 0;
        let detainedCount = 0;
        let rollNumber = 1;

        for (const entry of candidates) {
          if (skip.has(entry.studentId)) continue;

          const isDetained = detained.has(entry.studentId);

          await tx.enrollment.update({
            where: { id: entry.id },
            data: {
              status: isDetained ? EnrollmentStatus.DETAINED : EnrollmentStatus.PROMOTED,
              exitedOn: targetYear.startDate,
            },
          });

          await tx.enrollment.create({
            data: {
              schoolId,
              studentId: entry.studentId,
              academicYearId: dto.toAcademicYearId,
              classId: isDetained ? fromSection.classId : toSection.classId,
              sectionId: isDetained ? fromSection.id : toSection.id,
              rollNumber:
                dto.regenerateRollNumbers !== false && !isDetained
                  ? String(rollNumber).padStart(2, '0')
                  : null,
              status: EnrollmentStatus.ACTIVE,
              enrolledOn: targetYear.startDate,
              remarks: isDetained ? 'Detained in the same class' : null,
            },
          });

          if (isDetained) detainedCount += 1;
          else {
            promoted += 1;
            rollNumber += 1;
          }
        }

        return { promoted, detained: detainedCount, skipped: skip.size };
      },
      { timeout: 60_000 },
    );

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'students',
      entity: 'Enrollment',
      description:
        `Promoted ${result.promoted} student(s) from ${fromSection.class.name} ${fromSection.name} ` +
        `to ${toSection.class.name} ${toSection.name} for ${targetYear.name}` +
        (result.detained ? `; ${result.detained} detained` : ''),
      newValue: result,
      schoolId,
    });

    this.log.info('Bulk promotion completed', { schoolId, ...result });
    return result;
  }

  async remove(schoolId: string, id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNumber: true,
        userId: true,
        _count: { select: { invoices: true, payments: true, marks: true } },
      },
    });
    if (!student) throw new NotFoundError('Student');

    // Financial and examination history must survive; only the record is hidden.
    await this.prisma.transaction(async (tx) => {
      await tx.student.update({
        where: { id },
        data: { deletedAt: new Date(), status: StudentStatus.INACTIVE },
      });
      await tx.enrollment.updateMany({
        where: { studentId: id, status: EnrollmentStatus.ACTIVE },
        data: { status: EnrollmentStatus.WITHDRAWN, exitedOn: new Date() },
      });
      if (student.userId) {
        await tx.user.update({
          where: { id: student.userId },
          data: { deletedAt: new Date(), status: 'INACTIVE' },
        });
        await tx.session.updateMany({
          where: { userId: student.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'student_deleted' },
        });
      }
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'students',
      entity: 'Student',
      entityId: id,
      description:
        `Removed student "${[student.firstName, student.lastName].filter(Boolean).join(' ')}" ` +
        `(${student.admissionNumber}); ${student._count.invoices} invoice(s) and ` +
        `${student._count.marks} mark(s) retained`,
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Guardians
  // -------------------------------------------------------------------------

  async linkGuardian(schoolId: string, studentId: string, dto: LinkGuardianDto) {
    const [student, guardian] = await this.prisma.$transaction([
      this.prisma.student.count({ where: { id: studentId, schoolId, deletedAt: null } }),
      this.prisma.guardian.count({ where: { id: dto.guardianId, schoolId, deletedAt: null } }),
    ]);

    if (student === 0) throw new NotFoundError('Student');
    if (guardian === 0) throw new NotFoundError('Guardian');

    // Only one guardian can be primary for a student.
    if (dto.isPrimary) {
      await this.prisma.studentGuardian.updateMany({
        where: { studentId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const link = await this.prisma.studentGuardian.upsert({
      where: { studentId_guardianId: { studentId, guardianId: dto.guardianId } },
      create: {
        studentId,
        guardianId: dto.guardianId,
        isPrimary: dto.isPrimary ?? false,
        isPayer: dto.isPayer ?? false,
        canPickup: dto.canPickup ?? true,
      },
      update: {
        isPrimary: dto.isPrimary ?? undefined,
        isPayer: dto.isPayer ?? undefined,
        canPickup: dto.canPickup ?? undefined,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'students',
      entity: 'StudentGuardian',
      entityId: link.id,
      description: 'Linked a guardian to a student',
      schoolId,
    });

    return link;
  }

  async unlinkGuardian(schoolId: string, studentId: string, guardianId: string) {
    const link = await this.prisma.studentGuardian.findFirst({
      where: { studentId, guardianId, student: { schoolId } },
      select: { id: true, isPrimary: true },
    });
    if (!link) throw new NotFoundError('Guardian link');

    const remaining = await this.prisma.studentGuardian.count({ where: { studentId } });
    if (remaining <= 1) {
      throw new BadRequestError(
        'A student must have at least one guardian. Add another before removing this one.',
      );
    }

    await this.prisma.studentGuardian.delete({ where: { id: link.id } });

    // Never leave a student without a primary contact.
    if (link.isPrimary) {
      const next = await this.prisma.studentGuardian.findFirst({
        where: { studentId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) {
        await this.prisma.studentGuardian.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
      }
    }

    return { unlinked: true };
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  async statistics(schoolId: string, academicYearId?: string) {
    const yearId = await this.academicYears.resolveId(schoolId, academicYearId);

    const [total, byStatus, byGender, byClass, newThisMonth] = await this.prisma.$transaction([
      this.prisma.student.count({
        where: { schoolId, deletedAt: null, status: StudentStatus.ACTIVE },
      }),
      this.prisma.student.groupBy({
        by: ['status'],
        where: { schoolId, deletedAt: null },
        orderBy: undefined,
        _count: true,
      }),
      this.prisma.student.groupBy({
        by: ['gender'],
        where: { schoolId, deletedAt: null, status: StudentStatus.ACTIVE },
        orderBy: undefined,
        _count: true,
      }),
      this.prisma.enrollment.groupBy({
        by: ['classId'],
        where: { schoolId, academicYearId: yearId, status: EnrollmentStatus.ACTIVE },
        orderBy: undefined,
        _count: true,
      }),
      this.prisma.student.count({
        where: {
          schoolId,
          deletedAt: null,
          admissionDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
    ]);

    const classes = await this.prisma.class.findMany({
      where: { schoolId, academicYearId: yearId },
      select: { id: true, name: true, level: true },
      orderBy: { level: 'asc' },
    });
    const classById = new Map(classes.map((cls) => [cls.id, cls]));

    return {
      totalActive: total,
      newThisMonth,
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
      byGender: Object.fromEntries(byGender.map((row) => [row.gender, row._count])),
      byClass: byClass
        .map((row) => ({
          classId: row.classId,
          className: classById.get(row.classId)?.name ?? 'Unknown',
          level: classById.get(row.classId)?.level ?? 0,
          count: row._count,
        }))
        .sort((a, b) => a.level - b.level),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Creates or links guardians for a student. A guardian is matched by phone
   * within the school so that siblings share one parent record and therefore
   * one parent login.
   */
  private async upsertGuardians(
    tx: TransactionClient,
    schoolId: string,
    studentId: string,
    guardians: GuardianInputDto[],
  ): Promise<string[]> {
    const linkIds: string[] = [];
    let hasPrimary = false;

    for (const input of guardians) {
      let guardianId = input.guardianId ?? null;

      if (!guardianId && input.phone) {
        const existing = await tx.guardian.findFirst({
          where: { schoolId, phone: input.phone, deletedAt: null },
          select: { id: true },
        });
        guardianId = existing?.id ?? null;
      }

      if (!guardianId) {
        if (!input.firstName || !input.phone) {
          throw new BadRequestError(
            'A new guardian needs at least a first name and a mobile number',
          );
        }

        const guardian = await tx.guardian.create({
          data: {
            schoolId,
            firstName: input.firstName,
            lastName: input.lastName ?? null,
            relation: input.relation,
            email: input.email ?? null,
            phone: input.phone,
            occupation: input.occupation ?? null,
            organization: input.organization ?? null,
            qualification: input.qualification ?? null,
          },
          select: { id: true },
        });
        guardianId = guardian.id;

        if (input.createLogin !== false) {
          const account = await this.users.createLinkedAccount(tx, {
            schoolId,
            email: input.email,
            phone: input.phone,
            firstName: input.firstName,
            lastName: input.lastName,
            roleType: RoleType.PARENT,
          });
          await tx.guardian.update({
            where: { id: guardianId },
            data: { userId: account.userId },
          });
        }
      }

      const isPrimary = (input.isPrimary ?? false) && !hasPrimary;
      if (isPrimary) hasPrimary = true;

      const link = await tx.studentGuardian.create({
        data: {
          studentId,
          guardianId,
          isPrimary,
          isPayer: input.isPayer ?? isPrimary,
          canPickup: input.canPickup ?? true,
        },
        select: { id: true },
      });
      linkIds.push(link.id);
    }

    // If nobody was flagged primary, promote the first guardian.
    if (!hasPrimary && linkIds.length > 0) {
      await tx.studentGuardian.update({
        where: { id: linkIds[0] },
        data: { isPrimary: true, isPayer: true },
      });
    }

    return linkIds;
  }

  private searchFilter(search: string): Prisma.StudentWhereInput {
    return {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { admissionNumber: { contains: search, mode: 'insensitive' } },
        { rollNumber: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        {
          guardians: {
            some: {
              guardian: {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { phone: { contains: search } },
                ],
              },
            },
          },
        },
      ],
    };
  }

  private async outstandingByStudent(
    schoolId: string,
    studentIds: string[],
  ): Promise<Map<string, number>> {
    if (studentIds.length === 0) return new Map();

    const rows = await this.prisma.invoice.groupBy({
      by: ['studentId'],
      where: {
        schoolId,
        studentId: { in: studentIds },
        status: {
          in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
        },
      },
      orderBy: undefined,
      _sum: { balance: true },
    });

    return new Map(rows.map((row) => [row.studentId, Number(row._sum.balance ?? 0)]));
  }

  private async outstandingFor(schoolId: string, studentId: string): Promise<number> {
    const result = await this.prisma.invoice.aggregate({
      where: {
        schoolId,
        studentId,
        status: {
          in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
        },
      },
      _sum: { balance: true },
    });
    return Number(result._sum.balance ?? 0);
  }

  private async attendanceSummary(schoolId: string, studentId: string) {
    const rows = await this.prisma.attendance.groupBy({
      by: ['status'],
      where: { schoolId, studentId, sessionType: 'DAILY' },
      orderBy: undefined,
      _count: true,
    });

    const counts = Object.fromEntries(rows.map((row) => [row.status, row._count])) as Record<
      AttendanceStatus,
      number
    >;
    const present =
      (counts.PRESENT ?? 0) + (counts.LATE ?? 0) + (counts.HALF_DAY ?? 0) * 0.5;
    const total = rows
      .filter((row) => row.status !== AttendanceStatus.HOLIDAY)
      .reduce((sum, row) => sum + row._count, 0);

    return {
      totalDays: total,
      presentDays: present,
      absentDays: counts.ABSENT ?? 0,
      lateDays: counts.LATE ?? 0,
      percentage: total > 0 ? Number(((present / total) * 100).toFixed(2)) : null,
    };
  }
}
