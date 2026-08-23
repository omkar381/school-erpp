import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  LeaveApplicantType,
  LeaveStatus,
  NotificationType,
  Prisma,
  Priority,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { PERMISSIONS } from '../../common/constants/permissions';
import { formatDate, inclusiveDayCount, parseDateOnly } from '../../common/utils/date.util';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CalendarService } from '../academics/services/calendar.service';
import type {
  ApplyLeaveDto,
  CreateLeaveTypeDto,
  LeaveQueryDto,
  ReviewLeaveDto,
} from './dto/leave.dto';

@Injectable()
export class LeaveService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('LeaveService');
  }

  // -------------------------------------------------------------------------
  // Leave types
  // -------------------------------------------------------------------------

  async listTypes(schoolId: string, applicableTo?: LeaveApplicantType) {
    return this.prisma.leaveType.findMany({
      where: { schoolId, isActive: true, ...(applicableTo ? { applicableTo } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async createType(schoolId: string, dto: CreateLeaveTypeDto) {
    const duplicate = await this.prisma.leaveType.count({ where: { schoolId, code: dto.code } });
    if (duplicate > 0) {
      throw new ConflictError(`A leave type with the code "${dto.code}" already exists`);
    }

    const type = await this.prisma.leaveType.create({
      data: {
        schoolId,
        name: dto.name,
        code: dto.code,
        applicableTo: dto.applicableTo,
        annualQuota: dto.annualQuota ?? 0,
        isPaid: dto.isPaid ?? true,
        carryForward: dto.carryForward ?? false,
        maxCarryForward: dto.maxCarryForward ?? 0,
        requiresDocument: dto.requiresDocument ?? false,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'leave',
      entity: 'LeaveType',
      entityId: type.id,
      description: `Created leave type "${type.name}"`,
      schoolId,
    });

    return type;
  }

  // -------------------------------------------------------------------------
  // Applications
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: LeaveQueryDto, user: AuthenticatedUser) {
    const canSeeAll =
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.LEAVE_VIEW_ALL) ||
      user.permissions.includes(PERMISSIONS.LEAVE_APPROVE);

    const where: Prisma.LeaveRequestWhereInput = {
      schoolId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.applicantType ? { applicantType: query.applicantType } : {}),
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.from || query.to
        ? {
            fromDate: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
            },
            ...(query.to ? { toDate: { lte: parseDateOnly(query.to) } } : {}),
          }
        : {}),
      // Without the wider permission a user sees only what concerns them.
      ...(canSeeAll
        ? {}
        : {
            OR: [
              ...(user.staffId ? [{ staffId: user.staffId }] : []),
              ...(user.studentId ? [{ studentId: user.studentId }] : []),
              { submittedById: user.id },
              ...(user.guardianId
                ? [
                    {
                      student: {
                        guardians: { some: { guardianId: user.guardianId } },
                      },
                    } as Prisma.LeaveRequestWhereInput,
                  ]
                : []),
            ],
          }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ status: 'asc' }, { fromDate: 'desc' }],
        include: {
          leaveType: { select: { id: true, name: true, code: true, isPaid: true } },
          staff: {
            select: {
              id: true,
              employeeId: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
              department: { select: { name: true } },
            },
          },
          student: {
            select: {
              id: true,
              admissionNumber: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
              enrollments: {
                where: { status: 'ACTIVE' },
                take: 1,
                select: {
                  class: { select: { name: true } },
                  section: { select: { name: true } },
                },
              },
            },
          },
          attachments: { select: { id: true, fileName: true, mimeType: true, url: true } },
        },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  async findOne(schoolId: string, id: string, user: AuthenticatedUser) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, schoolId },
      include: {
        leaveType: true,
        staff: { select: { id: true, employeeId: true, firstName: true, lastName: true } },
        student: {
          select: { id: true, admissionNumber: true, firstName: true, lastName: true },
        },
        attachments: { select: { id: true, fileName: true, mimeType: true, url: true } },
      },
    });
    if (!request) throw new NotFoundError('Leave request');

    await this.assertCanView(user, request);
    return request;
  }

  /**
   * Submits a leave application.
   *
   * Staff leave is checked against the entitlement balance, and overlapping
   * requests are refused for both staff and students so a single day cannot be
   * claimed twice.
   */
  async apply(schoolId: string, dto: ApplyLeaveDto, user: AuthenticatedUser) {
    const fromDate = parseDateOnly(dto.fromDate);
    const toDate = parseDateOnly(dto.toDate);

    if (toDate < fromDate) {
      throw new BadRequestError('The end date cannot be before the start date');
    }

    const totalDays = dto.isHalfDay ? 0.5 : inclusiveDayCount(fromDate, toDate);

    if (dto.isHalfDay && fromDate.getTime() !== toDate.getTime()) {
      throw new BadRequestError('A half day must start and end on the same date');
    }
    if (totalDays > 180) {
      throw new BadRequestError('A single leave request cannot exceed 180 days');
    }

    const { applicantType, staffId, studentId } = await this.resolveApplicant(
      schoolId,
      dto,
      user,
    );

    // Refuse an overlap with an existing pending or approved request.
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        schoolId,
        status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
        ...(staffId ? { staffId } : { studentId: studentId! }),
        fromDate: { lte: toDate },
        toDate: { gte: fromDate },
      },
      select: { id: true, fromDate: true, toDate: true, status: true },
    });

    if (overlap) {
      throw new ConflictError(
        `This overlaps a ${overlap.status.toLowerCase()} request from ` +
          `${formatDate(overlap.fromDate)} to ${formatDate(overlap.toDate)}`,
        ErrorCode.LEAVE_OVERLAP,
      );
    }

    let leaveType: { id: string; name: string; requiresDocument: boolean; annualQuota: Prisma.Decimal } | null =
      null;

    if (dto.leaveTypeId) {
      leaveType = await this.prisma.leaveType.findFirst({
        where: { id: dto.leaveTypeId, schoolId, isActive: true },
        select: { id: true, name: true, requiresDocument: true, annualQuota: true },
      });
      if (!leaveType) throw new NotFoundError('Leave type');
    }

    // Staff leave draws down an entitlement, so the balance is enforced.
    if (applicantType === LeaveApplicantType.STAFF && staffId && leaveType) {
      await this.assertBalanceAvailable(staffId, leaveType.id, totalDays, fromDate);
    }

    const request = await this.prisma.transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: {
          schoolId,
          applicantType,
          staffId: staffId ?? null,
          studentId: studentId ?? null,
          leaveTypeId: leaveType?.id ?? null,
          submittedById: user.id,
          fromDate,
          toDate,
          isHalfDay: dto.isHalfDay ?? false,
          totalDays,
          reason: dto.reason,
          status: LeaveStatus.PENDING,
        },
        select: { id: true, fromDate: true, toDate: true, totalDays: true },
      });

      // Reserving the days on the balance stops a second request from being
      // approved against days already spoken for.
      if (applicantType === LeaveApplicantType.STAFF && staffId && leaveType) {
        await tx.leaveBalance.updateMany({
          where: { staffId, leaveTypeId: leaveType.id, year: fromDate.getUTCFullYear() },
          data: { pending: { increment: totalDays } },
        });
      }

      return created;
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'leave',
      entity: 'LeaveRequest',
      entityId: request.id,
      description:
        `Applied for ${totalDays} day(s) leave from ${formatDate(fromDate)} to ${formatDate(toDate)}`,
      schoolId,
    });

    void this.notifyApprovers(schoolId, request.id).catch(() => undefined);

    return request;
  }

  /** Approves, rejects or asks for changes to a leave request. */
  async review(schoolId: string, id: string, dto: ReviewLeaveDto, user: AuthenticatedUser) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, schoolId },
      select: {
        id: true,
        status: true,
        applicantType: true,
        staffId: true,
        studentId: true,
        leaveTypeId: true,
        fromDate: true,
        toDate: true,
        totalDays: true,
        submittedById: true,
        staff: { select: { userId: true, firstName: true, lastName: true } },
        student: {
          select: {
            firstName: true,
            lastName: true,
            userId: true,
            guardians: { select: { guardian: { select: { userId: true } } } },
          },
        },
      },
    });
    if (!request) throw new NotFoundError('Leave request');

    if (request.status !== LeaveStatus.PENDING && request.status !== LeaveStatus.CHANGES_REQUESTED) {
      throw new BadRequestError(`This request has already been ${request.status.toLowerCase()}`);
    }

    // Nobody approves their own leave.
    if (request.staff?.userId === user.id && !user.isSuperAdmin) {
      throw new ForbiddenError('You cannot review your own leave request');
    }

    const status = dto.status;

    await this.prisma.transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status,
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewRemarks: dto.remarks ?? null,
        },
      });

      // Move the reserved days into used, or release them.
      if (request.applicantType === LeaveApplicantType.STAFF && request.staffId && request.leaveTypeId) {
        const year = request.fromDate.getUTCFullYear();
        const days = Number(request.totalDays);

        if (status === LeaveStatus.APPROVED) {
          await tx.leaveBalance.updateMany({
            where: { staffId: request.staffId, leaveTypeId: request.leaveTypeId, year },
            data: { pending: { decrement: days }, used: { increment: days } },
          });
        } else if (status === LeaveStatus.REJECTED || status === LeaveStatus.CANCELLED) {
          await tx.leaveBalance.updateMany({
            where: { staffId: request.staffId, leaveTypeId: request.leaveTypeId, year },
            data: { pending: { decrement: days } },
          });
        }
      }
    });

    this.audit.record({
      action: status === LeaveStatus.APPROVED ? AuditAction.APPROVE : AuditAction.REJECT,
      module: 'leave',
      entity: 'LeaveRequest',
      entityId: id,
      description:
        `Leave ${status.toLowerCase()} for ${formatDate(request.fromDate)} to ` +
        `${formatDate(request.toDate)}${dto.remarks ? `: ${dto.remarks}` : ''}`,
      oldValue: { status: request.status },
      newValue: { status },
      schoolId,
    });

    void this.notifyApplicant(schoolId, request, status, dto.remarks).catch(() => undefined);

    return { id, status };
  }

  /** An applicant withdrawing their own pending request. */
  async cancel(schoolId: string, id: string, user: AuthenticatedUser) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, schoolId },
      select: {
        id: true,
        status: true,
        submittedById: true,
        staffId: true,
        studentId: true,
        leaveTypeId: true,
        fromDate: true,
        totalDays: true,
        applicantType: true,
        staff: { select: { userId: true } },
      },
    });
    if (!request) throw new NotFoundError('Leave request');

    const isOwner =
      request.submittedById === user.id ||
      request.staff?.userId === user.id ||
      (user.studentId && request.studentId === user.studentId);

    if (!isOwner && !user.permissions.includes(PERMISSIONS.LEAVE_APPROVE) && !user.isSuperAdmin) {
      throw new ForbiddenError('You can only withdraw your own leave request');
    }

    if (request.status === LeaveStatus.CANCELLED) {
      throw new BadRequestError('This request has already been withdrawn');
    }
    if (request.status === LeaveStatus.APPROVED && request.fromDate < new Date()) {
      throw new BadRequestError('Leave that has already begun cannot be withdrawn');
    }

    await this.prisma.transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id },
        data: { status: LeaveStatus.CANCELLED, cancelledAt: new Date() },
      });

      if (request.applicantType === LeaveApplicantType.STAFF && request.staffId && request.leaveTypeId) {
        const year = request.fromDate.getUTCFullYear();
        const days = Number(request.totalDays);

        await tx.leaveBalance.updateMany({
          where: { staffId: request.staffId, leaveTypeId: request.leaveTypeId, year },
          data:
            request.status === LeaveStatus.APPROVED
              ? { used: { decrement: days } }
              : { pending: { decrement: days } },
        });
      }
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'leave',
      entity: 'LeaveRequest',
      entityId: id,
      description: 'Leave request withdrawn',
      schoolId,
    });

    return { id, status: LeaveStatus.CANCELLED };
  }

  // -------------------------------------------------------------------------
  // Balances
  // -------------------------------------------------------------------------

  async balancesFor(schoolId: string, staffId: string, year?: number) {
    const targetYear = year ?? new Date().getUTCFullYear();

    const types = await this.prisma.leaveType.findMany({
      where: { schoolId, isActive: true, applicableTo: LeaveApplicantType.STAFF },
      orderBy: { name: 'asc' },
    });

    const balances = await this.prisma.leaveBalance.findMany({
      where: { staffId, year: targetYear },
    });
    const byType = new Map(balances.map((balance) => [balance.leaveTypeId, balance]));

    return {
      staffId,
      year: targetYear,
      types: types.map((type) => {
        const balance = byType.get(type.id);
        const allocated = Number(balance?.allocated ?? type.annualQuota);
        const carried = Number(balance?.carriedOver ?? 0);
        const used = Number(balance?.used ?? 0);
        const pending = Number(balance?.pending ?? 0);

        return {
          leaveTypeId: type.id,
          name: type.name,
          code: type.code,
          isPaid: type.isPaid,
          allocated,
          carriedOver: carried,
          used,
          pending,
          available: Number((allocated + carried - used - pending).toFixed(2)),
        };
      }),
    };
  }

  /** Creates the year's balance rows for every staff member. Run annually. */
  async allocateAnnualBalances(schoolId: string, year: number) {
    const [types, staff] = await this.prisma.$transaction([
      this.prisma.leaveType.findMany({
        where: { schoolId, isActive: true, applicableTo: LeaveApplicantType.STAFF },
      }),
      this.prisma.staff.findMany({
        where: { schoolId, deletedAt: null, employmentStatus: { in: ['ACTIVE', 'PROBATION'] } },
        select: { id: true },
      }),
    ]);

    // Carry forward from the previous year, capped by the type's limit.
    const previous = await this.prisma.leaveBalance.findMany({
      where: { year: year - 1, staffId: { in: staff.map((entry) => entry.id) } },
    });
    const previousByKey = new Map(
      previous.map((balance) => [`${balance.staffId}:${balance.leaveTypeId}`, balance]),
    );

    let created = 0;

    for (const member of staff) {
      for (const type of types) {
        const last = previousByKey.get(`${member.id}:${type.id}`);
        let carried = 0;

        if (type.carryForward && last) {
          const unused =
            Number(last.allocated) + Number(last.carriedOver) - Number(last.used);
          carried = Math.max(0, Math.min(unused, Number(type.maxCarryForward)));
        }

        await this.prisma.leaveBalance.upsert({
          where: {
            staffId_leaveTypeId_year: { staffId: member.id, leaveTypeId: type.id, year },
          },
          create: {
            staffId: member.id,
            leaveTypeId: type.id,
            year,
            allocated: type.annualQuota,
            carriedOver: carried,
          },
          update: {},
        });
        created += 1;
      }
    }

    this.log.info('Annual leave balances allocated', { schoolId, year, rows: created });
    return { year, staff: staff.length, types: types.length, rows: created };
  }

  /** Pending requests awaiting the signed-in approver. */
  async pendingApprovals(schoolId: string, user: AuthenticatedUser) {
    if (
      !user.isSuperAdmin &&
      !user.permissions.includes(PERMISSIONS.LEAVE_APPROVE)
    ) {
      return { count: 0, items: [] };
    }

    const items = await this.prisma.leaveRequest.findMany({
      where: { schoolId, status: LeaveStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: {
        leaveType: { select: { name: true, code: true } },
        staff: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNumber: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              take: 1,
              select: { class: { select: { name: true } }, section: { select: { name: true } } },
            },
          },
        },
      },
    });

    return { count: items.length, items };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async resolveApplicant(
    schoolId: string,
    dto: ApplyLeaveDto,
    user: AuthenticatedUser,
  ): Promise<{ applicantType: LeaveApplicantType; staffId?: string; studentId?: string }> {
    // Applying for a student: either the student themselves or their guardian.
    if (dto.studentId) {
      const student = await this.prisma.student.findFirst({
        where: { id: dto.studentId, schoolId, deletedAt: null },
        select: { id: true, userId: true },
      });
      if (!student) throw new NotFoundError('Student');

      const isSelf = user.studentId === student.id;
      const isAdmin =
        user.isSuperAdmin || user.permissions.includes(PERMISSIONS.LEAVE_APPROVE);

      if (!isSelf && !isAdmin) {
        if (!user.guardianId) {
          throw new ForbiddenError('You may not apply for leave on behalf of this student');
        }
        const link = await this.prisma.studentGuardian.count({
          where: { guardianId: user.guardianId, studentId: student.id },
        });
        if (link === 0) {
          throw new ForbiddenError('You may not apply for leave on behalf of this student');
        }
      }

      return { applicantType: LeaveApplicantType.STUDENT, studentId: student.id };
    }

    // Applying for staff: normally oneself.
    const staffId = dto.staffId ?? user.staffId;
    if (!staffId) {
      throw new BadRequestError('The leave applicant could not be determined');
    }

    if (
      staffId !== user.staffId &&
      !user.isSuperAdmin &&
      !user.permissions.includes(PERMISSIONS.LEAVE_APPROVE)
    ) {
      throw new ForbiddenError('You may not apply for leave on behalf of another staff member');
    }

    const staff = await this.prisma.staff.count({
      where: { id: staffId, schoolId, deletedAt: null },
    });
    if (staff === 0) throw new NotFoundError('Staff member');

    return { applicantType: LeaveApplicantType.STAFF, staffId };
  }

  private async assertBalanceAvailable(
    staffId: string,
    leaveTypeId: string,
    days: number,
    fromDate: Date,
  ): Promise<void> {
    const year = fromDate.getUTCFullYear();

    const balance = await this.prisma.leaveBalance.findUnique({
      where: { staffId_leaveTypeId_year: { staffId, leaveTypeId, year } },
    });

    // No allocation row means the entitlement has not been set up; treat it as
    // the type's quota rather than blocking the applicant.
    if (!balance) {
      const type = await this.prisma.leaveType.findUniqueOrThrow({
        where: { id: leaveTypeId },
        select: { annualQuota: true, name: true },
      });
      if (Number(type.annualQuota) > 0 && days > Number(type.annualQuota)) {
        throw new BadRequestError(
          `That exceeds the annual entitlement of ${Number(type.annualQuota)} day(s) for ${type.name}`,
          ErrorCode.LEAVE_BALANCE_EXCEEDED,
        );
      }
      return;
    }

    const available =
      Number(balance.allocated) +
      Number(balance.carriedOver) -
      Number(balance.used) -
      Number(balance.pending);

    if (days > available) {
      throw new BadRequestError(
        `Only ${available} day(s) of this leave type remain available`,
        ErrorCode.LEAVE_BALANCE_EXCEEDED,
        { available, requested: days },
      );
    }
  }

  private async assertCanView(
    user: AuthenticatedUser,
    request: { staffId: string | null; studentId: string | null; submittedById: string | null },
  ): Promise<void> {
    if (
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.LEAVE_VIEW_ALL) ||
      user.permissions.includes(PERMISSIONS.LEAVE_APPROVE)
    ) {
      return;
    }

    if (request.submittedById === user.id) return;
    if (user.staffId && request.staffId === user.staffId) return;
    if (user.studentId && request.studentId === user.studentId) return;

    if (user.guardianId && request.studentId) {
      const link = await this.prisma.studentGuardian.count({
        where: { guardianId: user.guardianId, studentId: request.studentId },
      });
      if (link > 0) return;
    }

    throw new ForbiddenError('You do not have access to this leave request');
  }

  private async notifyApprovers(schoolId: string, requestId: string): Promise<void> {
    const request = await this.prisma.leaveRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        id: true,
        fromDate: true,
        toDate: true,
        totalDays: true,
        applicantType: true,
        staff: { select: { firstName: true, lastName: true } },
        student: { select: { firstName: true, lastName: true } },
      },
    });

    // Anyone holding the approval permission is told there is work waiting.
    const approvers = await this.prisma.user.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: 'ACTIVE',
        roles: {
          some: {
            role: {
              permissions: { some: { permission: { key: PERMISSIONS.LEAVE_APPROVE } } },
            },
          },
        },
      },
      select: { id: true },
      take: 50,
    });

    if (approvers.length === 0) return;

    const applicant =
      request.applicantType === LeaveApplicantType.STAFF
        ? [request.staff?.firstName, request.staff?.lastName].filter(Boolean).join(' ')
        : [request.student?.firstName, request.student?.lastName].filter(Boolean).join(' ');

    await this.notifications.dispatch({
      schoolId,
      userIds: approvers.map((approver) => approver.id),
      type: NotificationType.LEAVE,
      title: 'Leave request awaiting approval',
      body: `${applicant} has applied for ${Number(request.totalDays)} day(s) from ${formatDate(request.fromDate)}.`,
      data: { leaveRequestId: request.id },
      actionUrl: `/leave/${request.id}`,
    });
  }

  private async notifyApplicant(
    schoolId: string,
    request: {
      id: string;
      fromDate: Date;
      toDate: Date;
      staff: { userId: string; firstName: string; lastName: string | null } | null;
      student: {
        userId: string | null;
        firstName: string;
        lastName: string | null;
        guardians: Array<{ guardian: { userId: string | null } }>;
      } | null;
    },
    status: LeaveStatus,
    remarks?: string,
  ): Promise<void> {
    const recipients: string[] = [];

    if (request.staff?.userId) recipients.push(request.staff.userId);
    if (request.student?.userId) recipients.push(request.student.userId);
    for (const link of request.student?.guardians ?? []) {
      if (link.guardian.userId) recipients.push(link.guardian.userId);
    }

    if (recipients.length === 0) return;

    const applicantName =
      [request.staff?.firstName, request.staff?.lastName].filter(Boolean).join(' ') ||
      [request.student?.firstName, request.student?.lastName].filter(Boolean).join(' ');

    await this.notifications.dispatch({
      schoolId,
      userIds: recipients,
      type: NotificationType.LEAVE,
      title: `Leave ${status.toLowerCase()}`,
      body:
        `Leave from ${formatDate(request.fromDate)} to ${formatDate(request.toDate)} ` +
        `has been ${status.toLowerCase()}.`,
      priority: status === LeaveStatus.REJECTED ? Priority.IMPORTANT : Priority.NORMAL,
      data: { leaveRequestId: request.id, status },
      actionUrl: `/leave/${request.id}`,
      email: {
        subject: `Leave request ${status.toLowerCase()}`,
        template: 'leave-status',
        data: {
          applicantName,
          status,
          fromDate: formatDate(request.fromDate),
          toDate: formatDate(request.toDate),
          remarks,
        },
      },
    });
  }
}
