import { Injectable } from '@nestjs/common';
import {
  EmploymentStatus,
  NotificationType,
  Priority,
  StudentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { ForbiddenError, NotFoundError } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Students who count against the plan. A pupil who has left — transferred,
 * graduated or dropped out — is history, not a seat the school is using.
 */
export const BILLABLE_STUDENT_STATUSES: StudentStatus[] = [
  StudentStatus.ACTIVE,
  StudentStatus.INACTIVE,
  StudentStatus.SUSPENDED,
];

export type LimitKey = 'students' | 'staff' | 'storage';

export interface LimitUsage {
  used: number;
  limit: number;
  /** 0–100, capped. `null` when the resource is unlimited. */
  percent: number;
  remaining: number;
  exceeded: boolean;
  /** True from 90% onwards, the point at which the UI starts warning. */
  warning: boolean;
}

export interface SchoolUsage {
  schoolId: string;
  students: LimitUsage;
  staff: LimitUsage;
  /** Storage figures are in megabytes. */
  storage: LimitUsage;
  users: number;
  documents: number;
  plan: {
    id: string;
    code: string;
    name: string;
    tier: string;
  } | null;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    startDate: Date;
    endDate: Date;
    daysRemaining: number;
    isTrial: boolean;
    autoRenew: boolean;
  } | null;
  limits: { maxStudents: number; maxStaff: number; storageMb: number };
  /** Which limits came from a per-school override rather than the plan. */
  overridden: LimitKey[];
  measuredAt: Date;
}

interface ResolvedLimits {
  maxStudents: number;
  maxStaff: number;
  storageMb: number;
  overridden: LimitKey[];
}

/** Fallback when a school has no subscription at all — small, but not zero. */
const UNSUBSCRIBED_LIMITS: ResolvedLimits = {
  maxStudents: 50,
  maxStaff: 10,
  storageMb: 512,
  overridden: [],
};

const WARNING_THRESHOLD = 0.9;
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  usage: SchoolUsage;
  expiresAt: number;
}

/**
 * Measures what a school is actually consuming and decides whether it may
 * consume more.
 *
 * Counting is deliberately done against the live tables rather than a running
 * counter: a counter drifts the first time a row is deleted outside the app,
 * and a wrong limit either blocks a paying customer or silently gives work
 * away. The short cache keeps the repeated reads off the hot path.
 */
