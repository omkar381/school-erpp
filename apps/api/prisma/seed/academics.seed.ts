import { PrismaClient, PeriodType } from '@prisma/client';
import type { SchoolSeedResult } from './school.seed';

export interface AcademicsSeedResult {
  classes: Array<{
    id: string;
    name: string;
    level: number;
    sections: Array<{ id: string; name: string }>;
    subjectIds: string[];
  }>;
  subjectsByCode: Record<string, string>;
  departmentIds: Record<string, string>;
  designationIds: Record<string, string>;
  roomIds: string[];
  periodIds: string[];
  gradeScaleId: string;
}

const DEPARTMENTS = [
  { name: 'Science', code: 'SCI' },
  { name: 'Mathematics', code: 'MATH' },
  { name: 'Languages', code: 'LANG' },
  { name: 'Social Sciences', code: 'SOC' },
  { name: 'Computer Science', code: 'CS' },
  { name: 'Physical Education', code: 'PE' },
  { name: 'Administration', code: 'ADMIN' },
];

const DESIGNATIONS = [
  { name: 'Principal', code: 'PRINCIPAL', level: 100 },
  { name: 'Vice Principal', code: 'VICE_PRINCIPAL', level: 90 },
  { name: 'Head of Department', code: 'HOD', level: 70 },
  { name: 'Senior Teacher', code: 'SR_TEACHER', level: 50 },
  { name: 'Teacher', code: 'TEACHER', level: 40 },
  { name: 'Accountant', code: 'ACCOUNTANT', level: 40 },
  { name: 'Librarian', code: 'LIBRARIAN', level: 35 },
  { name: 'Administrative Officer', code: 'ADMIN_OFFICER', level: 45 },
];

const SUBJECTS = [
  { name: 'English', code: 'ENG', department: 'LANG', category: 'LANGUAGE', color: '#2563EB' },
  { name: 'Hindi', code: 'HIN', department: 'LANG', category: 'LANGUAGE', color: '#7C3AED' },
  { name: 'Kannada', code: 'KAN', department: 'LANG', category: 'LANGUAGE', color: '#DB2777' },
  { name: 'Mathematics', code: 'MATH', department: 'MATH', category: 'CORE', color: '#059669' },
  { name: 'Science', code: 'SCI', department: 'SCI', category: 'CORE', color: '#0891B2', practical: true },
  { name: 'Physics', code: 'PHY', department: 'SCI', category: 'CORE', color: '#0284C7', practical: true },
  { name: 'Chemistry', code: 'CHEM', department: 'SCI', category: 'CORE', color: '#CA8A04', practical: true },
  { name: 'Biology', code: 'BIO', department: 'SCI', category: 'CORE', color: '#16A34A', practical: true },
  { name: 'Social Science', code: 'SST', department: 'SOC', category: 'CORE', color: '#DC2626' },
  { name: 'Computer Science', code: 'CS', department: 'CS', category: 'CORE', color: '#4F46E5', practical: true },
  { name: 'Physical Education', code: 'PE', department: 'PE', category: 'CO_SCHOLASTIC', color: '#EA580C', gradedOnly: true },
  { name: 'Art & Craft', code: 'ART', department: 'PE', category: 'CO_SCHOLASTIC', color: '#DB2777', gradedOnly: true },
];

/** Subjects taught at each class level. */
function subjectsForLevel(level: number): string[] {
  const base = ['ENG', 'HIN', 'MATH', 'SST', 'CS', 'PE', 'ART'];
  if (level <= 5) return [...base, 'SCI', 'KAN'];
  if (level <= 8) return [...base, 'SCI', 'KAN'];
  // Senior classes split Science into its component subjects.
  return [...base, 'PHY', 'CHEM', 'BIO'];
}

const PERIODS = [
  { name: 'Assembly', sequence: 1, startTime: '08:30', endTime: '08:45', type: PeriodType.ASSEMBLY },
  { name: 'Period 1', sequence: 2, startTime: '08:45', endTime: '09:30', type: PeriodType.CLASS },
  { name: 'Period 2', sequence: 3, startTime: '09:30', endTime: '10:15', type: PeriodType.CLASS },
  { name: 'Short Break', sequence: 4, startTime: '10:15', endTime: '10:30', type: PeriodType.BREAK },
  { name: 'Period 3', sequence: 5, startTime: '10:30', endTime: '11:15', type: PeriodType.CLASS },
  { name: 'Period 4', sequence: 6, startTime: '11:15', endTime: '12:00', type: PeriodType.CLASS },
  { name: 'Period 5', sequence: 7, startTime: '12:00', endTime: '12:30', type: PeriodType.CLASS },
  { name: 'Lunch', sequence: 8, startTime: '12:30', endTime: '13:10', type: PeriodType.LUNCH },
  { name: 'Period 6', sequence: 9, startTime: '13:10', endTime: '13:55', type: PeriodType.CLASS },
  { name: 'Period 7', sequence: 10, startTime: '13:55', endTime: '14:40', type: PeriodType.CLASS },
  { name: 'Period 8', sequence: 11, startTime: '14:40', endTime: '15:30', type: PeriodType.CLASS },
];

