import { Injectable } from '@nestjs/common';
import { AttendanceStatus, AuditAction, ExamStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../../common/dto/api-response.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { BadRequestError, NotFoundError } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { AuditService } from '../../audit/audit.service';
import { CalendarService } from '../../academics/services/calendar.service';
import { GradingService, type MarkLike } from './grading.service';
import type { GenerateReportCardDto, ReportCardRemarksDto } from '../dto/exam.dto';

interface SubjectRow {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  isGradedOnly: boolean;
  /** Per-exam contribution, so the card can show a breakdown. */
  exams: Array<{
    examId: string;
    examName: string;
    maxMarks: number;
    obtained: number | null;
    grade: string | null;
    isAbsent: boolean;
  }>;
  totalMax: number;
  totalObtained: number | null;
  percentage: number | null;
  grade: string | null;
  isPass: boolean | null;
}

/**
 * Report cards aggregate several exams into one term result.
 *
 * The computed rows are stored as a snapshot on the ReportCard so a card
 * remains reproducible even if a later authorised mark correction changes the
 * underlying data — the card is a document issued at a point in time.
 */
@Injectable()
export class ReportCardsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly grading: GradingService,
    private readonly calendar: CalendarService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('ReportCardsService');
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  async generate(schoolId: string, dto: GenerateReportCardDto) {
    const exams = await this.prisma.exam.findMany({
      where: { id: { in: dto.examIds }, schoolId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        weightage: true,
        academicYearId: true,
        gradeScaleId: true,
      },
    });

    if (exams.length !== dto.examIds.length) {
      throw new BadRequestError('One or more exams do not exist in this school');
    }

    const unpublished = exams.filter((exam) => exam.status !== ExamStatus.PUBLISHED);
    if (unpublished.length > 0) {
      throw new BadRequestError(
        `Results are not published for: ${unpublished.map((exam) => exam.name).join(', ')}`,
        ErrorCode.RESULTS_NOT_PUBLISHED,
      );
    }

    const academicYearIds = new Set(exams.map((exam) => exam.academicYearId));
    if (academicYearIds.size > 1) {
      throw new BadRequestError('All exams on a report card must belong to the same academic year');
    }
    const academicYearId = exams[0].academicYearId;

    // Which students to generate for.
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        schoolId,
        academicYearId,
        status: 'ACTIVE',
        ...(dto.studentId ? { studentId: dto.studentId } : {}),
        ...(dto.sectionId ? { sectionId: dto.sectionId } : {}),
        ...(!dto.studentId && !dto.sectionId
          ? { class: { examClasses: { some: { examId: { in: dto.examIds } } } } }
          : {}),
      },
      select: {
        studentId: true,
        classId: true,
        sectionId: true,
        rollNumber: true,
        student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
      },
    });

    if (enrollments.length === 0) {
      throw new BadRequestError('No enrolled students matched the given criteria');
    }

    const bands = exams[0].gradeScaleId
      ? await this.grading.loadBands(exams[0].gradeScaleId)
      : [];

    // Attendance denominator for the whole academic year.
    const year = await this.prisma.academicYear.findUniqueOrThrow({
      where: { id: academicYearId },
      select: { startDate: true, endDate: true },
    });
    const upperBound = year.endDate < new Date() ? year.endDate : new Date();
    const workingDays = await this.calendar.workingDaysBetween(
      schoolId,
      year.startDate,
      upperBound,
    );

    const studentIds = enrollments.map((entry) => entry.studentId);

    const [allMarks, attendance] = await Promise.all([
      this.prisma.mark.findMany({
        where: { examId: { in: dto.examIds }, studentId: { in: studentIds } },
        select: {
          studentId: true,
          examId: true,
          totalMarks: true,
          grade: true,
          isAbsent: true,
          isExempted: true,
          subject: { select: { id: true, name: true, code: true, isGradedOnly: true } },
          examSubject: { select: { maxMarks: true, passMarks: true, maxMarksPractical: true } },
        },
      }),
      this.prisma.attendance.groupBy({
        by: ['studentId', 'status'],
        where: {
          schoolId,
          studentId: { in: studentIds },
          sessionType: 'DAILY',
          date: { gte: year.startDate, lte: upperBound },
        },
        orderBy: undefined,
        _count: true,
      }),
    ]);

    const examById = new Map(exams.map((exam) => [exam.id, exam]));
    const marksByStudent = new Map<string, typeof allMarks>();
    for (const mark of allMarks) {
      const bucket = marksByStudent.get(mark.studentId) ?? [];
      bucket.push(mark);
      marksByStudent.set(mark.studentId, bucket);
    }

    const attendanceByStudent = new Map<string, Record<string, number>>();
    for (const row of attendance) {
      const bucket = attendanceByStudent.get(row.studentId) ?? {};
      bucket[row.status] = row._count;
      attendanceByStudent.set(row.studentId, bucket);
    }

    // Build every card first, then rank, then write.
    const drafts = enrollments.map((enrollment) => {
      const marks = marksByStudent.get(enrollment.studentId) ?? [];
      const subjects = this.buildSubjectRows(marks, examById, bands);
      const summary = this.grading.summariseWithGrade(marks as MarkLike[], bands);

      const counts = attendanceByStudent.get(enrollment.studentId) ?? {};
      const present =
        (counts.PRESENT ?? 0) +
        (counts.LATE ?? 0) +
        (counts.EXCUSED ?? 0) +
        (counts.HALF_DAY ?? 0) * 0.5;
      const totalDays = Object.entries(counts)
        .filter(([status]) => status !== AttendanceStatus.HOLIDAY)
        .reduce((sum, [, count]) => sum + count, 0);

      return {
        enrollment,
        subjects,
        summary,
        attendance: {
          attendedDays: Math.round(present),
          totalDays: totalDays || workingDays.workingDays,
          percent:
            totalDays > 0 ? Number(((present / totalDays) * 100).toFixed(2)) : null,
        },
      };
    });

    // Rank within the class, sharing positions on a tie.
    const byClass = new Map<string, typeof drafts>();
    for (const draft of drafts) {
      const bucket = byClass.get(draft.enrollment.classId) ?? [];
      bucket.push(draft);
      byClass.set(draft.enrollment.classId, bucket);
    }

    const rankByStudent = new Map<string, { rank: number; outOf: number }>();
    for (const [, classDrafts] of byClass) {
      const ranked = classDrafts
        .filter((draft) => draft.summary.percentage !== null)
        .sort((a, b) => (b.summary.percentage ?? 0) - (a.summary.percentage ?? 0));

      let position = 0;
      let previous: number | null = null;

      ranked.forEach((draft, index) => {
        if (draft.summary.percentage !== previous) {
          position = index + 1;
          previous = draft.summary.percentage;
        }
        rankByStudent.set(draft.enrollment.studentId, {
          rank: position,
          outOf: ranked.length,
        });
      });
    }

    const generatedAt = new Date();

    const cards = await this.prisma.transaction(
      async (tx) => {
        const created: string[] = [];

        for (const draft of drafts) {
          const rank = rankByStudent.get(draft.enrollment.studentId);

          const card = await tx.reportCard.upsert({
            where: {
              studentId_academicYearId_term: {
                studentId: draft.enrollment.studentId,
                academicYearId,
                term: dto.term,
              },
            },
            create: {
              schoolId,
              academicYearId,
              studentId: draft.enrollment.studentId,
              classId: draft.enrollment.classId,
              sectionId: draft.enrollment.sectionId,
              term: dto.term,
              totalMarks: draft.summary.totalMaxMarks,
              obtainedMarks: draft.summary.totalObtained,
              percentage: draft.summary.percentage,
              grade: draft.summary.grade,
              gradePoint: draft.summary.gradePoint,
              rank: rank?.rank ?? null,
              rankOutOf: rank?.outOf ?? null,
              result: draft.summary.result,
              attendedDays: draft.attendance.attendedDays,
              totalDays: draft.attendance.totalDays,
              attendancePercent: draft.attendance.percent,
              principalRemarks: dto.principalRemarks ?? null,
              snapshot: {
                subjects: draft.subjects,
                summary: draft.summary,
                attendance: draft.attendance,
                exams: exams.map((exam) => ({
                  id: exam.id,
                  name: exam.name,
                  weightage: exam.weightage ? Number(exam.weightage) : null,
                })),
                generatedAt: generatedAt.toISOString(),
              } as unknown as Prisma.InputJsonValue,
              generatedAt,
              publishedAt: dto.publish ? generatedAt : null,
              exams: {
                create: exams.map((exam) => ({
                  examId: exam.id,
                  weightage: exam.weightage,
                })),
              },
            },
            update: {
              totalMarks: draft.summary.totalMaxMarks,
              obtainedMarks: draft.summary.totalObtained,
              percentage: draft.summary.percentage,
              grade: draft.summary.grade,
              gradePoint: draft.summary.gradePoint,
              rank: rank?.rank ?? null,
              rankOutOf: rank?.outOf ?? null,
              result: draft.summary.result,
              attendedDays: draft.attendance.attendedDays,
              totalDays: draft.attendance.totalDays,
              attendancePercent: draft.attendance.percent,
              snapshot: {
                subjects: draft.subjects,
                summary: draft.summary,
                attendance: draft.attendance,
                exams: exams.map((exam) => ({
                  id: exam.id,
                  name: exam.name,
                  weightage: exam.weightage ? Number(exam.weightage) : null,
                })),
                generatedAt: generatedAt.toISOString(),
              } as unknown as Prisma.InputJsonValue,
              generatedAt,
              ...(dto.publish ? { publishedAt: generatedAt } : {}),
              ...(dto.principalRemarks ? { principalRemarks: dto.principalRemarks } : {}),
            },
            select: { id: true },
          });

          created.push(card.id);
        }

        return created;
      },
      { timeout: 120_000 },
    );

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'exams',
      entity: 'ReportCard',
      description:
        `Generated ${cards.length} report card(s) for "${dto.term}" ` +
        `from ${exams.length} exam(s)`,
      newValue: { term: dto.term, examIds: dto.examIds, count: cards.length },
      schoolId,
    });

    this.log.info('Report cards generated', {
      schoolId,
      term: dto.term,
      count: cards.length,
      published: Boolean(dto.publish),
    });

    return {
      term: dto.term,
      generated: cards.length,
      published: Boolean(dto.publish),
      reportCardIds: cards,
    };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findAll(
    schoolId: string,
    query: PaginationQueryDto & {
      academicYearId?: string;
      classId?: string;
      sectionId?: string;
      studentId?: string;
      term?: string;
      publishedOnly?: boolean;
    },
  ) {
    const where: Prisma.ReportCardWhereInput = {
      schoolId,
      ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.term ? { term: query.term } : {}),
      ...(query.publishedOnly ? { publishedAt: { not: null } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.reportCard.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ generatedAt: 'desc' }, { rank: 'asc' }],
        select: {
          id: true,
          term: true,
          totalMarks: true,
          obtainedMarks: true,
          percentage: true,
          grade: true,
          rank: true,
          rankOutOf: true,
          result: true,
          attendancePercent: true,
          generatedAt: true,
          publishedAt: true,
          pdfUrl: true,
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
        },
      }),
      this.prisma.reportCard.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  async findOne(schoolId: string, id: string) {
    const card = await this.prisma.reportCard.findFirst({
      where: { id, schoolId },
      include: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            photoUrl: true,
            dateOfBirth: true,
            guardians: {
              where: { isPrimary: true },
              take: 1,
              select: { guardian: { select: { firstName: true, lastName: true } } },
            },
          },
        },
        class: { select: { id: true, name: true } },
        section: {
          select: {
            id: true,
            name: true,
            classTeacher: { select: { firstName: true, lastName: true } },
          },
        },
        academicYear: { select: { id: true, name: true } },
        exams: { include: { exam: { select: { id: true, name: true, type: true } } } },
      },
    });

    if (!card) throw new NotFoundError('Report card');

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: {
        name: true,
        logoUrl: true,
        addressLine1: true,
        city: true,
        state: true,
        phone: true,
        email: true,
        reportCardHeader: true,
        principalName: true,
      },
    });

    return { ...card, school };
  }

  /** Report cards a student or parent may see: published ones only. */
  async forStudent(schoolId: string, studentId: string) {
    return this.prisma.reportCard.findMany({
      where: { schoolId, studentId, publishedAt: { not: null } },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        term: true,
        totalMarks: true,
        obtainedMarks: true,
        percentage: true,
        grade: true,
        rank: true,
        rankOutOf: true,
        result: true,
        attendancePercent: true,
        publishedAt: true,
        pdfUrl: true,
        academicYear: { select: { name: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
      },
    });
  }

  async setRemarks(schoolId: string, id: string, dto: ReportCardRemarksDto) {
    const card = await this.prisma.reportCard.findFirst({
      where: { id, schoolId },
      select: { id: true },
    });
    if (!card) throw new NotFoundError('Report card');

    return this.prisma.reportCard.update({
      where: { id },
      data: {
        classTeacherRemarks: dto.classTeacherRemarks ?? undefined,
        principalRemarks: dto.principalRemarks ?? undefined,
      },
    });
  }

  async publish(schoolId: string, ids: string[]) {
    const result = await this.prisma.reportCard.updateMany({
      where: { id: { in: ids }, schoolId, publishedAt: null },
      data: { publishedAt: new Date() },
    });

    this.audit.record({
      action: AuditAction.MARKS_PUBLISH,
      module: 'exams',
      entity: 'ReportCard',
      description: `Published ${result.count} report card(s)`,
      schoolId,
    });

    return { published: result.count };
  }

  // -------------------------------------------------------------------------

  /**
   * Collapses several exams into one row per subject.
   *
   * When exams carry a weightage the contribution is scaled accordingly;
   * otherwise the raw marks are simply summed.
   */
  private buildSubjectRows(
    marks: Array<{
      examId: string;
      totalMarks: Prisma.Decimal | null;
      grade: string | null;
      isAbsent: boolean;
      isExempted: boolean;
      subject: { id: string; name: string; code: string; isGradedOnly: boolean };
      examSubject: {
        maxMarks: Prisma.Decimal;
        passMarks: Prisma.Decimal;
        maxMarksPractical: Prisma.Decimal | null;
      };
    }>,
    examById: Map<string, { id: string; name: string; weightage: Prisma.Decimal | null }>,
    bands: Parameters<GradingService['gradeFor']>[2],
  ): SubjectRow[] {
    const bySubject = new Map<string, typeof marks>();
    for (const mark of marks) {
      const bucket = bySubject.get(mark.subject.id) ?? [];
      bucket.push(mark);
      bySubject.set(mark.subject.id, bucket);
    }

    return [...bySubject.entries()].map(([subjectId, subjectMarks]) => {
      const first = subjectMarks[0];

      const examRows = subjectMarks.map((mark) => {
        const maxMarks =
          Number(mark.examSubject.maxMarks) + Number(mark.examSubject.maxMarksPractical ?? 0);
        return {
          examId: mark.examId,
          examName: examById.get(mark.examId)?.name ?? 'Exam',
          maxMarks,
          obtained: mark.totalMarks === null ? null : Number(mark.totalMarks),
          grade: mark.grade,
          isAbsent: mark.isAbsent,
        };
      });

      const counted = subjectMarks.filter((mark) => !mark.isExempted);
      const totalMax = counted.reduce(
        (sum, mark) =>
          sum +
          Number(mark.examSubject.maxMarks) +
          Number(mark.examSubject.maxMarksPractical ?? 0),
        0,
      );
      const anyPending = counted.some(
        (mark) => !mark.isAbsent && mark.totalMarks === null,
      );
      const totalObtained = anyPending
        ? null
        : counted.reduce((sum, mark) => sum + Number(mark.totalMarks ?? 0), 0);

      const percentage =
        totalObtained !== null && totalMax > 0
          ? Number(((totalObtained / totalMax) * 100).toFixed(2))
          : null;

      const grade =
        totalObtained !== null && totalMax > 0
          ? this.grading.gradeFor(totalObtained, totalMax, bands)
          : null;

      const passMarksTotal = counted.reduce(
        (sum, mark) => sum + Number(mark.examSubject.passMarks),
        0,
      );

      return {
        subjectId,
        subjectName: first.subject.name,
        subjectCode: first.subject.code,
        isGradedOnly: first.subject.isGradedOnly,
        exams: examRows,
        totalMax,
        totalObtained,
        percentage,
        grade: grade?.grade ?? null,
        isPass: totalObtained === null ? null : totalObtained >= passMarksTotal,
      };
    });
  }
}
