import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { BadRequestError, NotFoundError } from '../../../common/exceptions/app.exception';
import { eachDay, parseDateOnly, weekdayOf } from '../../../common/utils/date.util';
import { AuditService } from '../../audit/audit.service';
import { AcademicYearService } from './academic-year.service';
import type { CreateHolidayDto, UpdateHolidayDto } from '../dto/academics.dto';

export interface WorkingDayInfo {
  date: string;
  isWorkingDay: boolean;
  reason?: 'HOLIDAY' | 'WEEK_OFF';
  holidayName?: string;
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicYears: AcademicYearService,
    private readonly audit: AuditService,
  ) {}

  async listHolidays(schoolId: string, academicYearId?: string) {
    const yearId = await this.academicYears.resolveId(schoolId, academicYearId);

    return this.prisma.holiday.findMany({
      where: { schoolId, academicYearId: yearId },
      orderBy: { startDate: 'asc' },
    });
  }

  async createHoliday(schoolId: string, dto: CreateHolidayDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);
    const startDate = parseDateOnly(dto.startDate);
    const endDate = parseDateOnly(dto.endDate);

    if (endDate < startDate) {
      throw new BadRequestError('The end date cannot be before the start date');
    }

    const holiday = await this.prisma.holiday.create({
      data: {
        schoolId,
        academicYearId,
        name: dto.name,
        startDate,
        endDate,
        description: dto.description ?? null,
        type: dto.type ?? 'SCHOOL',
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'academics',
      entity: 'Holiday',
      entityId: holiday.id,
      description: `Added holiday "${holiday.name}"`,
      schoolId,
    });

    return holiday;
  }

  async updateHoliday(schoolId: string, id: string, dto: UpdateHolidayDto) {
    const existing = await this.prisma.holiday.count({ where: { id, schoolId } });
    if (existing === 0) throw new NotFoundError('Holiday');

    return this.prisma.holiday.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        description: dto.description ?? undefined,
        type: dto.type ?? undefined,
        startDate: dto.startDate ? parseDateOnly(dto.startDate) : undefined,
        endDate: dto.endDate ? parseDateOnly(dto.endDate) : undefined,
      },
    });
  }

  async removeHoliday(schoolId: string, id: string) {
    const holiday = await this.prisma.holiday.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true },
    });
    if (!holiday) throw new NotFoundError('Holiday');

    await this.prisma.holiday.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'academics',
      entity: 'Holiday',
      entityId: id,
      description: `Removed holiday "${holiday.name}"`,
      schoolId,
    });

    return { deleted: true };
  }

  /**
   * Whether a given date is a teaching day. Used by attendance to refuse
   * marking on holidays and non-working days, and by report cards to compute
   * the denominator of the attendance percentage.
   */
  async isWorkingDay(schoolId: string, date: Date): Promise<WorkingDayInfo> {
    const [school, holiday] = await this.prisma.$transaction([
      this.prisma.school.findUnique({ where: { id: schoolId }, select: { settings: true } }),
      this.prisma.holiday.findFirst({
        where: { schoolId, startDate: { lte: date }, endDate: { gte: date } },
        select: { name: true },
      }),
    ]);

    const isoDate = date.toISOString().slice(0, 10);

    if (holiday) {
      return { date: isoDate, isWorkingDay: false, reason: 'HOLIDAY', holidayName: holiday.name };
    }

    const workingDays = this.workingDaysOf(school?.settings);
    if (!workingDays.includes(weekdayOf(date))) {
      return { date: isoDate, isWorkingDay: false, reason: 'WEEK_OFF' };
    }

    return { date: isoDate, isWorkingDay: true };
  }

  /** Working-day breakdown for a date range, in one pass. */
  async workingDaysBetween(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<{ workingDays: number; holidays: number; weekOffs: number; days: WorkingDayInfo[] }> {
    const [school, holidays] = await this.prisma.$transaction([
      this.prisma.school.findUnique({ where: { id: schoolId }, select: { settings: true } }),
      this.prisma.holiday.findMany({
        where: { schoolId, startDate: { lte: to }, endDate: { gte: from } },
        select: { name: true, startDate: true, endDate: true },
      }),
    ]);

    const allowedDays = this.workingDaysOf(school?.settings);

    const days = eachDay(from, to).map<WorkingDayInfo>((day) => {
      const isoDate = day.toISOString().slice(0, 10);
      const holiday = holidays.find(
        (entry) => entry.startDate <= day && entry.endDate >= day,
      );

      if (holiday) {
        return { date: isoDate, isWorkingDay: false, reason: 'HOLIDAY', holidayName: holiday.name };
      }
      if (!allowedDays.includes(weekdayOf(day))) {
        return { date: isoDate, isWorkingDay: false, reason: 'WEEK_OFF' };
      }
      return { date: isoDate, isWorkingDay: true };
    });

    return {
      workingDays: days.filter((day) => day.isWorkingDay).length,
      holidays: days.filter((day) => day.reason === 'HOLIDAY').length,
      weekOffs: days.filter((day) => day.reason === 'WEEK_OFF').length,
      days,
    };
  }

  /** Merged calendar: holidays plus published events, for the calendar view. */
  async calendar(schoolId: string, from: Date, to: Date) {
    const [holidays, events, exams] = await this.prisma.$transaction([
      this.prisma.holiday.findMany({
        where: { schoolId, startDate: { lte: to }, endDate: { gte: from } },
        select: { id: true, name: true, startDate: true, endDate: true, type: true },
      }),
      this.prisma.event.findMany({
        where: { schoolId, isPublished: true, startAt: { lte: to }, endAt: { gte: from } },
        select: {
          id: true,
          title: true,
          type: true,
          startAt: true,
          endAt: true,
          isAllDay: true,
          venue: true,
        },
      }),
      this.prisma.exam.findMany({
        where: {
          schoolId,
          deletedAt: null,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: { id: true, name: true, type: true, startDate: true, endDate: true },
      }),
    ]);

    return [
      ...holidays.map((holiday) => ({
        id: holiday.id,
        kind: 'HOLIDAY' as const,
        title: holiday.name,
        start: holiday.startDate,
        end: holiday.endDate,
        allDay: true,
        meta: { type: holiday.type },
      })),
      ...events.map((event) => ({
        id: event.id,
        kind: 'EVENT' as const,
        title: event.title,
        start: event.startAt,
        end: event.endAt,
        allDay: event.isAllDay,
        meta: { type: event.type, venue: event.venue },
      })),
      ...exams.map((exam) => ({
        id: exam.id,
        kind: 'EXAM' as const,
        title: exam.name,
        start: exam.startDate,
        end: exam.endDate,
        allDay: true,
        meta: { type: exam.type },
      })),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private workingDaysOf(settings: unknown): string[] {
    const timings = (settings as { timings?: { workingDays?: string[] } } | null)?.timings;
    return (
      timings?.workingDays ?? [
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
      ]
    );
  }
}
