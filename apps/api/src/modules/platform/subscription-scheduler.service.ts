import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditAction, Priority, SchoolStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from './subscriptions.service';
import { daysUntil } from './usage.service';

/** Reminders go out at these distances from the end date, once each. */
const REMINDER_DAYS = [30, 14, 7, 3, 1];

/**
 * Keeps subscription state true to the calendar.
 *
 * Nothing here changes what a school is owed — it only reflects dates that
 * have already passed, so running it twice is harmless and skipping a day only
 * delays the transition.
 */
@Injectable()
export class SubscriptionSchedulerService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: AuditService,
    private readonly tenantGuard: TenantGuard,
    logger: AppLogger,
  ) {
    this.log = logger.child('SubscriptionScheduler');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'subscriptions:expire' })
  async expireLapsedSubscriptions(): Promise<{ expired: number }> {
    const now = new Date();

    const lapsed = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        endDate: { lt: now },
        school: { deletedAt: null },
      },
      select: {
        id: true,
        schoolId: true,
        status: true,
        endDate: true,
        school: { select: { name: true, status: true } },
        plan: { select: { name: true } },
      },
    });

    for (const subscription of lapsed) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.EXPIRED },
      });

      // Suspension is an operator decision; expiry only moves a school that is
      // otherwise running normally into the expired state.
      if (
        subscription.school.status === SchoolStatus.ACTIVE ||
        subscription.school.status === SchoolStatus.TRIAL
      ) {
        await this.prisma.school.update({
          where: { id: subscription.schoolId },
          data: { status: SchoolStatus.EXPIRED },
        });
        this.tenantGuard.invalidate(subscription.schoolId);
      }

      this.audit.record({
        action: AuditAction.UPDATE,
        module: 'platform',
        entity: 'Subscription',
        entityId: subscription.id,
        description: `Subscription for "${subscription.school.name}" expired on ${subscription.endDate.toISOString().slice(0, 10)}`,
        oldValue: { status: subscription.status },
        newValue: { status: SubscriptionStatus.EXPIRED },
        schoolId: subscription.schoolId,
        userId: null,
      });

      await this.subscriptions.notifySchoolAdmins(
        subscription.schoolId,
        'Your subscription has expired',
        `The ${subscription.plan.name} plan ended on ${subscription.endDate.toISOString().slice(0, 10)}. Renew to restore full access.`,
        Priority.URGENT,
      );
    }

    if (lapsed.length > 0) {
      this.log.warn('Expired lapsed subscriptions', { count: lapsed.length });
    }
    return { expired: lapsed.length };
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'subscriptions:expiry-reminders' })
  async sendExpiryReminders(): Promise<{ notified: number }> {
    const now = new Date();
    const horizon = new Date(now.getTime() + (REMINDER_DAYS[0] + 1) * 86_400_000);

    const upcoming = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        endDate: { gte: now, lte: horizon },
        school: { deletedAt: null },
      },
      select: {
        id: true,
        schoolId: true,
        status: true,
        endDate: true,
        autoRenew: true,
        plan: { select: { name: true } },
      },
    });

    let notified = 0;

    for (const subscription of upcoming) {
      const remaining = daysUntil(subscription.endDate);
      if (!REMINDER_DAYS.includes(remaining)) continue;

      const trial = subscription.status === SubscriptionStatus.TRIALING;
      await this.subscriptions.notifySchoolAdmins(
        subscription.schoolId,
        trial ? `Your trial ends in ${remaining} day${remaining === 1 ? '' : 's'}` : `Subscription renewal due in ${remaining} day${remaining === 1 ? '' : 's'}`,
        trial
          ? `The ${subscription.plan.name} trial ends on ${subscription.endDate.toISOString().slice(0, 10)}. Choose a plan to keep your data accessible.`
          : subscription.autoRenew
            ? `The ${subscription.plan.name} plan renews automatically on ${subscription.endDate.toISOString().slice(0, 10)}.`
            : `The ${subscription.plan.name} plan ends on ${subscription.endDate.toISOString().slice(0, 10)} and will not renew automatically.`,
        remaining <= 3 ? Priority.URGENT : Priority.IMPORTANT,
      );
      notified += 1;
    }

    if (notified > 0) this.log.info('Sent subscription expiry reminders', { notified });
    return { notified };
  }
}
