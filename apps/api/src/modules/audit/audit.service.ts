import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RequestContext } from '../../common/context/request-context';
import { AppLogger } from '../../common/logger/app-logger.service';
import { redact } from '../../common/logger/app-logger.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';

export interface AuditRecordInput {
  action: AuditAction;
  module: string;
  entity: string;
  entityId?: string | null;
  description?: string;
  oldValue?: unknown;
  newValue?: unknown;
  /** Overrides the ambient request context when logging outside a request. */
  schoolId?: string | null;
  userId?: string | null;
}

export interface AuditQuery extends PaginationQueryDto {
  action?: AuditAction;
  module?: string;
  entity?: string;
  entityId?: string;
  userId?: string;
  from?: string;
  to?: string;
}

/**
 * Durable record of every sensitive action.
 *
 * Writes are deliberately non-blocking and never propagate failures: an audit
 * outage must not take down the operation being audited. Failures are logged so
 * they remain visible.
 */
@Injectable()
export class AuditService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    logger: AppLogger,
  ) {
    this.log = logger.child('AuditService');
  }

  /** Fire-and-forget audit write. Safe to call from any service. */
  record(input: AuditRecordInput): void {
    void this.recordAsync(input);
  }

  async recordAsync(input: AuditRecordInput): Promise<void> {
    const context = RequestContext.get();

    try {
      await this.prisma.auditLog.create({
        data: {
          schoolId: input.schoolId !== undefined ? input.schoolId : (context?.schoolId ?? null),
          userId: input.userId !== undefined ? input.userId : (context?.userId ?? null),
          action: input.action,
          module: input.module,
          entity: input.entity,
          entityId: input.entityId ?? null,
          description: input.description ?? null,
          oldValue: this.serialize(input.oldValue),
          newValue: this.serialize(input.newValue),
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent?.slice(0, 500) ?? null,
          requestId: context?.requestId ?? null,
          impersonatedById: context?.impersonatedById ?? null,
        },
      });
    } catch (error) {
      this.log.error('Failed to write audit log entry', error, {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
      });
    }
  }

  /**
   * Computes a minimal before/after diff so audit rows stay small and
   * reviewable rather than storing two full entity snapshots.
   */
  diff(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
  ): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } {
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};

    if (!before || !after) {
      return { oldValue: before ?? {}, newValue: after ?? {} };
    }

    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = before[key];
      const b = after[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        oldValue[key] = a;
        newValue[key] = b;
      }
    }

    return { oldValue, newValue };
  }

  async findMany(schoolId: string | null, query: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(schoolId ? { schoolId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.module ? { module: query.module } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search, mode: 'insensitive' } },
              { entity: { contains: query.search, mode: 'insensitive' } },
              { entityId: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: query.sortOrder },
        select: {
          id: true,
          action: true,
          module: true,
          entity: true,
          entityId: true,
          description: true,
          oldValue: true,
          newValue: true,
          ipAddress: true,
          userAgent: true,
          requestId: true,
          createdAt: true,
          user: {
            select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  private serialize(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    return redact(value) as Prisma.InputJsonValue;
  }
}
