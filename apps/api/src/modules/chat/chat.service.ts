import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  ConversationType,
  MessageType,
  NotificationType,
  Prisma,
  RoleType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { PERMISSIONS } from '../../common/constants/permissions';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type {
  CreateConversationDto,
  ReportMessageDto,
  SendMessageDto,
} from './dto/chat.dto';

@Injectable()
export class ChatService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('ChatService');
  }

  // -------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------

  async listConversations(schoolId: string, userId: string, query: PaginationQueryDto) {
    const where: Prisma.ConversationWhereInput = {
      schoolId,
      members: { some: { userId, leftAt: null } },
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              {
                members: {
                  some: {
                    userId: { not: userId },
                    user: {
                      OR: [
                        { firstName: { contains: query.search, mode: 'insensitive' } },
                        { lastName: { contains: query.search, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          type: true,
          title: true,
          lastMessageAt: true,
          lastMessagePreview: true,
          isArchived: true,
          isLocked: true,
          members: {
            where: { leftAt: null },
            select: {
              userId: true,
              unreadCount: true,
              lastReadAt: true,
              isMuted: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatarUrl: true,
                  roles: { select: { role: { select: { type: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map((conversation) => {
        const me = conversation.members.find((member) => member.userId === userId);
        const others = conversation.members.filter((member) => member.userId !== userId);

        return {
          id: conversation.id,
          type: conversation.type,
          // A direct conversation is titled by the other participant.
          title:
            conversation.title ??
            (others.length === 1
              ? [others[0].user.firstName, others[0].user.lastName].filter(Boolean).join(' ')
              : `${others.length + 1} participants`),
          avatarUrl: others.length === 1 ? others[0].user.avatarUrl : null,
          lastMessageAt: conversation.lastMessageAt,
          lastMessagePreview: conversation.lastMessagePreview,
          unreadCount: me?.unreadCount ?? 0,
          isMuted: me?.isMuted ?? false,
          isArchived: conversation.isArchived,
          isLocked: conversation.isLocked,
          participants: others.map((member) => ({
            id: member.user.id,
            name: [member.user.firstName, member.user.lastName].filter(Boolean).join(' '),
            avatarUrl: member.user.avatarUrl,
            roles: member.user.roles.map((entry) => entry.role.type),
            isOnline: this.realtime.isOnline(member.user.id),
          })),
        };
      }),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * Opens a conversation, reusing the existing thread for a pair of users.
   *
   * A stable hash of the sorted member ids gives every pair exactly one direct
   * thread, so two people cannot end up messaging in parallel conversations.
   */
  async createConversation(schoolId: string, dto: CreateConversationDto, user: AuthenticatedUser) {
    const memberIds = [...new Set([user.id, ...dto.memberIds])];

    if (memberIds.length < 2) {
      throw new BadRequestError('A conversation needs at least one other participant');
    }

    const members = await this.prisma.user.findMany({
      where: { id: { in: memberIds }, schoolId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        roles: { select: { role: { select: { type: true } } } },
      },
    });

    if (members.length !== memberIds.length) {
      throw new BadRequestError('One or more participants are not active users of this school');
    }

    // Enforce who may talk to whom.
    for (const member of members) {
      if (member.id === user.id) continue;
      this.assertMayMessage(user, member.roles.map((entry) => entry.role.type));
    }

    const type = memberIds.length === 2 ? ConversationType.DIRECT : ConversationType.GROUP;
    const directKey =
      type === ConversationType.DIRECT
        ? createHash('sha256').update([...memberIds].sort().join(':')).digest('hex')
        : null;

    if (directKey) {
      const existing = await this.prisma.conversation.findFirst({
        where: { schoolId, directKey },
        select: { id: true },
      });
      if (existing) return this.getConversation(schoolId, existing.id, user.id);
    }

    const conversation = await this.prisma.conversation.create({
      data: {
        schoolId,
        type,
        title: dto.title ?? null,
        directKey,
        createdById: user.id,
        members: {
          create: memberIds.map((memberId) => ({
            userId: memberId,
            role: memberId === user.id ? 'OWNER' : 'MEMBER',
          })),
        },
      },
      select: { id: true },
    });

    // Bring every participant's open sockets into the room immediately.
    this.realtime.emitToUsers(memberIds, 'conversation:created', {
      conversationId: conversation.id,
      type,
    });

    return this.getConversation(schoolId, conversation.id, user.id);
  }

  async getConversation(schoolId: string, conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, schoolId, members: { some: { userId, leftAt: null } } },
      select: {
        id: true,
        type: true,
        title: true,
        isLocked: true,
        isArchived: true,
        lastMessageAt: true,
        createdAt: true,
        members: {
          where: { leftAt: null },
          select: {
            userId: true,
            role: true,
            unreadCount: true,
            lastReadAt: true,
            isMuted: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatarUrl: true,
                roles: { select: { role: { select: { type: true } } } },
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError('Conversation');
    }

    return {
      ...conversation,
      members: conversation.members.map((member) => ({
        ...member,
        name: [member.user.firstName, member.user.lastName].filter(Boolean).join(' '),
        roles: member.user.roles.map((entry) => entry.role.type),
        isOnline: this.realtime.isOnline(member.userId),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  async listMessages(
    schoolId: string,
    conversationId: string,
    userId: string,
    query: PaginationQueryDto & { before?: string },
  ) {
    await this.assertMember(schoolId, conversationId, userId);

    const where: Prisma.MessageWhereInput = {
      conversationId,
      deletedAt: null,
      ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        take: query.take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          body: true,
          createdAt: true,
          editedAt: true,
          isFlagged: true,
          replyToId: true,
          sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          attachments: {
            select: { id: true, fileName: true, mimeType: true, sizeBytes: true, url: true },
          },
          receipts: { select: { userId: true, deliveredAt: true, readAt: true } },
          replyTo: {
            select: {
              id: true,
              body: true,
              sender: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      ...buildPaginatedResult(
        // Oldest-first is what a chat UI renders.
        items.reverse().map((message) => ({
          ...message,
          isMine: message.sender.id === userId,
          readBy: message.receipts.filter((receipt) => receipt.readAt).length,
        })),
        total,
        query.page,
        query.limit,
      ),
      hasMore: total > query.take,
    };
  }

  /**
   * Sends a message.
   *
   * `clientRef` de-duplicates a send that the mobile app retried after losing
   * connectivity, so a flaky network cannot produce two copies of one message.
   */
  async sendMessage(
    schoolId: string,
    conversationId: string,
    dto: SendMessageDto,
    user: AuthenticatedUser,
  ) {
    const conversation = await this.assertMember(schoolId, conversationId, user.id);

    if (conversation.isLocked) {
      throw new ForbiddenError('This conversation has been closed to new messages');
    }

    if (dto.clientRef) {
      const existing = await this.prisma.message.findFirst({
        where: { conversationId, clientRef: dto.clientRef },
        select: { id: true, createdAt: true },
      });
      if (existing) {
        this.log.debug('Duplicate message suppressed by clientRef', { messageId: existing.id });
        return { ...existing, duplicate: true };
      }
    }

    const otherMemberIds = conversation.members
      .filter((member) => member.userId !== user.id)
      .map((member) => member.userId);

    const preview =
      dto.type === MessageType.TEXT || !dto.type
        ? (dto.body ?? '').slice(0, 120)
        : `[${(dto.type ?? 'FILE').toLowerCase()}]`;

    const message = await this.prisma.transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderId: user.id,
          type: dto.type ?? MessageType.TEXT,
          body: dto.body ?? null,
          clientRef: dto.clientRef ?? null,
          replyToId: dto.replyToId ?? null,
          // Delivery receipts start empty; the socket layer fills them in.
          receipts: {
            create: otherMemberIds.map((userId) => ({ userId })),
          },
        },
        select: {
          id: true,
          type: true,
          body: true,
          createdAt: true,
          replyToId: true,
          sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt, lastMessagePreview: preview },
      });

      // Unread counts are maintained per member so a badge is a single read.
      await tx.conversationMember.updateMany({
        where: { conversationId, userId: { in: otherMemberIds } },
        data: { unreadCount: { increment: 1 } },
      });

      return created;
    });

    this.realtime.emitToConversation(conversationId, 'message:new', {
      ...message,
      conversationId,
    });

    // Push only reaches members who are not currently connected.
    const offline = otherMemberIds.filter((id) => !this.realtime.isOnline(id));
    const notMuted = conversation.members
      .filter((member) => !member.isMuted && offline.includes(member.userId))
      .map((member) => member.userId);

    if (notMuted.length > 0) {
      void this.notifications
        .dispatch({
          schoolId,
          userIds: notMuted,
          type: NotificationType.MESSAGE,
          title: [user.firstName, user.lastName].filter(Boolean).join(' '),
          body: preview,
          data: { conversationId, messageId: message.id },
          actionUrl: `/messages/${conversationId}`,
          channels: ['PUSH'],
        })
        .catch(() => undefined);
    }

    return message;
  }

  /** Marks everything up to now as read for one member. */
  async markRead(schoolId: string, conversationId: string, userId: string) {
    await this.assertMember(schoolId, conversationId, userId);

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.conversationMember.updateMany({
        where: { conversationId, userId },
        data: { unreadCount: 0, lastReadAt: now },
      }),
      this.prisma.messageReceipt.updateMany({
        where: { userId, readAt: null, message: { conversationId } },
        data: { readAt: now, deliveredAt: now },
      }),
    ]);

    // Let the other participants' clients render read ticks.
    this.realtime.emitToConversation(conversationId, 'message:read', {
      conversationId,
      userId,
      readAt: now.toISOString(),
    });

    return { read: true, readAt: now };
  }

  async deleteMessage(schoolId: string, messageId: string, user: AuthenticatedUser) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversation: { schoolId } },
      select: { id: true, senderId: true, conversationId: true, createdAt: true },
    });
    if (!message) throw new NotFoundError('Message');

    const isModerator =
      user.isSuperAdmin || user.permissions.includes(PERMISSIONS.MESSAGES_MODERATE);

    if (message.senderId !== user.id && !isModerator) {
      throw new ForbiddenError('You can only delete your own messages');
    }

    // Authors get a short window; a moderator is not time-limited.
    const ageMinutes = (Date.now() - message.createdAt.getTime()) / 60_000;
    if (message.senderId === user.id && !isModerator && ageMinutes > 60) {
      throw new BadRequestError('A message can only be deleted within an hour of sending it');
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: null },
    });

    this.realtime.emitToConversation(message.conversationId, 'message:deleted', {
      conversationId: message.conversationId,
      messageId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Moderation
  // -------------------------------------------------------------------------

  async reportMessage(schoolId: string, messageId: string, dto: ReportMessageDto, user: AuthenticatedUser) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversation: { schoolId } },
      select: { id: true, senderId: true, body: true, conversationId: true },
    });
    if (!message) throw new NotFoundError('Message');

    await this.prisma.message.update({
      where: { id: messageId },
      data: { isFlagged: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'chat',
      entity: 'Message',
      entityId: messageId,
      description: `Message reported: ${dto.reason}`,
      newValue: { reportedBy: user.id, reason: dto.reason },
      schoolId,
    });

    this.log.warn('Chat message reported', { messageId, reportedBy: user.id });

    return { reported: true };
  }

  async listFlagged(schoolId: string, query: PaginationQueryDto) {
    const where: Prisma.MessageWhereInput = {
      isFlagged: true,
      deletedAt: null,
      conversation: { schoolId },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          body: true,
          createdAt: true,
          sender: { select: { id: true, firstName: true, lastName: true, email: true } },
          conversation: { select: { id: true, type: true, title: true } },
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  async setConversationLocked(schoolId: string, conversationId: string, locked: boolean) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, schoolId },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundError('Conversation');

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { isLocked: locked },
    });

    this.realtime.emitToConversation(conversationId, 'conversation:locked', {
      conversationId,
      isLocked: locked,
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'chat',
      entity: 'Conversation',
      entityId: conversationId,
      description: `Conversation ${locked ? 'locked' : 'unlocked'}`,
      schoolId,
    });

    return { conversationId, isLocked: locked };
  }

  /** People the signed-in user is allowed to start a conversation with. */
  async contactsFor(schoolId: string, user: AuthenticatedUser, search?: string) {
    const allowedRoles = this.allowedCounterpartRoles(user);

    if (allowedRoles.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: 'ACTIVE',
        id: { not: user.id },
        roles: { some: { role: { type: { in: allowedRoles } } } },
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: 50,
      orderBy: { firstName: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        roles: { select: { role: { select: { type: true, name: true } } } },
        staff: { select: { designation: { select: { name: true } } } },
      },
    });

    return users.map((entry) => ({
      id: entry.id,
      name: [entry.firstName, entry.lastName].filter(Boolean).join(' '),
      avatarUrl: entry.avatarUrl,
      roles: entry.roles.map((link) => link.role.type),
      designation: entry.staff?.designation?.name ?? entry.roles[0]?.role.name ?? null,
      isOnline: this.realtime.isOnline(entry.id),
    }));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async assertMember(schoolId: string, conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, schoolId },
      select: {
        id: true,
        isLocked: true,
        members: { where: { leftAt: null }, select: { userId: true, isMuted: true } },
      },
    });

    if (!conversation) throw new NotFoundError('Conversation');

    if (!conversation.members.some((member) => member.userId === userId)) {
      // Reported as not-found rather than forbidden so conversation ids cannot
      // be probed for existence.
      throw new NotFoundError('Conversation');
    }

    return conversation;
  }

  /**
   * The messaging policy: parents talk to staff, students talk to staff, and
   * staff talk to anyone. Parent-to-parent and student-to-student messaging is
   * deliberately not allowed.
   */
  private allowedCounterpartRoles(user: AuthenticatedUser): RoleType[] {
    const staffRoles: RoleType[] = [
      RoleType.SCHOOL_ADMIN,
      RoleType.PRINCIPAL,
      RoleType.VICE_PRINCIPAL,
      RoleType.TEACHER,
      RoleType.ACCOUNTANT,
      RoleType.LIBRARIAN,
      RoleType.TRANSPORT_MANAGER,
      RoleType.RECEPTIONIST,
      RoleType.HR_MANAGER,
      RoleType.STAFF,
    ];

    if (user.staffId || user.isSuperAdmin) {
      return [...staffRoles, RoleType.PARENT, RoleType.STUDENT];
    }
    if (user.guardianId || user.studentId) return staffRoles;
    return [];
  }

  private assertMayMessage(user: AuthenticatedUser, counterpartRoles: RoleType[]): void {
    const allowed = this.allowedCounterpartRoles(user);
    if (!counterpartRoles.some((role) => allowed.includes(role))) {
      throw new ForbiddenError(
        'You are not permitted to start a conversation with this person',
      );
    }
  }
}
