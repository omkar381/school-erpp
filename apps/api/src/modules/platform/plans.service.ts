import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../../common/exceptions/app.exception';
import { CORE_MODULES, PLAN_MODULES, type ModuleKey } from '../../common/constants/modules';
import { AuditService } from '../audit/audit.service';
import type { CreatePlanDto, PlanQueryDto, SetPlanActiveDto, UpdatePlanDto } from './dto/platform.dto';

const PLAN_SORT_FIELDS = ['sortOrder', 'name', 'code', 'priceYearly', 'createdAt'] as const;

/**
 * The catalogue of what a school can buy.
 *
 * A plan is referenced by live subscriptions, so it is never deleted — it is
 * deactivated, which stops new sales without rewriting anybody's billing
 * history.
 */
@Injectable()
export class PlansService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('PlansService');
  }

  async findAll(query: PlanQueryDto) {
    const where: Prisma.SubscriptionPlanWhereInput = {
      ...(query.tier ? { tier: query.tier } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.subscriptionPlan.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.sortBy
          ? query.buildOrderBy(PLAN_SORT_FIELDS, 'sortOrder')
          : [{ sortOrder: 'asc' }, { priceYearly: 'asc' }],
        include: {
          _count: {
            select: {
              subscriptions: {
                where: {
                  status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
                },
              },
            },
          },
        },
      }),
      this.prisma.subscriptionPlan.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ _count, ...plan }) => ({ ...plan, activeSubscriptions: _count.subscriptions })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      include: {
        _count: { select: { subscriptions: true } },
      },
    });
    if (!plan) throw new NotFoundError('Subscription plan');

    const byStatus = await this.prisma.subscription.groupBy({
      by: ['status'],
      where: { planId: id },
      _count: { _all: true },
    });

    const { _count, ...rest } = plan;
    return {
      ...rest,
      subscriptionCount: _count.subscriptions,
      subscriptionsByStatus: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
    };
  }

  async create(dto: CreatePlanDto) {
    const clash = await this.prisma.subscriptionPlan.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (clash) throw new ConflictError(`A plan with the code "${dto.code}" already exists`);

    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        code: dto.code,
        name: dto.name,
        tier: dto.tier,
        description: dto.description ?? null,
        priceMonthly: dto.priceMonthly ?? 0,
        priceYearly: dto.priceYearly ?? 0,
        currency: dto.currency ?? 'INR',
        maxStudents: dto.maxStudents ?? 500,
        maxStaff: dto.maxStaff ?? 100,
        storageMb: dto.storageMb ?? 5120,
        modules: this.normaliseModules(dto.modules, dto.tier),
        trialDays: dto.trialDays ?? 14,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'platform',
      entity: 'SubscriptionPlan',
      entityId: plan.id,
      description: `Created subscription plan "${plan.name}"`,
      newValue: { code: plan.code, tier: plan.tier, priceYearly: plan.priceYearly },
      schoolId: null,
    });

    this.log.info('Subscription plan created', { planId: plan.id, code: plan.code });
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto) {
    const existing = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Subscription plan');

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.tier !== undefined ? { tier: dto.tier } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.priceMonthly !== undefined ? { priceMonthly: dto.priceMonthly } : {}),
        ...(dto.priceYearly !== undefined ? { priceYearly: dto.priceYearly } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.maxStudents !== undefined ? { maxStudents: dto.maxStudents } : {}),
        ...(dto.maxStaff !== undefined ? { maxStaff: dto.maxStaff } : {}),
        ...(dto.storageMb !== undefined ? { storageMb: dto.storageMb } : {}),
        ...(dto.modules !== undefined
          ? { modules: this.normaliseModules(dto.modules, dto.tier ?? existing.tier) }
          : {}),
        ...(dto.trialDays !== undefined ? { trialDays: dto.trialDays } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });

    const { oldValue, newValue } = this.audit.diff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'platform',
      entity: 'SubscriptionPlan',
      entityId: id,
      description: `Updated subscription plan "${updated.name}"`,
      oldValue,
      newValue,
      schoolId: null,
    });

    return updated;
  }

  async setActive(id: string, dto: SetPlanActiveDto) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!plan) throw new NotFoundError('Subscription plan');

    if (!dto.isActive) {
      // Deactivation only stops new sales; refuse if it is the last one that
      // could be sold, since school provisioning picks the first active plan.
      const otherActive = await this.prisma.subscriptionPlan.count({
        where: { isActive: true, id: { not: id } },
      });
      if (otherActive === 0) {
        throw new BadRequestError(
          'At least one plan must stay active — new schools are provisioned onto it.',
        );
      }
    }

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: { isActive: dto.isActive },
      select: { id: true, name: true, isActive: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'platform',
      entity: 'SubscriptionPlan',
      entityId: id,
      description: `${dto.isActive ? 'Activated' : 'Deactivated'} plan "${plan.name}"`,
      oldValue: { isActive: plan.isActive },
      newValue: { isActive: dto.isActive },
      schoolId: null,
    });

    return updated;
  }

  /** Public pricing table, also used by the school's own subscription screen. */
  async listSellable() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceYearly: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        tier: true,
        description: true,
        priceMonthly: true,
        priceYearly: true,
        currency: true,
        maxStudents: true,
        maxStaff: true,
        storageMb: true,
        modules: true,
        trialDays: true,
      },
    });
  }

  /** Core modules are implied, so a plan can never be saved without them. */
  private normaliseModules(modules: string[] | undefined, tier: string): string[] {
    const chosen =
      modules ?? (PLAN_MODULES[tier as keyof typeof PLAN_MODULES] as ModuleKey[] | undefined) ?? [];
    return [...new Set([...CORE_MODULES, ...chosen])];
  }
}
