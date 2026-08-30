import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  Prisma,
  RoleType,
  SchoolStatus,
  SubscriptionStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService, type TransactionClient } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import {
  ALL_MODULES,
  CORE_MODULES,
  MODULES,
  PLAN_MODULES,
  type ModuleKey,
} from '../../common/constants/modules';
import { ROLE_DEFAULT_PERMISSIONS, ROLE_LABELS } from '../../common/constants/permissions';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/services/password.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ModuleGuard } from '../../common/guards/module.guard';
import type {
  CreateSchoolDto,
  SchoolAdminSeedDto,
  SchoolQueryDto,
  SchoolTimingsDto,
  UpdateBrandingDto,
  UpdateModulesDto,
  UpdateSchoolDto,
  UpdateSettingsDto,
} from './dto/school.dto';

const SCHOOL_SORT_FIELDS = ['name', 'code', 'city', 'status', 'createdAt'] as const;

/** Settings applied to a newly created school. */
const DEFAULT_SETTINGS = {
  timings: {
    startTime: '08:30',
    endTime: '15:30',
    workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    lunchStart: '12:30',
    lunchEnd: '13:10',
  },
  attendance: {
    /** Attendance older than this many days needs elevated permission to change. */
    editWindowDays: 7,
    notifyParentsOnAbsence: true,
    minimumAttendancePercent: 75,
    allowFutureMarking: false,
  },
  fees: {
    lateFeeEnabled: true,
    lateFeeGraceDays: 5,
    reminderDaysBefore: [7, 3, 1],
    allowPartialPayment: true,
    allowOnlinePayment: true,
  },
  exams: {
    passingPercentage: 35,
    showRankInReportCard: true,
    lockMarksOnPublish: true,
  },
  admissions: {
    autoGenerateAdmissionNumber: true,
    admissionNumberPrefix: '',
  },
  library: {
    maxBooksPerStudent: 2,
    loanDurationDays: 14,
    finePerDay: 2,
    maxRenewals: 2,
  },
} as const;

