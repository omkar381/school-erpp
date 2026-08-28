import { Injectable } from '@nestjs/common';
import { AuditAction, EmploymentStatus, Prisma, RoleType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
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
import { UsageService } from '../platform/usage.service';
import type {
  ChangeEmploymentStatusDto,
  CreateStaffDto,
  StaffQueryDto,
  UpdateStaffDto,
} from './dto/staff.dto';

const STAFF_SORT_FIELDS = [
  'firstName',
  'lastName',
  'employeeId',
  'joiningDate',
  'employmentStatus',
  'createdAt',
] as const;

@Injectable()
export class StaffService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    logger: AppLogger,
  ) {
    this.log = logger.child('StaffService');
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: StaffQueryDto) {
    const where: Prisma.StaffWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.employmentStatus ? { employmentStatus: query.employmentStatus } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.designationId ? { designationId: query.designationId } : {}),
      ...(query.isTeacher !== undefined ? { isTeacher: query.isTeacher } : {}),
      ...(query.employmentType ? { employmentType: query.employmentType } : {}),
      ...(query.subjectId
        ? { subjectTeachers: { some: { subjectId: query.subjectId } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { employeeId: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.staff.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(STAFF_SORT_FIELDS, 'firstName'),
        select: {
          id: true,
          employeeId: true,
          firstName: true,
          middleName: true,
          lastName: true,
          photoUrl: true,
          email: true,
          phone: true,
          gender: true,
          joiningDate: true,
          employmentStatus: true,
          employmentType: true,
          isTeacher: true,
          qualification: true,
          department: { select: { id: true, name: true, code: true } },
          designation: { select: { id: true, name: true } },
          user: { select: { id: true, status: true, lastLoginAt: true } },
          _count: { select: { subjectTeachers: true, classTeacherOf: true } },
        },
      }),
      this.prisma.staff.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ _count, ...staff }) => ({
        ...staff,
        fullName: [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(' '),
        subjectCount: _count.subjectTeachers,
        classTeacherCount: _count.classTeacherOf,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const staff = await this.prisma.staff.findFirst({
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
            roles: { select: { role: { select: { id: true, name: true, type: true } } } },
          },
        },
        department: { select: { id: true, name: true, code: true } },
        designation: { select: { id: true, name: true, level: true } },
        classTeacherOf: {
          select: {
            id: true,
            name: true,
            class: { select: { id: true, name: true } },
            _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
          },
        },
        subjectTeachers: {
          include: {
            subject: { select: { id: true, name: true, code: true, colorHex: true } },
            section: {
              select: { id: true, name: true, class: { select: { id: true, name: true } } },
            },
          },
        },
        documents: {
          where: { deletedAt: null },
          select: {
            id: true,
            title: true,
            fileName: true,
            mimeType: true,
            isVerified: true,
            expiryDate: true,
            createdAt: true,
            category: { select: { id: true, name: true } },
          },
        },
        salaryStructures: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: {
            id: true,
            effectiveFrom: true,
            basicSalary: true,
            grossSalary: true,
            netSalary: true,
            currency: true,
          },
        },
      },
    });

    if (!staff) throw new NotFoundError('Staff member');

    const { user, classTeacherOf, ...rest } = staff;

    return {
      ...rest,
      fullName: [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(' '),
      user: user
        ? { ...user, roles: user.roles.map((entry) => entry.role) }
        : null,
      classTeacherOf: classTeacherOf.map(({ _count, ...section }) => ({
        ...section,
        studentCount: _count.enrollments,
      })),
    };
  }

  /** Compact profile for the teacher mobile app. */
  async myProfile(schoolId: string, staffId: string) {
    const staff = await this.findOne(schoolId, staffId);
    const { documents: _documents, salaryStructures: _salary, ...rest } = staff as Record<string, unknown> & {
      documents?: unknown;
      salaryStructures?: unknown;
    };
    return rest;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  async create(schoolId: string, dto: CreateStaffDto) {
    await this.usage.assertWithinLimit(schoolId, 'staff');

    if (dto.employeeId) {
      const taken = await this.prisma.staff.count({
        where: { schoolId, employeeId: dto.employeeId },
      });
      if (taken > 0) {
        throw new ConflictError(
          `Employee ID "${dto.employeeId}" is already in use`,
          ErrorCode.DUPLICATE_EMPLOYEE_ID,
        );
      }
    }

    const roles = await this.prisma.role.findMany({
      where: { id: { in: dto.roleIds }, schoolId },
      select: { id: true, type: true, name: true },
    });
    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestError('One or more roles do not exist in this school');
    }
    if (roles.some((role) => role.type === RoleType.SUPER_ADMIN)) {
      throw new BadRequestError('The Super Administrator role cannot be assigned');
    }

    if (dto.departmentId) {
      const department = await this.prisma.department.count({
        where: { id: dto.departmentId, schoolId },
      });
      if (department === 0) throw new NotFoundError('Department');
    }

    const result = await this.prisma.transaction(async (tx) => {
      const employeeId =
        dto.employeeId ?? (await this.sequences.next(schoolId, 'EMPLOYEE', { padding: 4 }, tx));

      // Staff always get a login: the platform has no way to represent an
      // employee who cannot be assigned work.
      const account = await this.users.createLinkedAccount(tx, {
        schoolId,
        email: dto.email,
        phone: dto.phone,
        firstName: dto.firstName,
        middleName: dto.middleName,
        lastName: dto.lastName,
        roleType: roles[0].type,
        password: dto.password,
      });

      // The helper attaches the first role; add any remaining ones.
      if (roles.length > 1) {
        await tx.userRole.createMany({
          data: roles.slice(1).map((role) => ({ userId: account.userId, roleId: role.id })),
          skipDuplicates: true,
        });
      }

      const staff = await tx.staff.create({
        data: {
          schoolId,
          userId: account.userId,
          employeeId,
          departmentId: dto.departmentId ?? null,
          designationId: dto.designationId ?? null,
          firstName: dto.firstName,
          middleName: dto.middleName ?? null,
          lastName: dto.lastName ?? null,
          dateOfBirth: dto.dateOfBirth ? parseDateOnly(dto.dateOfBirth) : null,
          gender: dto.gender ?? null,
          bloodGroup: dto.bloodGroup ?? 'UNKNOWN',
          photoUrl: dto.photoUrl ?? null,
          email: dto.email ?? null,
          phone: dto.phone,
          alternatePhone: dto.alternatePhone ?? null,
          addressLine1: dto.addressLine1 ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          postalCode: dto.postalCode ?? null,
          qualification: dto.qualification ?? null,
          specialization: dto.specialization ?? null,
          experienceYears: dto.experienceYears ?? 0,
          aadhaarNumber: dto.aadhaarNumber ?? null,
          panNumber: dto.panNumber ?? null,
          joiningDate: parseDateOnly(dto.joiningDate),
          employmentStatus: dto.employmentStatus ?? EmploymentStatus.ACTIVE,
          employmentType: dto.employmentType ?? 'TEACHING',
          isTeacher: dto.isTeacher ?? true,
          bankName: dto.bankName ?? null,
          bankAccountNumber: dto.bankAccountNumber ?? null,
          bankIfsc: dto.bankIfsc ?? null,
          emergencyContactName: dto.emergencyContactName ?? null,
          emergencyContactPhone: dto.emergencyContactPhone ?? null,
        },
        select: { id: true, employeeId: true, firstName: true, lastName: true },
      });

      return { staff, temporaryPassword: account.temporaryPassword };
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'staff',
      entity: 'Staff',
      entityId: result.staff.id,
      description:
        `Added staff member "${[result.staff.firstName, result.staff.lastName].filter(Boolean).join(' ')}" ` +
        `(${result.staff.employeeId})`,
      newValue: { employeeId: result.staff.employeeId, roles: roles.map((role) => role.type) },
      schoolId,
    });

    this.log.info('Staff member created', {
      schoolId,
      staffId: result.staff.id,
      employeeId: result.staff.employeeId,
    });

    return {
      ...(await this.findOne(schoolId, result.staff.id)),
      temporaryPassword: result.temporaryPassword,
    };
  }

  async update(schoolId: string, id: string, dto: UpdateStaffDto) {
    const existing = await this.prisma.staff.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Staff member');

    const { roleIds: _roleIds, password: _password, ...data } = dto;

    const updated = await this.prisma.staff.update({
      where: { id },
      data: {
        ...data,
        dateOfBirth: dto.dateOfBirth ? parseDateOnly(dto.dateOfBirth) : undefined,
        joiningDate: dto.joiningDate ? parseDateOnly(dto.joiningDate) : undefined,
      },
    });

    if (dto.firstName || dto.lastName || dto.email || dto.phone) {
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
      module: 'staff',
      entity: 'Staff',
      entityId: id,
      description: 'Updated staff profile',
      ...this.audit.diff(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      ),
      schoolId,
    });

    return updated;
  }

  async changeEmploymentStatus(schoolId: string, id: string, dto: ChangeEmploymentStatusDto) {
    const staff = await this.prisma.staff.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        employmentStatus: true,
        firstName: true,
        lastName: true,
        _count: { select: { classTeacherOf: true, subjectTeachers: true } },
      },
    });
    if (!staff) throw new NotFoundError('Staff member');

    const departing =
      dto.status === EmploymentStatus.RESIGNED ||
      dto.status === EmploymentStatus.TERMINATED ||
      dto.status === EmploymentStatus.RETIRED;

    // A departing teacher must not remain responsible for a class.
    if (departing && staff._count.classTeacherOf > 0) {
      throw new ConflictError(
        `This teacher is the class teacher for ${staff._count.classTeacherOf} section(s). ` +
          'Assign a replacement before recording their departure.',
      );
    }

    await this.prisma.transaction(async (tx) => {
      await tx.staff.update({
        where: { id },
        data: {
          employmentStatus: dto.status,
          ...(departing
            ? {
                relievingDate: dto.effectiveDate ? parseDateOnly(dto.effectiveDate) : new Date(),
              }
            : {}),
        },
      });

      if (departing) {
        // Free up their teaching assignments and future timetable slots.
        await tx.subjectTeacher.deleteMany({ where: { staffId: id } });
        await tx.timetableSlot.updateMany({
          where: { staffId: id, isActive: true },
          data: { staffId: null },
        });
        await tx.user.update({
          where: { id: staff.userId },
          data: { status: 'INACTIVE' },
        });
        await tx.session.updateMany({
          where: { userId: staff.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: `staff_${dto.status.toLowerCase()}` },
        });
      } else if (dto.status === EmploymentStatus.ACTIVE) {
        await tx.user.update({ where: { id: staff.userId }, data: { status: 'ACTIVE' } });
      }
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'staff',
      entity: 'Staff',
      entityId: id,
      description: `Employment status changed to ${dto.status}${dto.reason ? `: ${dto.reason}` : ''}`,
      oldValue: { employmentStatus: staff.employmentStatus },
      newValue: { employmentStatus: dto.status },
      schoolId,
    });

    return { id, employmentStatus: dto.status };
  }

  async remove(schoolId: string, id: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        employeeId: true,
        _count: { select: { classTeacherOf: true, marksEntered: true, attendanceMarked: true } },
      },
    });
    if (!staff) throw new NotFoundError('Staff member');

    if (staff._count.classTeacherOf > 0) {
      throw new ConflictError(
        'This teacher is still assigned as a class teacher. Reassign those sections first.',
      );
    }

    await this.prisma.transaction(async (tx) => {
      await tx.staff.update({
        where: { id },
        data: { deletedAt: new Date(), employmentStatus: EmploymentStatus.TERMINATED },
      });
      await tx.subjectTeacher.deleteMany({ where: { staffId: id } });
      await tx.timetableSlot.updateMany({ where: { staffId: id }, data: { staffId: null } });
      await tx.user.update({
        where: { id: staff.userId },
        data: { deletedAt: new Date(), status: 'INACTIVE' },
      });
      await tx.session.updateMany({
        where: { userId: staff.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'staff_deleted' },
      });
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'staff',
      entity: 'Staff',
      entityId: id,
      description:
        `Removed staff member "${[staff.firstName, staff.lastName].filter(Boolean).join(' ')}" ` +
        `(${staff.employeeId}); ${staff._count.marksEntered} mark entries retained`,
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  async statistics(schoolId: string) {
    const [total, teachers, byStatus, byDepartment, newThisYear] = await this.prisma.$transaction([
      this.prisma.staff.count({
        where: { schoolId, deletedAt: null, employmentStatus: EmploymentStatus.ACTIVE },
      }),
      this.prisma.staff.count({
        where: {
          schoolId,
          deletedAt: null,
          isTeacher: true,
          employmentStatus: EmploymentStatus.ACTIVE,
        },
      }),
      this.prisma.staff.groupBy({
        by: ['employmentStatus'],
        where: { schoolId, deletedAt: null },
        orderBy: undefined,
        _count: true,
      }),
      this.prisma.staff.groupBy({
        by: ['departmentId'],
        where: { schoolId, deletedAt: null, employmentStatus: EmploymentStatus.ACTIVE },
        orderBy: undefined,
        _count: true,
      }),
      this.prisma.staff.count({
        where: {
          schoolId,
          deletedAt: null,
          joiningDate: { gte: new Date(new Date().getFullYear(), 0, 1) },
        },
      }),
    ]);

    const departments = await this.prisma.department.findMany({
      where: { schoolId },
      select: { id: true, name: true },
    });
    const departmentById = new Map(departments.map((department) => [department.id, department]));

    return {
      totalActive: total,
      teachers,
      nonTeaching: total - teachers,
      newThisYear,
      byStatus: Object.fromEntries(byStatus.map((row) => [row.employmentStatus, row._count])),
      byDepartment: byDepartment.map((row) => ({
        departmentId: row.departmentId,
        name: row.departmentId
          ? (departmentById.get(row.departmentId)?.name ?? 'Unknown')
          : 'Unassigned',
        count: row._count,
      })),
    };
  }

  /** Teachers available for assignment, used by dropdowns across the app. */
  async listTeachers(schoolId: string, subjectId?: string) {
    return this.prisma.staff.findMany({
      where: {
        schoolId,
        deletedAt: null,
        isTeacher: true,
        employmentStatus: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.PROBATION] },
        ...(subjectId ? { subjectTeachers: { some: { subjectId } } } : {}),
      },
      orderBy: { firstName: 'asc' },
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        photoUrl: true,
        phone: true,
        department: { select: { id: true, name: true } },
        designation: { select: { name: true } },
      },
    });
  }
}
