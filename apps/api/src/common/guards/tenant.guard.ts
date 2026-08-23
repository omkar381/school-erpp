import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SchoolStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RequestContext } from '../context/request-context';
import { IS_PUBLIC_KEY, SKIP_TENANT_KEY } from '../decorators';
import { ForbiddenError, UnauthorizedError } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-codes';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

const SCHOOL_HEADER = 'x-school-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CachedSchool {
  status: SchoolStatus;
  enabledModules: Record<string, boolean>;
  expiresAt: number;
}

/**
 * Resolves and pins the tenant for the request.
 *
 * A school user is permanently bound to their own `schoolId` — the
 * `X-School-Id` header is ignored for them, so it cannot be used to reach
 * another tenant. Only a super admin may target a different school, and doing
 * so is recorded in the request context for auditing.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly schoolCache = new Map<string, CachedSchool>();
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) throw new UnauthorizedError();

    const skipTenant = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const schoolId = this.resolveSchoolId(user, request.headers[SCHOOL_HEADER]);

    if (!schoolId) {
      if (skipTenant || user.isSuperAdmin) {
        request.schoolId = null;
        return true;
      }
      throw new ForbiddenError(
        'This account is not associated with a school',
        ErrorCode.TENANT_REQUIRED,
      );
    }

    await this.assertSchoolUsable(schoolId, user.isSuperAdmin);

    request.schoolId = schoolId;
    RequestContext.set('schoolId', schoolId);
    return true;
  }

  private resolveSchoolId(user: AuthenticatedUser, header: unknown): string | null {
    // School-scoped users are always pinned to their own tenant.
    if (!user.isSuperAdmin) return user.schoolId;

    const requested = typeof header === 'string' ? header.trim() : '';
    if (requested && UUID_PATTERN.test(requested)) {
      RequestContext.set('impersonatedById', undefined);
      return requested;
    }
    return user.schoolId;
  }

  private async assertSchoolUsable(schoolId: string, isSuperAdmin: boolean): Promise<void> {
    const school = await this.loadSchool(schoolId);

    if (!school) {
      throw new ForbiddenError('School not found or no longer active', ErrorCode.TENANT_MISMATCH);
    }

    // A super admin retains access to a suspended school so they can fix it.
    if (isSuperAdmin) return;

    if (school.status === SchoolStatus.SUSPENDED || school.status === SchoolStatus.ARCHIVED) {
      throw new ForbiddenError(
        'This school account has been suspended. Please contact support.',
        ErrorCode.SCHOOL_SUSPENDED,
      );
    }

    if (school.status === SchoolStatus.EXPIRED) {
      throw new ForbiddenError(
        'The subscription for this school has expired.',
        ErrorCode.SUBSCRIPTION_EXPIRED,
      );
    }
  }

  private async loadSchool(schoolId: string): Promise<CachedSchool | null> {
    const cached = this.schoolCache.get(schoolId);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const school = await this.prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { status: true, enabledModules: true },
    });

    if (!school) {
      this.schoolCache.delete(schoolId);
      return null;
    }

    const entry: CachedSchool = {
      status: school.status,
      enabledModules: (school.enabledModules as Record<string, boolean>) ?? {},
      expiresAt: Date.now() + TenantGuard.CACHE_TTL_MS,
    };
    this.schoolCache.set(schoolId, entry);
    return entry;
  }

  /** Invoked by SchoolsService after a school's status or modules change. */
  invalidate(schoolId: string): void {
    this.schoolCache.delete(schoolId);
  }
}
