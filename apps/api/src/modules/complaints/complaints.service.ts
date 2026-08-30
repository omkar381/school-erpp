import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  ComplaintStatus,
  NotificationType,
  Prisma,
  Priority,
  UserStatus,
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
import { parseDateOnly } from '../../common/utils/date.util';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import type {
  ComplaintQueryDto,
  CreateComplaintDto,
  UpdateComplaintDto,
  UpdateComplaintStatusDto,
} from './dto/complaints.dto';

const COMPLAINT_SORT_FIELDS = ['createdAt', 'updatedAt', 'status', 'category'] as const;

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Statuses in which the school still owes the complainant an outcome. */
const OPEN_STATUSES: ComplaintStatus[] = [ComplaintStatus.OPEN, ComplaintStatus.UNDER_REVIEW];

/**
 * Statuses a complaint may move to from each status.
 *
 * RESOLVED and DISMISSED both fall back to UNDER_REVIEW rather than to OPEN,
 * because a complaint that has already been looked at and reopened is under
 * review by definition.
 */
const ALLOWED_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  OPEN: [ComplaintStatus.UNDER_REVIEW, ComplaintStatus.RESOLVED, ComplaintStatus.DISMISSED],
  UNDER_REVIEW: [ComplaintStatus.RESOLVED, ComplaintStatus.DISMISSED],
  RESOLVED: [ComplaintStatus.UNDER_REVIEW],
  DISMISSED: [ComplaintStatus.UNDER_REVIEW],
};

/** Renders a status the way a message to a person should read. */
function humanStatus(status: ComplaintStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

/** Statuses that must say what was actually done. */
const OUTCOME_STATUSES: ComplaintStatus[] = [
  ComplaintStatus.RESOLVED,
  ComplaintStatus.DISMISSED,
];

const REPORTER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} satisfies Prisma.UserSelect;

const COMPLAINT_INCLUDE = {
  reportedBy: { select: REPORTER_SELECT },
  resolvedBy: { select: REPORTER_SELECT },
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
} satisfies Prisma.ComplaintInclude;

type ComplaintRecord = Prisma.ComplaintGetPayload<{ include: typeof COMPLAINT_INCLUDE }>;

/**
 * Grievance redressal.
 *
 * A complaint differs from a support ticket in who it is about: it is a formal
 * record that the school has been told something is wrong, and it can be filed
 * anonymously. Anonymity here is real — the reporter is redacted from every
 * response except the reporter's own, handlers included — because a channel
 * that promises anonymity and then shows the name to the person being
 * complained about is worse than having no channel at all.
 */
