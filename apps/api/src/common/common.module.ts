import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ModuleGuard } from './guards/module.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { TenantGuard } from './guards/tenant.guard';
import { SequenceService } from './services/sequence.service';

/**
 * Provides the guard singletons and cross-cutting services.
 *
 * The guards live here rather than in AppModule so that services can inject
 * them (SchoolsService invalidates the tenant and module caches on change) and
 * receive the very same instance the request pipeline uses.
 */
@Global()
@Module({
  providers: [JwtAuthGuard, TenantGuard, ModuleGuard, PermissionsGuard, SequenceService],
  exports: [JwtAuthGuard, TenantGuard, ModuleGuard, PermissionsGuard, SequenceService],
})
export class CommonModule {}
