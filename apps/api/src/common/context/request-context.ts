import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
  userId?: string;
  /** Tenant the request is operating within. Undefined for platform routes. */
  schoolId?: string;
  roles?: string[];
  permissions?: Set<string>;
  isSuperAdmin?: boolean;
  /** Set when a super admin is acting as another user. */
  impersonatedById?: string;
  ipAddress?: string;
  userAgent?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Ambient per-request state. Used by the logger, the audit interceptor and the
 * Prisma tenant guard so that they do not need the request object threaded
 * through every call site.
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return storage.run(store, callback);
  },

  get(): RequestContextStore | undefined {
    return storage.getStore();
  },

  require(): RequestContextStore {
    const store = storage.getStore();
    if (!store) {
      throw new Error('RequestContext accessed outside of a request scope');
    }
    return store;
  },

  set<K extends keyof RequestContextStore>(key: K, value: RequestContextStore[K]): void {
    const store = storage.getStore();
    if (store) store[key] = value;
  },

  get schoolId(): string | undefined {
    return storage.getStore()?.schoolId;
  },

  get userId(): string | undefined {
    return storage.getStore()?.userId;
  },

  get requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
