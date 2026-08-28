import { SubscriptionStatus } from '@prisma/client';
import { UsageService } from './usage.service';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { AppException } from '../../common/exceptions/app.exception';

const PLAN = {
  id: 'plan-1',
  code: 'PROFESSIONAL',
  name: 'Professional',
  tier: 'PROFESSIONAL',
  maxStudents: 100,
  maxStaff: 20,
  storageMb: 1024,
};

function buildPrisma(overrides: {
  students?: number;
  staff?: number;
  documentBytes?: number;
  attachmentBytes?: number;
  limitOverrides?: Record<string, unknown>;
  subscription?: unknown;
}) {
  const subscription =
    overrides.subscription === undefined
      ? {
          id: 'sub-1',
          status: SubscriptionStatus.ACTIVE,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2027-01-01'),
          autoRenew: true,
          limitOverrides: overrides.limitOverrides ?? {},
          plan: PLAN,
        }
      : overrides.subscription;

  return {
    school: { findFirst: jest.fn().mockResolvedValue({ id: 'school-1' }) },
    subscription: { findFirst: jest.fn().mockResolvedValue(subscription) },
    student: {
      count: jest.fn().mockResolvedValue(overrides.students ?? 0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    staff: {
      count: jest.fn().mockResolvedValue(overrides.staff ?? 0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    user: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    document: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: overrides.documentBytes ?? 0 } }),
    },
    attachment: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { sizeBytes: overrides.attachmentBytes ?? 0 } }),
    },
  };
}

function buildService(prisma: ReturnType<typeof buildPrisma>): UsageService {
  const notifications = { dispatch: jest.fn().mockResolvedValue(undefined) };
  const logger = {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  };
  return new UsageService(prisma as never, notifications as never, logger as never);
}

describe('UsageService', () => {
  it('measures usage against the plan limits', async () => {
    const service = buildService(buildPrisma({ students: 40, staff: 5 }));

    const usage = await service.forSchool('school-1', { fresh: true });

    expect(usage.students).toMatchObject({ used: 40, limit: 100, remaining: 60, exceeded: false });
    expect(usage.students.percent).toBe(40);
    expect(usage.staff).toMatchObject({ used: 5, limit: 20 });
    expect(usage.plan?.code).toBe('PROFESSIONAL');
  });

  it('prefers a per-school override to the plan limit', async () => {
    const service = buildService(
      buildPrisma({ students: 150, limitOverrides: { maxStudents: 500 } }),
    );

    const usage = await service.forSchool('school-1', { fresh: true });

    expect(usage.limits.maxStudents).toBe(500);
    expect(usage.students.exceeded).toBe(false);
    expect(usage.overridden).toContain('students');
  });

  it('ignores an override that is not a usable number', async () => {
    const service = buildService(
      buildPrisma({ students: 10, limitOverrides: { maxStudents: 'lots' } }),
    );

    const usage = await service.forSchool('school-1', { fresh: true });

    expect(usage.limits.maxStudents).toBe(PLAN.maxStudents);
    expect(usage.overridden).not.toContain('students');
  });

  it('converts stored bytes to megabytes', async () => {
    const service = buildService(
      buildPrisma({ documentBytes: 1024 * 1024 * 100, attachmentBytes: 1024 * 1024 * 24 }),
    );

    const usage = await service.forSchool('school-1', { fresh: true });

    expect(usage.storage.used).toBe(124);
    expect(usage.storage.limit).toBe(1024);
  });

  it('flags the warning band before the limit is actually hit', async () => {
    const service = buildService(buildPrisma({ students: 92 }));

    const usage = await service.forSchool('school-1', { fresh: true });

    expect(usage.students.exceeded).toBe(false);
    expect(usage.students.warning).toBe(true);
  });

  it('falls back to a restricted allowance when the school has no subscription', async () => {
    const service = buildService(buildPrisma({ students: 0, subscription: null }));

    const usage = await service.forSchool('school-1', { fresh: true });

    expect(usage.plan).toBeNull();
    expect(usage.limits.maxStudents).toBe(50);
  });

  describe('assertWithinLimit', () => {
    it('allows a school with room to spare', async () => {
      const service = buildService(buildPrisma({ students: 10 }));
      await expect(service.assertWithinLimit('school-1', 'students')).resolves.toMatchObject({
        used: 10,
      });
    });

    it('refuses the row that would cross the limit', async () => {
      const service = buildService(buildPrisma({ students: 100 }));

      await expect(service.assertWithinLimit('school-1', 'students')).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_LIMIT_REACHED,
      });
    });

    it('refuses a bulk import that does not fit, even when a single row would', async () => {
      const service = buildService(buildPrisma({ students: 95 }));

      await expect(service.assertWithinLimit('school-1', 'students', 1)).resolves.toBeDefined();
      await expect(service.assertWithinLimit('school-1', 'students', 10)).rejects.toBeInstanceOf(
        AppException,
      );
    });

    it('names the plan and the numbers so the message is actionable', async () => {
      const service = buildService(buildPrisma({ staff: 20 }));

      await expect(service.assertWithinLimit('school-1', 'staff')).rejects.toThrow(
        /20 of 20 allowed by the Professional plan/,
      );
    });

    it('does not limit a caller with no tenant, such as a platform operator', async () => {
      const service = buildService(buildPrisma({ students: 100 }));
      await expect(service.assertWithinLimit(null, 'students')).resolves.toMatchObject({
        exceeded: false,
      });
    });
  });
});
