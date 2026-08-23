import {
  BloodGroup,
  EmploymentStatus,
  EnrollmentStatus,
  Gender,
  GuardianRelation,
  PrismaClient,
  RoleType,
  StudentStatus,
  UserStatus,
} from '@prisma/client';
import {
  CITIES,
  FIRST_NAMES_FEMALE,
  FIRST_NAMES_MALE,
  LAST_NAMES,
  OCCUPATIONS,
  PARENT_FIRST_NAMES_FEMALE,
  PARENT_FIRST_NAMES_MALE,
  Random,
  STREETS,
  dateOnly,
  hashPassword,
  seedPhone,
} from './helpers';
import type { SchoolSeedResult } from './school.seed';
import type { AcademicsSeedResult } from './academics.seed';

export interface PeopleSeedResult {
  staff: Array<{ id: string; userId: string; name: string; isTeacher: boolean }>;
  teachers: Array<{ id: string; userId: string; name: string }>;
  students: Array<{
    id: string;
    userId: string | null;
    name: string;
    classId: string;
    sectionId: string;
    level: number;
    guardianUserIds: string[];
  }>;
  sampleTeacherEmail: string;
  sampleParentEmail: string;
  sampleStudentEmail: string;
  adminUserId: string;
  principalStaffId: string;
}

const TEACHER_PROFILES = [
  { first: 'Meera', last: 'Krishnan', gender: Gender.FEMALE, dept: 'ADMIN', desig: 'PRINCIPAL', role: RoleType.PRINCIPAL, subjects: [] as string[], qualification: 'M.A., M.Ed., Ph.D.' },
  { first: 'Ramesh', last: 'Iyer', gender: Gender.MALE, dept: 'MATH', desig: 'HOD', role: RoleType.TEACHER, subjects: ['MATH'], qualification: 'M.Sc. Mathematics, B.Ed.' },
  { first: 'Sunitha', last: 'Rao', gender: Gender.FEMALE, dept: 'SCI', desig: 'HOD', role: RoleType.TEACHER, subjects: ['SCI', 'BIO'], qualification: 'M.Sc. Botany, B.Ed.' },
  { first: 'Anil', last: 'Sharma', gender: Gender.MALE, dept: 'SCI', desig: 'SR_TEACHER', role: RoleType.TEACHER, subjects: ['PHY'], qualification: 'M.Sc. Physics, B.Ed.' },
  { first: 'Kavitha', last: 'Nair', gender: Gender.FEMALE, dept: 'SCI', desig: 'TEACHER', role: RoleType.TEACHER, subjects: ['CHEM'], qualification: 'M.Sc. Chemistry, B.Ed.' },
  { first: 'Prakash', last: 'Desai', gender: Gender.MALE, dept: 'LANG', desig: 'HOD', role: RoleType.TEACHER, subjects: ['ENG'], qualification: 'M.A. English, B.Ed.' },
  { first: 'Radha', last: 'Verma', gender: Gender.FEMALE, dept: 'LANG', desig: 'TEACHER', role: RoleType.TEACHER, subjects: ['HIN'], qualification: 'M.A. Hindi, B.Ed.' },
  { first: 'Vidya', last: 'Gowda', gender: Gender.FEMALE, dept: 'LANG', desig: 'TEACHER', role: RoleType.TEACHER, subjects: ['KAN'], qualification: 'M.A. Kannada, B.Ed.' },
  { first: 'Sanjay', last: 'Patel', gender: Gender.MALE, dept: 'SOC', desig: 'HOD', role: RoleType.TEACHER, subjects: ['SST'], qualification: 'M.A. History, B.Ed.' },
  { first: 'Naveen', last: 'Kumar', gender: Gender.MALE, dept: 'CS', desig: 'HOD', role: RoleType.TEACHER, subjects: ['CS'], qualification: 'M.C.A., B.Ed.' },
  { first: 'Deepak', last: 'Shetty', gender: Gender.MALE, dept: 'PE', desig: 'TEACHER', role: RoleType.TEACHER, subjects: ['PE'], qualification: 'M.P.Ed.' },
  { first: 'Shobha', last: 'Menon', gender: Gender.FEMALE, dept: 'PE', desig: 'TEACHER', role: RoleType.TEACHER, subjects: ['ART'], qualification: 'M.F.A.' },
];

