import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, RoleType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import {
  ALL_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_LABELS,
  parsePermission,
  type PermissionKey,
} from '../../common/constants/permissions';
import { AuditService } from '../audit/audit.service';
import type {
  AssignRolesDto,
  CreateRoleDto,
  SetRolePermissionsDto,
  SetUserPermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';

/**
 * Permissions a school-scoped administrator can never grant, because they
 * belong to the platform operator rather than to any individual school.
 */
const PLATFORM_ONLY_PREFIX = 'platform.';

@Injectable()
export class RolesService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('RolesService');
  }

  // -------------------------------------------------------------------------
  // Catalogue
  // -------------------------------------------------------------------------

  /** The permission catalogue, grouped by module for the admin UI. */
  async listPermissions(includePlatform = false) {
    const permissions = await this.prisma.permission.findMany({
      where: includePlatform ? {} : { module: { not: 'platform' } },
      orderBy: [{ module: 'asc' }, { key: 'asc' }],
    });

    const grouped = new Map<string, typeof permissions>();
    for (const permission of permissions) {
      const bucket = grouped.get(permission.module) ?? [];
      bucket.push(permission);
      grouped.set(permission.module, bucket);
    }

    return [...grouped.entries()].map(([module, items]) => ({
      module,
      label: this.humanize(module),
      permissions: items.map((permission) => ({
        id: permission.id,
        key: permission.key,
        action: permission.action,
        description: permission.description,
      })),
    }));
  }

  async listRoles(schoolId: string) {
    const roles = await this.prisma.role.findMany({
      where: { schoolId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        type: true,
        name: true,
        description: true,
        isSystem: true,
        isDefault: true,
        createdAt: true,
        _count: { select: { userRoles: true, permissions: true } },
      },
    });

    return roles.map(({ _count, ...role }) => ({
      ...role,
      userCount: _count.userRoles,
      permissionCount: _count.permissions,
    }));
  }

  async getRole(schoolId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, schoolId },
      include: {
        permissions: { select: { permission: { select: { id: true, key: true, module: true } } } },
        _count: { select: { userRoles: true } },
      },
    });

    if (!role) throw new NotFoundError('Role');

    const { permissions, _count, ...rest } = role;
    return {
      ...rest,
      userCount: _count.userRoles,
      permissions: permissions.map((entry) => entry.permission),
      permissionKeys: permissions.map((entry) => entry.permission.key),
    };
  }

  // -------------------------------------------------------------------------
  // Role mutations
  // -------------------------------------------------------------------------

  async createRole(schoolId: string, dto: CreateRoleDto) {
    const existing = await this.prisma.role.findFirst({
      where: { schoolId, type: dto.type },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError(`A "${ROLE_LABELS[dto.type]}" role already exists for this school`);
    }

    const permissionIds = await this.resolvePermissionIds(dto.permissions ?? []);

    const role = await this.prisma.role.create({
      data: {
        schoolId,
        type: dto.type,
        name: dto.name,
        description: dto.description ?? null,
        isSystem: false,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      select: { id: true, name: true, type: true },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'roles',
      entity: 'Role',
      entityId: role.id,
      description: `Created role "${role.name}"`,
      newValue: { name: role.name, type: role.type, permissions: dto.permissions },
    });

    return this.getRole(schoolId, role.id);
  }

  async updateRole(schoolId: string, roleId: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, schoolId },
      select: { id: true, name: true, description: true, isSystem: true },
    });
    if (!role) throw new NotFoundError('Role');

    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: { name: dto.name ?? undefined, description: dto.description ?? undefined },
      select: { id: true, name: true, description: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'roles',
      entity: 'Role',
      entityId: roleId,
      description: `Updated role "${updated.name}"`,
      oldValue: { name: role.name, description: role.description },
      newValue: { name: updated.name, description: updated.description },
    });

    return updated;
  }

  /**
   * Replaces a role's permission set.
   *
   * Two invariants are enforced: a school role can never be granted a platform
   * permission, and the SCHOOL_ADMIN role must keep the permissions needed to
   * administer roles — otherwise a school could lock itself out of its own
   * permission management.
   */
  async setRolePermissions(schoolId: string, roleId: string, dto: SetRolePermissionsDto) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, schoolId },
      select: {
        id: true,
        type: true,
        name: true,
        isSystem: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });
    if (!role) throw new NotFoundError('Role');

    const requested = [...new Set(dto.permissions)];

    const platformKeys = requested.filter((key) => key.startsWith(PLATFORM_ONLY_PREFIX));
    if (platformKeys.length > 0) {
      throw new ForbiddenError(
        'Platform permissions cannot be granted to a school role',
        ErrorCode.MISSING_PERMISSION,
        { rejected: platformKeys },
      );
    }

    if (role.type === RoleType.SCHOOL_ADMIN) {
      const floor: PermissionKey[] = ['roles.view', 'roles.update', 'permissions.assign', 'users.view'] as PermissionKey[];
      const missing = floor.filter((key) => !requested.includes(key));
      if (missing.length > 0) {
        throw new BadRequestError(
          'The School Administrator role must retain role and permission management access, ' +
            'otherwise no one could restore it.',
          ErrorCode.BUSINESS_RULE_VIOLATION,
          { missing },
        );
      }
    }

    const permissionIds = await this.resolvePermissionIds(requested);
    const before = role.permissions.map((entry) => entry.permission.key);

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        skipDuplicates: true,
      }),
    ]);

    this.audit.record({
      action: AuditAction.PERMISSION_CHANGE,
      module: 'roles',
      entity: 'Role',
      entityId: roleId,
      description: `Changed permissions for role "${role.name}"`,
      oldValue: { permissions: before },
      newValue: { permissions: requested },
    });

    this.log.info('Role permissions updated', {
      roleId,
      added: requested.filter((key) => !before.includes(key)).length,
      removed: before.filter((key) => !requested.includes(key)).length,
    });

    return this.getRole(schoolId, roleId);
  }

  /** Restores a system role's factory permission set. */
  async resetRoleToDefaults(schoolId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, schoolId },
      select: { id: true, type: true, name: true },
    });
    if (!role) throw new NotFoundError('Role');

    const defaults = ROLE_DEFAULT_PERMISSIONS[role.type] ?? [];
    return this.setRolePermissions(schoolId, roleId, { permissions: [...defaults] });
  }

  async deleteRole(schoolId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, schoolId },
      select: { id: true, name: true, isSystem: true, _count: { select: { userRoles: true } } },
    });
    if (!role) throw new NotFoundError('Role');

    if (role.isSystem) {
      throw new ForbiddenError(
        'Built-in roles cannot be deleted. You can change their permissions instead.',
      );
    }
    if (role._count.userRoles > 0) {
      throw new ConflictError(
        `This role is assigned to ${role._count.userRoles} user(s). Reassign them before deleting it.`,
      );
    }

    await this.prisma.role.delete({ where: { id: roleId } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'roles',
      entity: 'Role',
      entityId: roleId,
      description: `Deleted role "${role.name}"`,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // User assignments
  // -------------------------------------------------------------------------

  async assignRoles(schoolId: string, userId: string, dto: AssignRolesDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, schoolId, deletedAt: null },
      select: { id: true, roles: { select: { role: { select: { id: true, type: true } } } } },
    });
    if (!user) throw new NotFoundError('User');

    const roles = await this.prisma.role.findMany({
      where: { id: { in: dto.roleIds }, schoolId },
      select: { id: true, type: true, name: true },
    });

    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestError('One or more roles do not exist in this school');
    }

    // SUPER_ADMIN is a platform role and is never assignable from a school.
    if (roles.some((role) => role.type === RoleType.SUPER_ADMIN)) {
      throw new ForbiddenError('The Super Administrator role cannot be assigned');
    }

    const before = user.roles.map((entry) => entry.role.type);

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      this.prisma.userRole.createMany({
        data: roles.map((role) => ({ userId, roleId: role.id })),
        skipDuplicates: true,
      }),
      // Roles changed: existing sessions keep working, but the principal is
      // rebuilt on the next request, so no token invalidation is needed.
    ]);

    this.audit.record({
      action: AuditAction.ROLE_CHANGE,
      module: 'roles',
      entity: 'User',
      entityId: userId,
      description: 'Changed user roles',
      oldValue: { roles: before },
      newValue: { roles: roles.map((role) => role.type) },
    });

    return { roles: roles.map(({ id, type, name }) => ({ id, type, name })) };
  }

  /**
   * Sets per-user permission overrides on top of their roles.
   * `effect: false` is an explicit deny that wins over any role grant.
   */
  async setUserPermissions(schoolId: string, userId: string, dto: SetUserPermissionsDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundError('User');

    const platformKeys = dto.overrides
      .filter((override) => override.key.startsWith(PLATFORM_ONLY_PREFIX))
      .map((override) => override.key);
    if (platformKeys.length > 0) {
      throw new ForbiddenError('Platform permissions cannot be granted to a school user');
    }

    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: dto.overrides.map((override) => override.key) } },
      select: { id: true, key: true },
    });
    const idByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

    const unknown = dto.overrides.filter((override) => !idByKey.has(override.key));
    if (unknown.length > 0) {
      throw new BadRequestError(
        `Unknown permission(s): ${unknown.map((override) => override.key).join(', ')}`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId } }),
      this.prisma.userPermission.createMany({
        data: dto.overrides.map((override) => ({
          userId,
          permissionId: idByKey.get(override.key)!,
          effect: override.effect,
        })),
        skipDuplicates: true,
      }),
    ]);

    this.audit.record({
      action: AuditAction.PERMISSION_CHANGE,
      module: 'roles',
      entity: 'User',
      entityId: userId,
      description: 'Changed user permission overrides',
      newValue: { overrides: dto.overrides },
    });

    return this.getUserPermissions(schoolId, userId);
  }

  /** Effective permissions for a user, showing where each grant comes from. */
  async getUserPermissions(schoolId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, schoolId, deletedAt: null },
      select: {
        roles: {
          select: {
            role: {
              select: {
                id: true,
                name: true,
                type: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
        permissions: { select: { effect: true, permission: { select: { key: true } } } },
      },
    });
    if (!user) throw new NotFoundError('User');

    const fromRoles = new Set<string>();
    for (const entry of user.roles) {
      for (const rolePermission of entry.role.permissions) {
        fromRoles.add(rolePermission.permission.key);
      }
    }

    const effective = new Set(fromRoles);
    const granted: string[] = [];
    const denied: string[] = [];

    for (const override of user.permissions) {
      if (override.effect) {
        effective.add(override.permission.key);
        granted.push(override.permission.key);
      } else {
        effective.delete(override.permission.key);
        denied.push(override.permission.key);
      }
    }

    return {
      roles: user.roles.map((entry) => ({
        id: entry.role.id,
        name: entry.role.name,
        type: entry.role.type,
      })),
      fromRoles: [...fromRoles].sort(),
      overrides: { granted, denied },
      effective: [...effective].sort(),
    };
  }

  // -------------------------------------------------------------------------
  // Seeding support
  // -------------------------------------------------------------------------

  /** Ensures the permissions table matches the code catalogue. Idempotent. */
  async syncPermissionCatalogue(): Promise<{ created: number; total: number }> {
    const existing = await this.prisma.permission.findMany({ select: { key: true } });
    const known = new Set(existing.map((permission) => permission.key));
    const missing = ALL_PERMISSIONS.filter((key) => !known.has(key));

    if (missing.length > 0) {
      await this.prisma.permission.createMany({
        data: missing.map((key) => {
          const { module, action } = parsePermission(key);
          return { key, module, action, description: this.describe(module, action) };
        }),
        skipDuplicates: true,
      });
    }

    return { created: missing.length, total: ALL_PERMISSIONS.length };
  }

  // -------------------------------------------------------------------------

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];

    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });

    const found = new Set(permissions.map((permission) => permission.key));
    const unknown = keys.filter((key) => !found.has(key));
    if (unknown.length > 0) {
      throw new BadRequestError(`Unknown permission(s): ${unknown.join(', ')}`);
    }

    return permissions.map((permission) => permission.id);
  }

  private humanize(value: string): string {
    return value
      .split(/[._]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private describe(module: string, action: string): string {
    return `${this.humanize(action)} — ${this.humanize(module)}`;
  }
}

export type { Prisma };
