import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';

export interface SendPushInput {
  userIds: string[];
  title: string;
  body: string;
  /** Deep-link payload; all values are coerced to strings by FCM. */
  data?: Record<string, string>;
  imageUrl?: string;
  /** Android notification channel; must match one registered by the app. */
  channelId?: string;
  badge?: number;
}

export interface PushResult {
  sent: number;
  failed: number;
  invalidTokensRemoved: number;
}

@Injectable()
export class PushService implements OnModuleInit {
  private app: admin.app.App | null = null;
  private readonly log: AppLogger;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    logger: AppLogger,
  ) {
    this.log = logger.child('PushService');
  }

  onModuleInit(): void {
    if (!this.config.get<boolean>('push.enabled')) {
      this.log.warn('Push notifications are disabled; messages will be logged instead of sent');
      return;
    }

    const projectId = this.config.get<string>('push.projectId');
    const clientEmail = this.config.get<string>('push.clientEmail');
    const privateKey = this.config.get<string>('push.privateKey');

    if (!projectId || !clientEmail || !privateKey) {
      this.log.error('FCM is enabled but the service account configuration is incomplete');
      return;
    }

    try {
      this.app =
        admin.apps.find((existing) => existing?.name === 'school-erp') ??
        admin.initializeApp(
          { credential: admin.credential.cert({ projectId, clientEmail, privateKey }) },
          'school-erp',
        );
      this.log.info('Firebase Admin initialised', { projectId });
    } catch (error) {
      this.log.error('Failed to initialise Firebase Admin', error);
    }
  }

  async send(input: SendPushInput): Promise<PushResult> {
    if (input.userIds.length === 0) {
      return { sent: 0, failed: 0, invalidTokensRemoved: 0 };
    }

    const devices = await this.prisma.device.findMany({
      where: {
        userId: { in: input.userIds },
        fcmToken: { not: null },
        pushEnabled: true,
      },
      select: { id: true, fcmToken: true },
    });

    const tokens = devices.map((device) => device.fcmToken!).filter(Boolean);

    if (tokens.length === 0) {
      this.log.debug('No push-capable devices for recipients', { userCount: input.userIds.length });
      return { sent: 0, failed: 0, invalidTokensRemoved: 0 };
    }

    if (!this.app) {
      this.log.info('Push (delivery disabled)', {
        title: input.title,
        recipients: input.userIds.length,
        devices: tokens.length,
      });
      return { sent: tokens.length, failed: 0, invalidTokensRemoved: 0 };
    }

    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];

    // FCM caps a multicast at 500 tokens per request.
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);

      try {
        const response = await admin.messaging(this.app).sendEachForMulticast({
          tokens: batch,
          notification: {
            title: input.title,
            body: input.body,
            ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
          },
          data: input.data ?? {},
          android: {
            priority: 'high',
            notification: {
              channelId: input.channelId ?? 'default',
              sound: 'default',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                ...(input.badge !== undefined ? { badge: input.badge } : {}),
              },
            },
          },
        });

        sent += response.successCount;
        failed += response.failureCount;

        response.responses.forEach((result, index) => {
          if (result.success) return;
          const code = result.error?.code;
          // These codes mean the token will never work again, so prune it.
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(batch[index]);
          }
        });
      } catch (error) {
        this.log.error('FCM multicast failed', error, { batchSize: batch.length });
        failed += batch.length;
      }
    }

    if (invalidTokens.length > 0) {
      await this.prisma.device.deleteMany({ where: { fcmToken: { in: invalidTokens } } });
      this.log.debug('Pruned unreachable push tokens', { count: invalidTokens.length });
    }

    return { sent, failed, invalidTokensRemoved: invalidTokens.length };
  }

  async sendToTopic(topic: string, title: string, body: string, data?: Record<string, string>) {
    if (!this.app) {
      this.log.info('Topic push (delivery disabled)', { topic, title });
      return { success: true };
    }

    try {
      await admin.messaging(this.app).send({
        topic,
        notification: { title, body },
        data: data ?? {},
      });
      return { success: true };
    } catch (error) {
      this.log.error('Topic push failed', error, { topic });
      return { success: false };
    }
  }
}
