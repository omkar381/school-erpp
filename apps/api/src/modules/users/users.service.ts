import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma, RoleType, UserStatus } from '@prisma/client';
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
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/services/password.service';
import { TokenService } from '../auth/services/token.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CreateUserDto,
  UpdateProfileDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';

const USER_SORT_FIELDS = ['firstName', 'lastName', 'email', 'status', 'lastLoginAt', 'createdAt'] as const;

/** Fields safe to return to a client. `passwordHash` is never selected. */
const PUBLIC_USER_SELECT = {
  id: true,
  schoolId: true,
  email: true,
  phone: true,
  firstName: true,
  middleName: true,
  lastName: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  locale: true,
  timezone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  lastLoginAt: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    logger: AppLogger,
  ) {
    this.log = logger.child('UsersService');
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { roles: { some: { role: { type: query.role } } } } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(USER_SORT_FIELDS, 'createdAt'),
        select: {
          ...PUBLIC_USER_SELECT,
          roles: { select: { role: { select: { id: true, name: true, type: true } } } },
          staff: { select: { id: true, employeeId: true } },
          student: { select: { id: true, admissionNumber: true } },
          guardian: { select: { id: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ roles, ...user }) => ({
        ...user,
        roles: roles.map((entry) => entry.role),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: {
        ...PUBLIC_USER_SELECT,
        twoFactorEnabled: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        roles: { select: { role: { select: { id: true, name: true, type: true } } } },
        staff: {
          select: { id: true, employeeId: true, designation: { select: { name: true } } },
        },
        student: { select: { id: true, admissionNumber: true } },
        guardian: { select: { id: true, relation: true } },
        _count: { select: { sessions: true, devices: true } },
      },
    });

    if (!user) throw new NotFoundError('User');

    const { roles, _count, ...rest } = user;
    return {
      ...rest,
      roles: roles.map((entry) => entry.role),
      activeSessions: _count.sessions,
      registeredDevices: _count.devices,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        ...PUBLIC_USER_SELECT,
        roles: { select: { role: { select: { id: true, name: true, type: true } } } },
        school: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            timezone: true,
            currency: true,
            locale: true,
            enabledModules: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundError('User');

    const { roles, ...rest } = user;
    return { ...rest, roles: roles.map((entry) => entry.role) };
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  async create(schoolId: string, dto: CreateUserDto, createdById?: string) {
    await this.assertIdentifiersFree(schoolId, dto.email, dto.phone);

    const roles = await this.prisma.role.findMany({
      where: { id: { in: dto.roleIds }, schoolId },
      select: { id: true, type: true, name: true },
    });

    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestError('One or more roles do not exist in this school');
    }
    if (roles.some((role) => role.type === RoleType.SUPER_ADMIN)) {
      throw new ForbiddenError('The Super Administrator role cannot be assigned');
    }

    const temporaryPassword = dto.password ?? this.passwords.generateTemporary();
    if (dto.password) this.passwords.validate(dto.password);
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const user = await this.prisma.user.create({
      data: {
        schoolId,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        passwordHash,
        firstName: dto.firstName,
        middleName: dto.middleName ?? null,
        lastName: dto.lastName ?? null,
        displayName: dto.displayName ?? null,
        locale: dto.locale ?? 'en',
        status: dto.status ?? UserStatus.ACTIVE,
        // An admin-set password is treated as temporary unless explicitly chosen.
        mustChangePassword: dto.mustChangePassword ?? !dto.password,
        createdById: createdById ?? null,
        roles: { create: roles.map((role) => ({ roleId: role.id })) },
      },
      select: PUBLIC_USER_SELECT,
    });

    if (dto.sendWelcomeEmail !== false && user.email) {
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
      });

      await this.notifications.sendEmail({
        to: user.email,
        subject: `Your ${school?.name ?? 'school'} account`,
        template: 'account-created',
        data: {
          firstName: user.firstName,
          schoolName: school?.name ?? '',
          roleName: roles.map((role) => role.name).join(', '),
          username: user.email,
          temporaryPassword,
          loginUrl: `${this.config.get<string>('app.webUrl')}/login`,
        },
      });
    }

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'users',
      entity: 'User',
      entityId: user.id,
      description: `Created user "${[user.firstName, user.lastName].filter(Boolean).join(' ')}"`,
      newValue: { email: user.email, roles: roles.map((role) => role.type) },
      schoolId,
    });

    return user;
  }

  async update(schoolId: string, id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { ...PUBLIC_USER_SELECT },
    });
    if (!existing) throw new NotFoundError('User');

    if (
      (dto.email && dto.email !== existing.email) ||
      (dto.phone && dto.phone !== existing.phone)
    ) {
      await this.assertIdentifiersFree(
        schoolId,
        dto.email !== existing.email ? dto.email : undefined,
        dto.phone !== existing.phone ? dto.phone : undefined,
        id,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...dto,
        // Changing the email invalidates the previous verification.
        ...(dto.email && dto.email !== existing.email ? { emailVerifiedAt: null } : {}),
        ...(dto.phone && dto.phone !== existing.phone ? { phoneVerifiedAt: null } : {}),
      },
      select: PUBLIC_USER_SELECT,
    });

    const { oldValue, newValue } = this.audit.diff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'users',
      entity: 'User',
      entityId: id,
      description: 'Updated user account',
      oldValue,
      newValue,
      schoolId,
    });

    return updated;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName ?? undefined,
        middleName: dto.middleName ?? undefined,
        lastName: dto.lastName ?? undefined,
        displayName: dto.displayName ?? undefined,
        avatarUrl: dto.avatarUrl ?? undefined,
        locale: dto.locale ?? undefined,
        timezone: dto.timezone ?? undefined,
      },
      select: PUBLIC_USER_SELECT,
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'users',
      entity: 'User',
      entityId: userId,
      description: 'Updated own profile',
      newValue: dto as Record<string, unknown>,
    });

    return updated;
  }

  async setStatus(schoolId: string, id: string, status: UserStatus, reason?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, status: true, firstName: true, lastName: true },
    });
    if (!user) throw new NotFoundError('User');

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        status,
        // Reactivating clears any lockout left over from failed attempts.
        ...(status === UserStatus.ACTIVE ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
      },
      select: PUBLIC_USER_SELECT,
    });

    // A deactivated account must lose access immediately.
    if (status !== UserStatus.ACTIVE) {
      await this.tokens.revokeAllForUser(id, `status_${status.toLowerCase()}`);
    }

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'users',
      entity: 'User',
      entityId: id,
      description: `Account status changed to ${status}${reason ? `: ${reason}` : ''}`,
      oldValue: { status: user.status },
      newValue: { status },
      schoolId,
    });

    return updated;
  }

  /** Issues a new temporary password and forces a change at next sign-in. */
  async resetPassword(schoolId: string, id: string, notify = true) {
    const user = await this.prisma.user.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, email: true, firstName: true },
    });
    if (!user) throw new NotFoundError('User');

    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await this.tokens.revokeAllForUser(id, 'password_reset_by_admin');

    if (notify && user.email) {
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
      });

      await this.notifications.sendEmail({
        to: user.email,
        subject: 'Your password has been reset',
        template: 'account-created',
        data: {
          firstName: user.firstName,
          schoolName: school?.name ?? '',
          roleName: '',
          username: user.email,
          temporaryPassword,
          loginUrl: `${this.config.get<string>('app.webUrl')}/login`,
        },
      });
    }

    this.audit.record({
      action: AuditAction.PASSWORD_RESET,
      module: 'users',
      entity: 'User',
      entityId: id,
      description: 'Password reset by an administrator',
      schoolId,
    });

    // The password is returned only when it cannot be emailed, so an admin can
    // hand it over in person.
    return {
      reset: true,
      emailed: notify && Boolean(user.email),
      temporaryPassword: notify && user.email ? undefined : temporaryPassword,
    };
  }

  async unlock(schoolId: string, id: string) {
    const result = await this.prisma.user.updateMany({
      where: { id, schoolId, deletedAt: null },
      data: { failedLoginAttempts: 0, lockedUntil: null, status: UserStatus.ACTIVE },
    });
    if (result.count === 0) throw new NotFoundError('User');

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'users',
      entity: 'User',
      entityId: id,
      description: 'Account unlocked',
      schoolId,
    });

    return { unlocked: true };
  }

  /**
   * Soft-deletes a user. Their linked domain record (student, staff, guardian)
   * is left intact so historical attendance, marks and invoices keep resolving.
   */
  async remove(schoolId: string, id: string, actingUserId: string) {
    if (id === actingUserId) {
      throw new BadRequestError('You cannot delete your own account', ErrorCode.BUSINESS_RULE_VIOLATION);
    }

    const user = await this.prisma.user.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        roles: { select: { role: { select: { type: true } } } },
      },
    });
    if (!user) throw new NotFoundError('User');

    // Never let the last administrator be removed.
    const isAdmin = user.roles.some((entry) => entry.role.type === RoleType.SCHOOL_ADMIN);
    if (isAdmin) {
      const remaining = await this.prisma.user.count({
        where: {
          schoolId,
          deletedAt: null,
          status: UserStatus.ACTIVE,
          id: { not: id },
          roles: { some: { role: { type: RoleType.SCHOOL_ADMIN } } },
        },
      });
      if (remaining === 0) {
        throw new ForbiddenError(
          'This is the only active school administrator. Create another one before deleting this account.',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: UserStatus.INACTIVE,
          // Free the identifiers so they can be reused by a new account.
          email: user.email ? `deleted+${id}@invalid.local` : null,
          phone: null,
        },
      }),
      this.prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'user_deleted' },
      }),
      this.prisma.device.deleteMany({ where: { userId: id } }),
    ]);

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'users',
      entity: 'User',
      entityId: id,
      description: `Deleted user "${[user.firstName, user.lastName].filter(Boolean).join(' ')}"`,
      schoolId,
    });

    return { deleted: true };
  }

  async statistics(schoolId: string) {
    const [byStatus, byRole, total, activeToday] = await this.prisma.$transaction([
      this.prisma.user.groupBy({
        by: ['status'],
        where: { schoolId, deletedAt: null },
        orderBy: undefined,
        _count: true,
      }),
      this.prisma.userRole.groupBy({
        by: ['roleId'],
        where: { user: { schoolId, deletedAt: null } },
        orderBy: undefined,
        _count: true,
      }),
      this.prisma.user.count({ where: { schoolId, deletedAt: null } }),
      this.prisma.user.count({
        where: {
          schoolId,
          deletedAt: null,
          lastLoginAt: { gte: new Date(Date.now() - 86_400_000) },
        },
      }),
    ]);

    const roles = await this.prisma.role.findMany({
      where: { schoolId },
      select: { id: true, name: true, type: true },
    });
    const roleById = new Map(roles.map((role) => [role.id, role]));

    return {
      total,
      activeToday,
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
      byRole: byRole.map((row) => ({
        role: roleById.get(row.roleId)?.type ?? 'UNKNOWN',
        name: roleById.get(row.roleId)?.name ?? 'Unknown',
        count: row._count,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers used by other domain services
  // -------------------------------------------------------------------------

  /**
   * Creates the login account that backs a student, guardian or staff record.
   * Called from within those services' transactions so the person and their
   * account are created atomically.
   */
  async createLinkedAccount(
    tx: TransactionClient,
    input: {
      schoolId: string;
      email?: string | null;
      phone?: string | null;
      firstName: string;
      middleName?: string | null;
      lastName?: string | null;
      roleType: RoleType;
      password?: string;
      status?: UserStatus;
    },
  ): Promise<{ userId: string; temporaryPassword: string | null }> {
    const role = await tx.role.findFirst({
      where: { schoolId: input.schoolId, type: input.roleType },
      select: { id: true },
    });
    if (!role) {
      throw new BadRequestError(
        `The ${input.roleType} role is not configured for this school`,
      );
    }

    const temporaryPassword = input.password ?? this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const user = await tx.user.create({
      data: {
        schoolId: input.schoolId,
        email: input.email ?? null,
        phone: input.phone ?? null,
        passwordHash,
        firstName: input.firstName,
        middleName: input.middleName ?? null,
        lastName: input.lastName ?? null,
        status: input.status ?? UserStatus.ACTIVE,
        mustChangePassword: !input.password,
        roles: { create: { roleId: role.id } },
      },
      select: { id: true },
    });

    return { userId: user.id, temporaryPassword: input.password ? null : temporaryPassword };
  }

  private async assertIdentifiersFree(
    schoolId: string,
    email?: string | null,
    phone?: string | null,
    excludeUserId?: string,
  ): Promise<void> {
    const conditions: Prisma.UserWhereInput[] = [];
    if (email) conditions.push({ email });
    if (phone) conditions.push({ phone });
    if (conditions.length === 0) return;

    const clash = await this.prisma.user.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        OR: conditions,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { email: true, phone: true },
    });

    if (clash) {
      throw new ConflictError(
        clash.email === email
          ? 'An account with this email address already exists in this school'
          : 'An account with this mobile number already exists in this school',
      );
    }
  }
}
