import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  NotificationType,
  Prisma,
  Priority,
  RoleType,
  TicketPriority,
  TicketStatus,
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
import { SequenceService } from '../../common/services/sequence.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import type {
  AssignTicketDto,
  CloseTicketDto,
  CreateTicketDto,
  ReplyTicketDto,
  TicketQueryDto,
  TicketStatsQueryDto,
  UpdateTicketDto,
} from './dto/support.dto';

const TICKET_SORT_FIELDS = ['createdAt', 'updatedAt', 'priority', 'status', 'subject'] as const;

const LIVE_STATUSES: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.IN_PROGRESS,
  TicketStatus.WAITING,
];

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

interface TicketAccess {
  /** May see internal notes, assign, and change priority or status freely. */
  isAgent: boolean;
  /** Platform support staff, who work across schools. */
  isPlatform: boolean;
}

/**
 * The support desk.
 *
 * One ticket table serves both the school portal and the platform's support
 * queue; who you are decides which rows you see and which fields come back.
 * Every read goes through `scopeFor`, so there is exactly one place where that
 * decision is made rather than a visibility rule per endpoint.
 */
@Injectable()
export class SupportService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly sequences: SequenceService,
    private readonly storage: StorageService,
    logger: AppLogger,
  ) {
    this.log = logger.child('SupportService');
  }

  // -------------------------------------------------------------------------
  // Access
  // -------------------------------------------------------------------------

  private accessFor(user: AuthenticatedUser): TicketAccess {
    const isPlatform = user.isSuperAdmin || user.roles.includes(RoleType.SUPER_ADMIN);
    return {
      isPlatform,
      isAgent: isPlatform || user.permissions.includes(PERMISSIONS.SUPPORT_TICKETS_MANAGE),
    };
  }

  /**
   * The rows this caller is allowed to see at all.
   *
   * A requester sees only their own tickets. A school agent sees their
   * school's. Platform support sees everything. Nothing widens this — the
   * query filters below can only narrow it further.
   */
  private scopeFor(
    schoolId: string | null,
    user: AuthenticatedUser,
    access: TicketAccess,
  ): Prisma.SupportTicketWhereInput {
    if (access.isPlatform) return {};
    if (!schoolId) return { requesterId: user.id };
    if (access.isAgent) return { schoolId };
    return { schoolId, requesterId: user.id };
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async findAll(schoolId: string | null, user: AuthenticatedUser, query: TicketQueryDto) {
    const access = this.accessFor(user);
    const scope = this.scopeFor(schoolId, user, access);

    const where: Prisma.SupportTicketWhereInput = {
      AND: [
        scope,
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.openOnly ? { status: { in: LIVE_STATUSES } } : {}),
          ...(query.priority ? { priority: query.priority } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
          ...(query.unassigned ? { assigneeId: null } : {}),
          ...(query.mine ? { requesterId: user.id } : {}),
          // Only platform support may target another school; for everyone else
          // the scope above already pins the tenant and this is ignored.
          ...(query.requesterId && access.isAgent ? { requesterId: query.requesterId } : {}),
          ...(query.schoolId && access.isPlatform ? { schoolId: query.schoolId } : {}),
          ...(query.search
            ? {
                OR: [
                  { subject: { contains: query.search, mode: 'insensitive' } },
                  { ticketNumber: { contains: query.search, mode: 'insensitive' } },
                  { description: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      ],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(TICKET_SORT_FIELDS, 'createdAt'),
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          category: true,
          priority: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
          closedAt: true,
          firstResponseAt: true,
          school: access.isPlatform
            ? { select: { id: true, name: true, code: true } }
            : undefined,
          requester: {
            select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
          },
          assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          _count: { select: { messages: true, attachments: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ _count, ...ticket }) => ({
        ...ticket,
        messageCount: _count.messages,
        attachmentCount: _count.attachments,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string | null, user: AuthenticatedUser, id: string) {
    const access = this.accessFor(user);

    const ticket = await this.prisma.supportTicket.findFirst({
      where: { AND: [{ id }, this.scopeFor(schoolId, user, access)] },
      include: {
        school: { select: { id: true, name: true, code: true } },
        requester: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            avatarUrl: true,
          },
        },
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        attachments: {
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, url: true },
          where: { ticketMessageId: null },
        },
        messages: {
          // A requester must never see the internal triage conversation.
          where: access.isAgent ? {} : { isInternal: false },
          orderBy: { createdAt: 'asc' },
          include: {
            author: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true },
            },
            attachments: {
              select: { id: true, fileName: true, mimeType: true, sizeBytes: true, url: true },
            },
          },
        },
      },
    });

    if (!ticket) throw new NotFoundError('Support ticket');

    const history = access.isAgent
      ? await this.prisma.auditLog.findMany({
          where: { entity: 'SupportTicket', entityId: id },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            action: true,
            description: true,
            oldValue: true,
            newValue: true,
            createdAt: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        })
      : [];

    return {
      ...ticket,
      canReply: ticket.status !== TicketStatus.CLOSED,
      canManage: access.isAgent,
      history,
    };
  }

  /** Headline counts for the support dashboards. */
  async statistics(
    schoolId: string | null,
    user: AuthenticatedUser,
    query: TicketStatsQueryDto = {},
  ) {
    const access = this.accessFor(user);
    const scope = this.scopeFor(schoolId, user, access);
    const narrowed: Prisma.SupportTicketWhereInput = {
      AND: [scope, query.schoolId && access.isPlatform ? { schoolId: query.schoolId } : {}],
    };

    const windowDays = Math.min(Math.max(query.days ?? 30, 1), 365);
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const [byStatus, byPriority, unassigned, resolvedRecently] = await Promise.all([
      this.prisma.supportTicket.groupBy({
        by: ['status'],
        where: narrowed,
        _count: { _all: true },
      }),
      this.prisma.supportTicket.groupBy({
        by: ['priority'],
        where: { AND: [narrowed, { status: { in: LIVE_STATUSES } }] },
        _count: { _all: true },
      }),
      this.prisma.supportTicket.count({
        where: { AND: [narrowed, { assigneeId: null, status: { in: LIVE_STATUSES } }] },
      }),
      this.prisma.supportTicket.findMany({
        where: { AND: [narrowed, { resolvedAt: { gte: since } }] },
        select: { createdAt: true, resolvedAt: true, firstResponseAt: true },
      }),
    ]);

    const statusCount = (status: TicketStatus): number =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;
    const priorityCount = (priority: TicketPriority): number =>
      byPriority.find((row) => row.priority === priority)?._count._all ?? 0;

    const resolutionHours = resolvedRecently
      .filter((ticket) => ticket.resolvedAt)
      .map((ticket) => (ticket.resolvedAt!.getTime() - ticket.createdAt.getTime()) / 3_600_000);
    const responseHours = resolvedRecently
      .filter((ticket) => ticket.firstResponseAt)
      .map((ticket) => (ticket.firstResponseAt!.getTime() - ticket.createdAt.getTime()) / 3_600_000);

    return {
      open: statusCount(TicketStatus.OPEN),
      inProgress: statusCount(TicketStatus.IN_PROGRESS),
      waiting: statusCount(TicketStatus.WAITING),
      resolved: statusCount(TicketStatus.RESOLVED),
      closed: statusCount(TicketStatus.CLOSED),
      pending:
        statusCount(TicketStatus.OPEN) +
        statusCount(TicketStatus.IN_PROGRESS) +
        statusCount(TicketStatus.WAITING),
      urgent: priorityCount(TicketPriority.CRITICAL) + priorityCount(TicketPriority.HIGH),
      unassigned,
      windowDays,
      resolvedInWindow: resolvedRecently.length,
      averageResolutionHours: average(resolutionHours),
      averageFirstResponseHours: average(responseHours),
    };
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  async create(schoolId: string | null, user: AuthenticatedUser, dto: CreateTicketDto) {
    // A platform user filing a ticket has no tenant; a school user always does.
    const ticketNumber = schoolId
      ? await this.sequences.next(schoolId, 'TICKET')
      : `TKT/PLATFORM/${Date.now().toString(36).toUpperCase()}`;

    const ticket = await this.prisma.supportTicket.create({
      data: {
        schoolId,
        requesterId: user.id,
        ticketNumber,
        subject: dto.subject,
        description: dto.description,
        category: dto.category ?? 'GENERAL',
        priority: dto.priority ?? TicketPriority.MEDIUM,
        status: TicketStatus.OPEN,
      },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (dto.attachmentIds?.length) {
      await this.claimAttachments(dto.attachmentIds, user.id, { ticketId: ticket.id });
    }

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'support',
      entity: 'SupportTicket',
      entityId: ticket.id,
      description: `Raised ticket ${ticket.ticketNumber}: ${ticket.subject}`,
      newValue: { category: ticket.category, priority: ticket.priority },
      schoolId,
      userId: user.id,
    });

    await this.notifyAgents(
      ticket.id,
      schoolId,
      `New ${ticket.priority.toLowerCase()} priority ticket`,
      `${ticket.ticketNumber} — ${ticket.subject}`,
      ticket.priority,
      user.id,
    );

    this.log.info('Support ticket raised', {
      ticketId: ticket.id,
      number: ticket.ticketNumber,
      schoolId,
    });

    return ticket;
  }

  async reply(
    schoolId: string | null,
    user: AuthenticatedUser,
    id: string,
    dto: ReplyTicketDto,
  ) {
    const access = this.accessFor(user);
    const ticket = await this.loadForWrite(schoolId, user, access, id);

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestError(
        'This ticket is closed. Raise a new one if the problem has come back.',
      );
    }

    // "Internal" is a promise to the agent that the requester will not see it,
    // so a requester must never be able to set it, even by accident.
    const isInternal = Boolean(dto.isInternal) && access.isAgent;

    const message = await this.prisma.ticketMessage.create({
      data: { ticketId: id, authorId: user.id, body: dto.body, isInternal },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    if (dto.attachmentIds?.length) {
      await this.claimAttachments(dto.attachmentIds, user.id, {
        ticketId: id,
        ticketMessageId: message.id,
      });
    }

    const nextStatus = this.resolveReplyStatus(ticket, access, isInternal, dto.status);

    await this.prisma.supportTicket.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        ...(nextStatus ? this.statusTransition(nextStatus) : {}),
        // The clock stops on the first reply from someone other than the
        // requester — an author replying to themselves is not a response.
        ...(!ticket.firstResponseAt && access.isAgent && !isInternal
          ? { firstResponseAt: new Date() }
          : {}),
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'support',
      entity: 'SupportTicket',
      entityId: id,
      description: isInternal
        ? `Added an internal note to ${ticket.ticketNumber}`
        : `Replied to ${ticket.ticketNumber}`,
      newValue: nextStatus ? { status: nextStatus } : undefined,
      schoolId: ticket.schoolId,
      userId: user.id,
    });

    if (!isInternal) {
      await this.notifyReply(ticket, user, dto.body);
    }

    return message;
  }

  async assign(
    schoolId: string | null,
    user: AuthenticatedUser,
    id: string,
    dto: AssignTicketDto,
  ) {
    const access = this.accessFor(user);
    if (!access.isAgent) {
      throw new ForbiddenError('Only support staff can assign tickets');
    }

    const ticket = await this.loadForWrite(schoolId, user, access, id);

    if (dto.assigneeId) {
      const assignee = await this.prisma.user.findFirst({
        where: { id: dto.assigneeId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, schoolId: true },
      });
      if (!assignee) throw new NotFoundError('Assignee');

      // A school agent may only hand a ticket to somebody in their own school;
      // platform support may assign to anyone on the support team.
      if (!access.isPlatform && assignee.schoolId !== ticket.schoolId) {
        throw new ForbiddenError('You can only assign tickets to people in your own school');
      }
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        assigneeId: dto.assigneeId ?? null,
        ...(dto.assigneeId && ticket.status === TicketStatus.OPEN
          ? { status: TicketStatus.IN_PROGRESS }
          : {}),
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    if (dto.note) {
      await this.prisma.ticketMessage.create({
        data: { ticketId: id, authorId: user.id, body: dto.note, isInternal: true },
      });
    }

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'support',
      entity: 'SupportTicket',
      entityId: id,
      description: dto.assigneeId
        ? `Assigned ${ticket.ticketNumber} to ${updated.assignee?.firstName ?? 'a colleague'}`
        : `Unassigned ${ticket.ticketNumber}`,
      oldValue: { assigneeId: ticket.assigneeId },
      newValue: { assigneeId: dto.assigneeId ?? null },
      schoolId: ticket.schoolId,
      userId: user.id,
    });

    if (dto.assigneeId && dto.assigneeId !== user.id) {
      await this.notifications.dispatch({
        schoolId: ticket.schoolId,
        userIds: [dto.assigneeId],
        type: NotificationType.SUPPORT,
        title: 'A ticket was assigned to you',
        body: `${ticket.ticketNumber} — ${ticket.subject}`,
        priority: this.notificationPriority(ticket.priority),
        actionUrl: `/support/${id}`,
        data: { ticketId: id, ticketNumber: ticket.ticketNumber },
      });
    }

    return updated;
  }

  async update(
    schoolId: string | null,
    user: AuthenticatedUser,
    id: string,
    dto: UpdateTicketDto,
  ) {
    const access = this.accessFor(user);
    if (!access.isAgent) {
      throw new ForbiddenError('Only support staff can change a ticket’s status or priority');
    }

    const ticket = await this.loadForWrite(schoolId, user, access, id);

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.status ? this.statusTransition(dto.status) : {}),
        ...(dto.priority ? { priority: dto.priority } : {}),
        ...(dto.category ? { category: dto.category } : {}),
      },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        category: true,
        resolvedAt: true,
        closedAt: true,
      },
    });

    if (dto.note) {
      await this.prisma.ticketMessage.create({
        data: { ticketId: id, authorId: user.id, body: dto.note, isInternal: true },
      });
    }

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'support',
      entity: 'SupportTicket',
      entityId: id,
      description: `Updated ${ticket.ticketNumber}${dto.note ? `: ${dto.note}` : ''}`,
      oldValue: {
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
      },
      newValue: {
        status: updated.status,
        priority: updated.priority,
        category: updated.category,
      },
      schoolId: ticket.schoolId,
      userId: user.id,
    });

    if (dto.status && dto.status !== ticket.status) {
      await this.notifyRequester(ticket, updated.status);
    }

    return updated;
  }

  /** A requester closing their own resolved ticket. */
  async close(schoolId: string | null, user: AuthenticatedUser, id: string, dto: CloseTicketDto) {
    const access = this.accessFor(user);
    const ticket = await this.loadForWrite(schoolId, user, access, id);

    if (!access.isAgent && ticket.requesterId !== user.id) {
      throw new ForbiddenError('You can only close a ticket you raised');
    }
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestError('This ticket is already closed');
    }

    if (dto.comment) {
      await this.prisma.ticketMessage.create({
        data: { ticketId: id, authorId: user.id, body: dto.comment, isInternal: false },
      });
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: this.statusTransition(TicketStatus.CLOSED),
      select: { id: true, status: true, closedAt: true, ticketNumber: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'support',
      entity: 'SupportTicket',
      entityId: id,
      description: `Closed ${ticket.ticketNumber}`,
      oldValue: { status: ticket.status },
      newValue: { status: TicketStatus.CLOSED },
      schoolId: ticket.schoolId,
      userId: user.id,
    });

    return updated;
  }

  /** Uploads a file and parks it until a ticket or reply claims it. */
  async uploadAttachment(
    schoolId: string | null,
    user: AuthenticatedUser,
    file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestError('No file was uploaded');
    if (file.size > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestError('Attachments must be 10 MB or smaller');
    }

    const stored = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `support/${schoolId ?? 'platform'}`,
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

  /** Support agents a ticket can be handed to. */
  async agents(schoolId: string | null, user: AuthenticatedUser) {
    const access = this.accessFor(user);
    if (!access.isAgent) throw new ForbiddenError('Only support staff can list assignees');

    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(access.isPlatform
          ? { roles: { some: { role: { type: RoleType.SUPER_ADMIN } } } }
          : {
              schoolId,
              roles: {
                some: { role: { type: { in: [RoleType.SCHOOL_ADMIN, RoleType.PRINCIPAL] } } },
              },
            }),
      },
      orderBy: { firstName: 'asc' },
      take: 100,
      select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async loadForWrite(
    schoolId: string | null,
    user: AuthenticatedUser,
    access: TicketAccess,
    id: string,
  ) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { AND: [{ id }, this.scopeFor(schoolId, user, access)] },
      select: {
        id: true,
        schoolId: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        category: true,
        requesterId: true,
        assigneeId: true,
        firstResponseAt: true,
      },
    });
    if (!ticket) throw new NotFoundError('Support ticket');
    return ticket;
  }

  /** Timestamps that must move together with the status. */
  private statusTransition(status: TicketStatus): Prisma.SupportTicketUpdateInput {
    // Reopening clears the completion timestamps, so the resolution metrics
    // never count a ticket that came back.
    if (LIVE_STATUSES.includes(status)) {
      return { status, resolvedAt: null, closedAt: null };
    }
    if (status === TicketStatus.RESOLVED) {
      return { status, resolvedAt: new Date(), closedAt: null };
    }
    return { status, closedAt: new Date() };
  }

  /**
   * Where a reply leaves the ticket when the author did not say.
   *
   * An agent's reply puts the ball in the requester's court; a requester's
   * reply brings it back. An internal note moves nothing.
   */
  private resolveReplyStatus(
    ticket: { status: TicketStatus; requesterId: string },
    access: TicketAccess,
    isInternal: boolean,
    requested?: TicketStatus,
  ): TicketStatus | null {
    if (requested && access.isAgent) return requested;
    if (isInternal) return null;

    if (access.isAgent) {
      return ticket.status === TicketStatus.OPEN ? TicketStatus.IN_PROGRESS : null;
    }
    return ticket.status === TicketStatus.WAITING || ticket.status === TicketStatus.RESOLVED
      ? TicketStatus.IN_PROGRESS
      : null;
  }

  private async claimAttachments(
    attachmentIds: string[],
    uploadedById: string,
    link: { ticketId: string; ticketMessageId?: string },
  ): Promise<void> {
    // Only the uploader's own unattached files can be claimed, so an id
    // guessed from elsewhere cannot pull somebody else's file onto a ticket.
    const { count } = await this.prisma.attachment.updateMany({
      where: {
        id: { in: attachmentIds },
        uploadedById,
        ticketId: null,
        ticketMessageId: null,
      },
      data: link,
    });

    if (count !== attachmentIds.length) {
      this.log.warn('Some ticket attachments could not be claimed', {
        requested: attachmentIds.length,
        claimed: count,
      });
    }
  }

  private notificationPriority(priority: TicketPriority): Priority {
    switch (priority) {
      case TicketPriority.CRITICAL:
        return Priority.URGENT;
      case TicketPriority.HIGH:
        return Priority.IMPORTANT;
      case TicketPriority.LOW:
        return Priority.LOW;
      default:
        return Priority.NORMAL;
    }
  }

  /** Tells whoever is responsible for the queue that a new ticket landed. */
  private async notifyAgents(
    ticketId: string,
    schoolId: string | null,
    title: string,
    body: string,
    priority: TicketPriority,
    excludeUserId: string,
  ): Promise<void> {
    try {
      const recipients = await this.prisma.user.findMany({
        where: {
          deletedAt: null,
          id: { not: excludeUserId },
          OR: [
            { roles: { some: { role: { type: RoleType.SUPER_ADMIN } } } },
            ...(schoolId
              ? [
                  {
                    schoolId,
                    roles: {
                      some: {
                        role: { type: { in: [RoleType.SCHOOL_ADMIN, RoleType.PRINCIPAL] } },
                      },
                    },
                  },
                ]
              : []),
          ],
        },
        select: { id: true },
        take: 30,
      });
      if (recipients.length === 0) return;

      await this.notifications.dispatch({
        schoolId,
        userIds: recipients.map((recipient) => recipient.id),
        type: NotificationType.SUPPORT,
        title,
        body,
        priority: this.notificationPriority(priority),
        actionUrl: `/support/${ticketId}`,
        data: { ticketId },
      });
    } catch (error) {
      this.log.error('Failed to notify support agents', error, { ticketId });
    }
  }

  /** A reply goes to the other side of the conversation, never back to its author. */
  private async notifyReply(
    ticket: { id: string; schoolId: string | null; ticketNumber: string; subject: string; requesterId: string; assigneeId: string | null; priority: TicketPriority },
    author: AuthenticatedUser,
    body: string,
  ): Promise<void> {
    const recipients = new Set<string>();
    if (ticket.requesterId !== author.id) recipients.add(ticket.requesterId);
    if (ticket.assigneeId && ticket.assigneeId !== author.id) recipients.add(ticket.assigneeId);
    if (recipients.size === 0) return;

    try {
      await this.notifications.dispatch({
        schoolId: ticket.schoolId,
        userIds: [...recipients],
        type: NotificationType.SUPPORT,
        title: `New reply on ${ticket.ticketNumber}`,
        body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
        priority: this.notificationPriority(ticket.priority),
        actionUrl: `/support/${ticket.id}`,
        data: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
      });
    } catch (error) {
      this.log.error('Failed to notify about a ticket reply', error, { ticketId: ticket.id });
    }
  }

  private async notifyRequester(
    ticket: { id: string; schoolId: string | null; ticketNumber: string; requesterId: string; priority: TicketPriority },
    status: TicketStatus,
  ): Promise<void> {
    try {
      await this.notifications.dispatch({
        schoolId: ticket.schoolId,
        userIds: [ticket.requesterId],
        type: NotificationType.SUPPORT,
        title:
          status === TicketStatus.RESOLVED
            ? `${ticket.ticketNumber} has been resolved`
            : `${ticket.ticketNumber} is now ${status.replace('_', ' ').toLowerCase()}`,
        body:
          status === TicketStatus.RESOLVED
            ? 'Open the ticket to confirm the fix, or reply if the problem is still there.'
            : 'Open the ticket to see the latest update.',
        priority: this.notificationPriority(ticket.priority),
        actionUrl: `/support/${ticket.id}`,
        data: { ticketId: ticket.id, status },
      });
    } catch (error) {
      this.log.error('Failed to notify the ticket requester', error, { ticketId: ticket.id });
    }
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}
