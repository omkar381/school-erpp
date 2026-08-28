import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  NotificationType,
  Prisma,
  Priority,
  SchoolStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import { BadRequestError, NotFoundError } from '../../common/exceptions/app.exception';
import {
  ALL_MODULES,
  CORE_MODULES,
  PLAN_MODULES,
  type ModuleKey,
} from '../../common/constants/modules';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ModuleGuard } from '../../common/guards/module.guard';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsageService, daysUntil } from './usage.service';
import type {
  CancelSubscriptionDto,
  ChangePlanDto,
  CreateSubscriptionDto,
  RenewSubscriptionDto,
  SetLimitsDto,
  SubscriptionQueryDto,
  UpdateSubscriptionDto,
} from './dto/platform.dto';

const SUBSCRIPTION_SORT_FIELDS = ['startDate', 'endDate', 'status', 'amount', 'createdAt'] as const;

const LIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
];

/**
 * One subscription row per school-plan period.
 *
 * Changing a plan updates the school's live subscription rather than opening a
 * second one — two overlapping live subscriptions would make "which limits
 * apply" ambiguous, and every limit check would have to guess.
 */
@Injectable()
export class SubscriptionsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly usage: UsageService,
    private readonly tenantGuard: TenantGuard,
    private readonly moduleGuard: ModuleGuard,
    logger: AppLogger,
  ) {
    this.log = logger.child('SubscriptionsService');
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async findAll(query: SubscriptionQueryDto) {
    const where: Prisma.SubscriptionWhereInput = {
      school: { deletedAt: null },
      ...(query.status ? { status: query.status } : {}),
      ...(query.planId ? { planId: query.planId } : {}),
      ...(query.schoolId ? { schoolId: query.schoolId } : {}),
      ...(query.expiringWithinDays
        ? {
            status: query.status ?? { in: LIVE_STATUSES },
            endDate: {
              gte: new Date(),
              lte: new Date(Date.now() + query.expiringWithinDays * 86_400_000),
            },
          }
        : {}),
      ...(query.search
        ? {
            school: {
              deletedAt: null,
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { code: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(SUBSCRIPTION_SORT_FIELDS, 'endDate'),
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          cancelledAt: true,
          autoRenew: true,
          billingCycle: true,
          amount: true,
          currency: true,
          limitOverrides: true,
          notes: true,
          createdAt: true,
          school: {
            select: { id: true, name: true, code: true, status: true, logoUrl: true, city: true },
          },
          plan: { select: { id: true, code: true, name: true, tier: true } },
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map((item) => ({ ...item, daysRemaining: daysUntil(item.endDate) })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        plan: true,
        school: {
          select: { id: true, name: true, code: true, status: true, email: true, phone: true },
        },
      },
    });
    if (!subscription) throw new NotFoundError('Subscription');

    const usage = await this.usage.forSchool(subscription.schoolId);

    return {
      ...subscription,
      daysRemaining: daysUntil(subscription.endDate),
      usage: { students: usage.students, staff: usage.staff, storage: usage.storage },
    };
  }

  /** The live subscription for one school, or the most recent expired one. */
  async forSchool(schoolId: string) {
    const subscription =
      (await this.prisma.subscription.findFirst({
        where: { schoolId, status: { in: LIVE_STATUSES }, endDate: { gte: new Date() } },
        orderBy: { endDate: 'desc' },
        include: { plan: true },
      })) ??
      (await this.prisma.subscription.findFirst({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      }));

    return subscription;
  }

  async history(schoolId: string) {
    return this.prisma.subscription.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        cancelledAt: true,
        amount: true,
        currency: true,
        billingCycle: true,
        autoRenew: true,
        notes: true,
        createdAt: true,
        plan: { select: { id: true, code: true, name: true, tier: true } },
      },
    });
  }

  /** What the signed-in school admin sees on their own subscription screen. */
  async currentForSchool(schoolId: string) {
    const [usage, subscription, school] = await Promise.all([
      this.usage.forSchool(schoolId, { fresh: true }),
      this.forSchool(schoolId),
      this.prisma.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { id: true, name: true, status: true, enabledModules: true },
      }),
    ]);

    const planModules = subscription
      ? this.planModuleList(subscription.plan.modules, subscription.plan.tier)
      : [...CORE_MODULES];
    const enabled = (school.enabledModules as Record<string, boolean>) ?? {};

    return {
      school: { id: school.id, name: school.name, status: school.status },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            cancelledAt: subscription.cancelledAt,
            billingCycle: subscription.billingCycle,
            autoRenew: subscription.autoRenew,
            amount: subscription.amount,
            currency: subscription.currency,
            daysRemaining: daysUntil(subscription.endDate),
            isTrial: subscription.status === SubscriptionStatus.TRIALING,
            trialDays: subscription.plan.trialDays,
          }
        : null,
      plan: subscription
        ? {
            id: subscription.plan.id,
            code: subscription.plan.code,
            name: subscription.plan.name,
            tier: subscription.plan.tier,
            description: subscription.plan.description,
            priceMonthly: subscription.plan.priceMonthly,
            priceYearly: subscription.plan.priceYearly,
            currency: subscription.plan.currency,
          }
        : null,
      usage: {
        students: usage.students,
        staff: usage.staff,
        storage: usage.storage,
        users: usage.users,
        documents: usage.documents,
      },
      limits: usage.limits,
      modules: ALL_MODULES.map((key) => ({
        key,
        inPlan: planModules.includes(key),
        enabled: CORE_MODULES.includes(key) ? true : enabled[key] === true,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  async create(dto: CreateSubscriptionDto) {
    const [school, plan] = await Promise.all([
      this.prisma.school.findFirst({
        where: { id: dto.schoolId, deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } }),
    ]);
    if (!school) throw new NotFoundError('School');
    if (!plan) throw new NotFoundError('Subscription plan');

    const status = dto.status ?? SubscriptionStatus.ACTIVE;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const billingCycle = dto.billingCycle ?? 'YEARLY';
    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : status === SubscriptionStatus.TRIALING
        ? addDays(startDate, plan.trialDays)
        : addCycle(startDate, billingCycle);

    if (endDate <= startDate) {
      throw new BadRequestError('The end date must be after the start date');
    }

    // A school has one live subscription at a time; supersede any other.
    const superseded = await this.prisma.subscription.updateMany({
      where: { schoolId: dto.schoolId, status: { in: LIVE_STATUSES } },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date(), autoRenew: false },
    });

    const subscription = await this.prisma.subscription.create({
      data: {
        schoolId: dto.schoolId,
        planId: dto.planId,
        status,
        startDate,
        endDate,
        billingCycle,
        amount: dto.amount ?? (billingCycle === 'MONTHLY' ? plan.priceMonthly : plan.priceYearly),
        currency: plan.currency,
        autoRenew: dto.autoRenew ?? true,
        limitOverrides: (dto.limitOverrides ?? {}) as Prisma.InputJsonValue,
        notes: dto.notes ?? null,
      },
      include: { plan: { select: { id: true, name: true, tier: true, modules: true } } },
    });

    if (dto.syncModules !== false) {
      await this.applyPlanModules(dto.schoolId, plan.modules, plan.tier);
    }

    await this.alignSchoolStatus(dto.schoolId, status);

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'platform',
      entity: 'Subscription',
      entityId: subscription.id,
      description: `Subscribed "${school.name}" to ${plan.name} (${status})`,
      newValue: {
        plan: plan.code,
        status,
        startDate,
        endDate,
        supersededPrevious: superseded.count > 0,
      },
      schoolId: dto.schoolId,
    });

    this.usage.invalidate(dto.schoolId);
    await this.notifySchoolAdmins(
      dto.schoolId,
      'Subscription updated',
      `Your school is now on the ${plan.name} plan until ${formatDate(endDate)}.`,
      Priority.NORMAL,
    );

    return subscription;
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      include: { school: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundError('Subscription');

    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    if (endDate <= startDate) {
      throw new BadRequestError('The end date must be after the start date');
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.startDate !== undefined ? { startDate } : {}),
        ...(dto.endDate !== undefined ? { endDate } : {}),
        ...(dto.billingCycle !== undefined ? { billingCycle: dto.billingCycle } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.autoRenew !== undefined ? { autoRenew: dto.autoRenew } : {}),
        ...(dto.limitOverrides !== undefined
          ? { limitOverrides: dto.limitOverrides as Prisma.InputJsonValue }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.status === SubscriptionStatus.CANCELLED && !existing.cancelledAt
          ? { cancelledAt: new Date() }
          : {}),
      },
      include: { plan: { select: { id: true, name: true, tier: true } } },
    });

    if (dto.status && dto.status !== existing.status) {
      await this.alignSchoolStatus(existing.schoolId, dto.status);
    }

    const { oldValue, newValue } = this.audit.diff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'platform',
      entity: 'Subscription',
      entityId: id,
      description: `Updated subscription for "${existing.school.name}"`,
      oldValue,
      newValue,
      schoolId: existing.schoolId,
    });

    this.usage.invalidate(existing.schoolId);
    return updated;
  }

  async changePlan(id: string, dto: ChangePlanDto) {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      include: { plan: true, school: { select: { id: true, name: true } } },
    });
    if (!existing) throw new NotFoundError('Subscription');
    if (existing.planId === dto.planId) {
      throw new BadRequestError('This subscription is already on that plan');
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundError('Subscription plan');

    // Downgrading below what the school already uses would leave it instantly
    // over its limit, so the operator has to resolve that first.
    const usage = await this.usage.forSchool(existing.schoolId, { fresh: true });
    const breaches: string[] = [];
    if (usage.students.used > plan.maxStudents) {
      breaches.push(`${usage.students.used} students exceeds the plan's ${plan.maxStudents}`);
    }
    if (usage.staff.used > plan.maxStaff) {
      breaches.push(`${usage.staff.used} staff exceeds the plan's ${plan.maxStaff}`);
    }
    if (breaches.length > 0) {
      throw new BadRequestError(
        `"${existing.school.name}" cannot move to ${plan.name}: ${breaches.join('; ')}. Raise the plan limits with an override, or reduce usage first.`,
      );
    }

    const endDate = dto.renew
      ? addCycle(new Date(), existing.billingCycle === 'MONTHLY' ? 'MONTHLY' : 'YEARLY')
      : existing.endDate;

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        planId: plan.id,
        endDate,
        amount: existing.billingCycle === 'MONTHLY' ? plan.priceMonthly : plan.priceYearly,
        currency: plan.currency,
        ...(existing.status === SubscriptionStatus.EXPIRED
          ? { status: SubscriptionStatus.ACTIVE }
          : {}),
      },
      include: { plan: { select: { id: true, name: true, tier: true } } },
    });

    if (dto.syncModules !== false) {
      await this.applyPlanModules(existing.schoolId, plan.modules, plan.tier);
    }

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'platform',
      entity: 'Subscription',
      entityId: id,
      description: `Changed plan for "${existing.school.name}" from ${existing.plan.name} to ${plan.name}${dto.reason ? `: ${dto.reason}` : ''}`,
      oldValue: { planId: existing.planId, plan: existing.plan.code },
      newValue: { planId: plan.id, plan: plan.code, endDate },
      schoolId: existing.schoolId,
    });

    this.usage.invalidate(existing.schoolId);
    await this.notifySchoolAdmins(
      existing.schoolId,
      'Your plan has changed',
      `Your school has moved from ${existing.plan.name} to ${plan.name}.`,
      Priority.IMPORTANT,
    );

    this.log.info('Subscription plan changed', {
      schoolId: existing.schoolId,
      from: existing.plan.code,
      to: plan.code,
    });

    return updated;
  }

  async renew(id: string, dto: RenewSubscriptionDto) {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      include: { plan: true, school: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundError('Subscription');

    const cycle = dto.billingCycle ?? (existing.billingCycle === 'MONTHLY' ? 'MONTHLY' : 'YEARLY');
    // Renewing early extends the paid period rather than shortening it.
    const from = existing.endDate > new Date() ? existing.endDate : new Date();
    const endDate = dto.endDate ? new Date(dto.endDate) : addCycle(from, cycle);

    if (endDate <= new Date()) {
      throw new BadRequestError('The new end date must be in the future');
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        endDate,
        billingCycle: cycle,
        cancelledAt: null,
        amount:
          dto.amount ?? (cycle === 'MONTHLY' ? existing.plan.priceMonthly : existing.plan.priceYearly),
      },
      include: { plan: { select: { id: true, name: true, tier: true } } },
    });

    await this.alignSchoolStatus(existing.schoolId, SubscriptionStatus.ACTIVE);

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'platform',
      entity: 'Subscription',
      entityId: id,
      description: `Renewed subscription for "${existing.school.name}" until ${formatDate(endDate)}`,
      oldValue: { endDate: existing.endDate, status: existing.status },
      newValue: { endDate, status: SubscriptionStatus.ACTIVE },
      schoolId: existing.schoolId,
    });

    this.usage.invalidate(existing.schoolId);
    await this.notifySchoolAdmins(
      existing.schoolId,
      'Subscription renewed',
      `Your ${existing.plan.name} plan now runs until ${formatDate(endDate)}.`,
      Priority.NORMAL,
    );

    return updated;
  }

  async cancel(id: string, dto: CancelSubscriptionDto) {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      include: { school: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundError('Subscription');
    if (existing.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestError('This subscription has already been cancelled');
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: new Date(),
        autoRenew: false,
        // A non-immediate cancellation still honours the paid period.
        ...(dto.immediate ? { endDate: new Date() } : {}),
        notes: dto.reason ?? existing.notes,
      },
      select: { id: true, status: true, endDate: true, cancelledAt: true },
    });

    if (dto.immediate) {
      await this.alignSchoolStatus(existing.schoolId, SubscriptionStatus.CANCELLED);
    }

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'platform',
      entity: 'Subscription',
      entityId: id,
      description: `Cancelled subscription for "${existing.school.name}"${dto.reason ? `: ${dto.reason}` : ''}`,
      oldValue: { status: existing.status, endDate: existing.endDate },
      newValue: { status: SubscriptionStatus.CANCELLED, endDate: updated.endDate },
      schoolId: existing.schoolId,
    });

    this.usage.invalidate(existing.schoolId);
    return updated;
  }

  /** Per-school limit overrides on top of the plan's numbers. */
  async setLimits(id: string, dto: SetLimitsDto) {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      include: { school: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundError('Subscription');

    const current = (existing.limitOverrides as Record<string, unknown>) ?? {};
    const next: Record<string, unknown> = dto.reset ? {} : { ...current };

    if (!dto.reset) {
      if (dto.maxStudents !== undefined) next.maxStudents = dto.maxStudents;
      if (dto.maxStaff !== undefined) next.maxStaff = dto.maxStaff;
      if (dto.storageMb !== undefined) next.storageMb = dto.storageMb;
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { limitOverrides: next as Prisma.InputJsonValue },
      select: { id: true, limitOverrides: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'platform',
      entity: 'Subscription',
      entityId: id,
      description: dto.reset
        ? `Cleared limit overrides for "${existing.school.name}"`
        : `Changed limit overrides for "${existing.school.name}"`,
      oldValue: current,
      newValue: next,
      schoolId: existing.schoolId,
    });

    this.usage.invalidate(existing.schoolId);
    return { ...updated, usage: await this.usage.forSchool(existing.schoolId, { fresh: true }) };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Turns a plan's module list into the school's on/off map.
   *
   * Anything the plan no longer covers is switched off, so a downgrade
   * genuinely removes access rather than leaving a paid-for module running.
   */
  private async applyPlanModules(schoolId: string, modules: string[], tier: string): Promise<void> {
    const allowed = new Set(this.planModuleList(modules, tier));
    const next: Record<string, boolean> = {};
    for (const key of ALL_MODULES) {
      next[key] = CORE_MODULES.includes(key) || allowed.has(key);
    }

    await this.prisma.school.update({
      where: { id: schoolId },
      data: { enabledModules: next as Prisma.InputJsonValue },
    });

    this.moduleGuard.invalidate(schoolId);
    this.tenantGuard.invalidate(schoolId);
  }

  private planModuleList(modules: string[], tier: string): ModuleKey[] {
    const base = modules.length
      ? (modules as ModuleKey[])
      : ((PLAN_MODULES[tier as keyof typeof PLAN_MODULES] as ModuleKey[]) ?? CORE_MODULES);
    return [...new Set([...CORE_MODULES, ...base])];
  }

  /**
   * Keeps the school's own status honest about its subscription. A suspended
   * or archived school is left alone — that is an operator decision that a
   * billing event must not silently undo.
   */
  private async alignSchoolStatus(
    schoolId: string,
    subscriptionStatus: SubscriptionStatus,
  ): Promise<void> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { status: true },
    });
    if (!school) return;
    if (school.status === SchoolStatus.SUSPENDED || school.status === SchoolStatus.ARCHIVED) return;

    const target =
      subscriptionStatus === SubscriptionStatus.TRIALING
        ? SchoolStatus.TRIAL
        : subscriptionStatus === SubscriptionStatus.ACTIVE
          ? SchoolStatus.ACTIVE
          : subscriptionStatus === SubscriptionStatus.EXPIRED ||
              subscriptionStatus === SubscriptionStatus.CANCELLED
            ? SchoolStatus.EXPIRED
            : null;

    if (!target || target === school.status) return;

    await this.prisma.school.update({ where: { id: schoolId }, data: { status: target } });
    this.tenantGuard.invalidate(schoolId);
  }

  async notifySchoolAdmins(
    schoolId: string,
    title: string,
    body: string,
    priority: Priority,
  ): Promise<void> {
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

      await this.notifications.dispatch({
        schoolId,
        userIds: admins.map((admin) => admin.id),
        type: NotificationType.SYSTEM,
        title,
        body,
        priority,
        actionUrl: '/settings/subscription',
      });
    } catch (error) {
      this.log.error('Failed to notify school administrators', error, { schoolId, title });
    }
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function addCycle(from: Date, cycle: 'MONTHLY' | 'YEARLY'): Date {
  const next = new Date(from);
  if (cycle === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
