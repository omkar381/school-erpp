/**
 * Development seed.
 *
 * Creates one fully-populated demo school so every module has something real to
 * work with: staff, students with parents, timetable, attendance history,
 * homework, exams with marks, a fee structure with invoices and payments,
 * notices, library and transport.
 *
 * This is DEVELOPMENT DATA ONLY. It refuses to run against NODE_ENV=production
 * unless ALLOW_PRODUCTION_SEED=true is set explicitly, and the demo school is
 * always tagged `isDemoData` in its settings so it can be identified and purged.
 *
 *   npm run db:seed
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedPlatform } from './platform.seed';
import { seedSchool } from './school.seed';
import { seedPeople } from './people.seed';
import { seedAcademics } from './academics.seed';
import { seedOperations } from './operations.seed';
import { logStep, formatDuration } from './helpers';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const startedAt = Date.now();

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error(
      'Refusing to seed a production database. Set ALLOW_PRODUCTION_SEED=true only if you are ' +
        'certain you want demo data in this environment.',
    );
  }

  console.log('\n  School ERP Platform — database seed');
  console.log('  ' + '─'.repeat(52) + '\n');

  // 1. Platform-level data: permissions, plans, the super administrator.
  const platform = await logStep('Platform (permissions, plans, super admin)', () =>
    seedPlatform(prisma),
  );

  // 2. The demo school with its roles, academic year and settings.
  const school = await logStep('Demo school (roles, academic year, branding)', () =>
    seedSchool(prisma),
  );

  // 3. Classes, sections, subjects, rooms, periods, holidays.
  const academics = await logStep('Academic structure (classes, subjects, timetable)', () =>
    seedAcademics(prisma, school),
  );

  // 4. Staff, students, guardians and their logins.
  const people = await logStep('People (staff, students, guardians)', () =>
    seedPeople(prisma, school, academics),
  );

  // 5. Everything that depends on people: attendance, homework, exams, fees.
  await logStep('Operations (attendance, homework, exams, fees, notices)', () =>
    seedOperations(prisma, school, academics, people),
  );

  console.log('\n  ' + '─'.repeat(52));
  console.log(`  Seed completed in ${formatDuration(Date.now() - startedAt)}\n`);

  console.log('  Sign-in credentials');
  console.log('  ' + '─'.repeat(52));
  const rows: Array<[string, string, string]> = [
    ['Super admin', platform.superAdminEmail, platform.superAdminPassword],
    ['School admin', 'admin@greenfield.edu', 'Admin@123'],
    ['Principal', 'principal@greenfield.edu', 'Principal@123'],
    ['Teacher', people.sampleTeacherEmail, 'Teacher@123'],
    ['Parent', people.sampleParentEmail, 'Parent@123'],
    ['Student', people.sampleStudentEmail, 'Student@123'],
  ];
  for (const [role, email, password] of rows) {
    console.log(`  ${role.padEnd(14)} ${email.padEnd(34)} ${password}`);
  }

  console.log('\n  Seeded totals');
  console.log('  ' + '─'.repeat(52));
  const counts = await Promise.all([
    prisma.student.count(),
    prisma.staff.count(),
    prisma.guardian.count(),
    prisma.class.count(),
    prisma.subject.count(),
    prisma.attendance.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.mark.count(),
    prisma.homework.count(),
  ]);
  const labels = [
    'Students',
    'Staff',
    'Guardians',
    'Classes',
    'Subjects',
    'Attendance records',
    'Invoices',
    'Payments',
    'Marks',
    'Homework',
  ];
  labels.forEach((label, index) => {
    console.log(`  ${label.padEnd(22)} ${String(counts[index]).padStart(6)}`);
  });
  console.log('');
}

main()
  .catch((error) => {
    console.error('\n  Seed failed:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
