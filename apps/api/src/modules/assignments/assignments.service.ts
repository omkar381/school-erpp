import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  EnrollmentStatus,
  HomeworkStatus,
  NotificationType,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { PERMISSIONS } from '../../common/constants/permissions';
import { formatDateTime } from '../../common/utils/date.util';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AssignmentQueryDto,
  CreateAssignmentDto,
  GradeSubmissionDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from './dto/assignment.dto';

/**
 * Assignments differ from homework in three ways that matter: they carry a
 * weightage towards the term grade, they support a late penalty rather than a
 * hard cut-off, and they allow multiple attempts.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async findAll(schoolId: string, query: AssignmentQueryDto, user: AuthenticatedUser) {
    const where: Prisma.AssignmentWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.mine && user.staffId ? { staffId: user.staffId } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { dueDate: query.sortOrder },
        select: {
          id: true,
          title: true,
          maxMarks: true,
          weightage: true,
          startDate: true,
          dueDate: true,
          status: true,
          allowLate: true,
          latePenaltyPercent: true,
          subject: { select: { id: true, name: true, code: true, colorHex: true } },
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
          staff: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { submissions: true, attachments: true } },
        },
      }),
      this.prisma.assignment.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ _count, ...assignment }) => ({
        ...assignment,
        submissionCount: _count.submissions,
        attachmentCount: _count.attachments,
        isOpen: assignment.dueDate > new Date() && assignment.status === HomeworkStatus.ASSIGNED,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        subject: { select: { id: true, name: true, code: true, colorHex: true } },
        class: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        staff: { select: { id: true, firstName: true, lastName: true } },
        attachments: { select: { id: true, fileName: true, mimeType: true, url: true } },
        submissions: {
          include: {
            student: {
              select: { id: true, admissionNumber: true, firstName: true, lastName: true },
            },
            attachments: { select: { id: true, fileName: true, mimeType: true, url: true } },
          },
          orderBy: { student: { firstName: 'asc' } },
        },
      },
    });

    if (!assignment) throw new NotFoundError('Assignment');

    const graded = assignment.submissions.filter(
      (submission) => submission.status === SubmissionStatus.GRADED,
    );

    const marks = graded
      .map((submission) => Number(submission.marksAwarded ?? 0))
      .filter((value) => Number.isFinite(value));

    return {
      ...assignment,
      stats: {
        submitted: assignment.submissions.length,
        graded: graded.length,
        late: assignment.submissions.filter((submission) => submission.isLate).length,
        averageMarks:
          marks.length > 0
            ? Number((marks.reduce((sum, value) => sum + value, 0) / marks.length).toFixed(2))
            : null,
        highestMarks: marks.length > 0 ? Math.max(...marks) : null,
        lowestMarks: marks.length > 0 ? Math.min(...marks) : null,
      },
    };
  }

  async forStudent(schoolId: string, studentId: string, query: AssignmentQueryDto) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, schoolId, status: EnrollmentStatus.ACTIVE },
      select: { sectionId: true },
    });
    if (!enrollment) throw new NotFoundError('Active enrollment for this student');

    const where: Prisma.AssignmentWhereInput = {
      schoolId,
      sectionId: enrollment.sectionId,
      deletedAt: null,
      status: { in: [HomeworkStatus.ASSIGNED, HomeworkStatus.CLOSED] },
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { dueDate: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          instructions: true,
          maxMarks: true,
          weightage: true,
          startDate: true,
          dueDate: true,
          allowLate: true,
          latePenaltyPercent: true,
          subject: { select: { id: true, name: true, code: true, colorHex: true } },
          attachments: { select: { id: true, fileName: true, mimeType: true, url: true } },
          submissions: {
            where: { studentId },
            select: {
              id: true,
              status: true,
              submittedAt: true,
              isLate: true,
              attemptCount: true,
              marksAwarded: true,
              grade: true,
              feedback: true,
              reviewedAt: true,
              attachments: { select: { id: true, fileName: true, mimeType: true, url: true } },
            },
          },
        },
      }),
      this.prisma.assignment.count({ where }),
    ]);

    const now = new Date();

    return buildPaginatedResult(
      items.map(({ submissions, ...assignment }) => {
        const submission = submissions[0] ?? null;
        const past = assignment.dueDate < now;
        return {
          ...assignment,
          submission,
          status: submission?.status ?? SubmissionStatus.PENDING,
          isOverdue: !submission && past,
          canSubmit:
            assignment.startDate <= now &&
            (!past || assignment.allowLate) &&
            (!submission || submission.status !== SubmissionStatus.GRADED),
        };
      }),
      total,
      query.page,
      query.limit,
    );
  }

  async create(schoolId: string, dto: CreateAssignmentDto, user: AuthenticatedUser) {
    if (!user.staffId) throw new ForbiddenError('Only teaching staff can create assignments');

    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, schoolId },
      select: {
        id: true,
        name: true,
        classId: true,
        classTeacherId: true,
        class: { select: { name: true } },
      },
    });
    if (!section) throw new NotFoundError('Section');

    await this.assertTeaches(user, section, dto.subjectId);

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const dueDate = new Date(dto.dueDate);

    if (dueDate <= startDate) {
      throw new BadRequestError('The due date must be after the start date');
    }

    const assignment = await this.prisma.assignment.create({
      data: {
        schoolId,
        classId: section.classId,
        sectionId: section.id,
        subjectId: dto.subjectId,
        staffId: user.staffId,
        title: dto.title,
        description: dto.description,
        instructions: dto.instructions ?? null,
        maxMarks: dto.maxMarks ?? 100,
        weightage: dto.weightage ?? null,
        startDate,
        dueDate,
        allowLate: dto.allowLate ?? false,
        latePenaltyPercent: dto.latePenaltyPercent ?? null,
        status: dto.publish === false ? HomeworkStatus.DRAFT : HomeworkStatus.ASSIGNED,
        publishedAt: dto.publish === false ? null : new Date(),
      },
      include: {
        subject: { select: { name: true } },
        section: { select: { id: true, name: true, class: { select: { name: true } } } },
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'assignments',
      entity: 'Assignment',
      entityId: assignment.id,
      description: `Created assignment "${assignment.title}" for ${section.class.name} ${section.name}`,
      schoolId,
    });

    if (assignment.status === HomeworkStatus.ASSIGNED) {
      void this.notifyClass(schoolId, assignment).catch(() => undefined);
    }

    return assignment;
  }

  async update(schoolId: string, id: string, dto: UpdateAssignmentDto, user: AuthenticatedUser) {
    const existing = await this.prisma.assignment.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, staffId: true, status: true, startDate: true, _count: { select: { submissions: true } } },
    });
    if (!existing) throw new NotFoundError('Assignment');

    this.assertOwnsOrManages(user, existing.staffId);

    // Changing the marks ceiling after grading has begun would invalidate
    // marks already awarded.
    if (dto.maxMarks !== undefined && existing._count.submissions > 0) {
      const graded = await this.prisma.assignmentSubmission.count({
        where: { assignmentId: id, status: SubmissionStatus.GRADED },
      });
      if (graded > 0) {
        throw new BadRequestError(
          `${graded} submission(s) have already been graded, so the maximum marks cannot be changed.`,
        );
      }
    }

    const wasPublished = existing.status !== HomeworkStatus.DRAFT;

    const updated = await this.prisma.assignment.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        description: dto.description ?? undefined,
        instructions: dto.instructions ?? undefined,
        maxMarks: dto.maxMarks ?? undefined,
        weightage: dto.weightage ?? undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        allowLate: dto.allowLate ?? undefined,
        latePenaltyPercent: dto.latePenaltyPercent ?? undefined,
        status: dto.status ?? (dto.publish ? HomeworkStatus.ASSIGNED : undefined),
        publishedAt: !wasPublished && dto.publish ? new Date() : undefined,
      },
      include: {
        subject: { select: { name: true } },
        section: { select: { id: true, name: true, class: { select: { name: true } } } },
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'assignments',
      entity: 'Assignment',
      entityId: id,
      description: `Updated assignment "${updated.title}"`,
      schoolId,
    });

    if (!wasPublished && updated.status === HomeworkStatus.ASSIGNED) {
      void this.notifyClass(schoolId, updated).catch(() => undefined);
    }

    return updated;
  }

  async remove(schoolId: string, id: string, user: AuthenticatedUser) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, staffId: true, title: true },
    });
    if (!assignment) throw new NotFoundError('Assignment');

    this.assertOwnsOrManages(user, assignment.staffId);

    await this.prisma.assignment.update({
      where: { id },
      data: { deletedAt: new Date(), status: HomeworkStatus.ARCHIVED },
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'assignments',
      entity: 'Assignment',
      entityId: id,
      description: `Removed assignment "${assignment.title}"`,
      schoolId,
    });

    return { deleted: true };
  }

  async submit(schoolId: string, assignmentId: string, studentId: string, dto: SubmitAssignmentDto) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, schoolId, deletedAt: null },
      select: {
        id: true,
        sectionId: true,
        startDate: true,
        dueDate: true,
        allowLate: true,
        status: true,
      },
    });
    if (!assignment) throw new NotFoundError('Assignment');

    if (assignment.status === HomeworkStatus.DRAFT) {
      throw new BadRequestError('This assignment has not been published yet');
    }

    const enrolled = await this.prisma.enrollment.count({
      where: { studentId, sectionId: assignment.sectionId, status: EnrollmentStatus.ACTIVE },
    });
    if (enrolled === 0) {
      throw new ForbiddenError('This assignment was not set for your class');
    }

    const now = new Date();
    if (now < assignment.startDate) {
      throw new BadRequestError(
        `This assignment opens on ${formatDateTime(assignment.startDate)}`,
      );
    }

    const isLate = now > assignment.dueDate;
    if (isLate && !assignment.allowLate) {
      throw new BadRequestError(
        `The deadline passed on ${formatDateTime(assignment.dueDate)} and late submissions are not accepted`,
      );
    }

    const existing = await this.prisma.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId } },
      select: { id: true, status: true, attemptCount: true },
    });

    if (existing?.status === SubmissionStatus.GRADED) {
      throw new BadRequestError('This assignment has already been graded and cannot be resubmitted');
    }

    return this.prisma.assignmentSubmission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId } },
      create: {
        assignmentId,
        studentId,
        status: isLate ? SubmissionStatus.LATE : SubmissionStatus.SUBMITTED,
        content: dto.content ?? null,
        submittedAt: now,
        isLate,
        attemptCount: 1,
      },
      update: {
        status: isLate ? SubmissionStatus.LATE : SubmissionStatus.SUBMITTED,
        content: dto.content ?? null,
        submittedAt: now,
        isLate,
        attemptCount: (existing?.attemptCount ?? 0) + 1,
      },
    });
  }

  /**
   * Grades a submission, applying the assignment's late penalty when the work
   * was handed in after the deadline.
   */
  async grade(
    schoolId: string,
    submissionId: string,
    dto: GradeSubmissionDto,
    user: AuthenticatedUser,
  ) {
    const submission = await this.prisma.assignmentSubmission.findFirst({
      where: { id: submissionId, assignment: { schoolId } },
      select: {
        id: true,
        isLate: true,
        studentId: true,
        assignment: {
          select: {
            id: true,
            staffId: true,
            maxMarks: true,
            title: true,
            latePenaltyPercent: true,
          },
        },
        student: { select: { userId: true } },
      },
    });
    if (!submission) throw new NotFoundError('Submission');

    this.assertOwnsOrManages(user, submission.assignment.staffId);

    const maxMarks = Number(submission.assignment.maxMarks);
    if (dto.marksAwarded > maxMarks) {
      throw new BadRequestError(`Marks awarded cannot exceed the maximum of ${maxMarks}`);
    }

    // The penalty is applied at grading time, not at submission time, so the
    // teacher always sees and records the raw mark they intended.
    const penaltyPercent = submission.isLate
      ? Number(submission.assignment.latePenaltyPercent ?? 0)
      : 0;
    const penalty = (dto.marksAwarded * penaltyPercent) / 100;
    const finalMarks = Math.max(0, Number((dto.marksAwarded - penalty).toFixed(2)));

    const updated = await this.prisma.assignmentSubmission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.GRADED,
        marksAwarded: finalMarks,
        grade: dto.grade ?? null,
        feedback: dto.feedback ?? null,
        reviewedById: user.staffId,
        reviewedAt: new Date(),
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'assignments',
      entity: 'AssignmentSubmission',
      entityId: submissionId,
      description:
        `Graded "${submission.assignment.title}": ${finalMarks}/${maxMarks}` +
        (penalty > 0 ? ` (after a ${penaltyPercent}% late penalty of ${penalty.toFixed(2)})` : ''),
      schoolId,
    });

    const guardians = await this.prisma.studentGuardian.findMany({
      where: { studentId: submission.studentId, guardian: { userId: { not: null } } },
      select: { guardian: { select: { userId: true } } },
    });

    const recipients = [
      ...(submission.student.userId ? [submission.student.userId] : []),
      ...guardians.map((entry) => entry.guardian.userId!).filter(Boolean),
    ];

    if (recipients.length > 0) {
      void this.notifications
        .dispatch({
          schoolId,
          userIds: recipients,
          type: NotificationType.ASSIGNMENT,
          title: 'Assignment graded',
          body: `"${submission.assignment.title}" — ${finalMarks}/${maxMarks}`,
          data: { assignmentId: submission.assignment.id, submissionId },
          actionUrl: `/assignments/${submission.assignment.id}`,
        })
        .catch(() => undefined);
    }

    return { ...updated, penaltyApplied: penalty, rawMarks: dto.marksAwarded };
  }

  // -------------------------------------------------------------------------

  private assertOwnsOrManages(user: AuthenticatedUser, ownerStaffId: string): void {
    if (user.isSuperAdmin) return;
    if (user.staffId === ownerStaffId) return;
    if (user.permissions.includes(PERMISSIONS.ASSIGNMENTS_DELETE)) return;
    throw new ForbiddenError('You can only change assignments you created yourself');
  }

  private async assertTeaches(
    user: AuthenticatedUser,
    section: { id: string; classTeacherId: string | null; name: string; class: { name: string } },
    subjectId: string,
  ): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.ASSIGNMENTS_DELETE)) return;
    if (section.classTeacherId === user.staffId) return;

    const teaches = await this.prisma.subjectTeacher.count({
      where: { sectionId: section.id, subjectId, staffId: user.staffId! },
    });
    if (teaches === 0) {
      throw new ForbiddenError(
        `You do not teach that subject in ${section.class.name} ${section.name}`,
      );
    }
  }

  private async notifyClass(
    schoolId: string,
    assignment: {
      id: string;
      title: string;
      dueDate: Date;
      sectionId: string;
      subject: { name: string };
    },
  ): Promise<void> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { sectionId: assignment.sectionId, status: EnrollmentStatus.ACTIVE },
      select: {
        student: {
          select: {
            userId: true,
            guardians: { select: { guardian: { select: { userId: true } } } },
          },
        },
      },
    });

    const userIds = new Set<string>();
    for (const enrollment of enrollments) {
      if (enrollment.student.userId) userIds.add(enrollment.student.userId);
      for (const link of enrollment.student.guardians) {
        if (link.guardian.userId) userIds.add(link.guardian.userId);
      }
    }

    if (userIds.size === 0) return;

    await this.notifications.dispatch({
      schoolId,
      userIds: [...userIds],
      type: NotificationType.ASSIGNMENT,
      title: `New ${assignment.subject.name} assignment`,
      body: `${assignment.title} — due ${formatDateTime(assignment.dueDate)}`,
      data: { assignmentId: assignment.id },
      actionUrl: `/assignments/${assignment.id}`,
    });
  }
}
