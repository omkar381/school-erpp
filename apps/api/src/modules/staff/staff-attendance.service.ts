import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, StaffAttendanceStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import {
  dayBoundsInZone,
  parseDateOnly,
  todayInZone,
} from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { CalendarService } from '../academics/services/calendar.service';
import type {
  CheckInDto,
  CheckOutDto,
  MarkStaffAttendanceDto,
  StaffAttendanceQueryDto,
} from './dto/staff-attendance.dto';

/** Minutes after the school start time before a check-in counts as late. */
const DEFAULT_LATE_GRACE_MINUTES = 10;

@Injectable()
export class StaffAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Self-service check-in / check-out
  // -------------------------------------------------------------------------

  async checkIn(schoolId: string, staffId: string, dto: CheckInDto) {
    const school = await this.getSchoolContext(schoolId);
    const today = todayInZone(school.timezone);

    const workingDay = await this.calendar.isWorkingDay(schoolId, today);
    if (!workingDay.isWorkingDay) {
      throw new BadRequestError(
        workingDay.reason === 'HOLIDAY'
          ? `Today is a holiday (${workingDay.holidayName}). Check-in is not required.`
          : 'Today is not a working day. Check-in is not required.',
        ErrorCode.HOLIDAY_NO_ATTENDANCE,
      );
    }

    const existing = await this.prisma.staffAttendance.findUnique({
      where: { staffId_date: { staffId, date: today } },
      select: { id: true, checkInAt: true },
    });

    if (existing?.checkInAt) {
      throw new ConflictError('You have already checked in today');
    }

    const now = new Date();
    const lateMinutes = this.minutesLate(now, school.startTime, school.timezone);

    const record = await this.prisma.staffAttendance.upsert({
      where: { staffId_date: { staffId, date: today } },
      create: {
        schoolId,
        staffId,
        date: today,
        status:
          lateMinutes > DEFAULT_LATE_GRACE_MINUTES
            ? StaffAttendanceStatus.LATE
            : StaffAttendanceStatus.PRESENT,
        checkInAt: now,
        lateMinutes: lateMinutes > 0 ? lateMinutes : null,
        checkInLat: dto.latitude ?? null,
        checkInLng: dto.longitude ?? null,
        source: dto.source ?? 'MANUAL',
      },
      update: {
        checkInAt: now,
        status:
          lateMinutes > DEFAULT_LATE_GRACE_MINUTES
            ? StaffAttendanceStatus.LATE
            : StaffAttendanceStatus.PRESENT,
        lateMinutes: lateMinutes > 0 ? lateMinutes : null,
        checkInLat: dto.latitude ?? null,
        checkInLng: dto.longitude ?? null,
      },
    });

    return {
      ...record,
      isLate: lateMinutes > DEFAULT_LATE_GRACE_MINUTES,
      lateByMinutes: Math.max(0, lateMinutes),
    };
  }

  async checkOut(schoolId: string, staffId: string, dto: CheckOutDto) {
    const school = await this.getSchoolContext(schoolId);
    const today = todayInZone(school.timezone);

    const existing = await this.prisma.staffAttendance.findUnique({
      where: { staffId_date: { staffId, date: today } },
      select: { id: true, checkInAt: true, checkOutAt: true },
    });

    if (!existing?.checkInAt) {
      throw new BadRequestError('You have not checked in today');
    }
    if (existing.checkOutAt) {
      throw new ConflictError('You have already checked out today');
    }

    const now = new Date();
    const workedMinutes = Math.round(
      (now.getTime() - existing.checkInAt.getTime()) / 60_000,
    );

    const record = await this.prisma.staffAttendance.update({
      where: { id: existing.id },
      data: {
        checkOutAt: now,
        workedMinutes,
        checkOutLat: dto.latitude ?? null,
        checkOutLng: dto.longitude ?? null,
      },
    });

    return {
      ...record,
      workedHours: Number((workedMinutes / 60).toFixed(2)),
    };
  }

  /** Today's own attendance state, for the teacher app home screen. */
  async myToday(schoolId: string, staffId: string) {
    const school = await this.getSchoolContext(schoolId);
    const today = todayInZone(school.timezone);

    const [record, workingDay] = await Promise.all([
      this.prisma.staffAttendance.findUnique({
        where: { staffId_date: { staffId, date: today } },
      }),
      this.calendar.isWorkingDay(schoolId, today),
    ]);

    return {
      date: today.toISOString().slice(0, 10),
      isWorkingDay: workingDay.isWorkingDay,
      holidayName: workingDay.holidayName ?? null,
      checkedIn: Boolean(record?.checkInAt),
      checkedOut: Boolean(record?.checkOutAt),
      record,
      schoolStartTime: school.startTime,
      schoolEndTime: school.endTime,
    };
  }

  // -------------------------------------------------------------------------
  // Administrative marking
  // -------------------------------------------------------------------------

  async mark(schoolId: string, dto: MarkStaffAttendanceDto, markedById: string) {
    const date = parseDateOnly(dto.date);
    const school = await this.getSchoolContext(schoolId);

    if (date.getTime() > todayInZone(school.timezone).getTime()) {
      throw new BadRequestError(
        'Attendance cannot be recorded for a future date',
        ErrorCode.ATTENDANCE_FUTURE_DATE,
      );
    }

    const staffIds = dto.records.map((record) => record.staffId);
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: staffIds }, schoolId, deletedAt: null },
      select: { id: true },
    });
    if (staff.length !== new Set(staffIds).size) {
      throw new BadRequestError('One or more staff members do not exist in this school');
    }

    const results = await this.prisma.transaction(async (tx) => {
      const written = [];

      for (const record of dto.records) {
        const entry = await tx.staffAttendance.upsert({
          where: { staffId_date: { staffId: record.staffId, date } },
          create: {
            schoolId,
            staffId: record.staffId,
            date,
            status: record.status,
            remarks: record.remarks ?? null,
            lateMinutes: record.lateMinutes ?? null,
            markedById,
            source: 'MANUAL',
          },
          update: {
            status: record.status,
            remarks: record.remarks ?? null,
            lateMinutes: record.lateMinutes ?? null,
            markedById,
          },
          select: { id: true, staffId: true, status: true },
        });
        written.push(entry);
      }

      return written;
    });

    this.audit.record({
      action: AuditAction.ATTENDANCE_UPDATE,
      module: 'staff',
      entity: 'StaffAttendance',
      description: `Recorded staff attendance for ${dto.date} (${results.length} record(s))`,
      newValue: { date: dto.date, count: results.length },
      schoolId,
    });

    return { date: dto.date, marked: results.length, records: results };
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: StaffAttendanceQueryDto) {
    const where: Prisma.StaffAttendanceWhereInput = {
      schoolId,
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.departmentId ? { staff: { departmentId: query.departmentId } } : {}),
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
      this.prisma.staffAttendance.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ date: 'desc' }, { staff: { firstName: 'asc' } }],
        include: {
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
        },
      }),
      this.prisma.staffAttendance.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /** Daily register for a date, listing every active staff member. */
  async dailyRegister(schoolId: string, dateInput: string, departmentId?: string) {
    const date = parseDateOnly(dateInput);

    const [staff, records, workingDay] = await Promise.all([
      this.prisma.staff.findMany({
        where: {
          schoolId,
          deletedAt: null,
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE_PERIOD'] },
          ...(departmentId ? { departmentId } : {}),
        },
        orderBy: { firstName: 'asc' },
        select: {
          id: true,
          employeeId: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          isTeacher: true,
          department: { select: { id: true, name: true } },
        },
      }),
      this.prisma.staffAttendance.findMany({
        where: { schoolId, date },
        select: {
          staffId: true,
          status: true,
          checkInAt: true,
          checkOutAt: true,
          lateMinutes: true,
          workedMinutes: true,
          remarks: true,
        },
      }),
      this.calendar.isWorkingDay(schoolId, date),
    ]);

    const byStaff = new Map(records.map((record) => [record.staffId, record]));

    const rows = staff.map((member) => ({
      staff: {
        ...member,
        fullName: [member.firstName, member.lastName].filter(Boolean).join(' '),
      },
      attendance: byStaff.get(member.id) ?? null,
      status: byStaff.get(member.id)?.status ?? null,
    }));

    return {
      date: dateInput,
      isWorkingDay: workingDay.isWorkingDay,
      holidayName: workingDay.holidayName ?? null,
      totalStaff: staff.length,
      marked: records.length,
      unmarked: staff.length - records.length,
      summary: this.countByStatus(records.map((record) => record.status)),
      rows,
    };
  }

  /** Monthly summary per staff member, used for payroll input. */
  async monthlySummary(schoolId: string, year: number, month: number, staffId?: string) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0));

    const [records, workingDays, staff] = await Promise.all([
      this.prisma.staffAttendance.findMany({
        where: {
          schoolId,
          date: { gte: from, lte: to },
          ...(staffId ? { staffId } : {}),
        },
        select: { staffId: true, status: true, workedMinutes: true, lateMinutes: true },
      }),
      this.calendar.workingDaysBetween(schoolId, from, to),
      this.prisma.staff.findMany({
        where: {
          schoolId,
          deletedAt: null,
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE_PERIOD'] },
          ...(staffId ? { id: staffId } : {}),
        },
        select: { id: true, employeeId: true, firstName: true, lastName: true },
      }),
    ]);

    const byStaff = new Map<string, typeof records>();
    for (const record of records) {
      const bucket = byStaff.get(record.staffId) ?? [];
      bucket.push(record);
      byStaff.set(record.staffId, bucket);
    }

    return {
      period: { year, month, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      workingDays: workingDays.workingDays,
      holidays: workingDays.holidays,
      staff: staff.map((member) => {
        const entries = byStaff.get(member.id) ?? [];
        const counts = this.countByStatus(entries.map((entry) => entry.status));
        const present =
          (counts.PRESENT ?? 0) + (counts.LATE ?? 0) + (counts.HALF_DAY ?? 0) * 0.5;

        return {
          staffId: member.id,
          employeeId: member.employeeId,
          name: [member.firstName, member.lastName].filter(Boolean).join(' '),
          present,
          absent: counts.ABSENT ?? 0,
          onLeave: counts.ON_LEAVE ?? 0,
          late: counts.LATE ?? 0,
          halfDay: counts.HALF_DAY ?? 0,
          totalHours: Number(
            (
              entries.reduce((sum, entry) => sum + (entry.workedMinutes ?? 0), 0) / 60
            ).toFixed(2),
          ),
          attendancePercent:
            workingDays.workingDays > 0
              ? Number(((present / workingDays.workingDays) * 100).toFixed(2))
              : null,
        };
      }),
    };
  }

  async history(schoolId: string, staffId: string, from: string, to: string) {
    const records = await this.prisma.staffAttendance.findMany({
      where: {
        schoolId,
        staffId,
        date: { gte: parseDateOnly(from), lte: parseDateOnly(to) },
      },
      orderBy: { date: 'desc' },
    });

    const counts = this.countByStatus(records.map((record) => record.status));

    return {
      from,
      to,
      records,
      summary: {
        ...counts,
        totalHours: Number(
          (records.reduce((sum, record) => sum + (record.workedMinutes ?? 0), 0) / 60).toFixed(2),
        ),
      },
    };
  }

  // -------------------------------------------------------------------------

  private async getSchoolContext(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { timezone: true, settings: true },
    });
    if (!school) throw new NotFoundError('School');

    const timings = (school.settings as { timings?: { startTime?: string; endTime?: string } } | null)
      ?.timings;

    return {
      timezone: school.timezone,
      startTime: timings?.startTime ?? '08:30',
      endTime: timings?.endTime ?? '15:30',
    };
  }

  private minutesLate(now: Date, startTime: string, timezone: string): number {
    const { start } = dayBoundsInZone(now, timezone);
    const [hours, minutes] = startTime.split(':').map(Number);
    const expected = new Date(start.getTime() + (hours * 60 + minutes) * 60_000);
    return Math.round((now.getTime() - expected.getTime()) / 60_000);
  }

  private countByStatus(statuses: StaffAttendanceStatus[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }
}
