import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  EnrollmentStatus,
  HomeworkStatus,
  NotificationType,
  Prisma,
  Priority,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { PERMISSIONS } from '../../common/constants/permissions';
import { formatDate, parseDateOnly, todayInZone } from '../../common/utils/date.util';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CreateHomeworkDto,
  HomeworkQueryDto,
  ReviewSubmissionDto,
  SubmitHomeworkDto,
  UpdateHomeworkDto,
} from './dto/homework.dto';

@Injectable()
export class HomeworkService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('HomeworkService');
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: HomeworkQueryDto, user: AuthenticatedUser) {
    const where: Prisma.HomeworkWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      // A teacher without the school-wide view permission sees only their own.
      ...(query.mine || (user.staffId && !this.canSeeAll(user)) ? { staffId: user.staffId! } : {}),
      ...(query.from || query.to
        ? {
            dueDate: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.homework.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { dueDate: query.sortOrder },
        select: {
          id: true,
          title: true,
          description: true,
          assignedDate: true,
          dueDate: true,
          priority: true,
          status: true,
          maxMarks: true,
          createdAt: true,
          subject: { select: { id: true, name: true, code: true, colorHex: true } },
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
          staff: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
          _count: { select: { attachments: true, submissions: true } },
        },
      }),
      this.prisma.homework.count({ where }),
    ]);

    // Submission progress is fetched in one grouped query rather than per row.
    const ids = items.map((item) => item.id);
    const progress = await this.submissionProgress(ids);

    return buildPaginatedResult(
      items.map(({ _count, ...homework }) => ({
        ...homework,
        attachmentCount: _count.attachments,
        submissionCount: _count.submissions,
        progress: progress.get(homework.id) ?? { submitted: 0, reviewed: 0, pending: 0 },
        isOverdue: homework.dueDate < new Date() && homework.status === HomeworkStatus.ASSIGNED,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const homework = await this.prisma.homework.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        subject: { select: { id: true, name: true, code: true, colorHex: true } },
        class: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        staff: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
        attachments: {
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, url: true },
        },
        submissions: {
          include: {
            student: {
              select: {
                id: true,
                admissionNumber: true,
                firstName: true,
                lastName: true,
                photoUrl: true,
              },
            },
            attachments: {
              select: { id: true, fileName: true, mimeType: true, sizeBytes: true, url: true },
            },
          },
          orderBy: { student: { firstName: 'asc' } },
        },
      },
    });

    if (!homework) throw new NotFoundError('Homework');

    // Students who have not submitted at all have no submission row yet, so the
    // class roll is used to show a complete picture to the teacher.
    const enrolled = await this.prisma.enrollment.findMany({
      where: { sectionId: homework.sectionId, status: EnrollmentStatus.ACTIVE },
      select: {
        rollNumber: true,
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
          },
        },
      },
      orderBy: { rollNumber: 'asc' },
    });

    const byStudent = new Map(
      homework.submissions.map((submission) => [submission.studentId, submission]),
    );

    return {
      ...homework,
      roster: enrolled.map((entry) => ({
        rollNumber: entry.rollNumber,
        student: entry.student,
        submission: byStudent.get(entry.student.id) ?? null,
        status: byStudent.get(entry.student.id)?.status ?? SubmissionStatus.PENDING,
      })),
      stats: {
        total: enrolled.length,
        submitted: homework.submissions.filter((s) =>
          (
            [
              SubmissionStatus.SUBMITTED,
              SubmissionStatus.LATE,
              SubmissionStatus.REVIEWED,
            ] as SubmissionStatus[]
          ).includes(s.status),
        ).length,
        reviewed: homework.submissions.filter((s) => s.status === SubmissionStatus.REVIEWED).length,
        pending: enrolled.length - homework.submissions.length,
      },
    };
  }

  /** Homework visible to a student, with their own submission state attached. */
  async forStudent(schoolId: string, studentId: string, query: HomeworkQueryDto) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, schoolId, status: EnrollmentStatus.ACTIVE },
      select: { sectionId: true },
    });
    if (!enrollment) throw new NotFoundError('Active enrollment for this student');

    const where: Prisma.HomeworkWhereInput = {
      schoolId,
      sectionId: enrollment.sectionId,
      deletedAt: null,
      status: { in: [HomeworkStatus.ASSIGNED, HomeworkStatus.CLOSED] },
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.from || query.to
        ? {
            dueDate: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.homework.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { dueDate: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          assignedDate: true,
          dueDate: true,
          priority: true,
          maxMarks: true,
          allowLate: true,
          subject: { select: { id: true, name: true, code: true, colorHex: true } },
          staff: { select: { id: true, firstName: true, lastName: true } },
          attachments: { select: { id: true, fileName: true, mimeType: true, url: true } },
          submissions: {
            where: { studentId },
            select: {
              id: true,
              status: true,
              submittedAt: true,
              isLate: true,
              marksAwarded: true,
              grade: true,
              feedback: true,
              reviewedAt: true,
              attachments: { select: { id: true, fileName: true, mimeType: true, url: true } },
            },
          },
        },
      }),
      this.prisma.homework.count({ where }),
    ]);

    const now = new Date();

    return buildPaginatedResult(
      items.map(({ submissions, ...homework }) => {
        const submission = submissions[0] ?? null;
        return {
          ...homework,
          submission,
          status: submission?.status ?? SubmissionStatus.PENDING,
          isOverdue: !submission && homework.dueDate < now,
          canSubmit:
            !submission ||
            submission.status === SubmissionStatus.PENDING ||
            submission.status === SubmissionStatus.RESUBMIT,
        };
      }),
      total,
      query.page,
      query.limit,
    );
  }

  /** Counts for the student and parent home screens. */
  async pendingCount(schoolId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, schoolId, status: EnrollmentStatus.ACTIVE },
      select: { sectionId: true },
    });
    if (!enrollment) return { pending: 0, overdue: 0, dueToday: 0 };

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true },
    });
    const today = todayInZone(school.timezone);

    const homework = await this.prisma.homework.findMany({
      where: {
        schoolId,
        sectionId: enrollment.sectionId,
        deletedAt: null,
        status: HomeworkStatus.ASSIGNED,
      },
      select: {
        id: true,
        dueDate: true,
        submissions: { where: { studentId }, select: { status: true } },
      },
    });

    const outstanding = homework.filter((entry) => {
      const status = entry.submissions[0]?.status;
      return !status || status === SubmissionStatus.PENDING || status === SubmissionStatus.RESUBMIT;
    });

    return {
      pending: outstanding.length,
      overdue: outstanding.filter((entry) => entry.dueDate < today).length,
      dueToday: outstanding.filter(
        (entry) => entry.dueDate.getTime() === today.getTime(),
      ).length,
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(schoolId: string, dto: CreateHomeworkDto, user: AuthenticatedUser) {
    if (!user.staffId) {
      throw new ForbiddenError('Only teaching staff can set homework');
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

    await this.assertTeachesSubject(user, section, dto.subjectId);

    const assignedDate = dto.assignedDate ? parseDateOnly(dto.assignedDate) : new Date();
    const dueDate = parseDateOnly(dto.dueDate);

    if (dueDate < parseDateOnly(assignedDate)) {
      throw new BadRequestError('The due date cannot be before the date the homework is set');
    }

    const homework = await this.prisma.homework.create({
      data: {
        schoolId,
        classId: section.classId,
        sectionId: section.id,
        subjectId: dto.subjectId,
        staffId: user.staffId,
        title: dto.title,
        description: dto.description,
        assignedDate,
        dueDate,
        priority: dto.priority ?? Priority.NORMAL,
        status: dto.publish === false ? HomeworkStatus.DRAFT : HomeworkStatus.ASSIGNED,
        maxMarks: dto.maxMarks ?? null,
        allowLate: dto.allowLate ?? true,
        notifyParents: dto.notifyParents ?? true,
        publishedAt: dto.publish === false ? null : new Date(),
      },
      include: {
        subject: { select: { name: true } },
        section: { select: { name: true, class: { select: { name: true } } } },
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'homework',
      entity: 'Homework',
      entityId: homework.id,
      description: `Set homework "${homework.title}" for ${section.class.name} ${section.name}`,
      schoolId,
    });

    if (homework.status === HomeworkStatus.ASSIGNED && homework.notifyParents) {
      void this.notifyClass(schoolId, homework).catch((error) =>
        this.log.error('Failed to notify about new homework', error, { homeworkId: homework.id }),
      );
    }

    return homework;
  }

  async update(schoolId: string, id: string, dto: UpdateHomeworkDto, user: AuthenticatedUser) {
    const existing = await this.prisma.homework.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: {
        id: true,
        staffId: true,
        title: true,
        status: true,
        dueDate: true,
        assignedDate: true,
      },
    });
    if (!existing) throw new NotFoundError('Homework');

    this.assertOwnsOrCanManage(user, existing.staffId);

    const dueDate = dto.dueDate ? parseDateOnly(dto.dueDate) : existing.dueDate;
    if (dueDate < existing.assignedDate) {
      throw new BadRequestError('The due date cannot be before the date the homework was set');
    }

    const wasPublished = existing.status !== HomeworkStatus.DRAFT;
    const nowPublished = dto.publish === true;

    const updated = await this.prisma.homework.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        description: dto.description ?? undefined,
        dueDate: dto.dueDate ? dueDate : undefined,
        priority: dto.priority ?? undefined,
        maxMarks: dto.maxMarks ?? undefined,
        allowLate: dto.allowLate ?? undefined,
        status: dto.status ?? (nowPublished ? HomeworkStatus.ASSIGNED : undefined),
        publishedAt: !wasPublished && nowPublished ? new Date() : undefined,
      },
      include: {
        subject: { select: { name: true } },
        section: { select: { name: true, class: { select: { name: true } } } },
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'homework',
      entity: 'Homework',
      entityId: id,
      description: `Updated homework "${updated.title}"`,
      schoolId,
    });

    // Publishing a draft is the moment parents should hear about it.
    if (!wasPublished && updated.status === HomeworkStatus.ASSIGNED && updated.notifyParents) {
      void this.notifyClass(schoolId, updated).catch(() => undefined);
    }

    return updated;
  }

  async remove(schoolId: string, id: string, user: AuthenticatedUser) {
    const homework = await this.prisma.homework.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, staffId: true, title: true, _count: { select: { submissions: true } } },
    });
    if (!homework) throw new NotFoundError('Homework');

    this.assertOwnsOrCanManage(user, homework.staffId);

    // Submissions are student work; soft-delete keeps them recoverable.
    await this.prisma.homework.update({
      where: { id },
      data: { deletedAt: new Date(), status: HomeworkStatus.ARCHIVED },
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'homework',
      entity: 'Homework',
      entityId: id,
      description:
        `Removed homework "${homework.title}" ` +
        `(${homework._count.submissions} submission(s) retained)`,
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Submissions
  // -------------------------------------------------------------------------

  async submit(schoolId: string, homeworkId: string, studentId: string, dto: SubmitHomeworkDto) {
    const homework = await this.prisma.homework.findFirst({
      where: { id: homeworkId, schoolId, deletedAt: null },
      select: {
        id: true,
        sectionId: true,
        dueDate: true,
        allowLate: true,
        status: true,
        title: true,
      },
    });
    if (!homework) throw new NotFoundError('Homework');

    if (homework.status === HomeworkStatus.DRAFT) {
      throw new BadRequestError('This homework has not been published yet');
    }

    // Only students actually in the section may submit.
    const enrolled = await this.prisma.enrollment.count({
      where: { studentId, sectionId: homework.sectionId, status: EnrollmentStatus.ACTIVE },
    });
    if (enrolled === 0) {
      throw new ForbiddenError('This homework was not set for your class');
    }

    const existing = await this.prisma.homeworkSubmission.findUnique({
      where: { homeworkId_studentId: { homeworkId, studentId } },
      select: { id: true, status: true },
    });

    if (
      existing &&
      existing.status !== SubmissionStatus.PENDING &&
      existing.status !== SubmissionStatus.RESUBMIT
    ) {
      throw new BadRequestError('This homework has already been submitted');
    }

    const now = new Date();
    const isLate = now > new Date(homework.dueDate.getTime() + 86_400_000 - 1);

    if (isLate && !homework.allowLate) {
      throw new BadRequestError(
        `The deadline for this homework passed on ${formatDate(homework.dueDate)} and late submissions are not accepted`,
      );
    }

    const submission = await this.prisma.homeworkSubmission.upsert({
      where: { homeworkId_studentId: { homeworkId, studentId } },
      create: {
        homeworkId,
        studentId,
        status: isLate ? SubmissionStatus.LATE : SubmissionStatus.SUBMITTED,
        content: dto.content ?? null,
        submittedAt: now,
        isLate,
      },
      update: {
        status: isLate ? SubmissionStatus.LATE : SubmissionStatus.SUBMITTED,
        content: dto.content ?? null,
        submittedAt: now,
        isLate,
      },
    });

    return submission;
  }

  async review(
    schoolId: string,
    submissionId: string,
    dto: ReviewSubmissionDto,
    user: AuthenticatedUser,
  ) {
    const submission = await this.prisma.homeworkSubmission.findFirst({
      where: { id: submissionId, homework: { schoolId } },
      select: {
        id: true,
        studentId: true,
        homework: {
          select: { id: true, staffId: true, maxMarks: true, title: true },
        },
        student: { select: { firstName: true, lastName: true, userId: true } },
      },
    });
    if (!submission) throw new NotFoundError('Submission');

    this.assertOwnsOrCanManage(user, submission.homework.staffId);

    const maxMarks = submission.homework.maxMarks ? Number(submission.homework.maxMarks) : null;
    if (dto.marksAwarded !== undefined && maxMarks !== null && dto.marksAwarded > maxMarks) {
      throw new BadRequestError(
        `Marks awarded cannot exceed the maximum of ${maxMarks}`,
      );
    }

    const updated = await this.prisma.homeworkSubmission.update({
      where: { id: submissionId },
      data: {
        status: dto.requestResubmission ? SubmissionStatus.RESUBMIT : SubmissionStatus.REVIEWED,
        marksAwarded: dto.marksAwarded ?? undefined,
        grade: dto.grade ?? undefined,
        feedback: dto.feedback ?? undefined,
        reviewedById: user.staffId,
        reviewedAt: new Date(),
      },
    });

    // Tell the student and their guardians that it has been marked.
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
          type: NotificationType.HOMEWORK,
          title: dto.requestResubmission ? 'Homework needs resubmission' : 'Homework reviewed',
          body: dto.requestResubmission
            ? `"${submission.homework.title}" needs to be submitted again.`
            : `"${submission.homework.title}" has been marked.`,
          data: { homeworkId: submission.homework.id, submissionId },
          actionUrl: `/homework/${submission.homework.id}`,
        })
        .catch(() => undefined);
    }

    return updated;
  }

  /** Bulk marking so a teacher can grade a whole class in one action. */
  async reviewBatch(
    schoolId: string,
    homeworkId: string,
    reviews: Array<{ submissionId: string; marksAwarded?: number; feedback?: string }>,
    user: AuthenticatedUser,
  ) {
    const homework = await this.prisma.homework.findFirst({
      where: { id: homeworkId, schoolId, deletedAt: null },
      select: { id: true, staffId: true, maxMarks: true },
    });
    if (!homework) throw new NotFoundError('Homework');

    this.assertOwnsOrCanManage(user, homework.staffId);

    const maxMarks = homework.maxMarks ? Number(homework.maxMarks) : null;
    const overMax = reviews.filter(
      (review) => review.marksAwarded !== undefined && maxMarks !== null && review.marksAwarded > maxMarks,
    );
    if (overMax.length > 0) {
      throw new BadRequestError(`Marks awarded cannot exceed the maximum of ${maxMarks}`);
    }

    const updated = await this.prisma.transaction(async (tx) => {
      let count = 0;
      for (const review of reviews) {
        const result = await tx.homeworkSubmission.updateMany({
          where: { id: review.submissionId, homeworkId },
          data: {
            status: SubmissionStatus.REVIEWED,
            marksAwarded: review.marksAwarded ?? undefined,
            feedback: review.feedback ?? undefined,
            reviewedById: user.staffId,
            reviewedAt: new Date(),
          },
        });
        count += result.count;
      }
      return count;
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'homework',
      entity: 'Homework',
      entityId: homeworkId,
      description: `Reviewed ${updated} homework submission(s)`,
      schoolId,
    });

    return { reviewed: updated };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private canSeeAll(user: AuthenticatedUser): boolean {
    return (
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.STUDENTS_VIEW_ALL) ||
      user.permissions.includes(PERMISSIONS.HOMEWORK_DELETE)
    );
  }

  private assertOwnsOrCanManage(user: AuthenticatedUser, ownerStaffId: string): void {
    if (user.isSuperAdmin) return;
    if (user.staffId === ownerStaffId) return;
    if (user.permissions.includes(PERMISSIONS.HOMEWORK_DELETE)) return;
    throw new ForbiddenError('You can only change homework you set yourself');
  }

  private async assertTeachesSubject(
    user: AuthenticatedUser,
    section: { id: string; classTeacherId: string | null; name: string; class: { name: string } },
    subjectId: string,
  ): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.HOMEWORK_DELETE)) return;
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

  private async submissionProgress(
    homeworkIds: string[],
  ): Promise<Map<string, { submitted: number; reviewed: number; pending: number }>> {
    if (homeworkIds.length === 0) return new Map();

    const rows = await this.prisma.homeworkSubmission.groupBy({
      by: ['homeworkId', 'status'],
      where: { homeworkId: { in: homeworkIds } },
      orderBy: undefined,
      _count: true,
    });

    const result = new Map<string, { submitted: number; reviewed: number; pending: number }>();

    for (const row of rows) {
      const bucket = result.get(row.homeworkId) ?? { submitted: 0, reviewed: 0, pending: 0 };
      if (row.status === SubmissionStatus.REVIEWED) bucket.reviewed += row._count;
      else if (
        row.status === SubmissionStatus.SUBMITTED ||
        row.status === SubmissionStatus.LATE
      ) {
        bucket.submitted += row._count;
      } else bucket.pending += row._count;
      result.set(row.homeworkId, bucket);
    }

    return result;
  }

  private async notifyClass(
    schoolId: string,
    homework: {
      id: string;
      title: string;
      dueDate: Date;
      sectionId: string;
      subject: { name: string };
      section: { name: string; class: { name: string } };
    },
  ): Promise<void> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { sectionId: homework.sectionId, status: EnrollmentStatus.ACTIVE },
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
      type: NotificationType.HOMEWORK,
      title: `New ${homework.subject.name} homework`,
      body: `${homework.title} — due ${formatDate(homework.dueDate)}`,
      data: { homeworkId: homework.id, sectionId: homework.sectionId },
      actionUrl: `/homework/${homework.id}`,
      channels: ['IN_APP', 'PUSH'],
    });
  }
}
