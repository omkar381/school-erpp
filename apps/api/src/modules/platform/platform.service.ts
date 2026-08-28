import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  EmploymentStatus,
  Prisma,
  Priority,
  SchoolStatus,
  SubscriptionStatus,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { BadRequestError, NotFoundError } from '../../common/exceptions/app.exception';
import {
  ALL_MODULES,
  CORE_MODULES,
  MODULE_LABELS,
  PLAN_MODULES,
  type ModuleKey,
} from '../../common/constants/modules';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ModuleGuard } from '../../common/guards/module.guard';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import { SubscriptionsService } from './subscriptions.service';
import { BILLABLE_STUDENT_STATUSES, UsageService, daysUntil } from './usage.service';
import type {
  PlatformSchoolQueryDto,
  SetSchoolModulesDto,
  SetSchoolStatusDto,
} from './dto/platform.dto';

const SCHOOL_SORT_FIELDS = ['name', 'code', 'city', 'status', 'createdAt'] as const;

const LIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
];

/**
 * The platform operator's view of the estate.
 *
 * Everything here reads across tenants, which is exactly why every route that
 * reaches it is behind a platform permission — see PlatformController.
 */
@Injectable()
export class PlatformService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly schools: SchoolsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly usage: UsageService,
    private readonly tenantGuard: TenantGuard,
    private readonly moduleGuard: ModuleGuard,
    logger: AppLogger,
  ) {
    this.log = logger.child('PlatformService');
  }

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  async overview() {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      schoolsByStatus,
      totalStudents,
      totalStaff,
      totalUsers,
      liveSubscriptions,
      newSchoolsThisMonth,
      ticketsByStatus,
      urgentTickets,
    ] = await Promise.all([
      this.prisma.school.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.student.count({
        where: {
          deletedAt: null,
          status: { in: BILLABLE_STUDENT_STATUSES },
          school: { deletedAt: null },
        },
      }),
      this.prisma.staff.count({
        where: {
          deletedAt: null,
          employmentStatus: { notIn: [EmploymentStatus.RESIGNED, EmploymentStatus.TERMINATED] },
          school: { deletedAt: null },
        },
      }),
      this.prisma.user.count({ where: { deletedAt: null, schoolId: { not: null } } }),
      this.prisma.subscription.findMany({
        where: { status: { in: LIVE_STATUSES }, school: { deletedAt: null } },
        select: { amount: true, billingCycle: true, status: true, currency: true },
      }),
      this.prisma.school.count({ where: { deletedAt: null, createdAt: { gte: monthStart } } }),
      this.prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.supportTicket.count({
        where: {
          priority: { in: ['HIGH', 'CRITICAL'] },
          status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING] },
        },
      }),
    ]);

    const countFor = (status: SchoolStatus): number =>
      schoolsByStatus.find((row) => row.status === status)?._count._all ?? 0;

    const totalSchools = schoolsByStatus.reduce((sum, row) => sum + row._count._all, 0);

    // Annualised run rate: monthly contracts are worth twelve of themselves,
    // which is the only way monthly and yearly plans can be added together.
    let annualRevenue = 0;
    let payingSubscriptions = 0;
    for (const subscription of liveSubscriptions) {
      if (subscription.status === SubscriptionStatus.TRIALING) continue;
      payingSubscriptions += 1;
      const amount = Number(subscription.amount);
      annualRevenue += subscription.billingCycle === 'MONTHLY' ? amount * 12 : amount;
    }

    const ticketCount = (status: TicketStatus): number =>
      ticketsByStatus.find((row) => row.status === status)?._count._all ?? 0;

    const [recentSchools, expiring, recentActivity, planBreakdown] = await Promise.all([
      this.prisma.school.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          name: true,
          code: true,
          city: true,
          state: true,
          status: true,
          logoUrl: true,
          createdAt: true,
          _count: { select: { students: true } },
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, plan: { select: { name: true, tier: true } } },
          },
        },
      }),
      this.prisma.subscription.findMany({
        where: {
          status: { in: LIVE_STATUSES },
          endDate: { gte: now, lte: in30Days },
          school: { deletedAt: null },
        },
        orderBy: { endDate: 'asc' },
        take: 10,
        select: {
          id: true,
          status: true,
          endDate: true,
          autoRenew: true,
          amount: true,
          currency: true,
          school: { select: { id: true, name: true, code: true, status: true } },
          plan: { select: { name: true, tier: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { module: { in: ['platform', 'schools', 'support'] } },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          action: true,
          module: true,
          entity: true,
          entityId: true,
          description: true,
          createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          school: { select: { id: true, name: true } },
        },
      }),
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: { in: LIVE_STATUSES }, school: { deletedAt: null } },
        _count: { _all: true },
      }),
    ]);

    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { id: { in: planBreakdown.map((row) => row.planId) } },
      select: { id: true, name: true, code: true, tier: true, priceYearly: true },
    });
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    return {
      schools: {
        total: totalSchools,
        active: countFor(SchoolStatus.ACTIVE),
        trial: countFor(SchoolStatus.TRIAL),
        suspended: countFor(SchoolStatus.SUSPENDED),
        expired: countFor(SchoolStatus.EXPIRED),
        archived: countFor(SchoolStatus.ARCHIVED),
        newThisMonth: newSchoolsThisMonth,
      },
      people: { students: totalStudents, staff: totalStaff, users: totalUsers },
      revenue: {
        annualRunRate: Math.round(annualRevenue),
        currency: liveSubscriptions[0]?.currency ?? 'INR',
        payingSubscriptions,
        trialSubscriptions: liveSubscriptions.filter(
          (subscription) => subscription.status === SubscriptionStatus.TRIALING,
        ).length,
        averageContractValue:
          payingSubscriptions > 0 ? Math.round(annualRevenue / payingSubscriptions) : 0,
      },
      support: {
        open: ticketCount(TicketStatus.OPEN),
        inProgress: ticketCount(TicketStatus.IN_PROGRESS),
        waiting: ticketCount(TicketStatus.WAITING),
        resolved: ticketCount(TicketStatus.RESOLVED),
        closed: ticketCount(TicketStatus.CLOSED),
        urgent: urgentTickets,
      },
      planBreakdown: planBreakdown
        .map((row) => ({
          planId: row.planId,
          name: planById.get(row.planId)?.name ?? 'Unknown',
          tier: planById.get(row.planId)?.tier ?? null,
          schools: row._count._all,
        }))
        .sort((a, b) => b.schools - a.schools),
      recentSchools: recentSchools.map(({ _count, subscriptions, ...school }) => ({
        ...school,
        studentCount: _count.students,
        plan: subscriptions[0]?.plan.name ?? null,
        subscriptionStatus: subscriptions[0]?.status ?? null,
      })),
      expiringSubscriptions: expiring.map((subscription) => ({
        ...subscription,
        daysRemaining: daysUntil(subscription.endDate),
      })),
      recentActivity,
      generatedAt: now,
    };
  }

  /** New schools and new subscriptions per month, for the dashboard chart. */
  async growth(months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const [schools, subscriptions] = await Promise.all([
      this.prisma.school.findMany({
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.subscription.findMany({
        where: { createdAt: { gte: since }, school: { deletedAt: null } },
        select: { createdAt: true, amount: true, billingCycle: true, status: true },
      }),
    ]);

    const buckets = new Map<string, { month: string; schools: number; subscriptions: number; revenue: number }>();
    for (let index = 0; index < months; index += 1) {
      const date = new Date(since);
      date.setMonth(since.getMonth() + index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, { month: key, schools: 0, subscriptions: 0, revenue: 0 });
    }

    const keyOf = (date: Date): string =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    for (const school of schools) {
      const bucket = buckets.get(keyOf(school.createdAt));
      if (bucket) bucket.schools += 1;
    }
    for (const subscription of subscriptions) {
      const bucket = buckets.get(keyOf(subscription.createdAt));
      if (!bucket) continue;
      bucket.subscriptions += 1;
      if (subscription.status !== SubscriptionStatus.TRIALING) {
        const amount = Number(subscription.amount);
        bucket.revenue += subscription.billingCycle === 'MONTHLY' ? amount * 12 : amount;
      }
    }

    return [...buckets.values()];
  }

  // -------------------------------------------------------------------------
  // Schools
  // -------------------------------------------------------------------------

  async listSchools(query: PlatformSchoolQueryDto) {
    const now = new Date();

    const subscriptionFilter: Prisma.SubscriptionListRelationFilter | undefined =
      query.tier || query.planId || query.expiringWithinDays
        ? {
            some: {
              status: { in: LIVE_STATUSES },
              ...(query.planId ? { planId: query.planId } : {}),
              ...(query.tier ? { plan: { tier: query.tier } } : {}),
              ...(query.expiringWithinDays
                ? {
                    endDate: {
                      gte: now,
                      lte: new Date(now.getTime() + query.expiringWithinDays * 86_400_000),
                    },
                  }
                : {}),
            },
          }
        : undefined;

    const where: Prisma.SchoolWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.state ? { state: { equals: query.state, mode: 'insensitive' } } : {}),
      ...(subscriptionFilter ? { subscriptions: subscriptionFilter } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.school.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(SCHOOL_SORT_FIELDS, 'createdAt'),
        select: {
          id: true,
          code: true,
          slug: true,
          name: true,
          status: true,
          email: true,
          phone: true,
          city: true,
          state: true,
          board: true,
          logoUrl: true,
          createdAt: true,
          onboardedAt: true,
          _count: { select: { users: true } },
          subscriptions: {
            orderBy: [{ status: 'asc' }, { endDate: 'desc' }],
            take: 1,
            select: {
              id: true,
              status: true,
              startDate: true,
              endDate: true,
              autoRenew: true,
              amount: true,
              currency: true,
              limitOverrides: true,
              plan: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  tier: true,
                  maxStudents: true,
                  maxStaff: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.school.count({ where }),
    ]);

    const counts = await this.usage.forSchools(items.map((school) => school.id));

    return buildPaginatedResult(
      items.map(({ subscriptions, _count, ...school }) => {
        const subscription = subscriptions[0] ?? null;
        const measured = counts.get(school.id) ?? { students: 0, staff: 0 };
        const overrides = (subscription?.limitOverrides as Record<string, number>) ?? {};
        const maxStudents = overrides.maxStudents ?? subscription?.plan.maxStudents ?? 0;

        return {
          ...school,
          userCount: _count.users,
          studentCount: measured.students,
          staffCount: measured.staff,
          subscription: subscription
            ? {
                id: subscription.id,
                status: subscription.status,
                startDate: subscription.startDate,
                endDate: subscription.endDate,
                autoRenew: subscription.autoRenew,
                amount: subscription.amount,
                currency: subscription.currency,
                daysRemaining: daysUntil(subscription.endDate),
                plan: subscription.plan,
              }
            : null,
          studentUsagePercent:
            maxStudents > 0 ? Math.min(100, Math.round((measured.students / maxStudents) * 100)) : null,
        };
      }),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * A school's operational profile.
   *
   * Deliberately aggregate: counts, subscription and configuration, never the
   * school's own records. A platform operator has no business reading a named
   * pupil's file from here.
   */
  async schoolDetail(id: string) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        legalName: true,
        status: true,
        email: true,
        phone: true,
        alternatePhone: true,
        website: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
        board: true,
        affiliationNumber: true,
        establishedYear: true,
        principalName: true,
        timezone: true,
        currency: true,
        locale: true,
        logoUrl: true,
        enabledModules: true,
        onboardingStep: true,
        onboardedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!school) throw new NotFoundError('School');

    const [
      usage,
      subscription,
      academicYear,
      classCount,
      staffBreakdown,
      studentBreakdown,
      admins,
      openTickets,
      recentActivity,
    ] = await Promise.all([
      this.usage.forSchool(id, { fresh: true }),
      this.subscriptions.forSchool(id),
      this.prisma.academicYear.findFirst({
        where: { schoolId: id, isCurrent: true },
        select: { id: true, name: true, startDate: true, endDate: true },
      }),
      this.prisma.class.count({ where: { schoolId: id } }),
      this.prisma.staff.groupBy({
        by: ['isTeacher'],
        where: { schoolId: id, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.student.groupBy({
        by: ['status'],
        where: { schoolId: id, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.user.findMany({
        where: {
          schoolId: id,
          deletedAt: null,
          roles: { some: { role: { type: { in: ['SCHOOL_ADMIN', 'PRINCIPAL'] } } } },
        },
        take: 5,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          status: true,
          lastLoginAt: true,
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          schoolId: id,
          status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING] },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { schoolId: id },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          id: true,
          action: true,
          module: true,
          entity: true,
          description: true,
          createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    const planModules = subscription
      ? this.planModuleList(subscription.plan.modules, subscription.plan.tier)
      : [...CORE_MODULES];
    const enabled = (school.enabledModules as Record<string, boolean>) ?? {};

    return {
      school,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            cancelledAt: subscription.cancelledAt,
            autoRenew: subscription.autoRenew,
            billingCycle: subscription.billingCycle,
            amount: subscription.amount,
            currency: subscription.currency,
            limitOverrides: subscription.limitOverrides,
            notes: subscription.notes,
            daysRemaining: daysUntil(subscription.endDate),
            isTrial: subscription.status === SubscriptionStatus.TRIALING,
            plan: {
              id: subscription.plan.id,
              code: subscription.plan.code,
              name: subscription.plan.name,
              tier: subscription.plan.tier,
              trialDays: subscription.plan.trialDays,
              priceMonthly: subscription.plan.priceMonthly,
              priceYearly: subscription.plan.priceYearly,
            },
          }
        : null,
      usage,
      academicYear,
      counts: {
        classes: classCount,
        teachers: staffBreakdown.find((row) => row.isTeacher)?._count._all ?? 0,
        nonTeaching: staffBreakdown.find((row) => !row.isTeacher)?._count._all ?? 0,
        studentsByStatus: Object.fromEntries(
          studentBreakdown.map((row) => [row.status, row._count._all]),
        ),
        openTickets,
      },
      administrators: admins,
      modules: ALL_MODULES.map((key) => ({
        key,
        label: MODULE_LABELS[key],
        core: CORE_MODULES.includes(key),
        inPlan: planModules.includes(key),
        enabled: CORE_MODULES.includes(key) ? true : enabled[key] === true,
      })),
      recentActivity,
    };
  }

  async schoolUsage(id: string) {
    return this.usage.forSchool(id, { fresh: true });
  }

  async schoolActivity(id: string, limit = 50) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!school) throw new NotFoundError('School');

    return this.prisma.auditLog.findMany({
      where: { schoolId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: {
        id: true,
        action: true,
        module: true,
        entity: true,
        entityId: true,
        description: true,
        createdAt: true,
        ipAddress: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  /**
   * Suspend, reactivate or archive a school.
   *
   * Delegates the state change to SchoolsService so session revocation and
   * cache invalidation stay in one place, then adds the platform-level audit
   * entry and tells the school what happened.
   */
  async setSchoolStatus(id: string, dto: SetSchoolStatusDto) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (!school) throw new NotFoundError('School');
    if (school.status === dto.status) {
      throw new BadRequestError(`This school is already ${dto.status.toLowerCase()}`);
    }

    const updated = await this.schools.setStatus(id, dto.status, dto.reason);

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'platform',
      entity: 'School',
      entityId: id,
      description:
        dto.status === SchoolStatus.SUSPENDED
          ? `Suspended "${school.name}"${dto.reason ? `: ${dto.reason}` : ''}`
          : dto.status === SchoolStatus.ACTIVE
            ? `Reactivated "${school.name}"${dto.reason ? `: ${dto.reason}` : ''}`
            : `Set "${school.name}" to ${dto.status}${dto.reason ? `: ${dto.reason}` : ''}`,
      oldValue: { status: school.status },
      newValue: { status: dto.status, reason: dto.reason ?? null },
      schoolId: id,
    });

    // A suspended school has no live sessions left to notify, so the message
    // is only worth sending on the way back up.
    if (dto.status === SchoolStatus.ACTIVE) {
      await this.subscriptions.notifySchoolAdmins(
        id,
        'Your school account is active again',
        dto.reason ?? 'Access has been restored by the platform team.',
        Priority.IMPORTANT,
      );
    }

    this.log.warn('School status changed by platform operator', {
      schoolId: id,
      from: school.status,
      to: dto.status,
    });

    return updated;
  }

  /** Turn feature modules on or off for one school. */
  async setSchoolModules(id: string, dto: SetSchoolModulesDto) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, enabledModules: true },
    });
    if (!school) throw new NotFoundError('School');

    const subscription = await this.subscriptions.forSchool(id);
    const allowed = new Set(
      subscription
        ? this.planModuleList(subscription.plan.modules, subscription.plan.tier)
        : CORE_MODULES,
    );

    const current = (school.enabledModules as Record<string, boolean>) ?? {};
    const next: Record<string, boolean> = { ...current };
    const changed: string[] = [];

    for (const [key, enabled] of Object.entries(dto.modules)) {
      if (!ALL_MODULES.includes(key as ModuleKey)) {
        throw new BadRequestError(`"${key}" is not a recognised module`);
      }
      if (CORE_MODULES.includes(key as ModuleKey)) {
        next[key] = true;
        continue;
      }
      if (enabled && !allowed.has(key as ModuleKey) && !dto.ignorePlan) {
        throw new BadRequestError(
          `The ${MODULE_LABELS[key as ModuleKey] ?? key} module is not part of the ${subscription?.plan.name ?? 'current'} plan. Change the plan, or send ignorePlan to grant it as an exception.`,
        );
      }
      if (next[key] !== Boolean(enabled)) changed.push(key);
      next[key] = Boolean(enabled);
    }

    const updated = await this.prisma.school.update({
      where: { id },
      data: { enabledModules: next as Prisma.InputJsonValue },
      select: { id: true, enabledModules: true },
    });

    this.moduleGuard.invalidate(id);
    this.tenantGuard.invalidate(id);

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'platform',
      entity: 'School',
      entityId: id,
      description: `Changed modules for "${school.name}": ${changed.join(', ') || 'no change'}${dto.ignorePlan ? ' (plan override)' : ''}`,
      oldValue: current,
      newValue: next,
      schoolId: id,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  /** Cross-school activity feed for the platform dashboard. */
  async schoolActivityFeed(limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { module: { in: ['platform', 'schools', 'support'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        module: true,
        entity: true,
        entityId: true,
        description: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        school: { select: { id: true, name: true, code: true } },
      },
    });
  }

  /** Paginated audit trail of platform-level actions. */
  async platformAudit(query: PaginationQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      module: { in: ['platform', 'schools', 'support'] },
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search, mode: 'insensitive' } },
              { entity: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: query.sortOrder },
        select: {
          id: true,
          action: true,
          module: true,
          entity: true,
          entityId: true,
          description: true,
          oldValue: true,
          newValue: true,
          ipAddress: true,
          createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          school: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  private planModuleList(modules: string[], tier: string): ModuleKey[] {
    const base = modules.length
      ? (modules as ModuleKey[])
      : ((PLAN_MODULES[tier as keyof typeof PLAN_MODULES] as ModuleKey[]) ?? CORE_MODULES);
    return [...new Set([...CORE_MODULES, ...base])];
  }
}
