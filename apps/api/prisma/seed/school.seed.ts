import {
  PrismaClient,
  Prisma,
  RoleType,
  SchoolStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { ROLE_DEFAULT_PERMISSIONS, ROLE_LABELS } from '../../src/common/constants/permissions';
import { ALL_MODULES } from '../../src/common/constants/modules';
import { dateOnly } from './helpers';

export interface SchoolSeedResult {
  schoolId: string;
  academicYearId: string;
  academicYearName: string;
  yearStart: Date;
  yearEnd: Date;
  roleIds: Record<RoleType, string>;
  currency: string;
  timezone: string;
}

const SCHOOL_CODE = 'GFIS';
const SCHOOL_SLUG = 'greenfield-international';

/** Academic year runs April to March, the Indian convention. */
function academicYearBounds(): { name: string; start: Date; end: Date } {
  const now = new Date();
  const startYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    name: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    start: new Date(Date.UTC(startYear, 3, 1)),
    end: new Date(Date.UTC(startYear + 1, 2, 31)),
  };
}

export async function seedSchool(prisma: PrismaClient): Promise<SchoolSeedResult> {
  const existing = await prisma.school.findUnique({
    where: { code: SCHOOL_CODE },
    select: { id: true },
  });

  // Re-running the seed replaces the demo school rather than accumulating copies.
  if (existing) {
    await prisma.school.delete({ where: { id: existing.id } });
  }

  const enabledModules: Record<string, boolean> = {};
  for (const key of ALL_MODULES) enabledModules[key] = true;

  const school = await prisma.school.create({
    data: {
      code: SCHOOL_CODE,
      slug: SCHOOL_SLUG,
      name: 'Greenfield International School',
      legalName: 'Greenfield Education Trust',
      status: SchoolStatus.ACTIVE,
      email: 'office@greenfield.edu',
      phone: '+918041234567',
      alternatePhone: '+918041234568',
      website: 'https://greenfield.edu',
      addressLine1: '24, Greenfield Campus Road',
      addressLine2: 'Off Sarjapur Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
      postalCode: '560035',
      latitude: 12.9081,
      longitude: 77.6476,
      board: 'CBSE',
      affiliationNumber: '830245',
      establishedYear: 1998,
      principalName: 'Dr. Meera Krishnan',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      locale: 'en',
      primaryColor: '#0F172A',
      secondaryColor: '#2563EB',
      reportCardHeader: 'Affiliated to CBSE, New Delhi — Affiliation No. 830245',
      invoiceFooter:
        'Fees once paid are non-refundable. Cheques to be drawn in favour of Greenfield Education Trust.',
      enabledModules: enabledModules as Prisma.InputJsonValue,
      onboardingStep: 5,
      onboardedAt: new Date(),
      settings: {
        // Marks this tenant as seeded demo data so it can be identified later.
        isDemoData: true,
        timings: {
          startTime: '08:30',
          endTime: '15:30',
          workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
          lunchStart: '12:30',
          lunchEnd: '13:10',
        },
        attendance: {
          editWindowDays: 7,
          notifyParentsOnAbsence: true,
          minimumAttendancePercent: 75,
          allowFutureMarking: false,
        },
        fees: {
          lateFeeEnabled: true,
          lateFeeGraceDays: 5,
          reminderDaysBefore: [7, 3, 1],
          allowPartialPayment: true,
          allowOnlinePayment: true,
        },
        exams: {
          passingPercentage: 35,
          showRankInReportCard: true,
          lockMarksOnPublish: true,
        },
        admissions: { autoGenerateAdmissionNumber: true, admissionNumberPrefix: '' },
        library: { maxBooksPerStudent: 2, loanDurationDays: 14, finePerDay: 2, maxRenewals: 2 },
      } as Prisma.InputJsonValue,
    },
    select: { id: true, currency: true, timezone: true },
  });

  // --- Roles ----------------------------------------------------------------
  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

  const roleIds = {} as Record<RoleType, string>;
  const schoolRoles = (Object.keys(ROLE_DEFAULT_PERMISSIONS) as RoleType[]).filter(
    (role) => role !== RoleType.SUPER_ADMIN,
  );

  for (const type of schoolRoles) {
    const role = await prisma.role.create({
      data: {
        schoolId: school.id,
        type,
        name: ROLE_LABELS[type],
        description: `Default ${ROLE_LABELS[type]} role`,
        isSystem: true,
        isDefault: true,
      },
      select: { id: true },
    });
    roleIds[type] = role.id;

    const grants = ROLE_DEFAULT_PERMISSIONS[type]
      .map((key) => idByKey.get(key))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: role.id, permissionId }));

    if (grants.length > 0) {
      await prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });
    }
  }

  // --- Subscription ---------------------------------------------------------
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({
    where: { code: 'ENTERPRISE' },
    select: { id: true, priceYearly: true, currency: true },
  });

  await prisma.subscription.create({
    data: {
      schoolId: school.id,
      planId: plan.id,
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86_400_000),
      amount: plan.priceYearly,
      currency: plan.currency,
      autoRenew: true,
    },
  });

  // --- Academic years -------------------------------------------------------
  const bounds = academicYearBounds();

  // A previous year is created too, so promotion and history features have
  // something realistic to operate on.
  const previousStartYear = bounds.start.getUTCFullYear() - 1;
  await prisma.academicYear.create({
    data: {
      schoolId: school.id,
      name: `${previousStartYear}-${String((previousStartYear + 1) % 100).padStart(2, '0')}`,
      startDate: new Date(Date.UTC(previousStartYear, 3, 1)),
      endDate: new Date(Date.UTC(previousStartYear + 1, 2, 31)),
      isCurrent: false,
      isLocked: true,
    },
  });

  const academicYear = await prisma.academicYear.create({
    data: {
      schoolId: school.id,
      name: bounds.name,
      startDate: bounds.start,
      endDate: bounds.end,
      isCurrent: true,
    },
    select: { id: true, name: true, startDate: true, endDate: true },
  });

  // --- Holidays -------------------------------------------------------------
  const year = bounds.start.getUTCFullYear();
  const holidays = [
    { name: 'Independence Day', date: `${year}-08-15`, type: 'PUBLIC' },
    { name: 'Gandhi Jayanti', date: `${year}-10-02`, type: 'PUBLIC' },
    { name: 'Dussehra Break', date: `${year}-10-10`, end: `${year}-10-14`, type: 'VACATION' },
    { name: 'Diwali Break', date: `${year}-11-08`, end: `${year}-11-12`, type: 'VACATION' },
    { name: 'Christmas', date: `${year}-12-25`, type: 'PUBLIC' },
    { name: 'Republic Day', date: `${year + 1}-01-26`, type: 'PUBLIC' },
    { name: 'Summer Vacation', date: `${year + 1}-04-15`, end: `${year + 1}-05-31`, type: 'VACATION' },
  ];

  await prisma.holiday.createMany({
    data: holidays.map((holiday) => ({
      schoolId: school.id,
      academicYearId: academicYear.id,
      name: holiday.name,
      startDate: dateOnly(holiday.date),
      endDate: dateOnly(holiday.end ?? holiday.date),
      type: holiday.type,
    })),
  });

  // --- Leave types ----------------------------------------------------------
  await prisma.leaveType.createMany({
    data: [
      { schoolId: school.id, name: 'Casual Leave', code: 'CL', applicableTo: 'STAFF', annualQuota: 12, isPaid: true },
      { schoolId: school.id, name: 'Sick Leave', code: 'SL', applicableTo: 'STAFF', annualQuota: 10, isPaid: true, requiresDocument: true },
      { schoolId: school.id, name: 'Earned Leave', code: 'EL', applicableTo: 'STAFF', annualQuota: 15, isPaid: true, carryForward: true, maxCarryForward: 30 },
      { schoolId: school.id, name: 'Loss of Pay', code: 'LOP', applicableTo: 'STAFF', annualQuota: 0, isPaid: false },
      { schoolId: school.id, name: 'Student Leave', code: 'STU', applicableTo: 'STUDENT', annualQuota: 0, isPaid: true },
      { schoolId: school.id, name: 'Medical Leave', code: 'MED', applicableTo: 'STUDENT', annualQuota: 0, isPaid: true, requiresDocument: true },
    ],
  });

  // --- Document categories --------------------------------------------------
  await prisma.documentCategory.createMany({
    data: [
      { schoolId: school.id, name: 'Birth Certificate', code: 'BIRTH_CERT', ownerType: 'STUDENT', isRequired: true },
      { schoolId: school.id, name: 'Transfer Certificate', code: 'TC', ownerType: 'STUDENT' },
      { schoolId: school.id, name: 'Aadhaar Card', code: 'AADHAAR', ownerType: 'STUDENT', isRequired: true },
      { schoolId: school.id, name: 'Photograph', code: 'PHOTO', ownerType: 'STUDENT', isRequired: true },
      { schoolId: school.id, name: 'Previous Marks Card', code: 'MARKS_CARD', ownerType: 'STUDENT' },
      { schoolId: school.id, name: 'Medical Record', code: 'MEDICAL', ownerType: 'STUDENT' },
      { schoolId: school.id, name: 'Qualification Certificate', code: 'QUALIFICATION', ownerType: 'STAFF', isRequired: true },
      { schoolId: school.id, name: 'Experience Letter', code: 'EXPERIENCE', ownerType: 'STAFF' },
      { schoolId: school.id, name: 'PAN Card', code: 'PAN', ownerType: 'STAFF' },
      { schoolId: school.id, name: 'Affiliation Document', code: 'AFFILIATION', ownerType: 'SCHOOL' },
    ],
  });

  // --- Grading scale --------------------------------------------------------
  const gradeScale = await prisma.gradeScale.create({
    data: {
      schoolId: school.id,
      name: 'CBSE Grading (Scholastic)',
      description: 'Standard CBSE grade bands based on percentage',
      isDefault: true,
      usePercentage: true,
    },
    select: { id: true },
  });

  await prisma.gradeBand.createMany({
    data: [
      { gradeScaleId: gradeScale.id, grade: 'A1', minValue: 91, maxValue: 100, gradePoint: 10, remark: 'Outstanding', sortOrder: 1 },
      { gradeScaleId: gradeScale.id, grade: 'A2', minValue: 81, maxValue: 90.99, gradePoint: 9, remark: 'Excellent', sortOrder: 2 },
      { gradeScaleId: gradeScale.id, grade: 'B1', minValue: 71, maxValue: 80.99, gradePoint: 8, remark: 'Very Good', sortOrder: 3 },
      { gradeScaleId: gradeScale.id, grade: 'B2', minValue: 61, maxValue: 70.99, gradePoint: 7, remark: 'Good', sortOrder: 4 },
      { gradeScaleId: gradeScale.id, grade: 'C1', minValue: 51, maxValue: 60.99, gradePoint: 6, remark: 'Fair', sortOrder: 5 },
      { gradeScaleId: gradeScale.id, grade: 'C2', minValue: 41, maxValue: 50.99, gradePoint: 5, remark: 'Satisfactory', sortOrder: 6 },
      { gradeScaleId: gradeScale.id, grade: 'D', minValue: 33, maxValue: 40.99, gradePoint: 4, remark: 'Needs Improvement', sortOrder: 7 },
      { gradeScaleId: gradeScale.id, grade: 'E', minValue: 0, maxValue: 32.99, gradePoint: 0, remark: 'Unsatisfactory', isPassing: false, sortOrder: 8 },
    ],
  });

  return {
    schoolId: school.id,
    academicYearId: academicYear.id,
    academicYearName: academicYear.name,
    yearStart: academicYear.startDate,
    yearEnd: academicYear.endDate,
    roleIds,
    currency: school.currency,
    timezone: school.timezone,
  };
}
