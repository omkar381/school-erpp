import { Injectable } from '@nestjs/common';
import {
  DeliveryStatus,
  NotificationChannel,
  NotificationType,
  Priority,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { NotFoundError } from '../../common/exceptions/app.exception';
import { EmailService, type SendEmailInput } from './channels/email.service';
import { PushService } from './channels/push.service';
import { SmsService } from './channels/sms.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface DispatchNotificationInput {
  schoolId: string | null;
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: Priority;
  imageUrl?: string;
  actionUrl?: string;
  channels?: NotificationChannel[];
  /** Bypasses per-user opt-out. Reserved for security and payment notices. */
  force?: boolean;
  /** Plain-text body for SMS; falls back to `body` when omitted. */
  smsBody?: string;
  email?: Omit<SendEmailInput, 'to'>;
}

export interface DispatchResult {
  created: number;
  push: { sent: number; failed: number };
  email: { sent: number; failed: number };
  sms: { sent: number; failed: number };
}

const DEFAULT_CHANNELS: NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
];

/**
 * Central fan-out for user-facing notifications.
 *
 * Every notification is persisted first (so the in-app inbox is the source of
 * truth), then delivered over the requested transports. A transport failure is
 * recorded against the delivery row and never fails the caller's operation.
 */
@Injectable()
export class NotificationsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly realtime: RealtimeGateway,
    logger: AppLogger,
  ) {
    this.log = logger.child('NotificationsService');
  }

  async dispatch(input: DispatchNotificationInput): Promise<DispatchResult> {
    const result: DispatchResult = {
      created: 0,
      push: { sent: 0, failed: 0 },
      email: { sent: 0, failed: 0 },
      sms: { sent: 0, failed: 0 },
    };

    const userIds = [...new Set(input.userIds)].filter(Boolean);
    if (userIds.length === 0) return result;

    const channels = input.channels ?? DEFAULT_CHANNELS;
    const eligible = input.force
      ? new Map(userIds.map((id) => [id, new Set(channels)]))
      : await this.filterByPreferences(userIds, input.type, channels);

    const inAppRecipients = userIds.filter((id) =>
      eligible.get(id)?.has(NotificationChannel.IN_APP),
    );

    // 1. Persist the in-app record for everyone who accepts it.
    const notifications = await this.prisma.$transaction(
      inAppRecipients.map((userId) =>
        this.prisma.notification.create({
          data: {
            schoolId: input.schoolId,
            userId,
            type: input.type,
            title: input.title,
            body: input.body,
            data: (input.data ?? {}) as Prisma.InputJsonValue,
            priority: input.priority ?? Priority.NORMAL,
            imageUrl: input.imageUrl ?? null,
            actionUrl: input.actionUrl ?? null,
          },
          select: { id: true, userId: true },
        }),
      ),
    );
    result.created = notifications.length;

    // 2. Live-update any open web session.
    for (const notification of notifications) {
      this.realtime.emitToUser(notification.userId, 'notification:new', {
        id: notification.id,
        type: input.type,
        title: input.title,
        body: input.body,
        priority: input.priority ?? Priority.NORMAL,
        actionUrl: input.actionUrl,
        createdAt: new Date().toISOString(),
      });
    }

    const notificationByUser = new Map(notifications.map((n) => [n.userId, n.id]));

    // 3. Push.
    if (channels.includes(NotificationChannel.PUSH)) {
      const recipients = userIds.filter((id) => eligible.get(id)?.has(NotificationChannel.PUSH));
      if (recipients.length > 0) {
        const pushResult = await this.push.send({
          userIds: recipients,
          title: input.title,
          body: input.body,
          imageUrl: input.imageUrl,
          data: this.stringifyData({
            type: input.type,
            ...(input.actionUrl ? { actionUrl: input.actionUrl } : {}),
            ...(input.data ?? {}),
          }),
        });
        result.push = { sent: pushResult.sent, failed: pushResult.failed };

        await this.recordDeliveries(
          recipients.map((id) => notificationByUser.get(id)).filter((id): id is string => !!id),
          NotificationChannel.PUSH,
          pushResult.failed === 0 ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
        );
      }
    }

    // 4. Email.
    if (channels.includes(NotificationChannel.EMAIL)) {
      const recipients = userIds.filter((id) => eligible.get(id)?.has(NotificationChannel.EMAIL));
      const addresses = await this.resolveEmails(recipients);

      for (const [userId, address] of addresses) {
        const sendResult = await this.email.send({
          to: address,
          subject: input.email?.subject ?? input.title,
          template: input.email?.template ?? 'generic',
          data: input.email?.data ?? { title: input.title, body: input.body },
          html: input.email?.html,
        });

        if (sendResult.success) result.email.sent += 1;
        else result.email.failed += 1;

        const notificationId = notificationByUser.get(userId);
        if (notificationId) {
          await this.recordDeliveries(
            [notificationId],
            NotificationChannel.EMAIL,
            sendResult.success ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
            address,
            sendResult.error,
          );
        }
      }
    }

    // 5. SMS.
    if (channels.includes(NotificationChannel.SMS)) {
      const recipients = userIds.filter((id) => eligible.get(id)?.has(NotificationChannel.SMS));
      const numbers = await this.resolvePhones(recipients);

      for (const [userId, phone] of numbers) {
        const sendResult = await this.sms.send({
          to: phone,
          message: input.smsBody ?? `${input.title}: ${input.body}`,
          purpose: input.type,
        });

        if (sendResult.success) result.sms.sent += 1;
        else result.sms.failed += 1;

        const notificationId = notificationByUser.get(userId);
        if (notificationId) {
          await this.recordDeliveries(
            [notificationId],
            NotificationChannel.SMS,
            sendResult.success ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
            phone,
            sendResult.error,
          );
        }
      }
    }

    this.log.debug('Notification dispatched', {
      type: input.type,
      recipients: userIds.length,
      ...result,
    });

    return result;
  }

  /** Convenience wrapper for a one-off transactional email. */
  async sendEmail(input: SendEmailInput) {
    return this.email.send(input);
  }

  // -------------------------------------------------------------------------
  // Inbox
  // -------------------------------------------------------------------------

  async listForUser(
    userId: string,
    query: PaginationQueryDto & { unreadOnly?: boolean; type?: NotificationType },
  ) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      archivedAt: null,
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null, archivedAt: null } }),
    ]);

    return { ...buildPaginatedResult(items, total, query.page, query.limit), unreadCount };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null, archivedAt: null } });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await this.prisma.notification.count({
        where: { id: notificationId, userId },
      });
      if (exists === 0) throw new NotFoundError('Notification');
    }
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async archive(userId: string, notificationId: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundError('Notification');
  }

  async getPreferences(userId: string) {
    const stored = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const byType = new Map(stored.map((preference) => [preference.type, preference]));

    return Object.values(NotificationType).map((type) => {
      const preference = byType.get(type);
      return {
        type,
        inApp: preference?.inApp ?? true,
        push: preference?.push ?? true,
        email: preference?.email ?? false,
        sms: preference?.sms ?? false,
      };
    });
  }

  async updatePreference(
    userId: string,
    type: NotificationType,
    values: { inApp?: boolean; push?: boolean; email?: boolean; sms?: boolean },
  ) {
    return this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, ...values },
      update: values,
    });
  }

  /** Deletes read notifications older than the retention window. */
  async pruneOld(retentionDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const result = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff }, readAt: { not: null } },
    });
    return result.count;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async filterByPreferences(
    userIds: string[],
    type: NotificationType,
    requested: NotificationChannel[],
  ): Promise<Map<string, Set<NotificationChannel>>> {
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, type },
    });
    const byUser = new Map(preferences.map((preference) => [preference.userId, preference]));

    const result = new Map<string, Set<NotificationChannel>>();

    for (const userId of userIds) {
      const preference = byUser.get(userId);
      const allowed = new Set<NotificationChannel>();

      for (const channel of requested) {
        const enabled =
          channel === NotificationChannel.IN_APP
            ? (preference?.inApp ?? true)
            : channel === NotificationChannel.PUSH
              ? (preference?.push ?? true)
              : channel === NotificationChannel.EMAIL
                ? (preference?.email ?? false)
                : (preference?.sms ?? false);

        if (enabled) allowed.add(channel);
      }

      result.set(userId, allowed);
    }

    return result;
  }

  private async resolveEmails(userIds: string[]): Promise<Array<[string, string]>> {
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, email: { not: null } },
      select: { id: true, email: true },
    });
    return users.map((user) => [user.id, user.email!] as [string, string]);
  }

  private async resolvePhones(userIds: string[]): Promise<Array<[string, string]>> {
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, phone: { not: null } },
      select: { id: true, phone: true },
    });
    return users.map((user) => [user.id, user.phone!] as [string, string]);
  }

  private async recordDeliveries(
    notificationIds: string[],
    channel: NotificationChannel,
    status: DeliveryStatus,
    target?: string,
    error?: string,
  ): Promise<void> {
    if (notificationIds.length === 0) return;

    await this.prisma.notificationDelivery.createMany({
      data: notificationIds.map((notificationId) => ({
        notificationId,
        channel,
        status,
        target: target ?? null,
        error: error ?? null,
        attempts: 1,
        sentAt: status === DeliveryStatus.SENT ? new Date() : null,
      })),
      skipDuplicates: true,
    });
  }

  private stringifyData(data: Record<string, unknown>): Record<string, string> {
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      output[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return output;
  }
}
