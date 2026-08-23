import { PrismaClient, RoleType, UserStatus } from '@prisma/client';
import { ALL_PERMISSIONS, parsePermission } from '../../src/common/constants/permissions';
import { ALL_MODULES, PLAN_MODULES } from '../../src/common/constants/modules';
import { hashPassword } from './helpers';

export interface PlatformSeedResult {
  superAdminId: string;
  superAdminEmail: string;
  superAdminPassword: string;
  permissionCount: number;
  planIds: Record<string, string>;
}

function humanize(value: string): string {
  return value
    .split(/[._]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Platform-level data that exists independently of any school: the permission
 * catalogue, the subscription plans and the super administrator account.
 * Idempotent — safe to re-run.
 */
export async function seedPlatform(prisma: PrismaClient): Promise<PlatformSeedResult> {
  // --- Permission catalogue -------------------------------------------------
  const existingPermissions = await prisma.permission.findMany({ select: { key: true } });
  const known = new Set(existingPermissions.map((permission) => permission.key));
  const missing = ALL_PERMISSIONS.filter((key) => !known.has(key));

  if (missing.length > 0) {
    await prisma.permission.createMany({
      data: missing.map((key) => {
        const { module, action } = parsePermission(key);
        return {
          key,
          module,
          action,
          description: `${humanize(action)} — ${humanize(module)}`,
        };
      }),
      skipDuplicates: true,
    });
  }

  // --- Subscription plans ---------------------------------------------------
  const planDefinitions = [
    {
      code: 'BASIC',
      name: 'Basic',
      tier: 'BASIC' as const,
      description: 'Core academics and fees for a single small school.',
      priceMonthly: 4999,
      priceYearly: 49_990,
      maxStudents: 500,
      maxStaff: 60,
      storageMb: 5_120,
      modules: PLAN_MODULES.BASIC,
      trialDays: 30,
      sortOrder: 1,
    },
    {
      code: 'PROFESSIONAL',
      name: 'Professional',
      tier: 'PROFESSIONAL' as const,
      description: 'Everything in Basic plus transport, library, chat and analytics.',
      priceMonthly: 9999,
      priceYearly: 99_990,
      maxStudents: 2_000,
      maxStaff: 250,
      storageMb: 25_600,
      modules: PLAN_MODULES.PROFESSIONAL,
      trialDays: 21,
      sortOrder: 2,
    },
    {
      code: 'ENTERPRISE',
      name: 'Enterprise',
      tier: 'ENTERPRISE' as const,
      description: 'Every module, unlimited scale and priority support.',
      priceMonthly: 19_999,
      priceYearly: 199_990,
      maxStudents: 20_000,
      maxStaff: 2_000,
      storageMb: 204_800,
      modules: ALL_MODULES,
      trialDays: 14,
      sortOrder: 3,
    },
  ];

  const planIds: Record<string, string> = {};

  for (const plan of planDefinitions) {
    const record = await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: { ...plan, currency: 'INR', isActive: true },
      update: {
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        maxStudents: plan.maxStudents,
        maxStaff: plan.maxStaff,
        storageMb: plan.storageMb,
        modules: plan.modules,
        sortOrder: plan.sortOrder,
      },
      select: { id: true },
    });
    planIds[plan.code] = record.id;
  }

  // --- Super administrator --------------------------------------------------
  const email = process.env.SUPERADMIN_EMAIL ?? 'superadmin@schoolerp.local';
  const password = process.env.SUPERADMIN_PASSWORD ?? 'SuperAdmin@123';

  // The platform role has a null schoolId, which is why it is looked up by type.
  let superAdminRole = await prisma.role.findFirst({
    where: { schoolId: null, type: RoleType.SUPER_ADMIN },
    select: { id: true },
  });

  if (!superAdminRole) {
    superAdminRole = await prisma.role.create({
      data: {
        schoolId: null,
        type: RoleType.SUPER_ADMIN,
        name: 'Super Administrator',
        description: 'Platform owner with unrestricted access',
        isSystem: true,
      },
      select: { id: true },
    });
  }

  const allPermissions = await prisma.permission.findMany({ select: { id: true } });
  await prisma.rolePermission.createMany({
    data: allPermissions.map((permission) => ({
      roleId: superAdminRole!.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  const existingAdmin = await prisma.user.findFirst({
    where: { email, schoolId: null },
    select: { id: true },
  });

  const superAdminId = existingAdmin
    ? existingAdmin.id
    : (
        await prisma.user.create({
          data: {
            schoolId: null,
            email,
            passwordHash: await hashPassword(password),
            firstName: 'Platform',
            lastName: 'Administrator',
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
            roles: { create: { roleId: superAdminRole.id } },
          },
          select: { id: true },
        })
      ).id;

  return {
    superAdminId,
    superAdminEmail: email,
    superAdminPassword: password,
    permissionCount: ALL_PERMISSIONS.length,
    planIds,
  };
}
