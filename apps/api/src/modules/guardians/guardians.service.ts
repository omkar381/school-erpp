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
import { PrismaService } from '../../database/prisma.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { todayInZone } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import type { CreateGuardianDto, GuardianQueryDto, UpdateGuardianDto } from './dto/guardian.dto';

const GUARDIAN_SORT_FIELDS = ['firstName', 'lastName', 'phone', 'relation', 'createdAt'] as const;

@Injectable()
export class GuardiansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async findAll(schoolId: string, query: GuardianQueryDto) {
    const where: Prisma.GuardianWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.relation ? { relation: query.relation } : {}),
      ...(query.hasLogin !== undefined
        ? query.hasLogin
          ? { userId: { not: null } }
          : { userId: null }
        : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
              {
                students: {
                  some: {
                    student: {
                      OR: [
                        { firstName: { contains: query.search, mode: 'insensitive' } },
                        { admissionNumber: { contains: query.search, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.guardian.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(GUARDIAN_SORT_FIELDS, 'firstName'),
        select: {
          id: true,
          firstName: true,
          lastName: true,
          relation: true,
          email: true,
          phone: true,
          alternatePhone: true,
          occupation: true,
          photoUrl: true,
          city: true,
          createdAt: true,
          user: { select: { id: true, status: true, lastLoginAt: true } },
          students: {
            select: {
              isPrimary: true,
              isPayer: true,
              student: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  admissionNumber: true,
                  photoUrl: true,
                  status: true,
                  enrollments: {
                    where: { academicYear: { isCurrent: true } },
                    take: 1,
                    select: {
                      class: { select: { name: true } },
                      section: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.guardian.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ students, ...guardian }) => ({
        ...guardian,
        fullName: [guardian.firstName, guardian.lastName].filter(Boolean).join(' '),
        hasLogin: Boolean(guardian.user),
        children: students.map(({ student, ...link }) => ({
          ...link,
          id: student.id,
          name: [student.firstName, student.lastName].filter(Boolean).join(' '),
          admissionNumber: student.admissionNumber,
          photoUrl: student.photoUrl,
          status: student.status,
          className: student.enrollments[0]
            ? `${student.enrollments[0].class.name} ${student.enrollments[0].section.name}`
            : null,
        })),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const guardian = await this.prisma.guardian.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            status: true,
            lastLoginAt: true,
            mustChangePassword: true,
          },
        },
        students: {
          include: {
            student: {
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                admissionNumber: true,
                photoUrl: true,
                dateOfBirth: true,
                gender: true,
                status: true,
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
            },
          },
        },
        documents: {
          where: { deletedAt: null },
          select: { id: true, title: true, fileName: true, mimeType: true, createdAt: true },
        },
      },
    });

    if (!guardian) throw new NotFoundError('Guardian');

    const { students, ...rest } = guardian;
    return {
      ...rest,
      fullName: [guardian.firstName, guardian.lastName].filter(Boolean).join(' '),
      children: students.map(({ student, ...link }) => ({ ...student, ...link })),
    };
  }

  async create(schoolId: string, dto: CreateGuardianDto) {
    const duplicate = await this.prisma.guardian.findFirst({
      where: { schoolId, phone: dto.phone, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    if (duplicate) {
      throw new ConflictError(
        `A guardian with this phone number already exists ` +
          `(${[duplicate.firstName, duplicate.lastName].filter(Boolean).join(' ')}). ` +
          'Link that record to the student instead of creating a new one.',
      );
    }

    const guardian = await this.prisma.transaction(async (tx) => {
      const created = await tx.guardian.create({
        data: {
          schoolId,
          firstName: dto.firstName,
          lastName: dto.lastName ?? null,
          relation: dto.relation,
          email: dto.email ?? null,
          phone: dto.phone,
          alternatePhone: dto.alternatePhone ?? null,
          occupation: dto.occupation ?? null,
          organization: dto.organization ?? null,
          annualIncome: dto.annualIncome ?? null,
          qualification: dto.qualification ?? null,
          photoUrl: dto.photoUrl ?? null,
          aadhaarNumber: dto.aadhaarNumber ?? null,
          addressLine1: dto.addressLine1 ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          postalCode: dto.postalCode ?? null,
        },
      });

      if (dto.createLogin !== false) {
        const account = await this.users.createLinkedAccount(tx, {
          schoolId,
          email: dto.email,
          phone: dto.phone,
          firstName: dto.firstName,
          lastName: dto.lastName,
          roleType: RoleType.PARENT,
        });
        await tx.guardian.update({ where: { id: created.id }, data: { userId: account.userId } });
      }

      if (dto.studentIds?.length) {
        const students = await tx.student.findMany({
          where: { id: { in: dto.studentIds }, schoolId, deletedAt: null },
          select: { id: true },
        });
        if (students.length !== dto.studentIds.length) {
          throw new BadRequestError('One or more students do not exist in this school');
        }

        await tx.studentGuardian.createMany({
          data: students.map((student) => ({
            studentId: student.id,
            guardianId: created.id,
            isPrimary: false,
            isPayer: false,
            canPickup: true,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'guardians',
      entity: 'Guardian',
      entityId: guardian.id,
      description: `Created guardian "${[guardian.firstName, guardian.lastName].filter(Boolean).join(' ')}"`,
      schoolId,
    });

    return this.findOne(schoolId, guardian.id);
  }

  async update(schoolId: string, id: string, dto: UpdateGuardianDto) {
    const existing = await this.prisma.guardian.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Guardian');

    if (dto.phone && dto.phone !== existing.phone) {
      const clash = await this.prisma.guardian.count({
        where: { schoolId, phone: dto.phone, deletedAt: null, id: { not: id } },
      });
      if (clash > 0) {
        throw new ConflictError('Another guardian already uses this phone number');
      }
    }

    const { studentIds: _studentIds, createLogin: _createLogin, ...data } = dto;

    const updated = await this.prisma.guardian.update({ where: { id }, data });

    if (existing.userId && (dto.firstName || dto.lastName || dto.email || dto.phone)) {
      await this.prisma.user.update({
        where: { id: existing.userId },
        data: {
          firstName: dto.firstName ?? undefined,
          lastName: dto.lastName ?? undefined,
          email: dto.email ?? undefined,
          phone: dto.phone ?? undefined,
        },
      });
    }

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'guardians',
      entity: 'Guardian',
      entityId: id,
      description: 'Updated guardian details',
      ...this.audit.diff(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      ),
      schoolId,
    });

    return updated;
  }

  async remove(schoolId: string, id: string) {
    const guardian = await this.prisma.guardian.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        userId: true,
        students: { select: { studentId: true, isPrimary: true } },
      },
    });
    if (!guardian) throw new NotFoundError('Guardian');

    // A student must never be left without a guardian on record.
    for (const link of guardian.students) {
      const others = await this.prisma.studentGuardian.count({
        where: { studentId: link.studentId, guardianId: { not: id } },
      });
      if (others === 0) {
        throw new ConflictError(
          'This guardian is the only contact for at least one student. ' +
            'Add another guardian to those students before deleting this record.',
        );
      }
    }

    await this.prisma.transaction(async (tx) => {
      await tx.guardian.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.studentGuardian.deleteMany({ where: { guardianId: id } });

      if (guardian.userId) {
        await tx.user.update({
          where: { id: guardian.userId },
          data: { deletedAt: new Date(), status: 'INACTIVE' },
        });
        await tx.session.updateMany({
          where: { userId: guardian.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'guardian_deleted' },
        });
      }
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'guardians',
      entity: 'Guardian',
      entityId: id,
      description: `Deleted guardian "${[guardian.firstName, guardian.lastName].filter(Boolean).join(' ')}"`,
      schoolId,
    });

    return { deleted: true };
  }

  /** Creates a parent portal login for a guardian who does not yet have one. */
  async createLogin(schoolId: string, id: string) {
    const guardian = await this.prisma.guardian.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, userId: true, firstName: true, lastName: true, email: true, phone: true },
    });
    if (!guardian) throw new NotFoundError('Guardian');

    if (guardian.userId) {
      throw new ConflictError('This guardian already has a portal login');
    }

    const result = await this.prisma.transaction(async (tx) => {
      const account = await this.users.createLinkedAccount(tx, {
        schoolId,
        email: guardian.email,
        phone: guardian.phone,
        firstName: guardian.firstName,
        lastName: guardian.lastName,
        roleType: RoleType.PARENT,
      });
      await tx.guardian.update({ where: { id }, data: { userId: account.userId } });
      return account;
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'guardians',
      entity: 'User',
      entityId: result.userId,
      description: 'Created a parent portal login',
      schoolId,
    });

    return { userId: result.userId, temporaryPassword: result.temporaryPassword };
  }

  // -------------------------------------------------------------------------
  // Parent portal
  // -------------------------------------------------------------------------

  /**
   * The children a signed-in parent may view. Every parent-facing endpoint
   * calls `assertChildAccess` before returning data about a student.
   */
  async myChildren(schoolId: string, guardianId: string) {
    const links = await this.prisma.studentGuardian.findMany({
      where: { guardianId, student: { schoolId, deletedAt: null } },
      orderBy: { isPrimary: 'desc' },
      select: {
        isPrimary: true,
        isPayer: true,
        student: {
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            admissionNumber: true,
            photoUrl: true,
            dateOfBirth: true,
            gender: true,
            bloodGroup: true,
            status: true,
            enrollments: {
              where: { academicYear: { isCurrent: true } },
              take: 1,
              select: {
                rollNumber: true,
                class: { select: { id: true, name: true } },
                section: {
                  select: {
                    id: true,
                    name: true,
                    classTeacher: {
                      select: { id: true, firstName: true, lastName: true, phone: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const studentIds = links.map((link) => link.student.id);
    if (studentIds.length === 0) return [];

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { timezone: true },
    });
    const today = todayInZone(school?.timezone);

    const [attendanceToday, dues] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where: { studentId: { in: studentIds }, date: today, sessionType: 'DAILY' },
        select: { studentId: true, status: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['studentId'],
        where: {
          studentId: { in: studentIds },
          status: {
            in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
          },
        },
        orderBy: undefined,
        _sum: { balance: true },
      }),
    ]);

    const attendanceByStudent = new Map(
      attendanceToday.map((entry) => [entry.studentId, entry.status]),
    );
    const duesByStudent = new Map(
      dues.map((entry) => [entry.studentId, Number(entry._sum?.balance ?? 0)]),
    );

    return links.map(({ student, ...link }) => ({
      ...link,
      id: student.id,
      fullName: [student.firstName, student.middleName, student.lastName]
        .filter(Boolean)
        .join(' '),
      admissionNumber: student.admissionNumber,
      photoUrl: student.photoUrl,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      bloodGroup: student.bloodGroup,
      status: student.status,
      enrollment: student.enrollments[0] ?? null,
      todayAttendance: (attendanceByStudent.get(student.id) ??
        null) as AttendanceStatus | null,
      outstandingAmount: duesByStudent.get(student.id) ?? 0,
    }));
  }

  /**
   * Authorisation gate for the parent portal. Throws unless the guardian is
   * actually linked to the student, so a parent cannot read another family's data
   * by guessing a student id.
   */
  async assertChildAccess(guardianId: string, studentId: string): Promise<void> {
    const link = await this.prisma.studentGuardian.count({
      where: { guardianId, studentId },
    });
    if (link === 0) {
      throw new ForbiddenError('You do not have access to this student');
    }
  }

  /** Student ids a guardian may access, for list endpoints. */
  async accessibleStudentIds(guardianId: string): Promise<string[]> {
    const links = await this.prisma.studentGuardian.findMany({
      where: { guardianId },
      select: { studentId: true },
    });
    return links.map((link) => link.studentId);
  }

  async statistics(schoolId: string) {
    const [total, withLogin, byRelation, activeChildren] = await this.prisma.$transaction([
      this.prisma.guardian.count({ where: { schoolId, deletedAt: null } }),
      this.prisma.guardian.count({ where: { schoolId, deletedAt: null, userId: { not: null } } }),
      this.prisma.guardian.groupBy({
        by: ['relation'],
        where: { schoolId, deletedAt: null },
        orderBy: undefined,
        _count: true,
      }),
      this.prisma.student.count({
        where: { schoolId, deletedAt: null, status: StudentStatus.ACTIVE },
      }),
    ]);

    return {
      total,
      withLogin,
      withoutLogin: total - withLogin,
      activeChildren,
      byRelation: Object.fromEntries(byRelation.map((row) => [row.relation, row._count])),
    };
  }
}

export { EnrollmentStatus, PaginationQueryDto };