@Injectable()
export class ComplaintsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    logger: AppLogger,
  ) {
    this.log = logger.child('ComplaintsService');
  }

  // -------------------------------------------------------------------------
  // Access
  // -------------------------------------------------------------------------

  /** Whether this caller handles complaints rather than merely raising them. */
  private isHandler(user: AuthenticatedUser): boolean {
    return user.permissions.includes(PERMISSIONS.COMPLAINTS_MANAGE);
  }

  /** The rows this caller may see at all. */
  private scopeFor(schoolId: string, user: AuthenticatedUser): Prisma.ComplaintWhereInput {
    if (this.isHandler(user)) return { schoolId };
    return { schoolId, reportedById: user.id };
  }

  /**
   * Hides the reporter on an anonymous complaint.
   *
   * The reporter still sees their own name, so their list does not turn into a
   * wall of "Anonymous" they cannot tell apart.
   */
  private shape(complaint: ComplaintRecord, user: AuthenticatedUser) {
    const isOwn = complaint.reportedById === user.id;
    const hideReporter = complaint.isAnonymous && !isOwn;

    return {
      id: complaint.id,
      category: complaint.category,
      subject: complaint.subject,
      description: complaint.description,
      status: complaint.status,
      isAnonymous: complaint.isAnonymous,
      isOwn,
      resolution: complaint.resolution,
      resolvedAt: complaint.resolvedAt,
      resolvedBy: complaint.resolvedBy
        ? {
            id: complaint.resolvedBy.id,
            name: [complaint.resolvedBy.firstName, complaint.resolvedBy.lastName]
              .filter(Boolean)
              .join(' '),
          }
        : null,
      reportedBy: hideReporter
        ? null
        : {
            id: complaint.reportedBy.id,
            name: [complaint.reportedBy.firstName, complaint.reportedBy.lastName]
              .filter(Boolean)
              .join(' '),
            email: complaint.reportedBy.email,
            phone: complaint.reportedBy.phone,
          },
      student: complaint.student
        ? {
            ...complaint.student,
            fullName: [complaint.student.firstName, complaint.student.lastName]
              .filter(Boolean)
              .join(' '),
          }
        : null,
      attachments: complaint.attachments,
      createdAt: complaint.createdAt,
      updatedAt: complaint.updatedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async statistics(schoolId: string, user: AuthenticatedUser) {
    const scope = this.scopeFor(schoolId, user);

    const [byStatus, byCategory, resolved] = await Promise.all([
      this.prisma.complaint.groupBy({
        by: ['status'],
        where: scope,
        _count: { _all: true },
      }),
      this.prisma.complaint.groupBy({
        by: ['category'],
        where: scope,
        _count: { _all: true },
      }),
      this.prisma.complaint.findMany({
        where: { ...scope, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        take: 500,
        orderBy: { resolvedAt: 'desc' },
      }),
    ]);

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])) as
      Record<ComplaintStatus, number | undefined>;

    const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);

    // Average days to an outcome, over the most recent 500 closed complaints —
    // enough to be representative without scanning the whole table.
    const averageResolutionDays =
      resolved.length > 0
        ? Math.round(
            (resolved.reduce(
              (sum, row) => sum + (row.resolvedAt!.getTime() - row.createdAt.getTime()),
              0,
            ) /
              resolved.length /
              86_400_000) *
              10,
          ) / 10
        : null;

    return {
      total,
      open: counts.OPEN ?? 0,
      underReview: counts.UNDER_REVIEW ?? 0,
      resolved: counts.RESOLVED ?? 0,
      dismissed: counts.DISMISSED ?? 0,
      awaitingOutcome: OPEN_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0),
      averageResolutionDays,
      byCategory: byCategory
        .map((row) => ({ category: row.category, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async list(schoolId: string, user: AuthenticatedUser, query: ComplaintQueryDto) {
    const where: Prisma.ComplaintWhereInput = {
      ...this.scopeFor(schoolId, user),
      ...(query.status ? { status: query.status } : {}),
      ...(query.openOnly ? { status: { in: OPEN_STATUSES } } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              // `to` is inclusive, so run to the end of that day.
              ...(query.to
                ? { lte: new Date(parseDateOnly(query.to).getTime() + 86_399_999) }
                : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        include: COMPLAINT_INCLUDE,
        orderBy: query.buildOrderBy(COMPLAINT_SORT_FIELDS, 'createdAt'),
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.complaint.count({ where }),
    ]);

    return buildPaginatedResult(
      rows.map((row) => this.shape(row, user)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, user: AuthenticatedUser, id: string) {
    const complaint = await this.prisma.complaint.findFirst({
      where: { id, ...this.scopeFor(schoolId, user) },
      include: COMPLAINT_INCLUDE,
    });
    // A complaint outside this caller's scope must read as absent rather than
    // forbidden, so the endpoint cannot be used to confirm one exists.
    if (!complaint) throw new NotFoundError('Complaint');

    return this.shape(complaint, user);
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  async create(schoolId: string, user: AuthenticatedUser, dto: CreateComplaintDto) {
    if (dto.studentId) {
      const student = await this.prisma.student.count({
        where: { id: dto.studentId, schoolId, deletedAt: null },
      });
      if (student === 0) throw new NotFoundError('Student');
    }

    const complaint = await this.prisma.complaint.create({
      data: {
        schoolId,
        reportedById: user.id,
        studentId: dto.studentId ?? null,
        category: dto.category,
        subject: dto.subject,
        description: dto.description,
        isAnonymous: dto.isAnonymous ?? false,
        status: ComplaintStatus.OPEN,
      },
      include: COMPLAINT_INCLUDE,
    });

    if (dto.attachmentIds?.length) {
      await this.prisma.attachment.updateMany({
        where: { id: { in: dto.attachmentIds }, schoolId, uploadedById: user.id },
        data: { complaintId: complaint.id },
      });
    }

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'complaints',
      entity: 'Complaint',
      entityId: complaint.id,
      // The audit trail records that a complaint was raised, not who raised it,
      // so an anonymous report stays anonymous even to someone reading the log.
      description: `Complaint raised — ${dto.category}: ${dto.subject}`,
      schoolId,
      ...(dto.isAnonymous ? { userId: null } : {}),
    });

    await this.notifyHandlers(schoolId, complaint);

    this.log.info('Complaint raised', {
      schoolId,
      complaintId: complaint.id,
      category: dto.category,
      isAnonymous: complaint.isAnonymous,
    });

    return this.shape(complaint, user);
  }

  /**
   * Corrects the wording of a complaint.
   *
   * Only the person who raised it may edit it, and only while nobody has ruled
   * on it — rewriting a complaint after it was resolved would leave a
   * resolution answering a question that is no longer on the record.
   */
  async update(schoolId: string, user: AuthenticatedUser, id: string, dto: UpdateComplaintDto) {
    const existing = await this.prisma.complaint.findFirst({
      where: { id, ...this.scopeFor(schoolId, user) },
    });
    if (!existing) throw new NotFoundError('Complaint');

    if (existing.reportedById !== user.id) {
      throw new ForbiddenError('Only the person who raised a complaint can edit it');
    }
    if (!OPEN_STATUSES.includes(existing.status)) {
      throw new BadRequestError(
        `This complaint has already been ${humanStatus(existing.status)} and can no longer be edited`,
      );
    }

    const updated = await this.prisma.complaint.update({
      where: { id },
      data: {
        category: dto.category ?? undefined,
        subject: dto.subject ?? undefined,
        description: dto.description ?? undefined,
      },
      include: COMPLAINT_INCLUDE,
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'complaints',
      entity: 'Complaint',
      entityId: id,
      description: 'Complaint edited by the person who raised it',
      schoolId,
    });

    return this.shape(updated, user);
  }

  async updateStatus(
    schoolId: string,
    user: AuthenticatedUser,
    id: string,
    dto: UpdateComplaintStatusDto,
  ) {
    if (!this.isHandler(user)) {
      throw new ForbiddenError('You are not allowed to rule on complaints');
    }

    const existing = await this.prisma.complaint.findFirst({ where: { id, schoolId } });
    if (!existing) throw new NotFoundError('Complaint');

    if (existing.status === dto.status) {
      throw new BadRequestError(`This complaint is already ${humanStatus(dto.status)}`);
    }

    const allowed = ALLOWED_TRANSITIONS[existing.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestError(
        `This complaint is ${humanStatus(existing.status)} and cannot move to ` +
          `${humanStatus(dto.status)}. Allowed: ${allowed.map(humanStatus).join(', ')}`,
      );
    }

    const isOutcome = OUTCOME_STATUSES.includes(dto.status);
    if (isOutcome && !dto.resolution?.trim()) {
      throw new BadRequestError(
        `Say what was done before marking a complaint ${humanStatus(dto.status)}`,
      );
    }

    const updated = await this.prisma.complaint.update({
      where: { id },
      data: {
        status: dto.status,
        resolution: dto.resolution ?? (isOutcome ? undefined : null),
        resolvedById: isOutcome ? user.id : null,
        resolvedAt: isOutcome ? new Date() : null,
      },
      include: COMPLAINT_INCLUDE,
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'complaints',
      entity: 'Complaint',
      entityId: id,
      description: `Complaint moved from ${existing.status} to ${dto.status}`,
      oldValue: { status: existing.status },
      newValue: { status: dto.status, resolution: dto.resolution ?? null },
      schoolId,
    });

    await this.notifyReporter(updated, dto.status);

    return this.shape(updated, user);
  }

  async uploadAttachment(schoolId: string, user: AuthenticatedUser, file: Express.Multer.File) {
    if (!file) throw new BadRequestError('No file was uploaded');
    if (file.size > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestError('Attachments must be 10 MB or smaller');
    }

    const stored = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `complaints/${schoolId}`,
      schoolId,
    });

    return this.prisma.attachment.create({
      data: {
        schoolId,
        fileName: stored.fileName,
        storageKey: stored.storageKey,
        url: stored.url,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        uploadedById: user.id,
      },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true, url: true },
    });
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  /** Tells the people who handle complaints that a new one has landed. */
  private async notifyHandlers(schoolId: string, complaint: ComplaintRecord): Promise<void> {
    try {
      const handlers = await this.prisma.user.findMany({
        where: {
          schoolId,
          deletedAt: null,
          status: UserStatus.ACTIVE,
          roles: {
            some: {
              role: {
                permissions: {
                  some: { permission: { key: PERMISSIONS.COMPLAINTS_MANAGE } },
                },
              },
            },
          },
        },
        select: { id: true },
        take: 50,
      });

      if (handlers.length === 0) return;

      await this.notifications.dispatch({
        schoolId,
        userIds: handlers.map((handler) => handler.id),
        type: NotificationType.GENERAL,
        title: 'A new complaint was raised',
        body: `${complaint.category} — ${complaint.subject}`,
        priority: Priority.IMPORTANT,
        actionUrl: `/complaints/${complaint.id}`,
        data: { complaintId: complaint.id },
      });
    } catch (error) {
      // A complaint that was filed but not announced is still filed; failing the
      // request here would lose the report itself.
      this.log.warn('Could not notify complaint handlers', {
        schoolId,
        complaintId: complaint.id,
        error: (error as Error).message,
      });
    }
  }

  /** Tells the complainant what was decided. */
  private async notifyReporter(
    complaint: ComplaintRecord,
    status: ComplaintStatus,
  ): Promise<void> {
    try {
      await this.notifications.dispatch({
        schoolId: complaint.schoolId,
        userIds: [complaint.reportedById],
        type: NotificationType.GENERAL,
        title: `Your complaint was marked ${humanStatus(status)}`,
        body: complaint.resolution ?? complaint.subject,
        priority: Priority.NORMAL,
        actionUrl: `/complaints/${complaint.id}`,
        data: { complaintId: complaint.id, status },
      });
    } catch (error) {
      this.log.warn('Could not notify complainant', {
        complaintId: complaint.id,
        error: (error as Error).message,
      });
    }
  }
}
