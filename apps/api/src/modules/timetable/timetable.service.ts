import { Injectable } from '@nestjs/common';
import { AuditAction, DayOfWeek, PeriodType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { parseDateOnly, todayInZone, weekdayOf } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { AcademicYearService } from '../academics/services/academic-year.service';
import type {
  BulkTimetableDto,
  CreatePeriodDto,
  CreateSubstitutionDto,
  UpsertSlotDto,
} from './dto/timetable.dto';

export interface SlotConflict {
  kind: 'TEACHER' | 'ROOM' | 'SECTION';
  message: string;
  conflictingSlotId: string;
  detail: Record<string, string>;
}

const DAY_ORDER: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

@Injectable()
export class TimetableService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly academicYears: AcademicYearService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('TimetableService');
  }

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  async listPeriods(schoolId: string, academicYearId?: string) {
    const yearId = await this.academicYears.resolveId(schoolId, academicYearId);
    return this.prisma.period.findMany({
      where: { schoolId, academicYearId: yearId },
      orderBy: { sequence: 'asc' },
    });
  }

  async createPeriod(schoolId: string, dto: CreatePeriodDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    if (this.toMinutes(dto.endTime) <= this.toMinutes(dto.startTime)) {
      throw new BadRequestError('The end time must be after the start time');
    }

    // Periods within a year must not overlap, or a slot could belong to two.
    const siblings = await this.prisma.period.findMany({
      where: { schoolId, academicYearId, appliesToLevel: dto.appliesToLevel ?? null },
      select: { id: true, name: true, startTime: true, endTime: true, sequence: true },
    });

    const overlap = siblings.find((period) =>
      this.overlaps(dto.startTime, dto.endTime, period.startTime, period.endTime),
    );
    if (overlap) {
      throw new ConflictError(
        `These times overlap "${overlap.name}" (${overlap.startTime}–${overlap.endTime})`,
      );
    }

    if (siblings.some((period) => period.sequence === dto.sequence)) {
      throw new ConflictError(`A period with sequence ${dto.sequence} already exists`);
    }

    const period = await this.prisma.period.create({
      data: {
        schoolId,
        academicYearId,
        name: dto.name,
        sequence: dto.sequence,
        startTime: dto.startTime,
        endTime: dto.endTime,
        type: dto.type ?? PeriodType.CLASS,
        appliesToLevel: dto.appliesToLevel ?? null,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'timetable',
      entity: 'Period',
      entityId: period.id,
      description: `Created period "${period.name}"`,
      schoolId,
    });

    return period;
  }

  async removePeriod(schoolId: string, id: string) {
    const period = await this.prisma.period.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { timetableSlots: true } } },
    });
    if (!period) throw new NotFoundError('Period');

    if (period._count.timetableSlots > 0) {
      throw new ConflictError(
        `"${period.name}" is used by ${period._count.timetableSlots} timetable slot(s). Remove those first.`,
      );
    }

    await this.prisma.period.delete({ where: { id } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Conflict detection
  // -------------------------------------------------------------------------

  /**
   * Finds everything that would clash if this slot were saved.
   *
   * Three independent resources can only be in one place at a time: the
   * teacher, the room and the section. Each is checked separately so the caller
   * can report precisely what is wrong rather than a generic failure.
   */
  async findConflicts(
    schoolId: string,
    academicYearId: string,
    slot: {
      dayOfWeek: DayOfWeek;
      periodId: string;
      sectionId: string;
      staffId?: string | null;
      roomId?: string | null;
    },
    excludeSlotId?: string,
  ): Promise<SlotConflict[]> {
    const base: Prisma.TimetableSlotWhereInput = {
      schoolId,
      academicYearId,
      dayOfWeek: slot.dayOfWeek,
      periodId: slot.periodId,
      isActive: true,
      ...(excludeSlotId ? { id: { not: excludeSlotId } } : {}),
    };

    const [sectionClash, teacherClash, roomClash] = await Promise.all([
      this.prisma.timetableSlot.findFirst({
        where: { ...base, sectionId: slot.sectionId },
        select: {
          id: true,
          subject: { select: { name: true } },
          section: { select: { name: true, class: { select: { name: true } } } },
        },
      }),
      slot.staffId
        ? this.prisma.timetableSlot.findFirst({
            where: { ...base, staffId: slot.staffId },
            select: {
              id: true,
              staff: { select: { firstName: true, lastName: true } },
              section: { select: { name: true, class: { select: { name: true } } } },
            },
          })
        : Promise.resolve(null),
      slot.roomId
        ? this.prisma.timetableSlot.findFirst({
            where: { ...base, roomId: slot.roomId },
            select: {
              id: true,
              room: { select: { name: true } },
              section: { select: { name: true, class: { select: { name: true } } } },
            },
          })
        : Promise.resolve(null),
    ]);

    const conflicts: SlotConflict[] = [];

    if (sectionClash) {
      conflicts.push({
        kind: 'SECTION',
        conflictingSlotId: sectionClash.id,
        message:
          `${sectionClash.section.class.name} ${sectionClash.section.name} already has ` +
          `${sectionClash.subject?.name ?? 'a class'} in this period`,
        detail: { sectionId: slot.sectionId },
      });
    }

    if (teacherClash) {
      const name = [teacherClash.staff?.firstName, teacherClash.staff?.lastName]
        .filter(Boolean)
        .join(' ');
      conflicts.push({
        kind: 'TEACHER',
        conflictingSlotId: teacherClash.id,
        message:
          `${name} is already teaching ${teacherClash.section.class.name} ` +
          `${teacherClash.section.name} in this period`,
        detail: { staffId: slot.staffId! },
      });
    }

    if (roomClash) {
      conflicts.push({
        kind: 'ROOM',
        conflictingSlotId: roomClash.id,
        message:
          `${roomClash.room?.name} is occupied by ${roomClash.section.class.name} ` +
          `${roomClash.section.name} in this period`,
        detail: { roomId: slot.roomId! },
      });
    }

    return conflicts;
  }

  /** Dry-run conflict check, used by the UI before the user commits a change. */
  async checkConflicts(schoolId: string, dto: UpsertSlotDto, excludeSlotId?: string) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);
    const conflicts = await this.findConflicts(schoolId, academicYearId, dto, excludeSlotId);
    return { hasConflicts: conflicts.length > 0, conflicts };
  }

  // -------------------------------------------------------------------------
  // Slots
  // -------------------------------------------------------------------------

  async upsertSlot(schoolId: string, dto: UpsertSlotDto, slotId?: string) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, schoolId },
      select: { id: true, classId: true, name: true, class: { select: { name: true } } },
    });
    if (!section) throw new NotFoundError('Section');

    // The subject must actually be part of this class's curriculum.
    if (dto.subjectId) {
      const mapped = await this.prisma.classSubject.count({
        where: { classId: section.classId, subjectId: dto.subjectId },
      });
      if (mapped === 0) {
        throw new BadRequestError(
          `That subject is not assigned to ${section.class.name}. Add it to the class first.`,
        );
      }
    }

    const conflicts = await this.findConflicts(
      schoolId,
      academicYearId,
      { ...dto, sectionId: section.id },
      slotId,
    );

    if (conflicts.length > 0) {
      const primary = conflicts[0];
      throw new ConflictError(
        primary.message,
        primary.kind === 'TEACHER'
          ? ErrorCode.TIMETABLE_TEACHER_CONFLICT
          : primary.kind === 'ROOM'
            ? ErrorCode.TIMETABLE_ROOM_CONFLICT
            : ErrorCode.TIMETABLE_SECTION_CONFLICT,
        { conflicts },
      );
    }

    const data = {
      schoolId,
      academicYearId,
      classId: section.classId,
      sectionId: section.id,
      periodId: dto.periodId,
      subjectId: dto.subjectId ?? null,
      staffId: dto.staffId ?? null,
      roomId: dto.roomId ?? null,
      dayOfWeek: dto.dayOfWeek,
      isActive: true,
    };

    const slot = slotId
      ? await this.prisma.timetableSlot.update({ where: { id: slotId }, data })
      : await this.prisma.timetableSlot.create({ data });

    this.audit.record({
      action: slotId ? AuditAction.UPDATE : AuditAction.CREATE,
      module: 'timetable',
      entity: 'TimetableSlot',
      entityId: slot.id,
      description: `${slotId ? 'Updated' : 'Created'} timetable slot for ${section.class.name} ${section.name}`,
      schoolId,
    });

    return slot;
  }

  /**
   * Replaces a section's whole week in one go.
   *
   * The entire payload is validated for internal consistency and against the
   * rest of the school before anything is written, so a partially applied
   * timetable is impossible.
   */
  async bulkUpsert(schoolId: string, dto: BulkTimetableDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, schoolId },
      select: { id: true, classId: true, name: true, class: { select: { name: true } } },
    });
    if (!section) throw new NotFoundError('Section');

    // 1. Internal consistency: the payload must not clash with itself.
    const seen = new Map<string, number>();
    const internalErrors: string[] = [];

    dto.slots.forEach((slot, index) => {
      const sectionKey = `section:${slot.dayOfWeek}:${slot.periodId}`;
      if (seen.has(sectionKey)) {
        internalErrors.push(
          `Rows ${seen.get(sectionKey)! + 1} and ${index + 1} both fill ${slot.dayOfWeek} period`,
        );
      }
      seen.set(sectionKey, index);

      if (slot.staffId) {
        const teacherKey = `staff:${slot.staffId}:${slot.dayOfWeek}:${slot.periodId}`;
        if (seen.has(teacherKey)) {
          internalErrors.push(
            `Row ${index + 1} double-books a teacher already used in row ${seen.get(teacherKey)! + 1}`,
          );
        }
        seen.set(teacherKey, index);
      }
    });

    if (internalErrors.length > 0) {
      throw new BadRequestError(
        `The timetable contains internal conflicts: ${internalErrors.join('; ')}`,
      );
    }

    // 2. External consistency: check against every other section's timetable.
    const existingIds = await this.prisma.timetableSlot.findMany({
      where: { schoolId, academicYearId, sectionId: section.id },
      select: { id: true },
    });
    const excluded = new Set(existingIds.map((slot) => slot.id));

    const allConflicts: Array<{ row: number; conflicts: SlotConflict[] }> = [];

    for (const [index, slot] of dto.slots.entries()) {
      const conflicts = (
        await this.findConflicts(schoolId, academicYearId, {
          ...slot,
          sectionId: section.id,
        })
      ).filter((conflict) => !excluded.has(conflict.conflictingSlotId));

      if (conflicts.length > 0) allConflicts.push({ row: index + 1, conflicts });
    }

    if (allConflicts.length > 0) {
      throw new ConflictError(
        `${allConflicts.length} slot(s) conflict with the existing timetable`,
        ErrorCode.TIMETABLE_TEACHER_CONFLICT,
        { conflicts: allConflicts },
      );
    }

    // 3. Apply atomically.
    const result = await this.prisma.transaction(async (tx) => {
      await tx.timetableSlot.deleteMany({
        where: { schoolId, academicYearId, sectionId: section.id },
      });

      await tx.timetableSlot.createMany({
        data: dto.slots.map((slot) => ({
          schoolId,
          academicYearId,
          classId: section.classId,
          sectionId: section.id,
          periodId: slot.periodId,
          subjectId: slot.subjectId ?? null,
          staffId: slot.staffId ?? null,
          roomId: slot.roomId ?? null,
          dayOfWeek: slot.dayOfWeek,
          isActive: true,
        })),
      });

      return dto.slots.length;
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'timetable',
      entity: 'TimetableSlot',
      entityId: section.id,
      description: `Replaced the timetable for ${section.class.name} ${section.name} (${result} slots)`,
      schoolId,
    });

    this.log.info('Timetable replaced', { schoolId, sectionId: section.id, slots: result });
    return { sectionId: section.id, slots: result };
  }

  async removeSlot(schoolId: string, id: string) {
    const slot = await this.prisma.timetableSlot.findFirst({
      where: { id, schoolId },
      select: { id: true },
    });
    if (!slot) throw new NotFoundError('Timetable slot');

    await this.prisma.timetableSlot.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'timetable',
      entity: 'TimetableSlot',
      entityId: id,
      description: 'Removed a timetable slot',
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  /** Weekly grid for a section: the parent and student timetable view. */
  async sectionTimetable(schoolId: string, sectionId: string, academicYearId?: string) {
    const yearId = await this.academicYears.resolveId(schoolId, academicYearId);

    const [section, periods, slots] = await Promise.all([
      this.prisma.section.findFirst({
        where: { id: sectionId, schoolId },
        select: {
          id: true,
          name: true,
          class: { select: { id: true, name: true } },
          classTeacher: { select: { id: true, firstName: true, lastName: true } },
          room: { select: { id: true, name: true } },
        },
      }),
      this.prisma.period.findMany({
        where: { schoolId, academicYearId: yearId },
        orderBy: { sequence: 'asc' },
      }),
      this.prisma.timetableSlot.findMany({
        where: { schoolId, academicYearId: yearId, sectionId, isActive: true },
        select: {
          id: true,
          dayOfWeek: true,
          periodId: true,
          subject: { select: { id: true, name: true, code: true, colorHex: true } },
          staff: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
          room: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);

    if (!section) throw new NotFoundError('Section');

    return {
      section,
      periods,
      days: this.buildGrid(periods, slots),
    };
  }

  /** Weekly grid for a teacher: what they teach and where. */
  async teacherTimetable(schoolId: string, staffId: string, academicYearId?: string) {
    const yearId = await this.academicYears.resolveId(schoolId, academicYearId);

    const [staff, periods, slots] = await Promise.all([
      this.prisma.staff.findFirst({
        where: { id: staffId, schoolId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, photoUrl: true, employeeId: true },
      }),
      this.prisma.period.findMany({
        where: { schoolId, academicYearId: yearId },
        orderBy: { sequence: 'asc' },
      }),
      this.prisma.timetableSlot.findMany({
        where: { schoolId, academicYearId: yearId, staffId, isActive: true },
        select: {
          id: true,
          dayOfWeek: true,
          periodId: true,
          subject: { select: { id: true, name: true, code: true, colorHex: true } },
          section: {
            select: { id: true, name: true, class: { select: { id: true, name: true } } },
          },
          room: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);

    if (!staff) throw new NotFoundError('Staff member');

    return {
      staff,
      periods,
      weeklyPeriods: slots.length,
      days: this.buildGrid(periods, slots),
    };
  }

  async roomTimetable(schoolId: string, roomId: string, academicYearId?: string) {
    const yearId = await this.academicYears.resolveId(schoolId, academicYearId);

    const [room, periods, slots] = await Promise.all([
      this.prisma.room.findFirst({ where: { id: roomId, schoolId } }),
      this.prisma.period.findMany({
        where: { schoolId, academicYearId: yearId },
        orderBy: { sequence: 'asc' },
      }),
      this.prisma.timetableSlot.findMany({
        where: { schoolId, academicYearId: yearId, roomId, isActive: true },
        select: {
          id: true,
          dayOfWeek: true,
          periodId: true,
          subject: { select: { name: true, code: true, colorHex: true } },
          section: { select: { name: true, class: { select: { name: true } } } },
          staff: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    if (!room) throw new NotFoundError('Room');
    return { room, periods, days: this.buildGrid(periods, slots) };
  }

  /**
   * A teacher's schedule for one day, with substitutions applied.
   * This is the first screen of the teacher mobile app.
   */
  async todayForTeacher(schoolId: string, staffId: string, dateInput?: string) {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true },
    });
    const date = dateInput ? parseDateOnly(dateInput) : todayInZone(school.timezone);
    const dayOfWeek = weekdayOf(date) as DayOfWeek;
    const yearId = await this.academicYears.resolveId(schoolId);

    const [ownSlots, coveringFor, cancelled] = await Promise.all([
      this.prisma.timetableSlot.findMany({
        where: { schoolId, academicYearId: yearId, staffId, dayOfWeek, isActive: true },
        select: {
          id: true,
          period: { select: { id: true, name: true, sequence: true, startTime: true, endTime: true } },
          subject: { select: { id: true, name: true, code: true, colorHex: true } },
          section: {
            select: {
              id: true,
              name: true,
              class: { select: { id: true, name: true } },
              _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
            },
          },
          room: { select: { id: true, name: true } },
        },
      }),
      // Periods this teacher is covering for an absent colleague.
      this.prisma.timetableSubstitution.findMany({
        where: { date, substituteStaffId: staffId, isCancelled: false },
        select: {
          id: true,
          reason: true,
          slot: {
            select: {
              id: true,
              period: {
                select: { id: true, name: true, sequence: true, startTime: true, endTime: true },
              },
              subject: { select: { id: true, name: true, code: true, colorHex: true } },
              section: {
                select: {
                  id: true,
                  name: true,
                  class: { select: { id: true, name: true } },
                  _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
                },
              },
              room: { select: { id: true, name: true } },
            },
          },
        },
      }),
      // The teacher's own periods that someone else is covering, or that were cancelled.
      this.prisma.timetableSubstitution.findMany({
        where: { date, slot: { staffId } },
        select: { slotId: true, isCancelled: true, substituteStaffId: true },
      }),
    ]);

    const handedOver = new Map(cancelled.map((entry) => [entry.slotId, entry]));

    const own = ownSlots
      .filter((slot) => !handedOver.has(slot.id))
      .map((slot) => ({
        slotId: slot.id,
        period: slot.period,
        subject: slot.subject,
        section: {
          id: slot.section.id,
          name: slot.section.name,
          class: slot.section.class,
          studentCount: slot.section._count.enrollments,
        },
        room: slot.room,
        isSubstitution: false,
      }));

    const substituting = coveringFor.map((entry) => ({
      slotId: entry.slot.id,
      period: entry.slot.period,
      subject: entry.slot.subject,
      section: {
        id: entry.slot.section.id,
        name: entry.slot.section.name,
        class: entry.slot.section.class,
        studentCount: entry.slot.section._count.enrollments,
      },
      room: entry.slot.room,
      isSubstitution: true,
      substitutionReason: entry.reason,
    }));

    const classes = [...own, ...substituting].sort(
      (a, b) => a.period.sequence - b.period.sequence,
    );

    return {
      date: date.toISOString().slice(0, 10),
      dayOfWeek,
      totalClasses: classes.length,
      substitutions: substituting.length,
      classes,
    };
  }

  /** A student's schedule for one day, for the student and parent apps. */
  async todayForStudent(schoolId: string, studentId: string, dateInput?: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, schoolId, status: 'ACTIVE' },
      select: { sectionId: true },
    });
    if (!enrollment) throw new NotFoundError('Active enrollment for this student');

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true },
    });
    const date = dateInput ? parseDateOnly(dateInput) : todayInZone(school.timezone);
    const dayOfWeek = weekdayOf(date) as DayOfWeek;
    const yearId = await this.academicYears.resolveId(schoolId);

    const [slots, substitutions] = await Promise.all([
      this.prisma.timetableSlot.findMany({
        where: {
          schoolId,
          academicYearId: yearId,
          sectionId: enrollment.sectionId,
          dayOfWeek,
          isActive: true,
        },
        select: {
          id: true,
          period: {
            select: { id: true, name: true, sequence: true, startTime: true, endTime: true, type: true },
          },
          subject: { select: { id: true, name: true, code: true, colorHex: true } },
          staff: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
          room: { select: { id: true, name: true } },
        },
      }),
      this.prisma.timetableSubstitution.findMany({
        where: { date, slot: { sectionId: enrollment.sectionId } },
        select: {
          slotId: true,
          isCancelled: true,
          substituteStaff: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    const bySlot = new Map(substitutions.map((entry) => [entry.slotId, entry]));

    return {
      date: date.toISOString().slice(0, 10),
      dayOfWeek,
      periods: slots
        .map((slot) => {
          const substitution = bySlot.get(slot.id);
          return {
            slotId: slot.id,
            period: slot.period,
            subject: slot.subject,
            teacher: substitution?.substituteStaff ?? slot.staff,
            room: slot.room,
            isCancelled: substitution?.isCancelled ?? false,
            isSubstituted: Boolean(substitution?.substituteStaff),
          };
        })
        .sort((a, b) => a.period.sequence - b.period.sequence),
    };
  }

  // -------------------------------------------------------------------------
  // Substitutions
  // -------------------------------------------------------------------------

  async createSubstitution(schoolId: string, dto: CreateSubstitutionDto, createdById: string) {
    const date = parseDateOnly(dto.date);

    const slot = await this.prisma.timetableSlot.findFirst({
      where: { id: dto.slotId, schoolId },
      select: {
        id: true,
        dayOfWeek: true,
        periodId: true,
        staffId: true,
        academicYearId: true,
        section: { select: { name: true, class: { select: { name: true } } } },
        subject: { select: { name: true } },
      },
    });
    if (!slot) throw new NotFoundError('Timetable slot');

    // The substitution must fall on the weekday the slot actually occurs.
    if (weekdayOf(date) !== slot.dayOfWeek) {
      throw new BadRequestError(
        `That slot is scheduled on ${slot.dayOfWeek}, but ${dto.date} is a ${weekdayOf(date)}`,
      );
    }

    if (dto.substituteStaffId) {
      if (dto.substituteStaffId === slot.staffId) {
        throw new BadRequestError('The substitute is the same teacher already assigned');
      }

      const staff = await this.prisma.staff.count({
        where: { id: dto.substituteStaffId, schoolId, deletedAt: null, isTeacher: true },
      });
      if (staff === 0) throw new NotFoundError('Substitute teacher');

      // The stand-in must actually be free at that time.
      const busy = await this.prisma.timetableSlot.findFirst({
        where: {
          schoolId,
          academicYearId: slot.academicYearId,
          staffId: dto.substituteStaffId,
          dayOfWeek: slot.dayOfWeek,
          periodId: slot.periodId,
          isActive: true,
        },
        select: { section: { select: { name: true, class: { select: { name: true } } } } },
      });

      if (busy) {
        throw new ConflictError(
          `The substitute already teaches ${busy.section.class.name} ${busy.section.name} in this period`,
          ErrorCode.TIMETABLE_TEACHER_CONFLICT,
        );
      }

      // And must not already be covering another period at the same time.
      const alreadyCovering = await this.prisma.timetableSubstitution.findFirst({
        where: {
          date,
          substituteStaffId: dto.substituteStaffId,
          isCancelled: false,
          slot: { periodId: slot.periodId },
        },
        select: { id: true },
      });

      if (alreadyCovering) {
        throw new ConflictError(
          'The substitute is already covering another class in this period',
          ErrorCode.TIMETABLE_TEACHER_CONFLICT,
        );
      }
    }

    const substitution = await this.prisma.timetableSubstitution.upsert({
      where: { slotId_date: { slotId: dto.slotId, date } },
      create: {
        slotId: dto.slotId,
        date,
        substituteStaffId: dto.substituteStaffId ?? null,
        reason: dto.reason ?? null,
        isCancelled: dto.isCancelled ?? false,
        createdById,
      },
      update: {
        substituteStaffId: dto.substituteStaffId ?? null,
        reason: dto.reason ?? null,
        isCancelled: dto.isCancelled ?? false,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'timetable',
      entity: 'TimetableSubstitution',
      entityId: substitution.id,
      description:
        `${dto.isCancelled ? 'Cancelled' : 'Arranged a substitute for'} ` +
        `${slot.subject?.name ?? 'a class'} in ${slot.section.class.name} ${slot.section.name} on ${dto.date}`,
      schoolId,
    });

    return substitution;
  }

  async listSubstitutions(schoolId: string, dateInput: string) {
    const date = parseDateOnly(dateInput);

    return this.prisma.timetableSubstitution.findMany({
      where: { date, slot: { schoolId } },
      include: {
        substituteStaff: { select: { id: true, firstName: true, lastName: true } },
        slot: {
          select: {
            id: true,
            period: { select: { name: true, sequence: true, startTime: true, endTime: true } },
            subject: { select: { name: true, code: true } },
            staff: { select: { id: true, firstName: true, lastName: true } },
            section: { select: { name: true, class: { select: { name: true } } } },
          },
        },
      },
      orderBy: { slot: { period: { sequence: 'asc' } } },
    });
  }

  async removeSubstitution(schoolId: string, id: string) {
    const substitution = await this.prisma.timetableSubstitution.findFirst({
      where: { id, slot: { schoolId } },
      select: { id: true },
    });
    if (!substitution) throw new NotFoundError('Substitution');

    await this.prisma.timetableSubstitution.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Teachers with no class in a given period — the candidate list an
   * administrator picks a stand-in from.
   */
  async availableTeachers(schoolId: string, dateInput: string, periodId: string) {
    const date = parseDateOnly(dateInput);
    const dayOfWeek = weekdayOf(date) as DayOfWeek;
    const yearId = await this.academicYears.resolveId(schoolId);

    const [teachers, busySlots, busySubstitutions] = await Promise.all([
      this.prisma.staff.findMany({
        where: {
          schoolId,
          deletedAt: null,
          isTeacher: true,
          employmentStatus: { in: ['ACTIVE', 'PROBATION'] },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          employeeId: true,
          department: { select: { name: true } },
        },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.timetableSlot.findMany({
        where: { schoolId, academicYearId: yearId, dayOfWeek, periodId, isActive: true },
        select: { staffId: true },
      }),
      this.prisma.timetableSubstitution.findMany({
        where: { date, isCancelled: false, slot: { periodId } },
        select: { substituteStaffId: true },
      }),
      ]);

    const busy = new Set<string>();
    for (const slot of busySlots) if (slot.staffId) busy.add(slot.staffId);
    for (const entry of busySubstitutions) {
      if (entry.substituteStaffId) busy.add(entry.substituteStaffId);
    }

    // Teachers on approved leave that day cannot cover either.
    const onLeave = await this.prisma.leaveRequest.findMany({
      where: {
        schoolId,
        status: 'APPROVED',
        applicantType: 'STAFF',
        fromDate: { lte: date },
        toDate: { gte: date },
      },
      select: { staffId: true },
    });
    for (const leave of onLeave) if (leave.staffId) busy.add(leave.staffId);

    return teachers
      .filter((teacher) => !busy.has(teacher.id))
      .map((teacher) => ({
        ...teacher,
        fullName: [teacher.firstName, teacher.lastName].filter(Boolean).join(' '),
      }));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildGrid<T extends { dayOfWeek: DayOfWeek; periodId: string }>(
    periods: Array<{ id: string }>,
    slots: T[],
  ): Array<{ day: DayOfWeek; slots: Array<T | null> }> {
    const byDayPeriod = new Map<string, T>();
    for (const slot of slots) byDayPeriod.set(`${slot.dayOfWeek}:${slot.periodId}`, slot);

    return DAY_ORDER.map((day) => ({
      day,
      slots: periods.map((period) => byDayPeriod.get(`${day}:${period.id}`) ?? null),
    }));
  }

  private toMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
    return (
      this.toMinutes(startA) < this.toMinutes(endB) &&
      this.toMinutes(startB) < this.toMinutes(endA)
    );
  }
}