@Injectable()
export class UsageService {
  private readonly log: AppLogger;
  private readonly cache = new Map<string, CacheEntry>();
  /** Schools already warned this process, so one notice is not sent per row. */
  private readonly warned = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    logger: AppLogger,
  ) {
    this.log = logger.child('UsageService');
  }

  // -------------------------------------------------------------------------
  // Measurement
  // -------------------------------------------------------------------------

  async forSchool(schoolId: string, options: { fresh?: boolean } = {}): Promise<SchoolUsage> {
    if (!options.fresh) {
      const cached = this.cache.get(schoolId);
      if (cached && cached.expiresAt > Date.now()) return cached.usage;
    }

    const school = await this.prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!school) throw new NotFoundError('School');

    const subscription = await this.currentSubscription(schoolId);
    const limits = this.resolveLimits(subscription);

    const [students, staff, users, documents, documentBytes, attachmentBytes] = await Promise.all([
      this.prisma.student.count({
        where: { schoolId, deletedAt: null, status: { in: BILLABLE_STUDENT_STATUSES } },
      }),
      this.prisma.staff.count({
        where: {
          schoolId,
          deletedAt: null,
          employmentStatus: { notIn: [EmploymentStatus.RESIGNED, EmploymentStatus.TERMINATED] },
        },
      }),
      this.prisma.user.count({ where: { schoolId, deletedAt: null } }),
      this.prisma.document.count({ where: { schoolId, deletedAt: null } }),
      this.prisma.document.aggregate({
        where: { schoolId, deletedAt: null },
        _sum: { sizeBytes: true },
      }),
      this.prisma.attachment.aggregate({
        where: { schoolId },
        _sum: { sizeBytes: true },
      }),
    ]);

    const storageMbUsed =
      (Number(documentBytes._sum.sizeBytes ?? 0) + Number(attachmentBytes._sum.sizeBytes ?? 0)) /
      (1024 * 1024);

    const usage: SchoolUsage = {
      schoolId,
      students: this.measure(students, limits.maxStudents),
      staff: this.measure(staff, limits.maxStaff),
      storage: this.measure(Math.round(storageMbUsed * 100) / 100, limits.storageMb),
      users,
      documents,
      plan: subscription
        ? {
            id: subscription.plan.id,
            code: subscription.plan.code,
            name: subscription.plan.name,
            tier: subscription.plan.tier,
          }
        : null,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            daysRemaining: daysUntil(subscription.endDate),
            isTrial: subscription.status === SubscriptionStatus.TRIALING,
            autoRenew: subscription.autoRenew,
          }
        : null,
      limits: {
        maxStudents: limits.maxStudents,
        maxStaff: limits.maxStaff,
        storageMb: limits.storageMb,
      },
      overridden: limits.overridden,
      measuredAt: new Date(),
    };

    this.cache.set(schoolId, { usage, expiresAt: Date.now() + CACHE_TTL_MS });
    return usage;
  }

  /** Usage for many schools at once, for the platform school list. */
  async forSchools(schoolIds: string[]): Promise<Map<string, { students: number; staff: number }>> {
    if (schoolIds.length === 0) return new Map();

    const [students, staff] = await Promise.all([
      this.prisma.student.groupBy({
        by: ['schoolId'],
        where: {
          schoolId: { in: schoolIds },
          deletedAt: null,
          status: { in: BILLABLE_STUDENT_STATUSES },
        },
        _count: { _all: true },
      }),
      this.prisma.staff.groupBy({
        by: ['schoolId'],
        where: {
          schoolId: { in: schoolIds },
          deletedAt: null,
          employmentStatus: { notIn: [EmploymentStatus.RESIGNED, EmploymentStatus.TERMINATED] },
        },
        _count: { _all: true },
      }),
    ]);

    const result = new Map<string, { students: number; staff: number }>();
    for (const id of schoolIds) result.set(id, { students: 0, staff: 0 });
    for (const row of students) {
      const entry = result.get(row.schoolId);
      if (entry) entry.students = row._count._all;
    }
    for (const row of staff) {
      const entry = result.get(row.schoolId);
      if (entry) entry.staff = row._count._all;
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Enforcement
  // -------------------------------------------------------------------------

  /**
   * Refuses the request when adding `count` more of `resource` would take the
   * school past its plan. The message names the plan and the numbers, because
   * "limit reached" on its own gives an administrator nothing to act on.
   */
  async assertWithinLimit(
    schoolId: string | null,
    resource: LimitKey,
    count = 1,
  ): Promise<LimitUsage> {
    if (!schoolId) {
      return { used: 0, limit: Number.MAX_SAFE_INTEGER, percent: 0, remaining: Number.MAX_SAFE_INTEGER, exceeded: false, warning: false };
    }

    const usage = await this.forSchool(schoolId, { fresh: true });
    const current = usage[resource];

    if (current.used + count > current.limit) {
      void this.notifyLimitReached(schoolId, resource, current);
      throw new ForbiddenError(
        this.limitMessage(resource, current, usage.plan?.name ?? null),
        ErrorCode.SUBSCRIPTION_LIMIT_REACHED,
        {
          resource,
          used: current.used,
          limit: current.limit,
          requested: count,
          plan: usage.plan?.name ?? null,
        },
      );
    }

    // Crossing into the warning band is worth telling the school about once,
    // while they still have room to act.
    if ((current.used + count) / current.limit >= WARNING_THRESHOLD) {
      void this.notifyLimitReached(schoolId, resource, current);
    }

    return current;
  }

  /** Non-throwing variant, for showing a banner before the user starts typing. */
  async check(schoolId: string, resource: LimitKey): Promise<LimitUsage> {
    const usage = await this.forSchool(schoolId);
    return usage[resource];
  }

  invalidate(schoolId: string): void {
    this.cache.delete(schoolId);
  }

  private limitMessage(resource: LimitKey, usage: LimitUsage, planName: string | null): string {
    const plan = planName ? `the ${planName} plan` : 'the current subscription';
    switch (resource) {
      case 'students':
        return `This school has reached its student limit — ${usage.used} of ${usage.limit} allowed by ${plan}. Upgrade the subscription or archive inactive students to add more.`;
      case 'staff':
        return `This school has reached its staff limit — ${usage.used} of ${usage.limit} allowed by ${plan}. Upgrade the subscription to add more staff.`;
      case 'storage':
        return `This school has used ${usage.used} MB of the ${usage.limit} MB allowed by ${plan}. Remove unused files or upgrade the subscription.`;
    }
  }

  /**
   * Tells the school's administrators once per day per resource. Sending on
   * every blocked attempt would turn a limit into a notification flood.
   */
  private async notifyLimitReached(
    schoolId: string,
    resource: LimitKey,
    usage: LimitUsage,
  ): Promise<void> {
    const key = `${schoolId}:${resource}`;
    const last = this.warned.get(key) ?? 0;
    if (Date.now() - last < 86_400_000) return;
    this.warned.set(key, Date.now());

    try {
      const admins = await this.prisma.user.findMany({
        where: {
          schoolId,
          deletedAt: null,
          roles: { some: { role: { type: { in: ['SCHOOL_ADMIN', 'PRINCIPAL'] } } } },
        },
        select: { id: true },
        take: 20,
      });
      if (admins.length === 0) return;

      const label = { students: 'Student', staff: 'Staff', storage: 'Storage' }[resource];

      await this.notifications.dispatch({
        schoolId,
        userIds: admins.map((admin) => admin.id),
        type: NotificationType.SYSTEM,
        title: `${label} limit reached`,
        body: `Your school is using ${usage.used} of ${usage.limit} ${resource === 'storage' ? 'MB' : resource}. Upgrade your plan to continue growing.`,
        priority: Priority.IMPORTANT,
        actionUrl: '/settings/subscription',
        data: { resource, used: usage.used, limit: usage.limit },
      });
    } catch (error) {
      this.log.error('Failed to send usage limit notification', error, { schoolId, resource });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async currentSubscription(schoolId: string) {
    // Prefer a live subscription; fall back to the most recent one so an
    // expired school still reports the limits it used to have.
    const live = await this.prisma.subscription.findFirst({
      where: {
        schoolId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        endDate: { gte: new Date() },
      },
      orderBy: { endDate: 'desc' },
      include: { plan: true },
    });
    if (live) return live;

    return this.prisma.subscription.findFirst({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
  }

  private resolveLimits(
    subscription: { limitOverrides: unknown; plan: { maxStudents: number; maxStaff: number; storageMb: number } } | null,
  ): ResolvedLimits {
    if (!subscription) return UNSUBSCRIBED_LIMITS;

    const overrides = (subscription.limitOverrides as Record<string, unknown> | null) ?? {};
    const overridden: LimitKey[] = [];

    const pick = (key: 'maxStudents' | 'maxStaff' | 'storageMb', tracked: LimitKey): number => {
      const raw = overrides[key];
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(value) && value > 0) {
        overridden.push(tracked);
        return Math.floor(value);
      }
      return subscription.plan[key];
    };

    return {
      maxStudents: pick('maxStudents', 'students'),
      maxStaff: pick('maxStaff', 'staff'),
      storageMb: pick('storageMb', 'storage'),
      overridden,
    };
  }

  private measure(used: number, limit: number): LimitUsage {
    const safeLimit = limit > 0 ? limit : 1;
    const percent = Math.min(100, Math.round((used / safeLimit) * 1000) / 10);
    return {
      used,
      limit,
      percent,
      remaining: Math.max(0, limit - used),
      exceeded: used >= limit,
      warning: used / safeLimit >= WARNING_THRESHOLD,
    };
  }
}

export function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}
