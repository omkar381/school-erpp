import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  ExamStatus,
  MarkStatus,
  NotificationType,
  Prisma,
  Priority,
} from '@prisma/client';
import { PrismaService, type TransactionClient } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { PERMISSIONS } from '../../../common/constants/permissions';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ExamsService } from './exams.service';
import { GradingService } from './grading.service';
import type { CorrectMarkDto, EnterMarksDto, PublishResultsDto } from '../dto/exam.dto';

@Injectable()
export class MarksService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exams: ExamsService,
    private readonly grading: GradingService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('MarksService');
  }

  // -------------------------------------------------------------------------
  // Entry sheet
  // -------------------------------------------------------------------------

  /**
   * The marks-entry grid: every enrolled student for a subject, with whatever
   * has already been recorded. Teachers work from this rather than a blank form.
   */
  async entrySheet(schoolId: string, examSubjectId: string, sectionId?: string) {
    const examSubject = await this.prisma.examSubject.findFirst({
      where: { id: examSubjectId, exam: { schoolId, deletedAt: null } },
      select: {
        id: true,
        classId: true,
        maxMarks: true,
        passMarks: true,
        maxMarksPractical: true,
        passMarksPractical: true,
        subject: { select: { id: true, name: true, code: true, hasPractical: true } },
        exam: {
          select: {
            id: true,
            name: true,
            status: true,
            marksLocked: true,
            gradeScale: {
              select: { id: true, usePercentage: true, bands: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
      },
    });
    if (!examSubject) throw new NotFoundError('Exam subject');

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classId: examSubject.classId,
        status: 'ACTIVE',
        ...(sectionId ? { sectionId } : {}),
      },
      orderBy: [{ section: { name: 'asc' } }, { rollNumber: 'asc' }],
      select: {
        rollNumber: true,
        section: { select: { id: true, name: true } },
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            photoUrl: true,
          },
        },
      },
    });

    const marks = await this.prisma.mark.findMany({
      where: {
        examSubjectId,
        studentId: { in: enrollments.map((entry) => entry.student.id) },
      },
      select: {
        id: true,
        studentId: true,
        marksObtained: true,
        practicalMarks: true,
        totalMarks: true,
        grade: true,
        isAbsent: true,
        isExempted: true,
        remarks: true,
        status: true,
        enteredAt: true,
      },
    });

    const byStudent = new Map(marks.map((mark) => [mark.studentId, mark]));

    return {
      examSubject: {
        id: examSubject.id,
        subject: examSubject.subject,
        maxMarks: Number(examSubject.maxMarks),
        passMarks: Number(examSubject.passMarks),
        maxMarksPractical: examSubject.maxMarksPractical
          ? Number(examSubject.maxMarksPractical)
          : null,
        passMarksPractical: examSubject.passMarksPractical
          ? Number(examSubject.passMarksPractical)
          : null,
      },
      exam: {
        id: examSubject.exam.id,
        name: examSubject.exam.name,
        status: examSubject.exam.status,
        marksLocked: examSubject.exam.marksLocked,
      },
      isEditable:
        !examSubject.exam.marksLocked &&
        examSubject.exam.status !== ExamStatus.PUBLISHED &&
        examSubject.exam.status !== ExamStatus.DRAFT,
      totalStudents: enrollments.length,
      entered: marks.length,
      rows: enrollments.map((entry) => {
        const mark = byStudent.get(entry.student.id);
        return {
          student: {
            ...entry.student,
            fullName: [entry.student.firstName, entry.student.middleName, entry.student.lastName]
              .filter(Boolean)
              .join(' '),
          },
          rollNumber: entry.rollNumber,
          section: entry.section,
          mark: mark
            ? {
                ...mark,
                marksObtained: mark.marksObtained ? Number(mark.marksObtained) : null,
                practicalMarks: mark.practicalMarks ? Number(mark.practicalMarks) : null,
                totalMarks: mark.totalMarks ? Number(mark.totalMarks) : null,
              }
            : null,
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Entry
  // -------------------------------------------------------------------------

  /**
   * Records marks for a whole subject in one transaction.
   *
   * Every value is validated against the subject's ceiling before anything is
   * written, so a typo in row 40 cannot leave rows 1-39 saved and the rest not.
   */
  async enter(schoolId: string, dto: EnterMarksDto, user: AuthenticatedUser) {
    const examSubject = await this.prisma.examSubject.findFirst({
      where: { id: dto.examSubjectId, exam: { schoolId, deletedAt: null } },
      select: {
        id: true,
        examId: true,
        classId: true,
        subjectId: true,
        maxMarks: true,
        passMarks: true,
        maxMarksPractical: true,
        subject: { select: { name: true } },
        exam: {
          select: {
            id: true,
            name: true,
            status: true,
            marksLocked: true,
            gradeScaleId: true,
          },
        },
      },
    });
    if (!examSubject) throw new NotFoundError('Exam subject');

    this.exams.assertMarksEditable(examSubject.exam);
    await this.assertCanEnterMarks(user, examSubject.classId, examSubject.subjectId);

    const maxMarks = Number(examSubject.maxMarks);
    const maxPractical = examSubject.maxMarksPractical
      ? Number(examSubject.maxMarksPractical)
      : 0;

    // --- Validate the whole payload first ---
    const errors: Array<{ studentId: string; message: string }> = [];

    for (const entry of dto.marks) {
      if (entry.isAbsent || entry.isExempted) continue;

      if (entry.marksObtained === undefined || entry.marksObtained === null) {
        errors.push({ studentId: entry.studentId, message: 'Marks are required' });
        continue;
      }
      if (entry.marksObtained < 0) {
        errors.push({ studentId: entry.studentId, message: 'Marks cannot be negative' });
      }
      if (entry.marksObtained > maxMarks) {
        errors.push({
          studentId: entry.studentId,
          message: `Marks cannot exceed the maximum of ${maxMarks}`,
        });
      }
      if (entry.practicalMarks !== undefined && entry.practicalMarks !== null) {
        if (maxPractical === 0) {
          errors.push({
            studentId: entry.studentId,
            message: 'This subject has no practical component',
          });
        } else if (entry.practicalMarks > maxPractical) {
          errors.push({
            studentId: entry.studentId,
            message: `Practical marks cannot exceed ${maxPractical}`,
          });
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestError(
        `${errors.length} mark(s) are invalid and nothing has been saved`,
        ErrorCode.MARKS_EXCEED_MAXIMUM,
        { errors },
      );
    }

    // Students must actually be enrolled in the class sitting the paper.
    const enrolled = await this.prisma.enrollment.findMany({
      where: {
        classId: examSubject.classId,
        status: 'ACTIVE',
        studentId: { in: dto.marks.map((entry) => entry.studentId) },
      },
      select: { studentId: true },
    });
    const enrolledIds = new Set(enrolled.map((entry) => entry.studentId));
    const strangers = dto.marks.filter((entry) => !enrolledIds.has(entry.studentId));

    if (strangers.length > 0) {
      throw new BadRequestError(
        `${strangers.length} student(s) are not enrolled in the class sitting this paper`,
      );
    }

    const bands = examSubject.exam.gradeScaleId
      ? await this.grading.loadBands(examSubject.exam.gradeScaleId)
      : [];

    const existing = await this.prisma.mark.findMany({
      where: {
        examSubjectId: examSubject.id,
        studentId: { in: dto.marks.map((entry) => entry.studentId) },
      },
      select: { id: true, studentId: true, marksObtained: true, isAbsent: true },
    });
    const existingByStudent = new Map(existing.map((mark) => [mark.studentId, mark]));

    const result = await this.prisma.transaction(
      async (tx) => {
        let created = 0;
        let updated = 0;

        for (const entry of dto.marks) {
          const theory = entry.isAbsent || entry.isExempted ? null : (entry.marksObtained ?? 0);
          const practical =
            entry.isAbsent || entry.isExempted ? null : (entry.practicalMarks ?? null);
          const total =
            theory === null ? null : Number((theory + (practical ?? 0)).toFixed(2));

          const grade =
            total === null
              ? null
              : this.grading.gradeFor(total, maxMarks + maxPractical, bands);

          const payload = {
            marksObtained: theory,
            practicalMarks: practical,
            totalMarks: total,
            grade: grade?.grade ?? null,
            gradePoint: grade?.gradePoint ?? null,
            isAbsent: entry.isAbsent ?? false,
            isExempted: entry.isExempted ?? false,
            remarks: entry.remarks ?? null,
            status: MarkStatus.ENTERED,
            enteredById: user.staffId,
            enteredAt: new Date(),
          };

          const previous = existingByStudent.get(entry.studentId);

          if (previous) {
            await tx.mark.update({ where: { id: previous.id }, data: payload });
            updated += 1;
          } else {
            await tx.mark.create({
              data: {
                examId: examSubject.examId,
                examSubjectId: examSubject.id,
                studentId: entry.studentId,
                subjectId: examSubject.subjectId,
                ...payload,
              },
            });
            created += 1;
          }
        }

        // Entering the first marks moves the exam into the marks-entry phase.
        if (examSubject.exam.status === ExamStatus.ONGOING) {
          await tx.exam.update({
            where: { id: examSubject.examId },
            data: { status: ExamStatus.MARKS_ENTRY },
          });
        }

        return { created, updated };
      },
      { timeout: 30_000 },
    );

    this.audit.record({
      action: AuditAction.MARKS_UPDATE,
      module: 'exams',
      entity: 'ExamSubject',
      entityId: examSubject.id,
      description:
        `Entered marks for ${examSubject.subject.name} in "${examSubject.exam.name}" ` +
        `(${result.created} new, ${result.updated} updated)`,
      schoolId,
    });

    this.log.info('Marks entered', {
      schoolId,
      examSubjectId: examSubject.id,
      ...result,
    });

    return { examSubjectId: examSubject.id, ...result, total: dto.marks.length };
  }

  /**
   * Changes a single mark after it has been locked.
   *
   * This is deliberately a separate, more heavily guarded path: it requires the
   * elevated permission, demands a written reason, and writes an immutable
   * MarkRevision row so the original value is never lost.
   */
  async correct(schoolId: string, markId: string, dto: CorrectMarkDto, user: AuthenticatedUser) {
    if (
      !user.isSuperAdmin &&
      !user.permissions.includes(PERMISSIONS.EXAMS_EDIT_LOCKED_MARKS)
    ) {
      throw new ForbiddenError(
        'Changing a locked mark requires the examination controller permission',
        ErrorCode.MISSING_PERMISSION,
      );
    }

    const mark = await this.prisma.mark.findFirst({
      where: { id: markId, exam: { schoolId } },
      select: {
        id: true,
        marksObtained: true,
        practicalMarks: true,
        totalMarks: true,
        grade: true,
        isAbsent: true,
        remarks: true,
        status: true,
        student: { select: { id: true, admissionNumber: true, firstName: true, lastName: true } },
        examSubject: {
          select: {
            maxMarks: true,
            maxMarksPractical: true,
            subject: { select: { name: true } },
          },
        },
        exam: { select: { id: true, name: true, gradeScaleId: true, status: true } },
      },
    });
    if (!mark) throw new NotFoundError('Mark');

    const maxMarks = Number(mark.examSubject.maxMarks);
    const maxPractical = mark.examSubject.maxMarksPractical
      ? Number(mark.examSubject.maxMarksPractical)
      : 0;

    if (!dto.isAbsent && dto.marksObtained !== undefined) {
      if (dto.marksObtained < 0 || dto.marksObtained > maxMarks) {
        throw new BadRequestError(
          `Marks must be between 0 and ${maxMarks}`,
          ErrorCode.MARKS_EXCEED_MAXIMUM,
        );
      }
    }

    const bands = mark.exam.gradeScaleId
      ? await this.grading.loadBands(mark.exam.gradeScaleId)
      : [];

    const theory = dto.isAbsent ? null : (dto.marksObtained ?? Number(mark.marksObtained ?? 0));
    const practical = dto.isAbsent
      ? null
      : (dto.practicalMarks ?? (mark.practicalMarks ? Number(mark.practicalMarks) : null));
    const total = theory === null ? null : Number((theory + (practical ?? 0)).toFixed(2));
    const grade =
      total === null ? null : this.grading.gradeFor(total, maxMarks + maxPractical, bands);

    const previousValue = {
      marksObtained: mark.marksObtained ? Number(mark.marksObtained) : null,
      practicalMarks: mark.practicalMarks ? Number(mark.practicalMarks) : null,
      totalMarks: mark.totalMarks ? Number(mark.totalMarks) : null,
      grade: mark.grade,
      isAbsent: mark.isAbsent,
      remarks: mark.remarks,
    };

    const newValue = {
      marksObtained: theory,
      practicalMarks: practical,
      totalMarks: total,
      grade: grade?.grade ?? null,
      isAbsent: dto.isAbsent ?? false,
      remarks: dto.remarks ?? mark.remarks,
    };

    const updated = await this.prisma.transaction(async (tx) => {
      // The revision row is the permanent record of what changed and why.
      await tx.markRevision.create({
        data: {
          markId,
          previousValue: previousValue as Prisma.InputJsonValue,
          newValue: newValue as Prisma.InputJsonValue,
          reason: dto.reason,
          changedById: user.id,
          approvedById: dto.approvedById ?? user.id,
        },
      });

      return tx.mark.update({
        where: { id: markId },
        data: {
          marksObtained: theory,
          practicalMarks: practical,
          totalMarks: total,
          grade: grade?.grade ?? null,
          gradePoint: grade?.gradePoint ?? null,
          isAbsent: dto.isAbsent ?? false,
          remarks: dto.remarks ?? undefined,
        },
      });
    });

    this.audit.record({
      action: AuditAction.MARKS_UPDATE,
      module: 'exams',
      entity: 'Mark',
      entityId: markId,
      description:
        `Corrected ${mark.examSubject.subject.name} mark for ${mark.student.admissionNumber} ` +
        `in "${mark.exam.name}": ${previousValue.totalMarks} to ${total}. Reason: ${dto.reason}`,
      oldValue: previousValue,
      newValue,
      schoolId,
    });

    this.log.warn('Locked mark corrected', {
      schoolId,
      markId,
      studentId: mark.student.id,
      by: user.id,
    });

    return updated;
  }

  async revisionHistory(schoolId: string, markId: string) {
    const mark = await this.prisma.mark.count({ where: { id: markId, exam: { schoolId } } });
    if (mark === 0) throw new NotFoundError('Mark');

    return this.prisma.markRevision.findMany({
      where: { markId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -------------------------------------------------------------------------
  // Locking and publishing
  // -------------------------------------------------------------------------

  async lock(schoolId: string, examId: string, locked: boolean) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, schoolId, deletedAt: null },
      select: { id: true, name: true, status: true, marksLocked: true },
    });
    if (!exam) throw new NotFoundError('Exam');

    await this.prisma.$transaction([
      this.prisma.exam.update({ where: { id: examId }, data: { marksLocked: locked } }),
      this.prisma.mark.updateMany({
        where: { examId, status: { not: MarkStatus.PUBLISHED } },
        data: {
          status: locked ? MarkStatus.LOCKED : MarkStatus.ENTERED,
          lockedAt: locked ? new Date() : null,
        },
      }),
    ]);

    this.audit.record({
      action: AuditAction.MARKS_UPDATE,
      module: 'exams',
      entity: 'Exam',
      entityId: examId,
      description: `${locked ? 'Locked' : 'Unlocked'} marks for "${exam.name}"`,
      schoolId,
    });

    return { examId, marksLocked: locked };
  }

  /**
   * Releases results to students and parents.
   *
   * Publishing is irreversible by design: it locks the marks, stamps them as
   * published and notifies every family. Incomplete marks entry blocks it
   * unless the caller explicitly acknowledges the gap.
   */
  async publish(schoolId: string, examId: string, dto: PublishResultsDto, user: AuthenticatedUser) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, schoolId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        academicYearId: true,
        examSubjects: { select: { id: true, subject: { select: { name: true } } } },
      },
    });
    if (!exam) throw new NotFoundError('Exam');

    if (exam.status === ExamStatus.PUBLISHED) {
      throw new BadRequestError('Results for this exam have already been published');
    }
    if (exam.status === ExamStatus.DRAFT || exam.status === ExamStatus.CANCELLED) {
      throw new BadRequestError(
        `Results cannot be published while the exam is ${exam.status}`,
        ErrorCode.EXAM_NOT_PUBLISHABLE,
      );
    }

    // Check marks-entry completeness before releasing anything.
    const expected = await this.exams.expectedMarkCounts(examId);
    const actual = await this.prisma.mark.groupBy({
      by: ['examSubjectId'],
      where: { examId },
      orderBy: undefined,
      _count: true,
    });
    const actualBySubject = new Map(actual.map((row) => [row.examSubjectId, row._count]));

    const incomplete = exam.examSubjects
      .map((subject) => ({
        subject: subject.subject.name,
        entered: actualBySubject.get(subject.id) ?? 0,
        expected: expected.get(subject.id) ?? 0,
      }))
      .filter((entry) => entry.entered < entry.expected);

    if (incomplete.length > 0 && !dto.publishIncomplete) {
      throw new BadRequestError(
        `Marks are incomplete for ${incomplete.length} subject(s). ` +
          'Complete them, or confirm publishing with incomplete marks.',
        ErrorCode.EXAM_NOT_PUBLISHABLE,
        { incomplete },
      );
    }

    const publishedAt = new Date();

    await this.prisma.transaction(
      async (tx) => {
        await tx.mark.updateMany({
          where: { examId },
          data: { status: MarkStatus.PUBLISHED, publishedAt, lockedAt: publishedAt },
        });

        await tx.exam.update({
          where: { id: examId },
          data: {
            status: ExamStatus.PUBLISHED,
            marksLocked: true,
            publishedAt,
            publishedById: user.id,
            resultDate: dto.resultDate ? new Date(dto.resultDate) : publishedAt,
          },
        });
      },
      { timeout: 30_000 },
    );

    this.audit.record({
      action: AuditAction.MARKS_PUBLISH,
      module: 'exams',
      entity: 'Exam',
      entityId: examId,
      description:
        `Published results for "${exam.name}"` +
        (incomplete.length > 0 ? ` with ${incomplete.length} incomplete subject(s)` : ''),
      newValue: { publishedAt, incomplete },
      schoolId,
    });

    if (dto.notify !== false) {
      void this.notifyResults(schoolId, exam.id, exam.name).catch((error) =>
        this.log.error('Failed to notify about published results', error, { examId }),
      );
    }

    this.log.info('Exam results published', { schoolId, examId, incomplete: incomplete.length });

    return {
      examId,
      publishedAt,
      incompleteSubjects: incomplete,
    };
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  /** A single student's result for one exam, with rank if enabled. */
  async studentResult(schoolId: string, examId: string, studentId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, schoolId, deletedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        showRank: true,
        startDate: true,
        endDate: true,
        resultDate: true,
        gradeScale: { select: { bands: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    if (!exam) throw new NotFoundError('Exam');

    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new BadRequestError(
        'Results for this exam have not been published yet',
        ErrorCode.RESULTS_NOT_PUBLISHED,
      );
    }

    const marks = await this.prisma.mark.findMany({
      where: { examId, studentId },
      select: {
        id: true,
        marksObtained: true,
        practicalMarks: true,
        totalMarks: true,
        grade: true,
        gradePoint: true,
        isAbsent: true,
        isExempted: true,
        remarks: true,
        subject: { select: { id: true, name: true, code: true, isGradedOnly: true } },
        examSubject: { select: { maxMarks: true, passMarks: true, maxMarksPractical: true } },
      },
    });

    if (marks.length === 0) throw new NotFoundError('Result for this student');

    const summary = this.grading.summarise(marks);

    let rank: { position: number; outOf: number } | null = null;
    if (exam.showRank) {
      rank = await this.grading.rankFor(examId, studentId);
    }

    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      select: {
        id: true,
        admissionNumber: true,
        firstName: true,
        middleName: true,
        lastName: true,
        photoUrl: true,
        enrollments: {
          where: { status: 'ACTIVE' },
          take: 1,
          select: {
            rollNumber: true,
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
      },
    });

    return {
      exam,
      student: {
        ...student,
        fullName: [student.firstName, student.middleName, student.lastName]
          .filter(Boolean)
          .join(' '),
        enrollment: student.enrollments[0] ?? null,
      },
      subjects: marks.map((mark) => ({
        subject: mark.subject,
        maxMarks: Number(mark.examSubject.maxMarks),
        passMarks: Number(mark.examSubject.passMarks),
        marksObtained: mark.marksObtained ? Number(mark.marksObtained) : null,
        practicalMarks: mark.practicalMarks ? Number(mark.practicalMarks) : null,
        totalMarks: mark.totalMarks ? Number(mark.totalMarks) : null,
        grade: mark.grade,
        gradePoint: mark.gradePoint ? Number(mark.gradePoint) : null,
        isAbsent: mark.isAbsent,
        isExempted: mark.isExempted,
        isPass:
          !mark.isAbsent &&
          mark.totalMarks !== null &&
          Number(mark.totalMarks) >= Number(mark.examSubject.passMarks),
        remarks: mark.remarks,
      })),
      summary,
      rank,
    };
  }

  /** Class-wide result sheet with ranks, for the exam coordinator. */
  async classResults(schoolId: string, examId: string, classId: string, sectionId?: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, schoolId, deletedAt: null },
      select: { id: true, name: true, status: true, showRank: true },
    });
    if (!exam) throw new NotFoundError('Exam');

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId, status: 'ACTIVE', ...(sectionId ? { sectionId } : {}) },
      orderBy: [{ section: { name: 'asc' } }, { rollNumber: 'asc' }],
      select: {
        rollNumber: true,
        section: { select: { id: true, name: true } },
        student: {
          select: { id: true, admissionNumber: true, firstName: true, lastName: true },
        },
      },
    });

    const marks = await this.prisma.mark.findMany({
      where: {
        examId,
        studentId: { in: enrollments.map((entry) => entry.student.id) },
      },
      select: {
        studentId: true,
        totalMarks: true,
        grade: true,
        isAbsent: true,
        isExempted: true,
        subject: { select: { id: true, name: true, code: true, isGradedOnly: true } },
        examSubject: { select: { maxMarks: true, passMarks: true, maxMarksPractical: true } },
        marksObtained: true,
        practicalMarks: true,
        gradePoint: true,
      },
    });

    const byStudent = new Map<string, typeof marks>();
    for (const mark of marks) {
      const bucket = byStudent.get(mark.studentId) ?? [];
      bucket.push(mark);
      byStudent.set(mark.studentId, bucket);
    }

    const rows = enrollments.map((entry) => {
      const studentMarks = byStudent.get(entry.student.id) ?? [];
      return {
        student: {
          ...entry.student,
          fullName: [entry.student.firstName, entry.student.lastName].filter(Boolean).join(' '),
        },
        rollNumber: entry.rollNumber,
        section: entry.section,
        marks: studentMarks.map((mark) => ({
          subjectId: mark.subject.id,
          subjectCode: mark.subject.code,
          total: mark.totalMarks ? Number(mark.totalMarks) : null,
          grade: mark.grade,
          isAbsent: mark.isAbsent,
        })),
        summary: this.grading.summarise(studentMarks),
      };
    });

    // Rank by percentage, sharing a position on a tie.
    const ranked = [...rows]
      .filter((row) => row.summary.percentage !== null)
      .sort((a, b) => (b.summary.percentage ?? 0) - (a.summary.percentage ?? 0));

    const rankByStudent = new Map<string, number>();
    let position = 0;
    let previousPercentage: number | null = null;

    ranked.forEach((row, index) => {
      if (row.summary.percentage !== previousPercentage) {
        position = index + 1;
        previousPercentage = row.summary.percentage;
      }
      rankByStudent.set(row.student.id, position);
    });

    const subjects = [
      ...new Map(marks.map((mark) => [mark.subject.id, mark.subject])).values(),
    ];

    const percentages = rows
      .map((row) => row.summary.percentage)
      .filter((value): value is number => value !== null);

    return {
      exam,
      subjects,
      totalStudents: rows.length,
      statistics: {
        appeared: percentages.length,
        passed: rows.filter((row) => row.summary.result === 'PASS').length,
        failed: rows.filter((row) => row.summary.result === 'FAIL').length,
        classAverage:
          percentages.length > 0
            ? Number(
                (percentages.reduce((sum, value) => sum + value, 0) / percentages.length).toFixed(2),
              )
            : null,
        highest: percentages.length > 0 ? Math.max(...percentages) : null,
        lowest: percentages.length > 0 ? Math.min(...percentages) : null,
      },
      rows: rows.map((row) => ({
        ...row,
        rank: exam.showRank ? (rankByStudent.get(row.student.id) ?? null) : null,
      })),
    };
  }

  // -------------------------------------------------------------------------

  private async assertCanEnterMarks(
    user: AuthenticatedUser,
    classId: string,
    subjectId: string,
  ): Promise<void> {
    if (user.isSuperAdmin) return;
    if (user.permissions.includes(PERMISSIONS.EXAMS_PUBLISH_RESULTS)) return;
    if (!user.staffId) throw new ForbiddenError('Only teaching staff can enter marks');

    // A teacher may only enter marks for a subject they actually teach in that class.
    const teaches = await this.prisma.subjectTeacher.count({
      where: { staffId: user.staffId, subjectId, section: { classId } },
    });
    if (teaches === 0) {
      throw new ForbiddenError('You do not teach this subject in this class');
    }
  }

  private async notifyResults(
    schoolId: string,
    examId: string,
    examName: string,
  ): Promise<void> {
    const students = await this.prisma.mark.findMany({
      where: { examId },
      distinct: ['studentId'],
      select: {
        studentId: true,
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

    for (const entry of students) {
      const recipients = [
        ...(entry.student.userId ? [entry.student.userId] : []),
        ...entry.student.guardians
          .map((link) => link.guardian.userId)
          .filter((id): id is string => Boolean(id)),
      ];

      if (recipients.length === 0) continue;

      const name = [entry.student.firstName, entry.student.lastName].filter(Boolean).join(' ');

      await this.notifications.dispatch({
        schoolId,
        userIds: recipients,
        type: NotificationType.RESULT,
        title: 'Examination results published',
        body: `Results for ${examName} are now available for ${name}.`,
        priority: Priority.IMPORTANT,
        data: { examId, studentId: entry.studentId },
        actionUrl: `/results/${examId}?studentId=${entry.studentId}`,
        channels: ['IN_APP', 'PUSH'],
      });
    }
  }
}

export type { TransactionClient };
