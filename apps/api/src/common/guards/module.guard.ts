import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service';
import {
  CORE_MODULES,
  MODULE_LABELS,
  isModuleEnabled,
  type ModuleKey,
} from '../constants/modules';
import { IS_PUBLIC_KEY, MODULE_KEY } from '../decorators';
import { ForbiddenError } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-codes';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

interface CacheEntry {
  modules: Record<string, boolean>;
  expiresAt: number;
}

/**
 * Blocks routes belonging to a feature module the school has turned off (or
 * that its subscription plan does not include). Core modules are always on.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  private readonly cache = new Map<string, CacheEntry>();
  private static readonly TTL_MS = 60_000;

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

    const required = this.reflector.getAllAndOverride<ModuleKey>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || CORE_MODULES.includes(required)) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    const schoolId = request.schoolId as string | undefined;

    if (user?.isSuperAdmin) return true;
    if (!schoolId) return true;

    const modules = await this.loadModules(schoolId);

    if (!isModuleEnabled(modules, required)) {
      throw new ForbiddenError(
        `The ${MODULE_LABELS[required] ?? required} module is not enabled for your school`,
        ErrorCode.MODULE_DISABLED,
        { module: required },
      );
    }

    return true;
  }

  private async loadModules(schoolId: string): Promise<Record<string, boolean>> {
    const cached = this.cache.get(schoolId);
    if (cached && cached.expiresAt > Date.now()) return cached.modules;

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { enabledModules: true },
    });

    const modules = (school?.enabledModules as Record<string, boolean>) ?? {};
    this.cache.set(schoolId, { modules, expiresAt: Date.now() + ModuleGuard.TTL_MS });
    return modules;
  }

  invalidate(schoolId: string): void {
    this.cache.delete(schoolId);
  }
}
