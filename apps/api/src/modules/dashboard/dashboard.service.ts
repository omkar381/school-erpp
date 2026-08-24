import { Injectable } from '@nestjs/common';
import { AttendanceStatus, RoleType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { NotFoundError } from '../../common/exceptions/app.exception';
import { addDays, todayInZone, weekdayOf } from '../../common/utils/date.util';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from '../guardians/guardians.service';

interface SchoolContext {
  schoolId: string;
  academicYearId: string;
  academicYearName: string;
  timezone: string;
  today: Date;
}

/** A headline figure with an optional period-on-period comparison. */
/** Roles whose day is the whole school rather than their own classes. */
const ADMIN_ROLES: RoleType[] = [
  RoleType.SUPER_ADMIN,
  RoleType.SCHOOL_ADMIN,
  RoleType.PRINCIPAL,
  RoleType.VICE_PRINCIPAL,
];

export interface Metric {
  label: string;
  value: number;
  /** Percentage change against the comparison window, when one applies. */
  changePercent?: number;
  format?: 'number' | 'currency' | 'percent';
}

/**
 * Counts subscriptions by plan tier and status, so the platform dashboard can
 * show the mix without a groupBy across a relation.
 */
function summarise(
  subscriptions: Array<{ status: string; plan: { name: string; tier: string } }>,
): Array<{ plan: string; tier: string; status: string; count: number }> {
  const counts = new Map<string, { plan: string; tier: string; status: string; count: number }>();

  for (const subscription of subscriptions) {
    const key = `${subscription.plan.tier}:${subscription.status}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(key, {
      plan: subscription.plan.name,
      tier: subscription.plan.tier,
      status: subscription.status,
      count: 1,
    });
  }

  return [...counts.values()].sort((a, b) => b.count - a.count);
}

@Injectable()
export class DashboardService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly guardians: GuardiansService,
    logger: AppLogger,
  ) {
    this.log = logger.child('DashboardService');
  }

  /**
   * Routes to the dashboard that matches what the caller actually does.
   *
   * A teacher's morning question ("which classes am I teaching, whose
   * attendance have I not marked?") has nothing in common with an
   * administrator's, so they get different queries rather than one payload
   * filtered down in the client.
   */
  async forUser(schoolId: string | null, user: AuthenticatedUser) {
    if (user.isSuperAdmin && !schoolId) {
      return { audience: 'PLATFORM' as const, ...(await this.platform()) };
    }

    if (!schoolId) throw new NotFoundError('School');
    const context = await this.context(schoolId);

    // Role, not permission, decides which dashboard fits: a teacher holds
    // students.view too, so permissions cannot tell the two apart.
    if (user.roles.some((role) => ADMIN_ROLES.includes(role))) {
      return { audience: 'ADMIN' as const, ...(await this.admin(context)) };
    }

    if (user.staffId && user.roles.includes(RoleType.TEACHER)) {
      return { audience: 'TEACHER' as const, ...(await this.teacher(context, user.staffId)) };
    }

    if (user.guardianId) {
      return { audience: 'PARENT' as const, ...(await this.parent(context, user.guardianId)) };
    }

    if (user.studentId) {
      return { audience: 'STUDENT' as const, ...(await this.student(context, user.studentId)) };
    }

    // Any other staff member — librarian, accountant, transport manager — sees
    // the school view, scoped by what their permissions already allow.
    return { audience: 'ADMIN' as const, ...(await this.admin(context)) };
  }

  // -------------------------------------------------------------------------
  // School administration
  // -------------------------------------------------------------------------

  private async admin(context: SchoolContext) {
    const { schoolId, academicYearId, today } = context;
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const tomorrow = addDays(today, 1);

    const [
      students,
      staff,
      attendanceToday,
      collectionToday,
      collectionMonth,
      outstanding,
      upcomingExams,
      openLeave,
      unreadNotices,
      pendingTickets,
    ] = await Promise.all([
      this.prisma.enrollment.count({ where: { academicYearId, status: 'ACTIVE' } }),
      this.prisma.staff.count({ where: { schoolId, employmentStatus: 'ACTIVE' } }),
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: { schoolId, date: { gte: today, lt: tomorrow } },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: { schoolId, status: 'SUCCESS', paidAt: { gte: today, lt: tomorrow } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: { schoolId, status: 'SUCCESS', paidAt: { gte: monthStart, lt: tomorrow } },
        _sum: { amount: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          schoolId,
          academicYearId,
          status: { notIn: ['CANCELLED', 'VOID', 'PAID'] },
        },
        _sum: { balance: true },
        _count: { _all: true },
      }),
      this.prisma.exam.findMany({
        where: { schoolId, academicYearId, startDate: { gte: today } },
        orderBy: { startDate: 'asc' },
        take: 5,
        select: { id: true, name: true, type: true, startDate: true, endDate: true },
      }),
      this.prisma.leaveRequest.count({ where: { schoolId, status: 'PENDING' } }),
      this.prisma.notice.count({
        where: { schoolId, status: 'PUBLISHED', publishAt: { gte: addDays(today, -7) } },
      }),
      this.prisma.supportTicket.count({
        where: { schoolId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
    ]);

    const marked = attendanceToday.reduce((sum, row) => sum + row._count._all, 0);
    const present = attendanceToday
      .filter(
        (row) =>
          row.status === AttendanceStatus.PRESENT || row.status === AttendanceStatus.LATE,
      )
      .reduce((sum, row) => sum + row._count._all, 0);

    const metrics: Metric[] = [
      { label: 'Students', value: students, format: 'number' },
      { label: 'Staff', value: staff, format: 'number' },
      {
        label: "Today's attendance",
        value: marked > 0 ? Number(((present / marked) * 100).toFixed(1)) : 0,
        format: 'percent',
      },
      {
        label: "Today's collection",
        value: Number(collectionToday._sum.amount ?? 0),
        format: 'currency',
      },
      {
        label: 'Collected this month',
        value: Number(collectionMonth._sum.amount ?? 0),
        format: 'currency',
      },
      {
        label: 'Outstanding',
        value: Number(outstanding._sum.balance ?? 0),
        format: 'currency',
      },
    ];

    const [enrolmentTrend, collectionTrend, attendanceTrend, classStrength] = await Promise.all([
      this.enrolmentTrend(schoolId),
      this.collectionTrend(schoolId, today),
      this.attendanceTrend(schoolId, today),
      this.classStrength(academicYearId),
    ]);

    return {
      academicYear: context.academicYearName,
      metrics,
      attendanceToday: {
        marked,
        present,
        absent:
          attendanceToday.find((row) => row.status === AttendanceStatus.ABSENT)?._count._all ?? 0,
        late: attendanceToday.find((row) => row.status === AttendanceStatus.LATE)?._count._all ?? 0,
        // Nothing marked yet is a different state from everyone being absent.
        notMarked: marked === 0,
      },
      finance: {
        receiptsToday: collectionToday._count._all,
        outstandingInvoices: outstanding._count._all,
      },
      actionQueue: {
        pendingLeave: openLeave,
        openTickets: pendingTickets,
        noticesThisWeek: unreadNotices,
      },
      upcomingExams,
      charts: { enrolmentTrend, collectionTrend, attendanceTrend, classStrength },
    };
  }

  // -------------------------------------------------------------------------
  // Teacher
  // -------------------------------------------------------------------------

  private async teacher(context: SchoolContext, staffId: string) {
    const { schoolId, academicYearId, today } = context;
    const weekday = weekdayOf(today);
    const tomorrow = addDays(today, 1);

    // Read receipts are keyed by user, not by staff record.
    const staff = await this.prisma.staff.findUniqueOrThrow({
      where: { id: staffId },
      select: { userId: true },
    });

    const [periods, classes, homework, submissionsToReview, pendingMarks, unreadMessages] =
      await Promise.all([
        this.prisma.timetableSlot.findMany({
          where: { schoolId, academicYearId, staffId, dayOfWeek: weekday, isActive: true },
          orderBy: { period: { startTime: 'asc' } },
          select: {
            id: true,
            class: { select: { name: true } },
            section: { select: { id: true, name: true } },
            subject: { select: { name: true } },
            room: { select: { name: true } },
            period: { select: { name: true, startTime: true, endTime: true } },
          },
        }),
        this.prisma.section.findMany({
          where: {
            schoolId,
            class: { academicYearId },
            OR: [{ classTeacherId: staffId }, { timetableSlots: { some: { staffId } } }],
          },
          select: {
            id: true,
            name: true,
            class: { select: { id: true, name: true, level: true } },
            _count: {
              select: { enrollments: { where: { academicYearId, status: 'ACTIVE' } } },
            },
          },
        }),
        this.prisma.homework.count({
          where: { schoolId, staffId, dueDate: { gte: today }, deletedAt: null },
        }),
        this.prisma.homeworkSubmission.count({
          where: {
            homework: { schoolId, staffId },
            status: { in: ['SUBMITTED', 'LATE'] },
          },
        }),
        this.prisma.mark.count({
          where: {
            exam: { schoolId, academicYearId },
            status: 'PENDING',
            subject: { subjectTeachers: { some: { staffId } } },
          },
        }),
        this.prisma.message.count({
          where: {
            deletedAt: null,
            senderId: { not: staff.userId },
            conversation: { members: { some: { userId: staff.userId } } },
            receipts: { none: { userId: staff.userId, readAt: { not: null } } },
          },
        }),
      ]);

    // Which of today's classes still need attendance marked.
    const sectionIds = periods.map((entry) => entry.section?.id).filter(Boolean) as string[];
    const marked = await this.prisma.attendance.groupBy({
      by: ['sectionId'],
      where: { schoolId, date: { gte: today, lt: tomorrow }, sectionId: { in: sectionIds } },
      _count: { _all: true },
    });
    const markedSections = new Set(marked.map((row) => row.sectionId));

    return {
      academicYear: context.academicYearName,
      metrics: [
        { label: "Today's periods", value: periods.length, format: 'number' },
        { label: 'Classes', value: classes.length, format: 'number' },
        { label: 'Submissions to review', value: submissionsToReview, format: 'number' },
        { label: 'Marks pending', value: pendingMarks, format: 'number' },
      ] satisfies Metric[],
      todaySchedule: periods.map((entry) => ({
        id: entry.id,
        period: entry.period?.name ?? '',
        startTime: entry.period?.startTime ?? '',
        endTime: entry.period?.endTime ?? '',
        className: entry.class?.name ?? '',
        sectionId: entry.section?.id ?? null,
        sectionName: entry.section?.name ?? '',
        subject: entry.subject?.name ?? '',
        room: entry.room?.name ?? null,
        attendanceMarked: entry.section ? markedSections.has(entry.section.id) : false,
      })),
      classes: classes.map((section) => ({
        sectionId: section.id,
        className: section.class?.name ?? '',
        sectionName: section.name,
        students: section._count.enrollments,
      })),
      actionQueue: {
        attendanceOutstanding: periods.filter(
          (entry) => entry.section && !markedSections.has(entry.section.id),
        ).length,
        submissionsToReview,
        marksPending: pendingMarks,
        unreadMessages,
      },
      homeworkDue: homework,
    };
  }

  // -------------------------------------------------------------------------
  // Parent
  // -------------------------------------------------------------------------

  /**
   * A parent's dashboard answers four questions at a glance: is my child in
   * school, is homework pending, is anything owed, and what is coming up.
   */
  private async parent(context: SchoolContext, guardianId: string) {
    const children = await this.guardians.accessibleStudentIds(guardianId);
    if (children.length === 0) {
      return { academicYear: context.academicYearName, children: [], notices: [] };
    }

    const summaries = await Promise.all(
      children.map((studentId: string) => this.childSummary(context, studentId)),
    );

    const notices = await this.recentNotices(context, ['ALL', 'PARENTS']);

    return {
      academicYear: context.academicYearName,
      children: summaries,
      notices,
    };
  }

  private async student(context: SchoolContext, studentId: string) {
    const summary = await this.childSummary(context, studentId);
    const notices = await this.recentNotices(context, ['ALL', 'STUDENTS']);
    return { academicYear: context.academicYearName, child: summary, notices };
  }

  private async childSummary(context: SchoolContext, studentId: string) {
    const { schoolId, academicYearId, today } = context;
    const tomorrow = addDays(today, 1);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    const [student, todayAttendance, monthAttendance, dues, homework, nextExam, transport] =
      await Promise.all([
        this.prisma.student.findFirst({
          where: { id: studentId, schoolId, deletedAt: null },
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            photoUrl: true,
            enrollments: {
              where: { academicYearId, status: 'ACTIVE' },
              take: 1,
              select: {
                class: { select: { name: true } },
                section: { select: { id: true, name: true } },
              },
            },
          },
        }),
        this.prisma.attendance.findFirst({
          where: { studentId, date: { gte: today, lt: tomorrow } },
          select: { status: true, remarks: true },
        }),
        this.prisma.attendance.groupBy({
          by: ['status'],
          where: { studentId, date: { gte: monthStart, lt: tomorrow } },
          _count: { _all: true },
        }),
        this.prisma.invoice.aggregate({
          where: {
            studentId,
            academicYearId,
            status: { notIn: ['CANCELLED', 'VOID', 'PAID'] },
          },
          _sum: { balance: true },
          _count: { _all: true },
        }),
        this.prisma.homework.findMany({
          where: {
            schoolId,
            dueDate: { gte: today },
            section: { enrollments: { some: { studentId, academicYearId, status: 'ACTIVE' } } },
          },
          orderBy: { dueDate: 'asc' },
          take: 5,
          select: {
            id: true,
            title: true,
            dueDate: true,
            subject: { select: { name: true } },
            submissions: { where: { studentId }, take: 1, select: { status: true } },
          },
        }),
        this.prisma.examSchedule.findFirst({
          where: {
            date: { gte: today },
            exam: { schoolId, academicYearId },
          },
          orderBy: { date: 'asc' },
          select: {
            date: true,
            startTime: true,
            examSubject: {
              select: {
                subject: { select: { name: true } },
                exam: { select: { name: true } },
              },
            },
          },
        }),
        this.prisma.studentTransport.findFirst({
          where: { studentId, academicYearId, isActive: true },
          select: {
            route: {
              select: { name: true, vehicle: { select: { registrationNumber: true } } },
            },
            pickupStop: { select: { name: true, pickupTime: true } },
          },
        }),
      ]);

    if (!student) throw new NotFoundError('Student');

    const enrollment = student.enrollments[0];
    const markedDays = monthAttendance.reduce((sum, row) => sum + row._count._all, 0);
    const presentDays = monthAttendance
      .filter(
        (row) =>
          row.status === AttendanceStatus.PRESENT || row.status === AttendanceStatus.LATE,
      )
      .reduce((sum, row) => sum + row._count._all, 0);

    return {
      studentId: student.id,
      name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '),
      admissionNumber: student.admissionNumber,
      photoUrl: student.photoUrl,
      className: enrollment?.class?.name ?? '—',
      sectionName: enrollment?.section?.name ?? '—',
      attendance: {
        // null rather than a status when the register has not been taken yet.
        today: todayAttendance?.status ?? null,
        monthPercent:
          markedDays > 0 ? Number(((presentDays / markedDays) * 100).toFixed(1)) : null,
        monthMarkedDays: markedDays,
      },
      fees: {
        outstanding: Number(dues._sum.balance ?? 0),
        unpaidInvoices: dues._count._all,
      },
      homework: homework.map((item) => ({
        id: item.id,
        title: item.title,
        subject: item.subject?.name ?? '',
        dueDate: item.dueDate,
        submitted: item.submissions.length > 0,
        status: item.submissions[0]?.status ?? 'PENDING',
      })),
      nextExam: nextExam
        ? {
            name: nextExam.examSubject.exam.name,
            subject: nextExam.examSubject.subject?.name ?? '',
            date: nextExam.date,
            startTime: nextExam.startTime,
          }
        : null,
      transport: transport
        ? {
            route: transport.route.name,
            bus: transport.route.vehicle?.registrationNumber ?? null,
            stop: transport.pickupStop?.name ?? null,
            pickupTime: transport.pickupStop?.pickupTime ?? null,
          }
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Platform
  // -------------------------------------------------------------------------

  private async platform() {
    const [schools, active, students, staff, subscriptions, recentSchools] = await Promise.all([
      this.prisma.school.count(),
      this.prisma.school.count({ where: { status: 'ACTIVE' } }),
      this.prisma.student.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.staff.count({ where: { employmentStatus: 'ACTIVE' } }),
      this.prisma.subscription.findMany({
        select: { status: true, plan: { select: { name: true, tier: true } } },
      }),
      this.prisma.school.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, code: true, status: true, createdAt: true },
      }),
    ]);

    return {
      metrics: [
        { label: 'Schools', value: schools, format: 'number' },
        { label: 'Active schools', value: active, format: 'number' },
        { label: 'Students', value: students, format: 'number' },
        { label: 'Staff', value: staff, format: 'number' },
      ] satisfies Metric[],
      subscriptions: summarise(subscriptions),
      recentSchools,
    };
  }

  // -------------------------------------------------------------------------
  // Charts
  // -------------------------------------------------------------------------

  /** Active enrolment at the close of each of the last six academic years. */
  private async enrolmentTrend(schoolId: string) {
    const years = await this.prisma.academicYear.findMany({
      where: { schoolId },
      orderBy: { startDate: 'desc' },
      take: 6,
      select: {
        id: true,
        name: true,
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    });

    return years
      .reverse()
      .map((year) => ({ label: year.name, value: year._count.enrollments }));
  }

  /** Collection per month over the last twelve months. */
  private async collectionTrend(schoolId: string, today: Date) {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));

    const rows = await this.prisma.$queryRaw<Array<{ month: Date; total: string }>>`
      SELECT date_trunc('month', "paidAt") AS month, SUM(amount) AS total
      FROM payments
      WHERE "schoolId" = ${schoolId}::uuid
        AND status = 'SUCCESS'
        AND "paidAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;

    return rows.map((row) => ({
      label: new Date(row.month).toISOString().slice(0, 7),
      value: Number(row.total),
    }));
  }

  /** Daily attendance percentage over the last thirty days. */
  private async attendanceTrend(schoolId: string, today: Date) {
    const from = addDays(today, -29);

    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; present: bigint; total: bigint }>
    >`
      SELECT date AS day,
             COUNT(*) FILTER (WHERE status IN ('PRESENT','LATE')) AS present,
             COUNT(*) AS total
      FROM attendances
      WHERE "schoolId" = ${schoolId}::uuid AND date >= ${from} AND date <= ${today}
      GROUP BY date
      ORDER BY date
    `;

    return rows.map((row) => ({
      label: new Date(row.day).toISOString().slice(0, 10),
      value:
        Number(row.total) > 0
          ? Number(((Number(row.present) / Number(row.total)) * 100).toFixed(1))
          : 0,
    }));
  }

  /** Head count per class, for the strength chart. */
  private async classStrength(academicYearId: string) {
    const rows = await this.prisma.enrollment.groupBy({
      by: ['classId'],
      where: { academicYearId, status: 'ACTIVE' },
      _count: { _all: true },
    });

    const classes = await this.prisma.class.findMany({
      where: { id: { in: rows.map((row) => row.classId) } },
      select: { id: true, name: true, level: true },
    });

    const byId = new Map(classes.map((klass) => [klass.id, klass]));

    return rows
      .map((row) => ({
        label: byId.get(row.classId)?.name ?? '—',
        value: row._count._all,
        level: byId.get(row.classId)?.level ?? 0,
      }))
      .sort((a, b) => a.level - b.level)
      .map(({ label, value }) => ({ label, value }));
  }

  // -------------------------------------------------------------------------

  private async recentNotices(context: SchoolContext, audiences: string[]) {
    return this.prisma.notice.findMany({
      where: {
        schoolId: context.schoolId,
        status: 'PUBLISHED',
        audience: { in: audiences as never[] },
        OR: [{ expiresAt: null }, { expiresAt: { gte: context.today } }],
      },
      orderBy: [{ isPinned: 'desc' }, { publishAt: 'desc' }],
      take: 5,
      select: {
        id: true,
        title: true,
        priority: true,
        isPinned: true,
        publishAt: true,
      },
    });
  }

  private async context(schoolId: string): Promise<SchoolContext> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        timezone: true,
        academicYears: {
          where: { isCurrent: true },
          take: 1,
          select: { id: true, name: true },
        },
      },
    });

    if (!school) throw new NotFoundError('School');

    const year = school.academicYears[0];
    if (!year) throw new NotFoundError('Current academic year');

    return {
      schoolId,
      academicYearId: year.id,
      academicYearName: year.name,
      timezone: school.timezone,
      today: todayInZone(school.timezone),
    };
  }
}
