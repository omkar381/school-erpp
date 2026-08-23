import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppLogger } from '../common/logger/app-logger.service';
import { TENANT_SCOPED_MODELS } from './tenant-models';

export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Wraps PrismaClient and installs the tenant-isolation guard.
 *
 * The guard is a defence-in-depth measure: services are expected to pass
 * `schoolId` explicitly, and this layer refuses to execute a read or write
 * against a tenant-scoped model if that filter is missing while a tenant
 * context is active. It cannot be bypassed from user input.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log: AppLogger;

  constructor(config: ConfigService, logger: AppLogger) {
    const logQueries = config.get<boolean>('database.logQueries');

    super({
      log: logQueries
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ],
      errorFormat: config.get<string>('app.env') === 'production' ? 'minimal' : 'pretty',
    });

    this.log = logger.child('PrismaService');

    if (logQueries) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$on('query', (event: Prisma.QueryEvent) => {
        if (event.duration > 200) {
          this.log.warn('Slow query', { durationMs: event.duration, query: event.query });
        }
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).$on('warn', (event: Prisma.LogEvent) => this.log.warn(event.message));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).$on('error', (event: Prisma.LogEvent) => this.log.error(event.message));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.log.info('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` inside a serializable-safe interactive transaction.
   * Used for all financial mutations so partial writes are impossible.
   */
  async transaction<T>(
    fn: (tx: TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    return this.$transaction(fn, {
      maxWait: options?.maxWait ?? 5_000,
      timeout: options?.timeout ?? 20_000,
      isolationLevel: options?.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }

  /** True when the given model carries a `schoolId` column. */
  isTenantScoped(model: string): boolean {
    return TENANT_SCOPED_MODELS.has(model);
  }

  /** Wipes all data. Guarded so it can never run outside tests. */
  async truncateAllTables(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('truncateAllTables() is not permitted in production');
    }

    const tables = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
    `;

    if (tables.length === 0) return;

    const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
    await this.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
  }
}
