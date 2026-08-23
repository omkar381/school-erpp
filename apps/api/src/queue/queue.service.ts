import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobStatus, Prisma } from '@prisma/client';
import { Queue, type JobsOptions } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { AppLogger } from '../common/logger/app-logger.service';
import { NotFoundError } from '../common/exceptions/app.exception';
import { RedisService } from './redis.service';
import { DEFAULT_JOB_OPTIONS, QUEUES, type JobName, type QueueName } from './queue.constants';

export interface EnqueueOptions extends JobsOptions {
  /** Records a JobRun row so clients can poll progress. Defaults to true. */
  track?: boolean;
  schoolId?: string | null;
  requestedById?: string | null;
}

export interface EnqueueResult {
  /** Null when the job ran inline because the queue was unavailable. */
  jobId: string | null;
  jobRunId: string | null;
  queued: boolean;
}

type InlineHandler = (payload: unknown, jobRunId: string | null) => Promise<unknown>;

/**
 * Facade over BullMQ.
 *
 * When Redis is not available the service degrades to executing the registered
 * handler inline. That keeps every feature working on a bare `npm run dev`
 * machine, while production gets real background processing.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  private readonly inlineHandlers = new Map<string, InlineHandler>();
  private readonly log: AppLogger;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    logger: AppLogger,
  ) {
    this.log = logger.child('QueueService');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close().catch(() => undefined)));
  }

  isEnabled(): boolean {
    return this.config.get<boolean>('queue.enabled', true) && this.redis.isEnabled();
  }

  /**
   * Registers the inline fallback for a job. Processors call this at startup so
   * the same code path serves both queued and inline execution.
   */
  registerInlineHandler(queue: QueueName, job: JobName, handler: InlineHandler): void {
    this.inlineHandlers.set(`${queue}:${job}`, handler);
  }

  async enqueue<T extends object>(
    queueName: QueueName,
    jobName: JobName,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    const { track = true, schoolId, requestedById, ...jobOptions } = options;

    const jobRun = track
      ? await this.prisma.jobRun.create({
          data: {
            schoolId: schoolId ?? null,
            queue: queueName,
            jobName,
            status: JobStatus.QUEUED,
            payload: payload as Prisma.InputJsonValue,
            requestedById: requestedById ?? null,
          },
          select: { id: true },
        })
      : null;

    if (!this.isEnabled()) {
      return this.runInline(queueName, jobName, payload, jobRun?.id ?? null);
    }

    try {
      const queue = this.getQueue(queueName);
      const job = await queue.add(
        jobName,
        { ...payload, __jobRunId: jobRun?.id ?? null },
        { ...DEFAULT_JOB_OPTIONS, ...jobOptions },
      );

      if (jobRun) {
        await this.prisma.jobRun.update({
          where: { id: jobRun.id },
          data: { jobId: job.id ?? null },
        });
      }

      return { jobId: job.id ?? null, jobRunId: jobRun?.id ?? null, queued: true };
    } catch (error) {
      this.log.error('Failed to enqueue job; falling back to inline execution', error, {
        queue: queueName,
        job: jobName,
      });
      return this.runInline(queueName, jobName, payload, jobRun?.id ?? null);
    }
  }

  /** Schedules a repeating job. Idempotent — re-registering replaces the schedule. */
  async schedule(
    queueName: QueueName,
    jobName: JobName,
    cron: string,
    payload: object = {},
  ): Promise<void> {
    if (!this.isEnabled()) {
      this.log.debug('Skipping repeatable job registration; queue unavailable', { jobName });
      return;
    }

    try {
      const queue = this.getQueue(queueName);
      await queue.add(jobName, payload, {
        ...DEFAULT_JOB_OPTIONS,
        repeat: { pattern: cron },
        jobId: `repeat:${jobName}`,
      });
      this.log.info('Repeatable job registered', { queue: queueName, job: jobName, cron });
    } catch (error) {
      this.log.error('Failed to register repeatable job', error, { job: jobName });
    }
  }

  getQueue(name: QueueName): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;

    const connection = this.redis.getClient();
    if (!connection) throw new Error('Redis connection is not available');

    const queue = new Queue(name, {
      connection,
      prefix: `${this.config.get<string>('redis.prefix', 'erp')}:bull`,
    });
    this.queues.set(name, queue);
    return queue;
  }

  // ---------------------------------------------------------------------------
  // Job run tracking
  // ---------------------------------------------------------------------------

  async markRunning(jobRunId: string, total?: number): Promise<void> {
    await this.prisma.jobRun
      .update({
        where: { id: jobRunId },
        data: { status: JobStatus.RUNNING, startedAt: new Date(), total: total ?? undefined },
      })
      .catch(() => undefined);
  }

  async updateProgress(
    jobRunId: string,
    processed: number,
    total?: number,
    counters?: { succeeded?: number; failed?: number },
  ): Promise<void> {
    const progress = total && total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    await this.prisma.jobRun
      .update({
        where: { id: jobRunId },
        data: {
          processed,
          progress,
          ...(total !== undefined ? { total } : {}),
          ...(counters?.succeeded !== undefined ? { succeeded: counters.succeeded } : {}),
          ...(counters?.failed !== undefined ? { failed: counters.failed } : {}),
        },
      })
      .catch(() => undefined);
  }

  async markCompleted(
    jobRunId: string,
    result?: unknown,
    resultStorageKey?: string,
  ): Promise<void> {
    await this.prisma.jobRun
      .update({
        where: { id: jobRunId },
        data: {
          status: JobStatus.COMPLETED,
          progress: 100,
          finishedAt: new Date(),
          result: (result ?? null) as Prisma.InputJsonValue,
          resultStorageKey: resultStorageKey ?? null,
        },
      })
      .catch(() => undefined);
  }

  async markFailed(jobRunId: string, error: unknown): Promise<void> {
    await this.prisma.jobRun
      .update({
        where: { id: jobRunId },
        data: {
          status: JobStatus.FAILED,
          finishedAt: new Date(),
          errors: [
            { message: error instanceof Error ? error.message : String(error) },
          ] as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }

  async getJobRun(schoolId: string | null, jobRunId: string) {
    const jobRun = await this.prisma.jobRun.findFirst({
      where: { id: jobRunId, ...(schoolId ? { schoolId } : {}) },
    });
    if (!jobRun) throw new NotFoundError('Job');
    return jobRun;
  }

  async listJobRuns(schoolId: string | null, limit = 25) {
    return this.prisma.jobRun.findMany({
      where: { ...(schoolId ? { schoolId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ---------------------------------------------------------------------------

  private async runInline<T extends object>(
    queueName: QueueName,
    jobName: JobName,
    payload: T,
    jobRunId: string | null,
  ): Promise<EnqueueResult> {
    const handler = this.inlineHandlers.get(`${queueName}:${jobName}`);

    if (!handler) {
      this.log.warn('No inline handler registered for job; it will not run', {
        queue: queueName,
        job: jobName,
      });
      if (jobRunId) await this.markFailed(jobRunId, new Error('No handler registered'));
      return { jobId: null, jobRunId, queued: false };
    }

    // Deliberately not awaited: callers must not block on background work.
    void (async () => {
      try {
        if (jobRunId) await this.markRunning(jobRunId);
        const result = await handler(payload, jobRunId);
        if (jobRunId) await this.markCompleted(jobRunId, result);
      } catch (error) {
        this.log.error('Inline job failed', error, { queue: queueName, job: jobName });
        if (jobRunId) await this.markFailed(jobRunId, error);
      }
    })();

    return { jobId: null, jobRunId, queued: false };
  }
}

export { QUEUES };