const ROOMS = [
  ...Array.from({ length: 12 }, (_, index) => ({
    name: `Room ${101 + index}`,
    code: `R${101 + index}`,
    type: 'CLASSROOM',
    capacity: 40,
    building: 'Main Block',
    floor: index < 6 ? 'Ground' : 'First',
  })),
  { name: 'Physics Laboratory', code: 'LAB_PHY', type: 'LAB', capacity: 30, building: 'Science Block', floor: 'Ground' },
  { name: 'Chemistry Laboratory', code: 'LAB_CHEM', type: 'LAB', capacity: 30, building: 'Science Block', floor: 'Ground' },
  { name: 'Biology Laboratory', code: 'LAB_BIO', type: 'LAB', capacity: 30, building: 'Science Block', floor: 'First' },
  { name: 'Computer Laboratory', code: 'LAB_CS', type: 'LAB', capacity: 40, building: 'Main Block', floor: 'Second' },
  { name: 'Library', code: 'LIBRARY', type: 'LIBRARY', capacity: 80, building: 'Main Block', floor: 'First' },
  { name: 'Auditorium', code: 'AUDI', type: 'AUDITORIUM', capacity: 500, building: 'Activity Block', floor: 'Ground' },
];

/** Classes 1 to 10, each with sections A and B. */
const CLASS_LEVELS = Array.from({ length: 10 }, (_, index) => index + 1);

export async function seedAcademics(
  prisma: PrismaClient,
  school: SchoolSeedResult,
): Promise<AcademicsSeedResult> {
  const { schoolId, academicYearId } = school;

  // --- Departments and designations ----------------------------------------
  const departmentIds: Record<string, string> = {};
  for (const department of DEPARTMENTS) {
    const record = await prisma.department.create({
      data: { schoolId, name: department.name, code: department.code },
      select: { id: true },
    });
    departmentIds[department.code] = record.id;
  }

  const designationIds: Record<string, string> = {};
  for (const designation of DESIGNATIONS) {
    const record = await prisma.designation.create({
      data: { schoolId, ...designation },
      select: { id: true },
    });
    designationIds[designation.code] = record.id;
  }

  // --- Rooms ----------------------------------------------------------------
  const roomIds: string[] = [];
  for (const room of ROOMS) {
    const record = await prisma.room.create({
      data: { schoolId, ...room },
      select: { id: true },
    });
    roomIds.push(record.id);
  }

  // --- Periods --------------------------------------------------------------
  const periodIds: string[] = [];
  for (const period of PERIODS) {
    const record = await prisma.period.create({
      data: { schoolId, academicYearId, ...period },
      select: { id: true },
    });
    periodIds.push(record.id);
  }

  // --- Subjects -------------------------------------------------------------
  const subjectsByCode: Record<string, string> = {};
  for (const subject of SUBJECTS) {
    const record = await prisma.subject.create({
      data: {
        schoolId,
        name: subject.name,
        code: subject.code,
        departmentId: departmentIds[subject.department],
        category: subject.category,
        hasPractical: subject.practical ?? false,
        isGradedOnly: subject.gradedOnly ?? false,
        colorHex: subject.color,
      },
      select: { id: true },
    });
    subjectsByCode[subject.code] = record.id;
  }

  // --- Classes, sections and their subject maps -----------------------------
  const classes: AcademicsSeedResult['classes'] = [];
  let roomCursor = 0;

  for (const level of CLASS_LEVELS) {
    const codes = subjectsForLevel(level);

    const created = await prisma.class.create({
      data: {
        schoolId,
        academicYearId,
        name: `Class ${level}`,
        level,
        medium: 'English',
        stream: level >= 9 ? 'Science' : null,
        sections: {
          create: ['A', 'B'].map((name) => ({
            schoolId,
            name,
            capacity: 40,
            roomId: roomIds[roomCursor++ % 12],
          })),
        },
        classSubjects: {
          create: codes.map((code) => ({
            subjectId: subjectsByCode[code],
            weeklyPeriods: ['MATH', 'ENG', 'SCI', 'PHY'].includes(code) ? 6 : 4,
            maxMarks: 100,
            passMarks: 35,
          })),
        },
      },
      select: {
        id: true,
        name: true,
        level: true,
        sections: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
    });

    classes.push({
      id: created.id,
      name: created.name,
      level: created.level,
      sections: created.sections,
      subjectIds: codes.map((code) => subjectsByCode[code]),
    });
  }

  const gradeScale = await prisma.gradeScale.findFirstOrThrow({
    where: { schoolId, isDefault: true },
    select: { id: true },
  });

  return {
    classes,
    subjectsByCode,
    departmentIds,
    designationIds,
    roomIds,
    periodIds,
    gradeScaleId: gradeScale.id,
  };
}

export { SUBJECTS, PERIODS, subjectsForLevel };
