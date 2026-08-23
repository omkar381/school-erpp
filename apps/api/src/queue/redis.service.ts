import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppLogger } from '../common/logger/app-logger.service';

/**
 * Shared Redis connection used for caching, distributed locks and BullMQ.
 *
 * Redis is optional: when it is unavailable the application keeps running with
 * caching disabled and jobs executed inline, so a local developer does not need
 * to run it. `isEnabled()` reports the current state.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private available = false;
  private readonly prefix: string;
  private readonly log: AppLogger;

  constructor(
    private readonly config: ConfigService,
    logger: AppLogger,
  ) {
    this.log = logger.child('RedisService');
    this.prefix = config.get<string>('redis.prefix', 'erp');
  }

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('redis.url');
    if (!url) {
      this.log.warn('REDIS_URL is not set; caching and background jobs run in degraded mode');
      return;
    }

    this.client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (attempt) => (attempt > 10 ? null : Math.min(attempt * 200, 3_000)),
    });

    this.client.on('ready', () => {
      this.available = true;
      this.log.info('Redis connection established');
    });
    this.client.on('error', (error) => {
      if (this.available) this.log.error('Redis connection error', error);
      this.available = false;
    });
    this.client.on('end', () => {
      this.available = false;
    });

    try {
      await this.client.connect();
    } catch (error) {
      this.log.warn('Could not connect to Redis; continuing without it', {
        error: (error as Error).message,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  isEnabled(): boolean {
    return this.available && this.client !== null;
  }

  /** Raw client for BullMQ, which needs to manage its own commands. */
  getClient(): Redis | null {
    return this.client;
  }

  async ping(): Promise<string> {
    if (!this.client) throw new Error('Redis is not configured');
    return this.client.ping();
  }

  private key(key: string): string {
    return `${this.prefix}:${key}`;
  }

  // ---------------------------------------------------------------------------
  // Cache helpers — all no-op safely when Redis is unavailable
  // ---------------------------------------------------------------------------

  async get<T>(key: string): Promise<T | null> {
    if (!this.isEnabled()) return null;
    try {
      const raw = await this.client!.get(this.key(key));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const payload = JSON.stringify(value);
      const ttl = ttlSeconds ?? this.config.get<number>('redis.cacheTtlSeconds', 60);
      await this.client!.set(this.key(key), payload, 'EX', ttl);
    } catch {
      // Cache writes are best-effort.
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.isEnabled() || keys.length === 0) return;
    try {
      await this.client!.del(...keys.map((key) => this.key(key)));
    } catch {
      // ignored
    }
  }

  /** Deletes every key matching a pattern, using SCAN to avoid blocking Redis. */
  async delPattern(pattern: string): Promise<number> {
    if (!this.isEnabled()) return 0;

    let cursor = '0';
    let deleted = 0;
    const match = this.key(pattern);

    try {
      do {
        const [next, keys] = await this.client!.scan(cursor, 'MATCH', match, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await this.client!.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');
    } catch {
      // ignored
    }

    return deleted;
  }

  /** Read-through cache helper. */
  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    if (!this.isEnabled()) return 0;
    try {
      const full = this.key(key);
      const value = await this.client!.incr(full);
      if (value === 1 && ttlSeconds) await this.client!.expire(full, ttlSeconds);
      return value;
    } catch {
      return 0;
    }
  }

  /**
   * Best-effort distributed lock. Returns a release function, or null when the
   * lock is already held. Callers must treat "not acquired" as a normal outcome.
   */
  async acquireLock(name: string, ttlSeconds = 30): Promise<(() => Promise<void>) | null> {
    if (!this.isEnabled()) return async () => undefined;

    const full = this.key(`lock:${name}`);
    const token = `${process.pid}-${Date.now()}-${Math.random()}`;

    try {
      const acquired = await this.client!.set(full, token, 'EX', ttlSeconds, 'NX');
      if (!acquired) return null;

      return async () => {
        // Only release the lock if we still own it.
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end`;
        await this.client!.eval(script, 1, full, token).catch(() => undefined);
      };
    } catch {
      return null;
    }
  }
}
