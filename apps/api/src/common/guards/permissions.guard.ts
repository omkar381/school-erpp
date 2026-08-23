import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleType } from '@prisma/client';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, PERMISSIONS_MODE_KEY, ROLES_KEY } from '../decorators';
import { ForbiddenError, UnauthorizedError } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-codes';
import type { PermissionKey } from '../constants/permissions';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Enforces the permission and role requirements declared on a route.
 *
 * This runs on the server for every request. The web and mobile clients also
 * hide unauthorised features, but that is purely a UX affordance — access is
 * decided here.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<RoleType[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length && !requiredRoles?.length) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new UnauthorizedError();

    // The super admin role is the platform owner and bypasses granular checks.
    if (user.isSuperAdmin) return true;

    if (requiredRoles?.length) {
      const hasRole = requiredRoles.some((role) => user.roles.includes(role));
      if (!hasRole) {
        throw new ForbiddenError(
          'Your role does not allow this action',
          ErrorCode.FORBIDDEN,
          { requiredRoles, userRoles: user.roles },
        );
      }
    }

    if (required?.length) {
      const mode = this.reflector.getAllAndOverride<'any' | 'all'>(PERMISSIONS_MODE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      const held = new Set(user.permissions);
      const satisfied =
        mode === 'any'
          ? required.some((permission) => held.has(permission))
          : required.every((permission) => held.has(permission));

      if (!satisfied) {
        const missing = required.filter((permission) => !held.has(permission));
        throw new ForbiddenError(
          'You do not have permission to perform this action',
          ErrorCode.MISSING_PERMISSION,
          { required, missing, mode: mode ?? 'all' },
        );
      }
    }

    return true;
  }
}