const NON_TEACHING = [
  { first: 'Vinod', last: 'Joshi', gender: Gender.MALE, desig: 'ACCOUNTANT', role: RoleType.ACCOUNTANT, type: 'ADMIN' },
  { first: 'Geetha', last: 'Bhat', gender: Gender.FEMALE, desig: 'LIBRARIAN', role: RoleType.LIBRARIAN, type: 'NON_TEACHING' },
  { first: 'Suresh', last: 'Naidu', gender: Gender.MALE, desig: 'ADMIN_OFFICER', role: RoleType.TRANSPORT_MANAGER, type: 'ADMIN' },
  { first: 'Rekha', last: 'Pillai', gender: Gender.FEMALE, desig: 'ADMIN_OFFICER', role: RoleType.RECEPTIONIST, type: 'ADMIN' },
  { first: 'Ashok', last: 'Reddy', gender: Gender.MALE, desig: 'ADMIN_OFFICER', role: RoleType.HR_MANAGER, type: 'ADMIN' },
];

const BLOOD_GROUPS: BloodGroup[] = [
  BloodGroup.A_POSITIVE,
  BloodGroup.B_POSITIVE,
  BloodGroup.O_POSITIVE,
  BloodGroup.AB_POSITIVE,
  BloodGroup.A_NEGATIVE,
  BloodGroup.O_NEGATIVE,
];

const CATEGORIES = ['GENERAL', 'OBC', 'SC', 'ST'];
const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Jain', 'Sikh'];

/** Five students per section across ten classes gives 100; we cap at 50 per the brief. */
const STUDENTS_PER_SECTION = 3;

