import { Injectable } from '@nestjs/common';
import { AuditAction, ExamStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { parseDateOnly, timeRangesOverlap } from '../../../common/utils/date.util';
import { AuditService } from '../../audit/audit.service';
import { AcademicYearService } from '../../academics/services/academic-year.service';
import type {
  CreateExamDto,
  ExamQueryDto,
  ScheduleExamSubjectDto,
  SetExamClassesDto,
  UpdateExamDto,
} from '../dto/exam.dto';

/** Exam states from which marks may still be changed. */
const MARKS_EDITABLE_STATES: ExamStatus[] = [
  ExamStatus.SCHEDULED,
  ExamStatus.ONGOING,
  ExamStatus.MARKS_ENTRY,
  ExamStatus.COMPLETED,
];

@Injectable()
export class ExamsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly academicYears: AcademicYearService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('ExamsService');
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: ExamQueryDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, query.academicYearId);

    const where: Prisma.ExamWhereInput = {
      schoolId,
      academicYearId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.classId ? { examClasses: { some: { classId: query.classId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.exam.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { startDate: query.sortOrder },
        select: {
          id: true,
          name: true,
          code: true,
          type: true,
          status: true,
          startDate: true,
          endDate: true,
          weightage: true,
          resultDate: true,
          publishedAt: true,
          marksLocked: true,
          showRank: true,
          gradeScale: { select: { id: true, name: true } },
          _count: { select: { examClasses: true, examSubjects: true, marks: true } },
        },
      }),
      this.prisma.exam.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ _count, ...exam }) => ({
        ...exam,
        classCount: _count.examClasses,
        subjectCount: _count.examSubjects,
        markCount: _count.marks,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        academicYear: { select: { id: true, name: true } },
        gradeScale: {
          select: {
            id: true,
            name: true,
            bands: { orderBy: { sortOrder: 'asc' } },
          },
        },
        examClasses: {
          include: {
            class: { select: { id: true, name: true, level: true } },
            section: { select: { id: true, name: true } },
          },
        },
        examSubjects: {
          include: {
            subject: { select: { id: true, name: true, code: true, colorHex: true } },
            schedules: {
              include: {
                room: { select: { id: true, name: true } },
                invigilator: { select: { id: true, firstName: true, lastName: true } },
              },
            },
            _count: { select: { marks: true } },
          },
        },
      },
    });

    if (!exam) throw new NotFoundError('Exam');

    // Marks-entry progress per subject, so the coordinator can see what is left.
    const expected = await this.expectedMarkCounts(exam.id);

    return {
      ...exam,
      examSubjects: exam.examSubjects.map(({ _count, ...subject }) => ({
        ...subject,
        marksEntered: _count.marks,
        marksExpected: expected.get(subject.id) ?? 0,
        isComplete: _count.marks > 0 && _count.marks >= (expected.get(subject.id) ?? 0),
      })),
    };
  }

  /** Exams a student can see, once results are published. */
  async forStudent(schoolId: string, studentId: string, academicYearId?: string) {
    const yearId = await this.academicYears.resolveId(schoolId, academicYearId);

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, schoolId, academicYearId: yearId },
      select: { classId: true, sectionId: true },
    });
    if (!enrollment) throw new NotFoundError('Enrollment for this student');

    const exams = await this.prisma.exam.findMany({
      where: {
        schoolId,
        academicYearId: yearId,
        deletedAt: null,
        status: { notIn: [ExamStatus.DRAFT, ExamStatus.CANCELLED] },
        examClasses: { some: { classId: enrollment.classId } },
      },
      orderBy: { startDate: 'desc' },
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        resultDate: true,
        publishedAt: true,
        examSubjects: {
          where: { classId: enrollment.classId },
          select: {
            id: true,
            maxMarks: true,
            passMarks: true,
            subject: { select: { id: true, name: true, code: true, colorHex: true } },
            schedules: {
              where: { OR: [{ sectionId: enrollment.sectionId }, { sectionId: null }] },
              select: { date: true, startTime: true, endTime: true, room: { select: { name: true } } },
            },
          },
        },
      },
    });

    return exams.map((exam) => ({
      ...exam,
      resultsAvailable: exam.status === ExamStatus.PUBLISHED,
      isUpcoming: exam.startDate > new Date(),
    }));
  }

  /** The next exam for a student — used on the parent and student home screens. */
  async nextExam(schoolId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, schoolId, status: 'ACTIVE' },
      select: { classId: true, sectionId: true },
    });
    if (!enrollment) return null;

    const schedule = await this.prisma.examSchedule.findFirst({
      where: {
        date: { gte: new Date() },
        exam: {
          schoolId,
          deletedAt: null,
          status: { in: [ExamStatus.SCHEDULED, ExamStatus.ONGOING] },
        },
        examSubject: { classId: enrollment.classId },
        OR: [{ sectionId: enrollment.sectionId }, { sectionId: null }],
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: {
        date: true,
        startTime: true,
        endTime: true,
        room: { select: { name: true } },
        exam: { select: { id: true, name: true, type: true } },
        examSubject: {
          select: {
            maxMarks: true,
            subject: { select: { id: true, name: true, code: true, colorHex: true } },
          },
        },
      },
    });

    return schedule;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async create(schoolId: string, dto: CreateExamDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const year = await this.prisma.academicYear.findUniqueOrThrow({
      where: { id: academicYearId },
      select: { isLocked: true, startDate: true, endDate: true, name: true },
    });

    if (year.isLocked) {
      throw new BadRequestError(
        `The ${year.name} academic year is locked`,
        ErrorCode.ACADEMIC_YEAR_LOCKED,
      );
    }

    const startDate = parseDateOnly(dto.startDate);
    const endDate = parseDateOnly(dto.endDate);

    if (endDate < startDate) {
      throw new BadRequestError('The end date cannot be before the start date');
    }
    if (startDate < year.startDate || endDate > year.endDate) {
      throw new BadRequestError(
        `Exam dates must fall within the ${year.name} academic year`,
      );
    }

    const duplicate = await this.prisma.exam.count({
      where: { schoolId, academicYearId, code: dto.code, deletedAt: null },
    });
    if (duplicate > 0) {
      throw new ConflictError(`An exam with the code "${dto.code}" already exists this year`);
    }

    const gradeScaleId =
      dto.gradeScaleId ??
      (
        await this.prisma.gradeScale.findFirst({
          where: { schoolId, isDefault: true },
          select: { id: true },
        })
      )?.id ??
      null;

    const exam = await this.prisma.exam.create({
      data: {
        schoolId,
        academicYearId,
        gradeScaleId,
        name: dto.name,
        code: dto.code,
        type: dto.type,
        description: dto.description ?? null,
        startDate,
        endDate,
        status: ExamStatus.DRAFT,
        weightage: dto.weightage ?? null,
        showRank: dto.showRank ?? true,
        instructions: dto.instructions ?? null,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'exams',
      entity: 'Exam',
      entityId: exam.id,
      description: `Created exam "${exam.name}"`,
      schoolId,
    });

    return exam;
  }

  async update(schoolId: string, id: string, dto: UpdateExamDto) {
    const existing = await this.prisma.exam.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Exam');

    // Once results are out, the exam definition is history.
    if (existing.status === ExamStatus.PUBLISHED) {
      throw new BadRequestError(
        'Results for this exam have been published and its details can no longer be changed',
        ErrorCode.MARKS_LOCKED,
      );
    }

    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        description: dto.description ?? undefined,
        type: dto.type ?? undefined,
        startDate: dto.startDate ? parseDateOnly(dto.startDate) : undefined,
        endDate: dto.endDate ? parseDateOnly(dto.endDate) : undefined,
        weightage: dto.weightage ?? undefined,
        showRank: dto.showRank ?? undefined,
        instructions: dto.instructions ?? undefined,
        gradeScaleId: dto.gradeScaleId ?? undefined,
        resultDate: dto.resultDate ? parseDateOnly(dto.resultDate) : undefined,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'exams',
      entity: 'Exam',
      entityId: id,
      description: `Updated exam "${updated.name}"`,
      ...this.audit.diff(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      ),
      schoolId,
    });

    return updated;
  }

  /**
   * Moves an exam through its lifecycle, enforcing the allowed transitions.
   * Publishing is handled separately because it also locks marks.
   */
  async setStatus(schoolId: string, id: string, status: ExamStatus) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, name: true, status: true, _count: { select: { examSubjects: true } } },
    });
    if (!exam) throw new NotFoundError('Exam');

    const allowed: Record<ExamStatus, ExamStatus[]> = {
      DRAFT: [ExamStatus.SCHEDULED, ExamStatus.CANCELLED],
      SCHEDULED: [ExamStatus.ONGOING, ExamStatus.DRAFT, ExamStatus.CANCELLED],
      ONGOING: [ExamStatus.MARKS_ENTRY, ExamStatus.CANCELLED],
      MARKS_ENTRY: [ExamStatus.COMPLETED, ExamStatus.ONGOING],
      COMPLETED: [ExamStatus.PUBLISHED, ExamStatus.MARKS_ENTRY],
      PUBLISHED: [],
      CANCELLED: [ExamStatus.DRAFT],
    };

    if (!allowed[exam.status].includes(status)) {
      throw new BadRequestError(
        `An exam cannot move from ${exam.status} to ${status}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    if (status === ExamStatus.SCHEDULED && exam._count.examSubjects === 0) {
      throw new BadRequestError('Add subjects to the exam before scheduling it');
    }

    if (status === ExamStatus.PUBLISHED) {
      throw new BadRequestError(
        'Use the publish-results endpoint to release results',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    const updated = await this.prisma.exam.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, status: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'exams',
      entity: 'Exam',
      entityId: id,
      description: `Exam "${exam.name}" moved from ${exam.status} to ${status}`,
      oldValue: { status: exam.status },
      newValue: { status },
      schoolId,
    });

    return updated;
  }

  async remove(schoolId: string, id: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, name: true, status: true, _count: { select: { marks: true } } },
    });
    if (!exam) throw new NotFoundError('Exam');

    if (exam.status === ExamStatus.PUBLISHED) {
      throw new BadRequestError('A published exam cannot be deleted');
    }
    if (exam._count.marks > 0) {
      throw new ConflictError(
        `This exam has ${exam._count.marks} mark(s) recorded. Cancel it instead of deleting it.`,
      );
    }

    await this.prisma.exam.update({
      where: { id },
      data: { deletedAt: new Date(), status: ExamStatus.CANCELLED },
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'exams',
      entity: 'Exam',
      entityId: id,
      description: `Deleted exam "${exam.name}"`,
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Classes and subjects
  // -------------------------------------------------------------------------

  /**
   * Sets which classes sit an exam, and creates an ExamSubject row per class
   * per subject from that class's curriculum.
   */
  async setClasses(schoolId: string, examId: string, dto: SetExamClassesDto) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, schoolId, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (!exam) throw new NotFoundError('Exam');

    if (exam.status === ExamStatus.PUBLISHED) {
      throw new BadRequestError('A published exam cannot be changed', ErrorCode.MARKS_LOCKED);
    }

    const classes = await this.prisma.class.findMany({
      where: { id: { in: dto.classIds }, schoolId },
      select: {
        id: true,
        name: true,
        classSubjects: {
          select: {
            subjectId: true,
            maxMarks: true,
            passMarks: true,
            subject: { select: { isGradedOnly: true } },
          },
        },
      },
    });

    if (classes.length !== dto.classIds.length) {
      throw new BadRequestError('One or more classes do not exist in this school');
    }

    // Removing a class that already has marks would orphan student results.
    const withMarks = await this.prisma.mark.findMany({
      where: { examId, examSubject: { classId: { notIn: dto.classIds } } },
      select: { examSubject: { select: { classId: true } } },
      take: 1,
    });
    if (withMarks.length > 0) {
      throw new ConflictError(
        'Marks have already been entered for a class you are removing. Delete those marks first.',
      );
    }

    const result = await this.prisma.transaction(async (tx) => {
      await tx.examClass.deleteMany({ where: { examId } });
      await tx.examSubject.deleteMany({
        where: { examId, classId: { notIn: dto.classIds } },
      });

      await tx.examClass.createMany({
        data: dto.classIds.map((classId) => ({ examId, classId })),
        skipDuplicates: true,
      });

      let subjectRows = 0;
      for (const cls of classes) {
        // Co-scholastic subjects are graded, not examined.
        const examinable = cls.classSubjects.filter(
          (entry) => !entry.subject.isGradedOnly,
        );

        for (const entry of examinable) {
          await tx.examSubject.upsert({
            where: {
              examId_classId_subjectId: {
                examId,
                classId: cls.id,
                subjectId: entry.subjectId,
              },
            },
            create: {
              examId,
              classId: cls.id,
              subjectId: entry.subjectId,
              maxMarks: dto.defaultMaxMarks ?? entry.maxMarks,
              passMarks: dto.defaultPassMarks ?? entry.passMarks,
            },
            update: {},
          });
          subjectRows += 1;
        }
      }

      return { classes: classes.length, subjects: subjectRows };
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'exams',
      entity: 'Exam',
      entityId: examId,
      description: `Set ${result.classes} class(es) and ${result.subjects} subject(s) for "${exam.name}"`,
      schoolId,
    });

    return result;
  }

  async updateExamSubject(
    schoolId: string,
    examSubjectId: string,
    dto: { maxMarks?: number; passMarks?: number; maxMarksPractical?: number; passMarksPractical?: number },
  ) {
    const examSubject = await this.prisma.examSubject.findFirst({
      where: { id: examSubjectId, exam: { schoolId } },
      select: {
        id: true,
        exam: { select: { status: true, marksLocked: true } },
        _count: { select: { marks: true } },
      },
    });
    if (!examSubject) throw new NotFoundError('Exam subject');

    if (examSubject.exam.marksLocked) {
      throw new BadRequestError('Marks for this exam are locked', ErrorCode.MARKS_LOCKED);
    }

    // Lowering the ceiling below marks already awarded would corrupt results.
    if (dto.maxMarks !== undefined && examSubject._count.marks > 0) {
      const highest = await this.prisma.mark.aggregate({
        where: { examSubjectId },
        _max: { marksObtained: true },
      });
      const max = Number(highest._max.marksObtained ?? 0);
      if (dto.maxMarks < max) {
        throw new BadRequestError(
          `A mark of ${max} has already been recorded, so the maximum cannot be set below it`,
        );
      }
    }

    if (
      dto.passMarks !== undefined &&
      dto.maxMarks !== undefined &&
      dto.passMarks > dto.maxMarks
    ) {
      throw new BadRequestError('The pass mark cannot exceed the maximum mark');
    }

    return this.prisma.examSubject.update({
      where: { id: examSubjectId },
      data: {
        maxMarks: dto.maxMarks ?? undefined,
        passMarks: dto.passMarks ?? undefined,
        maxMarksPractical: dto.maxMarksPractical ?? undefined,
        passMarksPractical: dto.passMarksPractical ?? undefined,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  /**
   * Schedules a subject paper, refusing any arrangement that would put a class
   * in two exam halls at once or double-book a room or invigilator.
   */
  async schedule(schoolId: string, dto: ScheduleExamSubjectDto) {
    const examSubject = await this.prisma.examSubject.findFirst({
      where: { id: dto.examSubjectId, exam: { schoolId, deletedAt: null } },
      select: {
        id: true,
        examId: true,
        classId: true,
        subject: { select: { name: true } },
        exam: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
      },
    });
    if (!examSubject) throw new NotFoundError('Exam subject');

    if (examSubject.exam.status === ExamStatus.PUBLISHED) {
      throw new BadRequestError('A published exam cannot be rescheduled');
    }

    const date = parseDateOnly(dto.date);

    if (date < examSubject.exam.startDate || date > examSubject.exam.endDate) {
      throw new BadRequestError(
        `The paper must be scheduled between ${examSubject.exam.startDate.toISOString().slice(0, 10)} ` +
          `and ${examSubject.exam.endDate.toISOString().slice(0, 10)}`,
      );
    }

    if (this.toMinutes(dto.endTime) <= this.toMinutes(dto.startTime)) {
      throw new BadRequestError('The end time must be after the start time');
    }

    // Other papers on the same day, to check for overlaps.
    const sameDay = await this.prisma.examSchedule.findMany({
      where: {
        date,
        id: dto.scheduleId ? { not: dto.scheduleId } : undefined,
        exam: { schoolId },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        roomId: true,
        invigilatorId: true,
        sectionId: true,
        examSubject: {
          select: { classId: true, subject: { select: { name: true } } },
        },
      },
    });

    const overlapping = sameDay.filter((entry) =>
      timeRangesOverlap(dto.startTime, dto.endTime, entry.startTime, entry.endTime),
    );

    const classClash = overlapping.find(
      (entry) =>
        entry.examSubject.classId === examSubject.classId &&
        (entry.sectionId === (dto.sectionId ?? null) ||
          entry.sectionId === null ||
          !dto.sectionId),
    );
    if (classClash) {
      throw new ConflictError(
        `This class already sits ${classClash.examSubject.subject.name} at that time`,
        ErrorCode.TIMETABLE_SECTION_CONFLICT,
      );
    }

    if (dto.roomId) {
      const roomClash = overlapping.find((entry) => entry.roomId === dto.roomId);
      if (roomClash) {
        throw new ConflictError(
          `That room is already in use for ${roomClash.examSubject.subject.name}`,
          ErrorCode.TIMETABLE_ROOM_CONFLICT,
        );
      }
    }

    if (dto.invigilatorId) {
      const invigilatorClash = overlapping.find(
        (entry) => entry.invigilatorId === dto.invigilatorId,
      );
      if (invigilatorClash) {
        throw new ConflictError(
          `That invigilator is already assigned to ${invigilatorClash.examSubject.subject.name}`,
          ErrorCode.TIMETABLE_TEACHER_CONFLICT,
        );
      }
    }

    const data = {
      examId: examSubject.examId,
      examSubjectId: examSubject.id,
      sectionId: dto.sectionId ?? null,
      roomId: dto.roomId ?? null,
      invigilatorId: dto.invigilatorId ?? null,
      date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      durationMinutes: this.toMinutes(dto.endTime) - this.toMinutes(dto.startTime),
      instructions: dto.instructions ?? null,
    };

    // Prisma cannot target a compound unique that contains a NULL (the
    // all-sections row has `sectionId: null`), so the upsert is done by hand:
    // find the existing slot for this subject+section, then update or create.
    const existing = dto.scheduleId
      ? { id: dto.scheduleId }
      : await this.prisma.examSchedule.findFirst({
          where: { examSubjectId: examSubject.id, sectionId: dto.sectionId ?? null },
          select: { id: true },
        });

    const schedule = existing
      ? await this.prisma.examSchedule.update({ where: { id: existing.id }, data })
      : await this.prisma.examSchedule.create({ data });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'exams',
      entity: 'ExamSchedule',
      entityId: schedule.id,
      description:
        `Scheduled ${examSubject.subject.name} for "${examSubject.exam.name}" ` +
        `on ${dto.date} at ${dto.startTime}`,
      schoolId,
    });

    return schedule;
  }

  /** The full datesheet for an exam, grouped by day. */
  async datesheet(schoolId: string, examId: string, classId?: string) {
    const schedules = await this.prisma.examSchedule.findMany({
      where: {
        examId,
        exam: { schoolId, deletedAt: null },
        ...(classId ? { examSubject: { classId } } : {}),
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        instructions: true,
        room: { select: { id: true, name: true, code: true } },
        invigilator: { select: { id: true, firstName: true, lastName: true } },
        examSubject: {
          select: {
            id: true,
            maxMarks: true,
            passMarks: true,
            classId: true,
            subject: { select: { id: true, name: true, code: true, colorHex: true } },
          },
        },
      },
    });

    const byDate = new Map<string, typeof schedules>();
    for (const schedule of schedules) {
      const key = schedule.date.toISOString().slice(0, 10);
      const bucket = byDate.get(key) ?? [];
      bucket.push(schedule);
      byDate.set(key, bucket);
    }

    return {
      examId,
      totalPapers: schedules.length,
      days: [...byDate.entries()]
        .map(([date, papers]) => ({ date, papers }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async removeSchedule(schoolId: string, id: string) {
    const schedule = await this.prisma.examSchedule.findFirst({
      where: { id, exam: { schoolId } },
      select: { id: true, exam: { select: { status: true } } },
    });
    if (!schedule) throw new NotFoundError('Exam schedule');

    if (schedule.exam.status === ExamStatus.PUBLISHED) {
      throw new BadRequestError('A published exam cannot be rescheduled');
    }

    await this.prisma.examSchedule.delete({ where: { id } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Helpers shared with MarksService
  // -------------------------------------------------------------------------

  /** How many students are expected to have a mark for each exam subject. */
  async expectedMarkCounts(examId: string): Promise<Map<string, number>> {
    const examSubjects = await this.prisma.examSubject.findMany({
      where: { examId },
      select: { id: true, classId: true },
    });

    const classIds = [...new Set(examSubjects.map((entry) => entry.classId))];
    if (classIds.length === 0) return new Map();

    const counts = await this.prisma.enrollment.groupBy({
      by: ['classId'],
      where: { classId: { in: classIds }, status: 'ACTIVE' },
      orderBy: undefined,
      _count: true,
    });
    const byClass = new Map(counts.map((row) => [row.classId, row._count]));

    return new Map(
      examSubjects.map((entry) => [entry.id, byClass.get(entry.classId) ?? 0]),
    );
  }

  assertMarksEditable(exam: { status: ExamStatus; marksLocked: boolean }): void {
    if (exam.marksLocked) {
      throw new BadRequestError(
        'Marks for this exam are locked. An authorised correction is required to change them.',
        ErrorCode.MARKS_LOCKED,
      );
    }
    if (!MARKS_EDITABLE_STATES.includes(exam.status)) {
      throw new BadRequestError(
        `Marks cannot be entered while the exam is ${exam.status}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
  }

  private toMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}
