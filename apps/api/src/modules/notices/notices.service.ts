import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  NoticeAudience,
  NoticeStatus,
  NotificationType,
  Prisma,
  Priority,
  RoleType,
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
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateNoticeDto, NoticeQueryDto, UpdateNoticeDto } from './dto/notice.dto';

@Injectable()
export class NoticesService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('NoticesService');
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: NoticeQueryDto) {
    const where: Prisma.NoticeWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.audience ? { audience: query.audience } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { body: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notice.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          title: true,
          body: true,
          kind: true,
          audience: true,
          priority: true,
          status: true,
          isPinned: true,
          publishAt: true,
          publishedAt: true,
          expiresAt: true,
          viewCount: true,
          createdAt: true,
          author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
          _count: { select: { attachments: true, reads: true } },
        },
      }),
      this.prisma.notice.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ _count, ...notice }) => ({
        ...notice,
        attachmentCount: _count.attachments,
        readCount: _count.reads,
        isExpired: notice.expiresAt ? notice.expiresAt < new Date() : false,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * The notice board as one specific user sees it.
   *
   * Audience targeting is resolved server-side: a parent must not be able to
   * read a staff-only circular by calling the admin listing endpoint.
   */
  async feedFor(schoolId: string, user: AuthenticatedUser, query: NoticeQueryDto) {
    const audiences = await this.audiencesFor(schoolId, user);

    const where: Prisma.NoticeWhereInput = {
      schoolId,
      deletedAt: null,
      status: NoticeStatus.PUBLISHED,
      publishAt: { lte: new Date() },
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      AND: [
        {
          OR: [
            { audience: NoticeAudience.ALL },
            { audience: { in: audiences.roleAudiences } },
            ...(audiences.classIds.length
              ? [
                  {
                    audience: NoticeAudience.CLASS,
                    classId: { in: audiences.classIds },
                  } as Prisma.NoticeWhereInput,
                ]
              : []),
            ...(audiences.sectionIds.length
              ? [
                  {
                    audience: NoticeAudience.SECTION,
                    sectionId: { in: audiences.sectionIds },
                  } as Prisma.NoticeWhereInput,
                ]
              : []),
            {
              audience: NoticeAudience.SPECIFIC_USERS,
              targetUserIds: { has: user.id },
            },
          ],
        },
      ],
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.search
        ? {
            title: { contains: query.search, mode: 'insensitive' },
          }
        : {}),
    };

    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notice.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
        select: {
          id: true,
          title: true,
          body: true,
          kind: true,
          priority: true,
          isPinned: true,
          publishedAt: true,
          expiresAt: true,
          author: { select: { firstName: true, lastName: true, avatarUrl: true } },
          attachments: {
            select: { id: true, fileName: true, mimeType: true, sizeBytes: true, url: true },
          },
          reads: { where: { userId: user.id }, select: { readAt: true } },
        },
      }),
      this.prisma.notice.count({ where }),
      this.prisma.notice.count({ where: { ...where, reads: { none: { userId: user.id } } } }),
    ]);

    return {
      ...buildPaginatedResult(
        items.map(({ reads, ...notice }) => ({
          ...notice,
          isRead: reads.length > 0,
          readAt: reads[0]?.readAt ?? null,
        })),
        total,
        query.page,
        query.limit,
      ),
      unreadCount,
    };
  }

  async findOne(schoolId: string, id: string) {
    const notice = await this.prisma.notice.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        class: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        attachments: {
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, url: true },
        },
        reads: {
          take: 100,
          orderBy: { readAt: 'desc' },
          select: {
            readAt: true,
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          },
        },
        _count: { select: { reads: true } },
      },
    });

    if (!notice) throw new NotFoundError('Notice');

    const { _count, ...rest } = notice;
    return { ...rest, readCount: _count.reads };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(schoolId: string, dto: CreateNoticeDto, user: AuthenticatedUser) {
    this.assertAudienceValid(dto);

    if (dto.classId) {
      const cls = await this.prisma.class.count({ where: { id: dto.classId, schoolId } });
      if (cls === 0) throw new NotFoundError('Class');
    }
    if (dto.sectionId) {
      const section = await this.prisma.section.count({ where: { id: dto.sectionId, schoolId } });
      if (section === 0) throw new NotFoundError('Section');
    }

    // Only a user who may broadcast can address the whole school.
    if (
      dto.audience === NoticeAudience.ALL &&
      !user.isSuperAdmin &&
      !user.permissions.includes(PERMISSIONS.COMMUNICATION_BROADCAST)
    ) {
      throw new ForbiddenError('You are not permitted to send a notice to the whole school');
    }

    const publishAt = dto.publishAt ? new Date(dto.publishAt) : new Date();
    const shouldPublishNow = dto.publish !== false && publishAt <= new Date();

    const notice = await this.prisma.notice.create({
      data: {
        schoolId,
        authorId: user.id,
        title: dto.title,
        body: dto.body,
        kind: dto.kind ?? 'NOTICE',
        audience: dto.audience,
        classId: dto.classId ?? null,
        sectionId: dto.sectionId ?? null,
        targetUserIds: dto.targetUserIds ?? [],
        priority: dto.priority ?? Priority.NORMAL,
        status:
          dto.publish === false
            ? NoticeStatus.DRAFT
            : shouldPublishNow
              ? NoticeStatus.PUBLISHED
              : NoticeStatus.SCHEDULED,
        isPinned: dto.isPinned ?? false,
        publishAt,
        publishedAt: shouldPublishNow && dto.publish !== false ? new Date() : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        sendPush: dto.sendPush ?? true,
        sendEmail: dto.sendEmail ?? false,
        sendSms: dto.sendSms ?? false,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'notices',
      entity: 'Notice',
      entityId: notice.id,
      description: `Created ${notice.kind.toLowerCase()} "${notice.title}" for ${notice.audience}`,
      schoolId,
    });

    if (notice.status === NoticeStatus.PUBLISHED) {
      void this.dispatch(schoolId, notice.id).catch((error) =>
        this.log.error('Failed to notify about a notice', error, { noticeId: notice.id }),
      );
    }

    return notice;
  }

  async update(schoolId: string, id: string, dto: UpdateNoticeDto, user: AuthenticatedUser) {
    const existing = await this.prisma.notice.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, authorId: true, status: true, title: true },
    });
    if (!existing) throw new NotFoundError('Notice');

    this.assertCanManage(user, existing.authorId);

    const wasPublished = existing.status === NoticeStatus.PUBLISHED;

    const updated = await this.prisma.notice.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        body: dto.body ?? undefined,
        priority: dto.priority ?? undefined,
        isPinned: dto.isPinned ?? undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        status: dto.status ?? undefined,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'notices',
      entity: 'Notice',
      entityId: id,
      description: `Updated notice "${updated.title}"`,
      schoolId,
    });

    return { ...updated, wasPublished };
  }

  /** Publishes a draft or scheduled notice and fans out the notification. */
  async publish(schoolId: string, id: string, user: AuthenticatedUser) {
    const notice = await this.prisma.notice.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, authorId: true, status: true, title: true, audience: true },
    });
    if (!notice) throw new NotFoundError('Notice');

    this.assertCanManage(user, notice.authorId);

    if (notice.status === NoticeStatus.PUBLISHED) {
      throw new BadRequestError('This notice has already been published');
    }

    const updated = await this.prisma.notice.update({
      where: { id },
      data: {
        status: NoticeStatus.PUBLISHED,
        publishedAt: new Date(),
        publishAt: new Date(),
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'notices',
      entity: 'Notice',
      entityId: id,
      description: `Published notice "${notice.title}"`,
      schoolId,
    });

    const result = await this.dispatch(schoolId, id);

    return { ...updated, notified: result.recipients };
  }

  async remove(schoolId: string, id: string, user: AuthenticatedUser) {
    const notice = await this.prisma.notice.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, authorId: true, title: true },
    });
    if (!notice) throw new NotFoundError('Notice');

    this.assertCanManage(user, notice.authorId);

    await this.prisma.notice.update({
      where: { id },
      data: { deletedAt: new Date(), status: NoticeStatus.ARCHIVED },
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'notices',
      entity: 'Notice',
      entityId: id,
      description: `Removed notice "${notice.title}"`,
      schoolId,
    });

    return { deleted: true };
  }

  async markRead(userId: string, noticeId: string) {
    await this.prisma.$transaction([
      this.prisma.noticeRead.upsert({
        where: { noticeId_userId: { noticeId, userId } },
        create: { noticeId, userId },
        update: {},
      }),
      this.prisma.notice.update({
        where: { id: noticeId },
        data: { viewCount: { increment: 1 } },
      }),
    ]);

    return { read: true };
  }

  /** Who has and has not read a notice — the read-tracking view. */
  async readReport(schoolId: string, noticeId: string) {
    const notice = await this.prisma.notice.findFirst({
      where: { id: noticeId, schoolId, deletedAt: null },
      select: { id: true, title: true, audience: true, classId: true, sectionId: true, targetUserIds: true },
    });
    if (!notice) throw new NotFoundError('Notice');

    const recipients = await this.resolveRecipients(schoolId, notice);

    const reads = await this.prisma.noticeRead.findMany({
      where: { noticeId },
      select: { userId: true, readAt: true },
    });
    const readBy = new Map(reads.map((read) => [read.userId, read.readAt]));

    const users = await this.prisma.user.findMany({
      where: { id: { in: recipients } },
      select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
    });

    return {
      noticeId,
      title: notice.title,
      totalRecipients: recipients.length,
      readCount: reads.length,
      readPercentage:
        recipients.length > 0
          ? Number(((reads.length / recipients.length) * 100).toFixed(1))
          : 0,
      recipients: users.map((user) => ({
        ...user,
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        isRead: readBy.has(user.id),
        readAt: readBy.get(user.id) ?? null,
      })),
    };
  }

  /** Publishes notices whose scheduled time has arrived. Run by a cron job. */
  async publishScheduled(): Promise<number> {
    const due = await this.prisma.notice.findMany({
      where: {
        status: NoticeStatus.SCHEDULED,
        publishAt: { lte: new Date() },
        deletedAt: null,
      },
      select: { id: true, schoolId: true },
      take: 100,
    });

    for (const notice of due) {
      await this.prisma.notice.update({
        where: { id: notice.id },
        data: { status: NoticeStatus.PUBLISHED, publishedAt: new Date() },
      });
      await this.dispatch(notice.schoolId, notice.id).catch(() => undefined);
    }

    if (due.length > 0) {
      this.log.info('Published scheduled notices', { count: due.length });
    }
    return due.length;
  }

  /** Marks notices whose expiry has passed. Run by a cron job. */
  async expireOld(): Promise<number> {
    const result = await this.prisma.notice.updateMany({
      where: {
        status: NoticeStatus.PUBLISHED,
        expiresAt: { lt: new Date() },
        deletedAt: null,
      },
      data: { status: NoticeStatus.EXPIRED },
    });
    return result.count;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async dispatch(schoolId: string, noticeId: string): Promise<{ recipients: number }> {
    const notice = await this.prisma.notice.findUniqueOrThrow({
      where: { id: noticeId },
      select: {
        id: true,
        title: true,
        body: true,
        kind: true,
        priority: true,
        audience: true,
        classId: true,
        sectionId: true,
        targetUserIds: true,
        sendPush: true,
        sendEmail: true,
        sendSms: true,
      },
    });

    const recipients = await this.resolveRecipients(schoolId, notice);
    if (recipients.length === 0) return { recipients: 0 };

    const channels: Array<'IN_APP' | 'PUSH' | 'EMAIL' | 'SMS'> = ['IN_APP'];
    if (notice.sendPush) channels.push('PUSH');
    if (notice.sendEmail) channels.push('EMAIL');
    if (notice.sendSms) channels.push('SMS');

    await this.notifications.dispatch({
      schoolId,
      userIds: recipients,
      type: NotificationType.NOTICE,
      title: notice.title,
      // Push payloads must stay short; the full text lives in the app.
      body: notice.body.length > 160 ? `${notice.body.slice(0, 157)}...` : notice.body,
      priority: notice.priority,
      data: { noticeId: notice.id, kind: notice.kind },
      actionUrl: `/notices/${notice.id}`,
      channels,
      // An urgent notice overrides a user's opt-out.
      force: notice.priority === Priority.URGENT,
      email: {
        subject: notice.title,
        template: 'notice',
        data: { title: notice.title, body: notice.body },
      },
      smsBody: `${notice.title}: ${notice.body.slice(0, 120)}`,
    });

    this.log.info('Notice dispatched', { noticeId, recipients: recipients.length });
    return { recipients: recipients.length };
  }

  /** Expands an audience selector into the concrete list of user ids. */
  private async resolveRecipients(
    schoolId: string,
    notice: {
      audience: NoticeAudience;
      classId: string | null;
      sectionId: string | null;
      targetUserIds: string[];
    },
  ): Promise<string[]> {
    const ids = new Set<string>();

    const addUsers = (users: Array<{ id: string }>) => {
      for (const user of users) ids.add(user.id);
    };

    switch (notice.audience) {
      case NoticeAudience.SPECIFIC_USERS: {
        const users = await this.prisma.user.findMany({
          where: { id: { in: notice.targetUserIds }, schoolId, deletedAt: null },
          select: { id: true },
        });
        addUsers(users);
        break;
      }

      case NoticeAudience.TEACHERS: {
        const users = await this.prisma.user.findMany({
          where: {
            schoolId,
            deletedAt: null,
            status: 'ACTIVE',
            roles: { some: { role: { type: RoleType.TEACHER } } },
          },
          select: { id: true },
        });
        addUsers(users);
        break;
      }

      case NoticeAudience.STAFF: {
        const users = await this.prisma.user.findMany({
          where: { schoolId, deletedAt: null, status: 'ACTIVE', staff: { isNot: null } },
          select: { id: true },
        });
        addUsers(users);
        break;
      }

      case NoticeAudience.PARENTS: {
        const users = await this.prisma.user.findMany({
          where: { schoolId, deletedAt: null, status: 'ACTIVE', guardian: { isNot: null } },
          select: { id: true },
        });
        addUsers(users);
        break;
      }

      case NoticeAudience.STUDENTS: {
        const users = await this.prisma.user.findMany({
          where: { schoolId, deletedAt: null, status: 'ACTIVE', student: { isNot: null } },
          select: { id: true },
        });
        addUsers(users);
        break;
      }

      case NoticeAudience.CLASS:
      case NoticeAudience.SECTION: {
        // A class or section notice reaches the students and their guardians.
        const enrollments = await this.prisma.enrollment.findMany({
          where: {
            status: 'ACTIVE',
            ...(notice.audience === NoticeAudience.SECTION
              ? { sectionId: notice.sectionId ?? undefined }
              : { classId: notice.classId ?? undefined }),
          },
          select: {
            student: {
              select: {
                userId: true,
                guardians: { select: { guardian: { select: { userId: true } } } },
              },
            },
            section: { select: { classTeacherId: true } },
          },
        });

        for (const enrollment of enrollments) {
          if (enrollment.student.userId) ids.add(enrollment.student.userId);
          for (const link of enrollment.student.guardians) {
            if (link.guardian.userId) ids.add(link.guardian.userId);
          }
        }

        // The class teacher should see notices addressed to their class.
        const teacherIds = enrollments
          .map((enrollment) => enrollment.section.classTeacherId)
          .filter((id): id is string => Boolean(id));

        if (teacherIds.length > 0) {
          const teachers = await this.prisma.staff.findMany({
            where: { id: { in: teacherIds } },
            select: { userId: true },
          });
          for (const teacher of teachers) ids.add(teacher.userId);
        }
        break;
      }

      case NoticeAudience.ALL:
      default: {
        const users = await this.prisma.user.findMany({
          where: { schoolId, deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        });
        addUsers(users);
        break;
      }
    }

    return [...ids];
  }

  /** Which audience buckets a given user falls into. */
  private async audiencesFor(
    schoolId: string,
    user: AuthenticatedUser,
  ): Promise<{ roleAudiences: NoticeAudience[]; classIds: string[]; sectionIds: string[] }> {
    const roleAudiences: NoticeAudience[] = [];
    const classIds: string[] = [];
    const sectionIds: string[] = [];

    if (user.staffId) {
      roleAudiences.push(NoticeAudience.STAFF);
      if (user.roles.includes(RoleType.TEACHER)) roleAudiences.push(NoticeAudience.TEACHERS);

      const sections = await this.prisma.section.findMany({
        where: { schoolId, classTeacherId: user.staffId },
        select: { id: true, classId: true },
      });
      for (const section of sections) {
        sectionIds.push(section.id);
        classIds.push(section.classId);
      }
    }

    if (user.studentId) {
      roleAudiences.push(NoticeAudience.STUDENTS);
      const enrollment = await this.prisma.enrollment.findFirst({
        where: { studentId: user.studentId, status: 'ACTIVE' },
        select: { classId: true, sectionId: true },
      });
      if (enrollment) {
        classIds.push(enrollment.classId);
        sectionIds.push(enrollment.sectionId);
      }
    }

    if (user.guardianId) {
      roleAudiences.push(NoticeAudience.PARENTS);
      const enrollments = await this.prisma.enrollment.findMany({
        where: {
          status: 'ACTIVE',
          student: { guardians: { some: { guardianId: user.guardianId } } },
        },
        select: { classId: true, sectionId: true },
      });
      for (const enrollment of enrollments) {
        classIds.push(enrollment.classId);
        sectionIds.push(enrollment.sectionId);
      }
    }

    return {
      roleAudiences,
      classIds: [...new Set(classIds)],
      sectionIds: [...new Set(sectionIds)],
    };
  }

  private assertAudienceValid(dto: CreateNoticeDto): void {
    if (dto.audience === NoticeAudience.CLASS && !dto.classId) {
      throw new BadRequestError('A class must be selected for a class notice');
    }
    if (dto.audience === NoticeAudience.SECTION && !dto.sectionId) {
      throw new BadRequestError('A section must be selected for a section notice');
    }
    if (dto.audience === NoticeAudience.SPECIFIC_USERS && !dto.targetUserIds?.length) {
      throw new BadRequestError('At least one recipient must be selected');
    }
  }

  private assertCanManage(user: AuthenticatedUser, authorId: string): void {
    if (user.isSuperAdmin) return;
    if (user.id === authorId) return;
    if (user.permissions.includes(PERMISSIONS.NOTICES_DELETE)) return;
    throw new ForbiddenError('You can only change notices you created yourself');
  }
}
