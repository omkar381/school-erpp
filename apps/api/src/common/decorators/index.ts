import { SetMetadata, createParamDecorator, ExecutionContext, applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { RoleType } from '@prisma/client';
import type { PermissionKey } from '../constants/permissions';
import type { ModuleKey } from '../constants/modules';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const PERMISSIONS_KEY = 'auth:permissions';
export const PERMISSIONS_MODE_KEY = 'auth:permissionsMode';
export const ROLES_KEY = 'auth:roles';
export const MODULE_KEY = 'auth:module';
export const SKIP_TENANT_KEY = 'auth:skipTenant';
export const AUDIT_KEY = 'audit:config';

/** Marks a route as reachable without authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires the caller to hold the listed permissions.
 * `mode: 'any'` passes when at least one is held; the default requires all.
 */
export const RequirePermissions = (
  ...permissions: PermissionKey[]
) => SetMetadata(PERMISSIONS_KEY, permissions);

export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, 'any'),
  );

/** Restricts a route to specific role types, independent of permissions. */
export const RequireRoles = (...roles: RoleType[]) => SetMetadata(ROLES_KEY, roles);

/** Rejects the request when the school has this feature module disabled. */
export const RequireModule = (module: ModuleKey) => SetMetadata(MODULE_KEY, module);

/** Allows a platform route to run without an active tenant context. */
export const SkipTenantCheck = () => SetMetadata(SKIP_TENANT_KEY, true);

export interface AuditOptions {
  action: string;
  module: string;
  entity: string;
  /** Where to find the entity id: a params key, or a path into the response body. */
  entityIdFrom?: string;
  description?: string;
}

/** Records a durable audit-log entry when the route succeeds. */
export const Audit = (options: AuditOptions) => SetMetadata(AUDIT_KEY, options);

/** Injects the authenticated user (or one of its properties). */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) return undefined;
    return property ? user[property] : user;
  },
);

/**
 * Injects the tenant id the request is operating within.
 * For school users this is their own schoolId; a super admin may target another
 * school by supplying the `X-School-Id` header.
 */
export const CurrentSchool = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.schoolId as string | undefined;
});

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return (
    (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    request.ip ??
    request.socket?.remoteAddress
  );
});

export const UserAgent = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest().headers['user-agent'],
);

/** Documents the optional super-admin tenant override header in Swagger. */
export const ApiSchoolHeader = () =>
  ApiHeader({
    name: 'X-School-Id',
    required: false,
    description: 'Target school id. Super administrators only.',
  });
