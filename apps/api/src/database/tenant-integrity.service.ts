import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger } from '../common/logger/app-logger.service';
import { CHILD_MODELS, NULLABLE_TENANT_MODELS, TENANT_SCOPED_MODELS } from './tenant-models';

/**
 * Boot-time consistency check between the Prisma schema and the hand-maintained
 * tenant model registry.
 *
 * If someone adds a model with a `schoolId` column but forgets to register it,
 * every query against it would run unscoped. Rather than discover that in
 * production, the application refuses to start.
 */
@Injectable()
export class TenantIntegrityService implements OnApplicationBootstrap {
  constructor(private readonly logger: AppLogger) {}

  onApplicationBootstrap(): void {
    const { unregistered, phantom, nullabilityMismatch } = this.audit();

    if (unregistered.length > 0) {
      throw new Error(
        `Tenant registry is out of date. These models have a schoolId column but are not ` +
          `listed in TENANT_SCOPED_MODELS: ${unregistered.join(', ')}. ` +
          `Add them to src/database/tenant-models.ts before starting the server.`,
      );
    }

    if (phantom.length > 0) {
      throw new Error(
        `TENANT_SCOPED_MODELS lists models that have no schoolId column: ${phantom.join(', ')}.`,
      );
    }

    if (nullabilityMismatch.length > 0) {
      throw new Error(
        `NULLABLE_TENANT_MODELS does not match the schema for: ${nullabilityMismatch.join(', ')}.`,
      );
    }

    this.logger.info('Tenant model registry verified', {
      tenantScopedModels: TENANT_SCOPED_MODELS.size,
      childModels: CHILD_MODELS.size,
    });
  }

  audit(): { unregistered: string[]; phantom: string[]; nullabilityMismatch: string[] } {
    const models = Prisma.dmmf.datamodel.models;
    const unregistered: string[] = [];
    const phantom: string[] = [];
    const nullabilityMismatch: string[] = [];

    for (const model of models) {
      const schoolIdField = model.fields.find((field) => field.name === 'schoolId');
      const registered = TENANT_SCOPED_MODELS.has(model.name);

      if (schoolIdField && !registered) {
        unregistered.push(model.name);
        continue;
      }
      if (!schoolIdField && registered) {
        phantom.push(model.name);
        continue;
      }
      if (!schoolIdField) continue;

      const declaredNullable = NULLABLE_TENANT_MODELS.has(model.name);
      const actuallyNullable = !schoolIdField.isRequired;
      if (declaredNullable !== actuallyNullable) {
        nullabilityMismatch.push(
          `${model.name} (schema nullable=${actuallyNullable}, registry nullable=${declaredNullable})`,
        );
      }
    }

    return { unregistered, phantom, nullabilityMismatch };
  }
}
