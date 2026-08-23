import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { RedisService } from '../../queue/redis.service';

type ComponentStatus = 'up' | 'down' | 'disabled';

interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  components: Record<string, ComponentHealth>;
  memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, cache] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    const components: Record<string, ComponentHealth> = { database, cache };
    const critical = [database];
    const status: HealthReport['status'] = critical.some((c) => c.status === 'down')
      ? 'error'
      : Object.values(components).some((c) => c.status === 'down')
        ? 'degraded'
        : 'ok';

    const memory = process.memoryUsage();

    return {
      status,
      version: process.env.npm_package_version ?? '1.0.0',
      environment: this.config.get<string>('app.env', 'development'),
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      components,
      memory: {
        heapUsedMb: Math.round(memory.heapUsed / 1_048_576),
        heapTotalMb: Math.round(memory.heapTotal / 1_048_576),
        rssMb: Math.round(memory.rss / 1_048_576),
      },
    };
  }

  /**
   * Readiness gates traffic: if the database is unreachable the instance should
   * be pulled from the load balancer rather than serving errors.
   */
  async readiness(): Promise<{ status: string }> {
    const database = await this.checkDatabase();
    if (database.status === 'down') {
      throw new ServiceUnavailableException({ status: 'not_ready', reason: 'database' });
    }
    return { status: 'ready' };
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return { status: 'down', message: 'Unable to reach the database' };
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    if (!this.redis.isEnabled()) return { status: 'disabled' };

    const startedAt = Date.now();
    try {
      await this.redis.ping();
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch {
      return { status: 'down', message: 'Unable to reach Redis' };
    }
  }
}
