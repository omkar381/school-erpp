import { Injectable } from '@nestjs/common';
import {
  AttendanceSessionType,
  AttendanceStatus,
  AuditAction,
  EnrollmentStatus,
  NotificationType,
  Prisma,
  Priority,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { PERMISSIONS } from '../../common/constants/permissions';
import { formatDate, parseDateOnly, todayInZone } from '../../common/utils/date.util';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CalendarService } from '../academics/services/calendar.service';
import type {
  AttendanceQueryDto,
  AttendanceReportQueryDto,
  MarkAttendanceDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

interface AttendanceSettings {
  editWindowDays: number;
  notifyParentsOnAbsence: boolean;
  minimumAttendancePercent: number;
  allowFutureMarking: boolean;
}

const DEFAULT_SETTINGS: AttendanceSettings = {
  editWindowDays: 7,
  notifyParentsOnAbsence: true,
  minimumAttendancePercent: 75,
  allowFutureMarking: false,
};

/** Statuses that count towards "present" when computing a percentage. */
const PRESENT_WEIGHTS: Partial<Record<AttendanceStatus, number>> = {
  PRESENT: 1,
  LATE: 1,
  HALF_DAY: 0.5,
  EXCUSED: 1,
};

@Injectable()
export class AttendanceService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('AttendanceService');
  }

  // -------------------------------------------------------------------------
  // Marking
  // -------------------------------------------------------------------------

  /**
   * Records attendance for a whole section in one transaction.
   *
   * Re-marking the same day is an update rather than a duplicate, and every
   * change to an existing record is written to the audit trail with its previous
   * value, so a disputed absence can always be traced.
   */
  async mark(schoolId: string, dto: MarkAttendanceDto, user: AuthenticatedUser) {
    const date = parseDateOnly(dto.date);
    const settings = await this.getSettings(schoolId);
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true, name: true },
    });

    if (!settings.allowFutureMarking && date.getTime() > todayInZone(school.timezone).getTime()) {
      throw new BadRequestError(
        'Attendance cannot be marked for a future date',
        ErrorCode.ATTENDANCE_FUTURE_DATE,
      );
    }

    const workingDay = await this.calendar.isWorkingDay(schoolId, date);
    if (!workingDay.isWorkingDay) {
      throw new BadRequestError(
        workingDay.reason === 'HOLIDAY'
          ? `${formatDate(date)} is a holiday (${workingDay.holidayName}). Attendance cannot be marked.`
          : `${formatDate(date)} is not a working day. Attendance cannot be marked.`,
        ErrorCode.HOLIDAY_NO_ATTENDANCE,
      );
    }

    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, schoolId },
      select: {
        id: true,
        name: true,
        classId: true,
        classTeacherId: true,
        class: { select: { id: true, name: true } },
      },
    });
    if (!section) throw new NotFoundError('Section');

    await this.assertCanMarkSection(user, section, dto.subjectId);

    // Every student in the payload must actually be enrolled in this section.
    const enrolled = await this.prisma.enrollment.findMany({
      where: {
        sectionId: dto.sectionId,
        status: EnrollmentStatus.ACTIVE,
        studentId: { in: dto.records.map((record) => record.studentId) },
      },
      select: { studentId: true },
    });
    const enrolledIds = new Set(enrolled.map((entry) => entry.studentId));
    const strangers = dto.records.filter((record) => !enrolledIds.has(record.studentId));

    if (strangers.length > 0) {
      throw new BadRequestError(
        `${strangers.length} student(s) in this list are not enrolled in ${section.class.name} ${section.name}`,
      );
    }

    const sessionType = dto.sessionType ?? AttendanceSessionType.DAILY;
    const subjectId = sessionType === AttendanceSessionType.DAILY ? null : (dto.subjectId ?? null);

    if (sessionType === AttendanceSessionType.SUBJECT && !subjectId) {
      throw new BadRequestError('A subject is required for subject-wise attendance');
    }

    const existing = await this.prisma.attendance.findMany({
      where: {
        sectionId: dto.sectionId,
        date,
        sessionType,
        subjectId,
        studentId: { in: dto.records.map((record) => record.studentId) },
      },
      select: { id: true, studentId: true, status: true, remarks: true },
    });
    const existingByStudent = new Map(existing.map((entry) => [entry.studentId, entry]));

    // Once the correction window has passed, changing a record needs the
    // dedicated edit permission rather than the ordinary marking permission.
    const daysSince = Math.floor(
      (todayInZone(school.timezone).getTime() - date.getTime()) / 86_400_000,
    );
    if (
      existing.length > 0 &&
      daysSince > settings.editWindowDays &&
      !user.permissions.includes(PERMISSIONS.ATTENDANCE_EDIT) &&
      !user.isSuperAdmin
    ) {
      throw new ForbiddenError(
        `Attendance older than ${settings.editWindowDays} days can only be changed by an administrator`,
        ErrorCode.ATTENDANCE_LOCKED,
      );
    }

    const staffId = user.staffId;
    const changes: Array<{ studentId: string; from: AttendanceStatus; to: AttendanceStatus }> = [];

    const result = await this.prisma.transaction(
      async (tx) => {
        let created = 0;
        let updated = 0;

        for (const record of dto.records) {
          const previous = existingByStudent.get(record.studentId);

          if (previous) {
            if (previous.status !== record.status || previous.remarks !== (record.remarks ?? null)) {
              await tx.attendance.update({
                where: { id: previous.id },
                data: {
                  status: record.status,
                  remarks: record.remarks ?? null,
                  lateMinutes: record.lateMinutes ?? null,
                  updatedById: user.id,
                },
              });
              changes.push({
                studentId: record.studentId,
                from: previous.status,
                to: record.status,
              });
              updated += 1;
            }
            continue;
          }

          await tx.attendance.create({
            data: {
              schoolId,
              studentId: record.studentId,
              classId: section.classId,
              sectionId: section.id,
              subjectId,
              periodId: dto.periodId ?? null,
              date,
              sessionType,
              status: record.status,
              lateMinutes: record.lateMinutes ?? null,
              remarks: record.remarks ?? null,
              source: dto.source ?? 'MANUAL',
              markedById: staffId,
            },
          });
          created += 1;
        }

        return { created, updated };
      },
      { timeout: 30_000 },
    );

    // Corrections are individually auditable; a first marking is summarised.
    if (changes.length > 0) {
      this.audit.record({
        action: AuditAction.ATTENDANCE_UPDATE,
        module: 'attendance',
        entity: 'Attendance',
        entityId: section.id,
        description:
          `Corrected attendance for ${section.class.name} ${section.name} on ${formatDate(date)} ` +
          `(${changes.length} change(s))`,
        oldValue: { changes: changes.map((change) => ({ studentId: change.studentId, status: change.from })) },
        newValue: { changes: changes.map((change) => ({ studentId: change.studentId, status: change.to })) },
        schoolId,
      });
    } else {
      this.audit.record({
        action: AuditAction.CREATE,
        module: 'attendance',
        entity: 'Attendance',
        entityId: section.id,
        description:
          `Marked attendance for ${section.class.name} ${section.name} on ${formatDate(date)} ` +
          `(${result.created} student(s))`,
        schoolId,
      });
    }

    // Parents are told about a new absence, not about one that was already known.
    if (settings.notifyParentsOnAbsence && sessionType === AttendanceSessionType.DAILY) {
      const newlyAbsent = dto.records
        .filter(
          (record) =>
            (record.status === AttendanceStatus.ABSENT ||
              record.status === AttendanceStatus.LATE) &&
            existingByStudent.get(record.studentId)?.status !== record.status,
        )
        .map((record) => ({ studentId: record.studentId, status: record.status }));

      if (newlyAbsent.length > 0) {
        void this.notifyGuardians(schoolId, school.name, date, newlyAbsent).catch((error) =>
          this.log.error('Failed to notify guardians of absence', error, { schoolId }),
        );
      }
    }

    this.log.info('Attendance marked', {
      schoolId,
      sectionId: section.id,
      date: dto.date,
      ...result,
    });

    return {
      date: dto.date,
      sectionId: section.id,
      sessionType,
      ...result,
      total: dto.records.length,
    };
  }

  /** Corrects a single attendance record, always with an audit entry. */
  async updateOne(schoolId: string, id: string, dto: UpdateAttendanceDto, user: AuthenticatedUser) {
    const record = await this.prisma.attendance.findFirst({
      where: { id, schoolId },
      include: {
        student: { select: { firstName: true, lastName: true, admissionNumber: true } },
      },
    });
    if (!record) throw new NotFoundError('Attendance record');

    const updated = await this.prisma.attendance.update({
      where: { id },
      data: {
        status: dto.status ?? undefined,
        remarks: dto.remarks ?? undefined,
        lateMinutes: dto.lateMinutes ?? undefined,
        updatedById: user.id,
      },
    });

    this.audit.record({
      action: AuditAction.ATTENDANCE_UPDATE,
      module: 'attendance',
      entity: 'Attendance',
      entityId: id,
      description:
        `Changed attendance for ${record.student.admissionNumber} on ${formatDate(record.date)} ` +
        `from ${record.status} to ${updated.status}` +
        (dto.reason ? `: ${dto.reason}` : ''),
      oldValue: { status: record.status, remarks: record.remarks },
      newValue: { status: updated.status, remarks: updated.remarks },
      schoolId,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Registers and reads
  // -------------------------------------------------------------------------

  /**
   * The marking screen: every enrolled student with whatever has already been
   * recorded for the date, so a teacher sees a pre-filled register.
   */
  async register(
    schoolId: string,
    sectionId: string,
    dateInput: string,
    sessionType: AttendanceSessionType = AttendanceSessionType.DAILY,
    subjectId?: string,
  ) {
    const date = parseDateOnly(dateInput);

    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, schoolId },
      select: {
        id: true,
        name: true,
        class: { select: { id: true, name: true } },
        classTeacher: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!section) throw new NotFoundError('Section');

    const [enrollments, records, workingDay] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { sectionId, status: EnrollmentStatus.ACTIVE },
        orderBy: [{ rollNumber: 'asc' }, { student: { firstName: 'asc' } }],
        select: {
          rollNumber: true,
          student: {
            select: {
              id: true,
              admissionNumber: true,
              firstName: true,
              middleName: true,
              lastName: true,
              photoUrl: true,
              gender: true,
            },
          },
        },
      }),
      this.prisma.attendance.findMany({
        where: {
          sectionId,
          date,
          sessionType,
          subjectId: sessionType === AttendanceSessionType.DAILY ? null : (subjectId ?? null),
        },
        select: {
          id: true,
          studentId: true,
          status: true,
          remarks: true,
          lateMinutes: true,
          markedAt: true,
          markedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.calendar.isWorkingDay(schoolId, date),
    ]);

    const byStudent = new Map(records.map((record) => [record.studentId, record]));

    const rows = enrollments.map(({ student, rollNumber }) => {
      const record = byStudent.get(student.id);
      return {
        student: {
          ...student,
          fullName: [student.firstName, student.middleName, student.lastName]
            .filter(Boolean)
            .join(' '),
        },
        rollNumber,
        attendanceId: record?.id ?? null,
        status: record?.status ?? null,
        remarks: record?.remarks ?? null,
        lateMinutes: record?.lateMinutes ?? null,
        markedAt: record?.markedAt ?? null,
        markedBy: record?.markedBy ?? null,
      };
    });

    return {
      date: dateInput,
      sessionType,
      subjectId: subjectId ?? null,
      isWorkingDay: workingDay.isWorkingDay,
      holidayName: workingDay.holidayName ?? null,
      section: {
        id: section.id,
        name: section.name,
        class: section.class,
        classTeacher: section.classTeacher,
      },
      totalStudents: enrollments.length,
      markedCount: records.length,
      isMarked: records.length > 0 && records.length >= enrollments.length,
      summary: this.summarise(records.map((record) => record.status)),
      rows,
    };
  }

  async findAll(schoolId: string, query: AttendanceQueryDto) {
    const where: Prisma.AttendanceWhereInput = {
      schoolId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.sessionType ? { sessionType: query.sessionType } : {}),
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ date: 'desc' }, { student: { firstName: 'asc' } }],
        select: {
          id: true,
          date: true,
          status: true,
          sessionType: true,
          remarks: true,
          lateMinutes: true,
          markedAt: true,
          student: {
            select: {
              id: true,
              admissionNumber: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
            },
          },
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true } },
        },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /** Per-student attendance history with a computed percentage. */
  async studentSummary(schoolId: string, studentId: string, from?: string, to?: string) {
    const range = {
      ...(from ? { gte: parseDateOnly(from) } : {}),
      ...(to ? { lte: parseDateOnly(to) } : {}),
    };

    const records = await this.prisma.attendance.findMany({
      where: {
        schoolId,
        studentId,
        sessionType: AttendanceSessionType.DAILY,
        ...(from || to ? { date: range } : {}),
      },
      orderBy: { date: 'desc' },
      select: { id: true, date: true, status: true, remarks: true, lateMinutes: true },
    });

    const summary = this.summarise(records.map((record) => record.status));
    const percentage = this.percentageOf(records.map((record) => record.status));

    // Month-by-month breakdown drives the trend chart in the parent app.
    const monthly = new Map<string, { present: number; total: number }>();
    for (const record of records) {
      if (record.status === AttendanceStatus.HOLIDAY) continue;
      const key = record.date.toISOString().slice(0, 7);
      const bucket = monthly.get(key) ?? { present: 0, total: 0 };
      bucket.present += PRESENT_WEIGHTS[record.status] ?? 0;
      bucket.total += 1;
      monthly.set(key, bucket);
    }

    return {
      studentId,
      from: from ?? null,
      to: to ?? null,
      summary,
      totalDays: records.filter((record) => record.status !== AttendanceStatus.HOLIDAY).length,
      percentage,
      monthly: [...monthly.entries()]
        .map(([month, value]) => ({
          month,
          present: value.present,
          total: value.total,
          percentage: value.total > 0 ? Number(((value.present / value.total) * 100).toFixed(2)) : null,
        }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      records,
    };
  }

  /** Class-wise attendance for a single date, for the admin dashboard. */
  async dailyOverview(schoolId: string, dateInput: string) {
    const date = parseDateOnly(dateInput);

    const [sections, records, workingDay] = await Promise.all([
      this.prisma.section.findMany({
        where: { schoolId },
        orderBy: [{ class: { level: 'asc' } }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          class: { select: { id: true, name: true, level: true } },
          classTeacher: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
        },
      }),
      this.prisma.attendance.groupBy({
        by: ['sectionId', 'status'],
        where: { schoolId, date, sessionType: AttendanceSessionType.DAILY },
        orderBy: undefined,
        _count: true,
      }),
      this.calendar.isWorkingDay(schoolId, date),
    ]);

    const bySection = new Map<string, Record<string, number>>();
    for (const row of records) {
      const bucket = bySection.get(row.sectionId) ?? {};
      bucket[row.status] = row._count;
      bySection.set(row.sectionId, bucket);
    }

    const rows = sections.map((section) => {
      const counts = bySection.get(section.id) ?? {};
      const marked = Object.values(counts).reduce((sum, value) => sum + value, 0);
      const present = Object.entries(counts).reduce(
        (sum, [status, count]) => sum + count * (PRESENT_WEIGHTS[status as AttendanceStatus] ?? 0),
        0,
      );

      return {
        section: { id: section.id, name: section.name, class: section.class },
        classTeacher: section.classTeacher,
        totalStudents: section._count.enrollments,
        marked,
        isMarked: marked > 0 && marked >= section._count.enrollments,
        present,
        absent: counts.ABSENT ?? 0,
        late: counts.LATE ?? 0,
        percentage: marked > 0 ? Number(((present / marked) * 100).toFixed(2)) : null,
      };
    });

    const totalStudents = rows.reduce((sum, row) => sum + row.totalStudents, 0);
    const totalPresent = rows.reduce((sum, row) => sum + row.present, 0);
    const totalMarked = rows.reduce((sum, row) => sum + row.marked, 0);

    return {
      date: dateInput,
      isWorkingDay: workingDay.isWorkingDay,
      holidayName: workingDay.holidayName ?? null,
      totals: {
        students: totalStudents,
        marked: totalMarked,
        present: totalPresent,
        absent: rows.reduce((sum, row) => sum + row.absent, 0),
        percentage: totalMarked > 0 ? Number(((totalPresent / totalMarked) * 100).toFixed(2)) : null,
        sectionsMarked: rows.filter((row) => row.isMarked).length,
        sectionsPending: rows.filter((row) => !row.isMarked).length,
      },
      sections: rows,
    };
  }

  /** Students below the school's minimum attendance threshold. */
  async lowAttendanceReport(schoolId: string, query: AttendanceReportQueryDto) {
    const settings = await this.getSettings(schoolId);
    const threshold = query.threshold ?? settings.minimumAttendancePercent;

    const from = query.from ? parseDateOnly(query.from) : undefined;
    const to = query.to ? parseDateOnly(query.to) : undefined;

    const rows = await this.prisma.attendance.groupBy({
      by: ['studentId', 'status'],
      where: {
        schoolId,
        sessionType: AttendanceSessionType.DAILY,
        ...(query.sectionId ? { sectionId: query.sectionId } : {}),
        ...(query.classId ? { classId: query.classId } : {}),
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: undefined,
      _count: true,
    });

    const byStudent = new Map<string, { present: number; total: number; absent: number }>();
    for (const row of rows) {
      if (row.status === AttendanceStatus.HOLIDAY) continue;
      const bucket = byStudent.get(row.studentId) ?? { present: 0, total: 0, absent: 0 };
      bucket.present += row._count * (PRESENT_WEIGHTS[row.status] ?? 0);
      bucket.total += row._count;
      if (row.status === AttendanceStatus.ABSENT) bucket.absent += row._count;
      byStudent.set(row.studentId, bucket);
    }

    const below = [...byStudent.entries()]
      .map(([studentId, value]) => ({
        studentId,
        ...value,
        percentage: value.total > 0 ? Number(((value.present / value.total) * 100).toFixed(2)) : 0,
      }))
      // A student with only a handful of records is not yet meaningfully below.
      .filter((entry) => entry.total >= 5 && entry.percentage < threshold)
      .sort((a, b) => a.percentage - b.percentage);

    if (below.length === 0) {
      return { threshold, count: 0, students: [] };
    }

    const students = await this.prisma.student.findMany({
      where: { id: { in: below.map((entry) => entry.studentId) } },
      select: {
        id: true,
        admissionNumber: true,
        firstName: true,
        lastName: true,
        photoUrl: true,
        enrollments: {
          where: { status: EnrollmentStatus.ACTIVE },
          take: 1,
          select: {
            rollNumber: true,
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
        guardians: {
          where: { isPrimary: true },
          take: 1,
          select: { guardian: { select: { firstName: true, lastName: true, phone: true } } },
        },
      },
    });
    const studentById = new Map(students.map((student) => [student.id, student]));

    return {
      threshold,
      count: below.length,
      students: below.map((entry) => {
        const student = studentById.get(entry.studentId);
        return {
          ...entry,
          admissionNumber: student?.admissionNumber ?? '',
          name: student
            ? [student.firstName, student.lastName].filter(Boolean).join(' ')
            : 'Unknown',
          photoUrl: student?.photoUrl ?? null,
          className: student?.enrollments[0]
            ? `${student.enrollments[0].class.name} ${student.enrollments[0].section.name}`
            : null,
          rollNumber: student?.enrollments[0]?.rollNumber ?? null,
          guardian: student?.guardians[0]?.guardian ?? null,
        };
      }),
    };
  }

  /** Sections that have not yet been marked today, for the admin nudge list. */
  async pendingSections(schoolId: string, dateInput?: string) {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true },
    });
    const date = dateInput ? parseDateOnly(dateInput) : todayInZone(school.timezone);

    const workingDay = await this.calendar.isWorkingDay(schoolId, date);
    if (!workingDay.isWorkingDay) {
      return { date: date.toISOString().slice(0, 10), isWorkingDay: false, sections: [] };
    }

    const [sections, marked] = await Promise.all([
      this.prisma.section.findMany({
        where: { schoolId, enrollments: { some: { status: EnrollmentStatus.ACTIVE } } },
        select: {
          id: true,
          name: true,
          class: { select: { id: true, name: true, level: true } },
          classTeacher: {
            select: { id: true, firstName: true, lastName: true, phone: true, userId: true },
          },
          _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
        },
      }),
      this.prisma.attendance.groupBy({
        by: ['sectionId'],
        where: { schoolId, date, sessionType: AttendanceSessionType.DAILY },
        orderBy: undefined,
        _count: true,
      }),
    ]);

    const markedBySection = new Map(marked.map((row) => [row.sectionId, row._count]));

    return {
      date: date.toISOString().slice(0, 10),
      isWorkingDay: true,
      sections: sections
        .filter((section) => (markedBySection.get(section.id) ?? 0) < section._count.enrollments)
        .map((section) => ({
          id: section.id,
          name: section.name,
          class: section.class,
          classTeacher: section.classTeacher,
          totalStudents: section._count.enrollments,
          markedCount: markedBySection.get(section.id) ?? 0,
        })),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * A teacher may mark the sections they are class teacher of, or a subject
   * period they actually teach. Anyone with the broader edit permission (an
   * administrator) may mark any section.
   */
  private async assertCanMarkSection(
    user: AuthenticatedUser,
    section: { id: string; classTeacherId: string | null; name: string; class: { name: string } },
    subjectId?: string,
  ): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.ATTENDANCE_EDIT)) return;
    if (!user.staffId) {
      throw new ForbiddenError('Only teaching staff can mark attendance');
    }
    if (section.classTeacherId === user.staffId) return;

    if (subjectId) {
      const teaches = await this.prisma.subjectTeacher.count({
        where: { sectionId: section.id, subjectId, staffId: user.staffId },
      });
      if (teaches > 0) return;
    }

    throw new ForbiddenError(
      `You are not assigned to ${section.class.name} ${section.name}`,
      ErrorCode.FORBIDDEN,
    );
  }

  private async notifyGuardians(
    schoolId: string,
    schoolName: string,
    date: Date,
    absences: Array<{ studentId: string; status: AttendanceStatus }>,
  ): Promise<void> {
    const links = await this.prisma.studentGuardian.findMany({
      where: {
        studentId: { in: absences.map((entry) => entry.studentId) },
        guardian: { userId: { not: null } },
      },
      select: {
        studentId: true,
        guardian: { select: { userId: true, firstName: true } },
        student: { select: { firstName: true, lastName: true } },
      },
    });

    const statusByStudent = new Map(absences.map((entry) => [entry.studentId, entry.status]));
    const formattedDate = formatDate(date);

    // Grouped per student so each family receives one message naming their child.
    const byStudent = new Map<string, { userIds: string[]; name: string }>();
    for (const link of links) {
      if (!link.guardian.userId) continue;
      const bucket = byStudent.get(link.studentId) ?? {
        userIds: [],
        name: [link.student.firstName, link.student.lastName].filter(Boolean).join(' '),
      };
      bucket.userIds.push(link.guardian.userId);
      byStudent.set(link.studentId, bucket);
    }

    for (const [studentId, entry] of byStudent) {
      const status = statusByStudent.get(studentId);
      const isAbsent = status === AttendanceStatus.ABSENT;

      await this.notifications.dispatch({
        schoolId,
        userIds: entry.userIds,
        type: NotificationType.ATTENDANCE,
        title: isAbsent ? 'Absence recorded' : 'Late arrival recorded',
        body: isAbsent
          ? `${entry.name} was marked absent on ${formattedDate}.`
          : `${entry.name} arrived late on ${formattedDate}.`,
        priority: isAbsent ? Priority.IMPORTANT : Priority.NORMAL,
        data: { studentId, date: date.toISOString().slice(0, 10), status },
        actionUrl: `/parent/attendance?studentId=${studentId}`,
        channels: ['IN_APP', 'PUSH'],
        email: {
          subject: `${schoolName}: attendance update for ${entry.name}`,
          template: 'attendance-absence',
          data: {
            guardianName: 'Parent',
            studentName: entry.name,
            status: isAbsent ? 'ABSENT' : 'LATE',
            date: formattedDate,
          },
        },
      });
    }
  }

  private summarise(statuses: AttendanceStatus[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }

  private percentageOf(statuses: AttendanceStatus[]): number | null {
    const countable = statuses.filter((status) => status !== AttendanceStatus.HOLIDAY);
    if (countable.length === 0) return null;

    const present = countable.reduce(
      (sum, status) => sum + (PRESENT_WEIGHTS[status] ?? 0),
      0,
    );
    return Number(((present / countable.length) * 100).toFixed(2));
  }

  private async getSettings(schoolId: string): Promise<AttendanceSettings> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { settings: true },
    });
    const stored = (school?.settings as { attendance?: Partial<AttendanceSettings> } | null)
      ?.attendance;
    return { ...DEFAULT_SETTINGS, ...stored };
  }
}