export async function seedPeople(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  academics: AcademicsSeedResult,
): Promise<PeopleSeedResult> {
  const { schoolId, academicYearId, roleIds, yearStart } = school;
  const random = new Random(42);

  const adminHash = await hashPassword('Admin@123');
  const principalHash = await hashPassword('Principal@123');
  const teacherHash = await hashPassword('Teacher@123');
  const staffHash = await hashPassword('Staff@123');
  const parentHash = await hashPassword('Parent@123');
  const studentHash = await hashPassword('Student@123');

  // -------------------------------------------------------------------------
  // School administrator
  // -------------------------------------------------------------------------
  const admin = await prisma.user.create({
    data: {
      schoolId,
      email: 'admin@greenfield.edu',
      phone: seedPhone(1),
      passwordHash: adminHash,
      firstName: 'Arun',
      lastName: 'Mehta',
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      roles: { create: { roleId: roleIds[RoleType.SCHOOL_ADMIN] } },
    },
    select: { id: true },
  });

  // -------------------------------------------------------------------------
  // Teaching staff
  // -------------------------------------------------------------------------
  const staff: PeopleSeedResult['staff'] = [];
  const teachers: PeopleSeedResult['teachers'] = [];
  const teacherIdBySubject = new Map<string, string[]>();
  let phoneCursor = 10;

  for (const [index, profile] of TEACHER_PROFILES.entries()) {
    const isPrincipal = profile.role === RoleType.PRINCIPAL;
    const email = isPrincipal
      ? 'principal@greenfield.edu'
      : `${profile.first.toLowerCase()}.${profile.last.toLowerCase()}@greenfield.edu`;

    const user = await prisma.user.create({
      data: {
        schoolId,
        email,
        phone: seedPhone(phoneCursor++),
        passwordHash: isPrincipal ? principalHash : teacherHash,
        firstName: profile.first,
        lastName: profile.last,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        roles: { create: { roleId: roleIds[profile.role] } },
      },
      select: { id: true },
    });

    const record = await prisma.staff.create({
      data: {
        schoolId,
        userId: user.id,
        employeeId: `EMP/${String(1001 + index).padStart(4, '0')}`,
        departmentId: academics.departmentIds[profile.dept],
        designationId: academics.designationIds[profile.desig],
        firstName: profile.first,
        lastName: profile.last,
        dateOfBirth: dateOnly(`${1975 + random.int(0, 15)}-${random.int(1, 12)}-${random.int(1, 28)}`),
        gender: profile.gender,
        bloodGroup: random.pick(BLOOD_GROUPS),
        email,
        phone: seedPhone(phoneCursor - 1),
        addressLine1: `${random.int(1, 200)}, ${random.pick(STREETS)}`,
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: `5600${String(random.int(10, 99))}`,
        qualification: profile.qualification,
        specialization: profile.subjects[0] ?? 'Administration',
        experienceYears: random.int(3, 25),
        joiningDate: dateOnly(`${2010 + random.int(0, 12)}-06-01`),
        employmentStatus: EmploymentStatus.ACTIVE,
        employmentType: 'TEACHING',
        isTeacher: true,
        emergencyContactName: `${random.pick(PARENT_FIRST_NAMES_MALE)} ${profile.last}`,
        emergencyContactPhone: seedPhone(phoneCursor + 500),
      },
      select: { id: true },
    });

    const name = `${profile.first} ${profile.last}`;
    staff.push({ id: record.id, userId: user.id, name, isTeacher: true });
    if (!isPrincipal) teachers.push({ id: record.id, userId: user.id, name });

    for (const code of profile.subjects) {
      const bucket = teacherIdBySubject.get(code) ?? [];
      bucket.push(record.id);
      teacherIdBySubject.set(code, bucket);
    }
  }

  const principalStaffId = staff[0].id;

  // Departments are headed by their HOD.
  for (const profile of TEACHER_PROFILES) {
    if (profile.desig !== 'HOD') continue;
    const member = staff.find((entry) => entry.name === `${profile.first} ${profile.last}`);
    if (member) {
      await prisma.department.update({
        where: { id: academics.departmentIds[profile.dept] },
        data: { headStaffId: member.id },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Non-teaching staff
  // -------------------------------------------------------------------------
  for (const [index, profile] of NON_TEACHING.entries()) {
    const email = `${profile.first.toLowerCase()}.${profile.last.toLowerCase()}@greenfield.edu`;

    const user = await prisma.user.create({
      data: {
        schoolId,
        email,
        phone: seedPhone(phoneCursor++),
        passwordHash: staffHash,
        firstName: profile.first,
        lastName: profile.last,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        roles: { create: { roleId: roleIds[profile.role] } },
      },
      select: { id: true },
    });

    const record = await prisma.staff.create({
      data: {
        schoolId,
        userId: user.id,
        employeeId: `EMP/${String(2001 + index).padStart(4, '0')}`,
        departmentId: academics.departmentIds.ADMIN,
        designationId: academics.designationIds[profile.desig],
        firstName: profile.first,
        lastName: profile.last,
        gender: profile.gender,
        bloodGroup: random.pick(BLOOD_GROUPS),
        email,
        phone: seedPhone(phoneCursor - 1),
        city: 'Bengaluru',
        state: 'Karnataka',
        qualification: 'B.Com.',
        experienceYears: random.int(2, 15),
        joiningDate: dateOnly(`${2015 + random.int(0, 8)}-06-01`),
        employmentStatus: EmploymentStatus.ACTIVE,
        employmentType: profile.type,
        isTeacher: false,
      },
      select: { id: true },
    });

    staff.push({
      id: record.id,
      userId: user.id,
      name: `${profile.first} ${profile.last}`,
      isTeacher: false,
    });
  }

  // -------------------------------------------------------------------------
  // Class teachers and subject teachers
  // -------------------------------------------------------------------------
  let teacherCursor = 0;
  for (const cls of academics.classes) {
    for (const section of cls.sections) {
      const classTeacher = teachers[teacherCursor % teachers.length];
      teacherCursor += 1;

      await prisma.section.update({
        where: { id: section.id },
        data: { classTeacherId: classTeacher.id },
      });

      // Assign a subject teacher for every subject the class studies.
      const classSubjects = await prisma.classSubject.findMany({
        where: { classId: cls.id },
        select: { subjectId: true, subject: { select: { code: true } } },
      });

      for (const entry of classSubjects) {
        const candidates = teacherIdBySubject.get(entry.subject.code);
        const staffId = candidates?.length
          ? candidates[teacherCursor % candidates.length]
          : teachers[teacherCursor % teachers.length].id;

        await prisma.subjectTeacher.create({
          data: {
            sectionId: section.id,
            subjectId: entry.subjectId,
            staffId,
            isPrimary: true,
          },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Students and guardians
  // -------------------------------------------------------------------------
  const students: PeopleSeedResult['students'] = [];
  let admissionCounter = 1;
  let guardianPhoneCursor = 2000;
  let sampleParentEmail = '';
  let sampleStudentEmail = '';

  for (const cls of academics.classes) {
    for (const section of cls.sections) {
      for (let index = 0; index < STUDENTS_PER_SECTION; index += 1) {
        const gender = random.chance(0.5) ? Gender.MALE : Gender.FEMALE;
        const firstName = random.pick(
          gender === Gender.MALE ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE,
        );
        const lastName = random.pick(LAST_NAMES);
        const admissionNumber = `ADM/${String(admissionCounter).padStart(5, '0')}`;
        // Age is derived from class level so dates of birth look plausible.
        const birthYear = new Date().getUTCFullYear() - (cls.level + 5);

        // Senior students get their own portal login.
        const wantsLogin = cls.level >= 6;
        const studentEmail = wantsLogin
          ? `${firstName.toLowerCase()}.${admissionCounter}@student.greenfield.edu`
          : null;

        let studentUserId: string | null = null;
        if (studentEmail) {
          const user = await prisma.user.create({
            data: {
              schoolId,
              email: studentEmail,
              passwordHash: studentHash,
              firstName,
              lastName,
              status: UserStatus.ACTIVE,
              emailVerifiedAt: new Date(),
              roles: { create: { roleId: roleIds[RoleType.STUDENT] } },
            },
            select: { id: true },
          });
          studentUserId = user.id;
          if (!sampleStudentEmail) sampleStudentEmail = studentEmail;
        }

        const student = await prisma.student.create({
          data: {
            schoolId,
            userId: studentUserId,
            admissionNumber,
            rollNumber: String(index + 1).padStart(2, '0'),
            firstName,
            lastName,
            dateOfBirth: dateOnly(`${birthYear}-${random.int(1, 12)}-${random.int(1, 28)}`),
            gender,
            bloodGroup: random.pick(BLOOD_GROUPS),
            nationality: 'Indian',
            religion: random.pick(RELIGIONS),
            category: random.pick(CATEGORIES),
            motherTongue: random.pick(['Kannada', 'Hindi', 'Tamil', 'Telugu', 'Malayalam']),
            email: studentEmail,
            addressLine1: `${random.int(1, 300)}, ${random.pick(STREETS)}`,
            city: random.pick(CITIES),
            state: 'Karnataka',
            country: 'India',
            postalCode: `5600${String(random.int(10, 99))}`,
            admissionDate: yearStart,
            status: StudentStatus.ACTIVE,
            ...(random.chance(0.12)
              ? { allergies: random.pick(['Peanuts', 'Dust', 'Pollen', 'Lactose']) }
              : {}),
          },
          select: { id: true },
        });

        await prisma.enrollment.create({
          data: {
            schoolId,
            studentId: student.id,
            academicYearId,
            classId: cls.id,
            sectionId: section.id,
            rollNumber: String(index + 1).padStart(2, '0'),
            status: EnrollmentStatus.ACTIVE,
            enrolledOn: yearStart,
          },
        });

        // --- Guardians: a father (primary payer) and a mother ---
        const guardianUserIds: string[] = [];

        const fatherFirst = random.pick(PARENT_FIRST_NAMES_MALE);
        const fatherPhone = seedPhone(guardianPhoneCursor++);
        const fatherEmail = `${fatherFirst.toLowerCase()}.${lastName.toLowerCase()}${admissionCounter}@example.com`;

        const fatherUser = await prisma.user.create({
          data: {
            schoolId,
            email: fatherEmail,
            phone: fatherPhone,
            passwordHash: parentHash,
            firstName: fatherFirst,
            lastName,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
            roles: { create: { roleId: roleIds[RoleType.PARENT] } },
          },
          select: { id: true },
        });
        if (!sampleParentEmail) sampleParentEmail = fatherEmail;
        guardianUserIds.push(fatherUser.id);

        const father = await prisma.guardian.create({
          data: {
            schoolId,
            userId: fatherUser.id,
            firstName: fatherFirst,
            lastName,
            relation: GuardianRelation.FATHER,
            email: fatherEmail,
            phone: fatherPhone,
            occupation: random.pick(OCCUPATIONS),
            annualIncome: random.int(4, 30) * 100_000,
            qualification: random.pick(['B.E.', 'B.Com.', 'M.B.A.', 'B.Sc.', 'M.Tech.']),
            addressLine1: `${random.int(1, 300)}, ${random.pick(STREETS)}`,
            city: random.pick(CITIES),
            state: 'Karnataka',
          },
          select: { id: true },
        });

        await prisma.studentGuardian.create({
          data: {
            studentId: student.id,
            guardianId: father.id,
            isPrimary: true,
            isPayer: true,
            canPickup: true,
          },
        });

        // Roughly two thirds of families also register the mother.
        if (random.chance(0.65)) {
          const motherFirst = random.pick(PARENT_FIRST_NAMES_FEMALE);
          const motherPhone = seedPhone(guardianPhoneCursor++);
          const motherEmail = `${motherFirst.toLowerCase()}.${lastName.toLowerCase()}${admissionCounter}@example.com`;

          const motherUser = await prisma.user.create({
            data: {
              schoolId,
              email: motherEmail,
              phone: motherPhone,
              passwordHash: parentHash,
              firstName: motherFirst,
              lastName,
              status: UserStatus.ACTIVE,
              emailVerifiedAt: new Date(),
              roles: { create: { roleId: roleIds[RoleType.PARENT] } },
            },
            select: { id: true },
          });
          guardianUserIds.push(motherUser.id);

          const mother = await prisma.guardian.create({
            data: {
              schoolId,
              userId: motherUser.id,
              firstName: motherFirst,
              lastName,
              relation: GuardianRelation.MOTHER,
              email: motherEmail,
              phone: motherPhone,
              occupation: random.pick([...OCCUPATIONS, 'Homemaker']),
              city: random.pick(CITIES),
              state: 'Karnataka',
            },
            select: { id: true },
          });

          await prisma.studentGuardian.create({
            data: {
              studentId: student.id,
              guardianId: mother.id,
              isPrimary: false,
              isPayer: false,
              canPickup: true,
            },
          });
        }

        students.push({
          id: student.id,
          userId: studentUserId,
          name: `${firstName} ${lastName}`,
          classId: cls.id,
          sectionId: section.id,
          level: cls.level,
          guardianUserIds,
        });

        admissionCounter += 1;
      }
    }
  }

  return {
    staff,
    teachers,
    students,
    sampleTeacherEmail: 'ramesh.iyer@greenfield.edu',
    sampleParentEmail,
    sampleStudentEmail,
    adminUserId: admin.id,
    principalStaffId,
  };
}