@Injectable()
export class SchoolsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly tenantGuard: TenantGuard,
    private readonly moduleGuard: ModuleGuard,
    logger: AppLogger,
  ) {
    this.log = logger.child('SchoolsService');
  }

  // -------------------------------------------------------------------------
  // Provisioning
  // -------------------------------------------------------------------------

  /**
   * Creates a school together with everything it needs to be usable: system
   * roles with their default permission grants, a first administrator, a
   * current academic year and a subscription. All inside one transaction, so a
   * failure never leaves a half-provisioned tenant behind.
   */
  async create(dto: CreateSchoolDto, createdById?: string) {
    const slug = dto.slug ?? this.slugify(dto.name);

    const clash = await this.prisma.school.findFirst({
      where: { OR: [{ code: dto.code }, { slug }] },
      select: { code: true, slug: true },
    });
    if (clash) {
      throw new ConflictError(
        clash.code === dto.code
          ? `A school with the code "${dto.code}" already exists`
          : `The website address "${slug}" is already taken`,
      );
    }

    const plan = await this.resolvePlan(dto.planCode);
    const temporaryPassword = dto.admin?.password ?? this.passwords.generateTemporary();
    const adminPasswordHash = dto.admin ? await this.passwords.hash(temporaryPassword) : null;

    const result = await this.prisma.transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          code: dto.code,
          slug,
          name: dto.name,
          legalName: dto.legalName ?? null,
          status: SchoolStatus.TRIAL,
          email: dto.email,
          phone: dto.phone,
          alternatePhone: dto.alternatePhone ?? null,
          website: dto.website ?? null,
          addressLine1: dto.addressLine1 ?? null,
          addressLine2: dto.addressLine2 ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          country: dto.country ?? 'India',
          postalCode: dto.postalCode ?? null,
          board: dto.board ?? null,
          affiliationNumber: dto.affiliationNumber ?? null,
          establishedYear: dto.establishedYear ?? null,
          principalName: dto.principalName ?? null,
          timezone: dto.timezone ?? this.config.get<string>('app.defaultTimezone', 'Asia/Kolkata'),
          currency: dto.currency ?? this.config.get<string>('app.defaultCurrency', 'INR'),
          locale: dto.locale ?? 'en',
          enabledModules: this.modulesToMap(
            PLAN_MODULES[plan.tier as keyof typeof PLAN_MODULES] ?? CORE_MODULES,
          ),
          settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
        },
      });

      await this.provisionRoles(tx, school.id);

      const subscription = await tx.subscription.create({
        data: {
          schoolId: school.id,
          planId: plan.id,
          status: SubscriptionStatus.TRIALING,
          startDate: new Date(),
          endDate: new Date(Date.now() + plan.trialDays * 86_400_000),
          amount: plan.priceYearly,
          currency: plan.currency,
        },
      });

      const academicYear = await tx.academicYear.create({
        data: {
          schoolId: school.id,
          ...this.currentAcademicYearBounds(),
          isCurrent: true,
        },
      });

      let admin: { id: string; email: string | null } | null = null;

      if (dto.admin && adminPasswordHash) {
        const adminRole = await tx.role.findFirstOrThrow({
          where: { schoolId: school.id, type: RoleType.SCHOOL_ADMIN },
          select: { id: true },
        });

        admin = await tx.user.create({
          data: {
            schoolId: school.id,
            email: dto.admin.email,
            phone: dto.admin.phone ?? null,
            passwordHash: adminPasswordHash,
            firstName: dto.admin.firstName,
            lastName: dto.admin.lastName ?? null,
            status: UserStatus.ACTIVE,
            // The generated password is single-use; the admin must replace it.
            mustChangePassword: !dto.admin.password,
            createdById: createdById ?? null,
            roles: { create: { roleId: adminRole.id } },
          },
          select: { id: true, email: true },
        });
      }

      return { school, subscription, academicYear, admin };
    });

    if (result.admin?.email && !dto.admin?.password) {
      await this.notifications.sendEmail({
        to: result.admin.email,
        subject: `Your ${result.school.name} administrator account`,
        template: 'welcome',
        data: {
          firstName: dto.admin!.firstName,
          schoolName: result.school.name,
          roleName: 'School Administrator',
          username: result.admin.email,
          temporaryPassword,
          loginUrl: `${this.config.get<string>('app.webUrl')}/login`,
        },
      });
    }

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'schools',
      entity: 'School',
      entityId: result.school.id,
      description: `Created school "${result.school.name}"`,
      newValue: { code: result.school.code, name: result.school.name },
      schoolId: result.school.id,
    });

    this.log.info('School provisioned', {
      schoolId: result.school.id,
      code: result.school.code,
      plan: plan.code,
    });

    return {
      school: result.school,
      subscription: result.subscription,
      academicYear: result.academicYear,
      adminCreated: Boolean(result.admin),
    };
  }

  /**
   * Adds an administrator to a school that already exists.
   *
   * Provisioning seeds the first admin, but there was no way to add another
   * afterwards — so a school whose only admin left was unreachable without
   * touching the database. The account is created the same way the first one
   * is, including the single-use password and the welcome email.
   */
  async addAdministrator(schoolId: string, dto: SchoolAdminSeedDto, createdById?: string) {
    const school = await this.prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!school) throw new NotFoundError('School');

    const taken = await this.prisma.user.count({
      where: { email: dto.email, deletedAt: null },
    });
    if (taken > 0) {
      throw new ConflictError(
        `The email "${dto.email}" is already registered.`,
        ErrorCode.DUPLICATE_EMAIL,
      );
    }

    const temporaryPassword = dto.password ?? this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const admin = await this.prisma.transaction(async (tx) => {
      const adminRole = await tx.role.findFirst({
        where: { schoolId, type: RoleType.SCHOOL_ADMIN },
        select: { id: true },
      });
      if (!adminRole) {
        throw new BadRequestError(
          'This school has no administrator role configured. Re-run role provisioning first.',
        );
      }

      return tx.user.create({
        data: {
          schoolId,
          email: dto.email,
          phone: dto.phone ?? null,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName ?? null,
          status: UserStatus.ACTIVE,
          mustChangePassword: !dto.password,
          createdById: createdById ?? null,
          roles: { create: { roleId: adminRole.id } },
        },
        select: { id: true, email: true, firstName: true, lastName: true, status: true },
      });
    });

    let welcomeEmailSent = false;

    if (!dto.password) {
      // Best-effort: the account is already usable, and failing the request
      // because SMTP is down would leave an admin created but unreported.
      welcomeEmailSent = await this.notifications
        .sendEmail({
          to: admin.email!,
          subject: `Your ${school.name} administrator account`,
          template: 'welcome',
          data: {
            firstName: dto.firstName,
            schoolName: school.name,
            roleName: 'School Administrator',
            username: admin.email,
            temporaryPassword,
            loginUrl: `${this.config.get<string>('app.webUrl')}/login`,
          },
        })
        .then(() => true)
        .catch((error: unknown) => {
          this.log.error('Welcome email could not be sent to a new administrator', {
            schoolId,
            userId: admin.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        });
    }

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'schools',
      entity: 'User',
      entityId: admin.id,
      description: `Added administrator "${dto.firstName}" to ${school.name}`,
      userId: createdById,
      schoolId,
    });

    this.log.info('School administrator added', { schoolId, userId: admin.id });

    // A generated password goes out by email and is deliberately never echoed
    // back in the response, so it cannot end up in a log or a browser cache.
    // `welcomeEmailSent` therefore matters: when it is false and no password
    // was supplied, nobody can sign in until an administrator resets it.
    return { administrator: admin, welcomeEmailSent, passwordWasSupplied: Boolean(dto.password) };
  }

  /** Creates the system roles for a school and grants each its default permissions. */
  private async provisionRoles(tx: TransactionClient, schoolId: string): Promise<void> {
    const permissions = await tx.permission.findMany({ select: { id: true, key: true } });
    const idByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

    if (idByKey.size === 0) {
      throw new BadRequestError(
        'The permission catalogue has not been seeded. Run the database seed before creating schools.',
      );
    }

    const schoolRoles = (Object.keys(ROLE_DEFAULT_PERMISSIONS) as RoleType[]).filter(
      (role) => role !== RoleType.SUPER_ADMIN,
    );

    for (const type of schoolRoles) {
      const role = await tx.role.create({
        data: {
          schoolId,
          type,
          name: ROLE_LABELS[type],
          description: `Default ${ROLE_LABELS[type]} role`,
          isSystem: true,
          isDefault: true,
        },
        select: { id: true },
      });

      const grants = ROLE_DEFAULT_PERMISSIONS[type]
        .map((key) => idByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId }));

      if (grants.length > 0) {
        await tx.rolePermission.createMany({ data: grants, skipDuplicates: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async findAll(query: SchoolQueryDto) {
    const where: Prisma.SchoolWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      ...(query.state ? { state: { equals: query.state, mode: 'insensitive' } } : {}),
      ...(query.board ? { board: { equals: query.board, mode: 'insensitive' } } : {}),
      ...(query.activeOnly
        ? {
            subscriptions: {
              some: {
                status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
                endDate: { gte: new Date() },
              },
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
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
          _count: { select: { students: true, staff: true, users: true } },
          subscriptions: {
            where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] } },
            orderBy: { endDate: 'desc' },
            take: 1,
            select: {
              status: true,
              endDate: true,
              plan: { select: { name: true, tier: true, maxStudents: true } },
            },
          },
        },
      }),
      this.prisma.school.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ subscriptions, _count, ...school }) => ({
        ...school,
        studentCount: _count.students,
        staffCount: _count.staff,
        userCount: _count.users,
        subscription: subscriptions[0] ?? null,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          include: { plan: true },
        },
        academicYears: { orderBy: { startDate: 'desc' }, take: 5 },
        _count: {
          select: { students: true, staff: true, users: true, classes: true },
        },
      },
    });

    if (!school) throw new NotFoundError('School');

    const { _count, ...rest } = school;
    return {
      ...rest,
      counts: {
        students: _count.students,
        staff: _count.staff,
        users: _count.users,
        classes: _count.classes,
      },
    };
  }

  /**
   * The school as every signed-in user needs to know it.
   *
   * Deliberately a different shape from `findOne`: that one carries
   * subscriptions, plan pricing and headcounts, which a parent or a student
   * has no business reading. This is the identity, the branding, the currency
   * and which modules are switched on — without which the app shell cannot
   * render a correct sidebar or format a single amount.
   */
  async currentContext(id: string) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        currency: true,
        timezone: true,
        status: true,
        enabledModules: true,
      },
    });

    if (!school) throw new NotFoundError('School');
    return school;
  }

  async findBySlug(slug: string) {
    const school = await this.prisma.school.findFirst({
      where: { slug, deletedAt: null, status: { not: SchoolStatus.ARCHIVED } },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
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
        logoUrl: true,
        faviconUrl: true,
        primaryColor: true,
        secondaryColor: true,
        latitude: true,
        longitude: true,
      },
    });

    if (!school) throw new NotFoundError('School');
    return school;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  async update(id: string, dto: UpdateSchoolDto) {
    const existing = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('School');

    if (dto.slug && dto.slug !== existing.slug) {
      const taken = await this.prisma.school.count({
        where: { slug: dto.slug, id: { not: id } },
      });
      if (taken > 0) throw new ConflictError(`The website address "${dto.slug}" is already taken`);
    }

    const updated = await this.prisma.school.update({
      where: { id },
      data: { ...dto },
    });

    const { oldValue, newValue } = this.audit.diff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'schools',
      entity: 'School',
      entityId: id,
      description: 'Updated school profile',
      oldValue,
      newValue,
      schoolId: id,
    });

    this.tenantGuard.invalidate(id);
    return updated;
  }

  async updateBranding(id: string, dto: UpdateBrandingDto) {
    const school = await this.prisma.school.update({ where: { id }, data: { ...dto } });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'schools',
      entity: 'School',
      entityId: id,
      description: 'Updated branding',
      newValue: dto as Record<string, unknown>,
      schoolId: id,
    });

    return school;
  }

  async updateModules(id: string, dto: UpdateModulesDto, subscriptionEnforced = true) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: { enabledModules: true },
    });
    if (!school) throw new NotFoundError('School');

    const allowed = subscriptionEnforced ? await this.planModules(id) : new Set(ALL_MODULES);
    const current = (school.enabledModules as Record<string, boolean>) ?? {};
    const next = { ...current };

    for (const [key, enabled] of Object.entries(dto.modules)) {
      if (!ALL_MODULES.includes(key as ModuleKey)) {
        throw new BadRequestError(`"${key}" is not a recognised module`);
      }
      // Core modules underpin the rest of the product and stay on.
      if (CORE_MODULES.includes(key as ModuleKey)) {
        next[key] = true;
        continue;
      }
      if (enabled && !allowed.has(key as ModuleKey)) {
        throw new ForbiddenError(
          `The "${key}" module is not included in this school's subscription plan`,
          ErrorCode.SUBSCRIPTION_LIMIT_REACHED,
        );
      }
      next[key] = Boolean(enabled);
    }

    const updated = await this.prisma.school.update({
      where: { id },
      data: { enabledModules: next as Prisma.InputJsonValue },
      select: { id: true, enabledModules: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'schools',
      entity: 'School',
      entityId: id,
      description: 'Changed enabled modules',
      oldValue: current,
      newValue: next,
      schoolId: id,
    });

    this.moduleGuard.invalidate(id);
    this.tenantGuard.invalidate(id);
    return updated;
  }

  /** Deep-merges a partial settings object into the school's settings blob. */
  async updateSettings(id: string, dto: UpdateSettingsDto) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: { settings: true },
    });
    if (!school) throw new NotFoundError('School');

    const current = (school.settings as Record<string, unknown>) ?? {};
    const merged = this.deepMerge(current, dto.settings);

    const updated = await this.prisma.school.update({
      where: { id },
      data: { settings: merged as Prisma.InputJsonValue },
      select: { id: true, settings: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'schools',
      entity: 'School',
      entityId: id,
      description: 'Updated school settings',
      oldValue: current,
      newValue: merged,
      schoolId: id,
    });

    return updated;
  }

  async updateTimings(id: string, dto: SchoolTimingsDto) {
    return this.updateSettings(id, { settings: { timings: dto } });
  }

  async getSettings(id: string) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: { settings: true, enabledModules: true, timezone: true, currency: true, locale: true },
    });
    if (!school) throw new NotFoundError('School');

    return {
      settings: this.deepMerge(DEFAULT_SETTINGS as unknown as Record<string, unknown>, (school.settings as Record<string, unknown>) ?? {}),
      enabledModules: school.enabledModules,
      timezone: school.timezone,
      currency: school.currency,
      locale: school.locale,
    };
  }

  async setStatus(id: string, status: SchoolStatus, reason?: string) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, name: true },
    });
    if (!school) throw new NotFoundError('School');

    const updated = await this.prisma.school.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, status: true },
    });

    // Suspending a school must take effect immediately for users already
    // holding valid access tokens.
    if (status === SchoolStatus.SUSPENDED || status === SchoolStatus.ARCHIVED) {
      await this.prisma.session.updateMany({
        where: { user: { schoolId: id }, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: `school_${status.toLowerCase()}` },
      });
    }

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'schools',
      entity: 'School',
      entityId: id,
      description: `School status changed to ${status}${reason ? `: ${reason}` : ''}`,
      oldValue: { status: school.status },
      newValue: { status },
      schoolId: id,
    });

    this.tenantGuard.invalidate(id);
    this.log.warn('School status changed', { schoolId: id, from: school.status, to: status });
    return updated;
  }

  /**
   * Soft-deletes a school. Records are retained so that a deletion can be
   * reviewed and reversed; a permanent purge is a separate, deliberate action.
   */
  async remove(id: string) {
    const school = await this.prisma.school.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, _count: { select: { students: true } } },
    });
    if (!school) throw new NotFoundError('School');

    await this.prisma.$transaction([
      this.prisma.school.update({
        where: { id },
        data: { deletedAt: new Date(), status: SchoolStatus.ARCHIVED },
      }),
      this.prisma.session.updateMany({
        where: { user: { schoolId: id }, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'school_deleted' },
      }),
    ]);

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'schools',
      entity: 'School',
      entityId: id,
      description: `Archived school "${school.name}" (${school._count.students} students retained)`,
      schoolId: id,
    });

    this.tenantGuard.invalidate(id);
    return { archived: true };
  }

  async completeOnboardingStep(id: string, step: number) {
    return this.prisma.school.update({
      where: { id },
      data: {
        onboardingStep: step,
        ...(step >= 5 ? { onboardedAt: new Date() } : {}),
      },
      select: { id: true, onboardingStep: true, onboardedAt: true },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Modules the school's current plan permits, before the admin's own toggles. */
  private async planModules(schoolId: string): Promise<Set<ModuleKey>> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        schoolId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        endDate: { gte: new Date() },
      },
      orderBy: { endDate: 'desc' },
      select: { plan: { select: { tier: true, modules: true } } },
    });

    if (!subscription) return new Set(CORE_MODULES);

    const planModules = subscription.plan.modules.length
      ? (subscription.plan.modules as ModuleKey[])
      : (PLAN_MODULES[subscription.plan.tier as keyof typeof PLAN_MODULES] ?? CORE_MODULES);

    return new Set([...CORE_MODULES, ...planModules]);
  }

  private async resolvePlan(planCode?: string) {
    const plan = planCode
      ? await this.prisma.subscriptionPlan.findUnique({ where: { code: planCode } })
      : await this.prisma.subscriptionPlan.findFirst({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        });

    if (!plan) {
      throw new BadRequestError(
        planCode
          ? `Subscription plan "${planCode}" was not found`
          : 'No subscription plans are configured. Run the database seed first.',
      );
    }
    return plan;
  }

  private modulesToMap(modules: readonly ModuleKey[]): Prisma.InputJsonValue {
    const map: Record<string, boolean> = {};
    for (const key of ALL_MODULES) map[key] = false;
    for (const key of CORE_MODULES) map[key] = true;
    for (const key of modules) map[key] = true;
    map[MODULES.CORE] = true;
    return map;
  }

  /** Indian academic year convention: April to March. */
  private currentAcademicYearBounds(): { name: string; startDate: Date; endDate: Date } {
    const now = new Date();
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return {
      name: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
      startDate: new Date(Date.UTC(startYear, 3, 1)),
      endDate: new Date(Date.UTC(startYear + 1, 2, 31)),
    };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private deepMerge(
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const output: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(patch)) {
      const existing = output[key];
      const bothPlainObjects =
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        existing !== null &&
        typeof existing === 'object' &&
        !Array.isArray(existing);

      output[key] = bothPlainObjects
        ? this.deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
        : value;
    }

    return output;
  }
}
