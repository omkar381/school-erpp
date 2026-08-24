import {
  AttendanceSessionType,
  AttendanceStatus,
  DayOfWeek,
  ExamStatus,
  ExamType,
  HomeworkStatus,
  InvoiceStatus,
  LedgerEntryType,
  MarkStatus,
  NoticeAudience,
  NoticeStatus,
  PaymentMethod,
  PaymentStatus,
  PeriodType,
  Prisma,
  PrismaClient,
  Priority,
  SubmissionStatus,
} from '@prisma/client';
import { Random, addDays, dateOnly, schoolDaysBetween } from './helpers';
import type { SchoolSeedResult } from './school.seed';
import type { AcademicsSeedResult } from './academics.seed';
import type { PeopleSeedResult } from './people.seed';
import { seedInventory } from './inventory.seed';

const WEEKDAYS: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

/** How many days of attendance history to generate. */
const ATTENDANCE_DAYS = 45;

export async function seedOperations(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  academics: AcademicsSeedResult,
  people: PeopleSeedResult,
): Promise<void> {
  const random = new Random(7);
  const { schoolId, academicYearId } = school;

  await seedTimetable(prisma, school, academics, random);
  await seedAttendance(prisma, school, people, random);
  await seedHomework(prisma, school, academics, people, random);
  const examId = await seedExams(prisma, school, academics, people, random);
  await seedFees(prisma, school, academics, people, random);
  await seedNotices(prisma, school, people);
  await seedLibrary(prisma, school, people, random);
  await seedTransport(prisma, school, people, random);
  await seedInventory(prisma, school, random);
  await seedEvents(prisma, school, people);

  void examId;
  void academicYearId;
  void schoolId;
}

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

async function seedTimetable(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  academics: AcademicsSeedResult,
  random: Random,
): Promise<void> {
  const { schoolId, academicYearId } = school;

  const periods = await prisma.period.findMany({
    where: { schoolId, academicYearId, type: PeriodType.CLASS },
    orderBy: { sequence: 'asc' },
    select: { id: true },
  });

  // Track occupancy so the generated timetable is genuinely conflict-free:
  // a teacher or a room can hold only one slot per day and period.
  const teacherBusy = new Set<string>();
  const roomBusy = new Set<string>();

  for (const cls of academics.classes) {
    const classSubjects = await prisma.classSubject.findMany({
      where: { classId: cls.id },
      select: { subjectId: true, weeklyPeriods: true },
    });

    for (const section of cls.sections) {
      const subjectTeachers = await prisma.subjectTeacher.findMany({
        where: { sectionId: section.id },
        select: { subjectId: true, staffId: true },
      });
      const staffBySubject = new Map(
        subjectTeachers.map((entry) => [entry.subjectId, entry.staffId]),
      );

      const sectionRecord = await prisma.section.findUniqueOrThrow({
        where: { id: section.id },
        select: { roomId: true },
      });

      // Build a pool of subject slots weighted by weekly period count.
      const pool: string[] = [];
      for (const entry of classSubjects) {
        for (let i = 0; i < entry.weeklyPeriods; i += 1) pool.push(entry.subjectId);
      }
      const shuffled = random.shuffle(pool);
      let cursor = 0;

      for (const day of WEEKDAYS) {
        // Saturday is a half day.
        const periodCount = day === DayOfWeek.SATURDAY ? 4 : periods.length;

        for (let index = 0; index < periodCount; index += 1) {
          const period = periods[index];
          const subjectId = shuffled[cursor % shuffled.length];
          cursor += 1;

          const staffId = staffBySubject.get(subjectId) ?? null;
          const teacherKey = staffId ? `${staffId}:${day}:${period.id}` : null;
          const roomKey = sectionRecord.roomId
            ? `${sectionRecord.roomId}:${day}:${period.id}`
            : null;

          // Skip rather than create a clashing slot; the timetable module's own
          // conflict detection must never find a contradiction in seeded data.
          if (teacherKey && teacherBusy.has(teacherKey)) continue;
          if (roomKey && roomBusy.has(roomKey)) continue;

          await prisma.timetableSlot.create({
            data: {
              schoolId,
              academicYearId,
              classId: cls.id,
              sectionId: section.id,
              periodId: period.id,
              subjectId,
              staffId,
              roomId: sectionRecord.roomId,
              dayOfWeek: day,
              isActive: true,
            },
          });

          if (teacherKey) teacherBusy.add(teacherKey);
          if (roomKey) roomBusy.add(roomKey);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

async function seedAttendance(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  people: PeopleSeedResult,
  random: Random,
): Promise<void> {
  const { schoolId } = school;

  const today = dateOnly(new Date());
  const start = addDays(today, -ATTENDANCE_DAYS);

  const holidays = await prisma.holiday.findMany({
    where: { schoolId, startDate: { lte: today }, endDate: { gte: start } },
    select: { startDate: true, endDate: true },
  });

  const isHoliday = (day: Date) =>
    holidays.some((holiday) => holiday.startDate <= day && holiday.endDate >= day);

  const days = schoolDaysBetween(start, today).filter((day) => !isHoliday(day));

  // Each student gets a stable "reliability" so the data shows a realistic
  // spread rather than uniform noise, including a few genuinely low cases.
  const reliability = new Map<string, number>();
  for (const student of people.students) {
    reliability.set(student.id, random.chance(0.08) ? random.next() * 0.25 + 0.55 : random.next() * 0.1 + 0.9);
  }

  const staffByStudentSection = new Map<string, string>();
  const sections = await prisma.section.findMany({
    where: { schoolId },
    select: { id: true, classTeacherId: true },
  });
  for (const section of sections) {
    if (section.classTeacherId) staffByStudentSection.set(section.id, section.classTeacherId);
  }

  const rows: Prisma.AttendanceCreateManyInput[] = [];

  for (const day of days) {
    for (const student of people.students) {
      const score = reliability.get(student.id) ?? 0.95;
      const roll = random.next();

      let status: AttendanceStatus;
      if (roll < score) status = AttendanceStatus.PRESENT;
      else if (roll < score + 0.04) status = AttendanceStatus.LATE;
      else if (roll < score + 0.06) status = AttendanceStatus.HALF_DAY;
      else if (roll < score + 0.07) status = AttendanceStatus.EXCUSED;
      else status = AttendanceStatus.ABSENT;

      rows.push({
        schoolId,
        studentId: student.id,
        classId: student.classId,
        sectionId: student.sectionId,
        date: day,
        sessionType: AttendanceSessionType.DAILY,
        status,
        lateMinutes: status === AttendanceStatus.LATE ? random.int(5, 40) : null,
        markedById: staffByStudentSection.get(student.sectionId) ?? null,
        source: 'MANUAL',
      });
    }
  }

  // Inserted in batches to keep the statement size reasonable.
  for (let index = 0; index < rows.length; index += 1000) {
    await prisma.attendance.createMany({
      data: rows.slice(index, index + 1000),
      skipDuplicates: true,
    });
  }

  // Staff attendance for the last two weeks.
  const staffRows: Prisma.StaffAttendanceCreateManyInput[] = [];
  for (const day of days.slice(-14)) {
    for (const member of people.staff) {
      const present = random.chance(0.95);
      staffRows.push({
        schoolId,
        staffId: member.id,
        date: day,
        status: present ? 'PRESENT' : random.chance(0.6) ? 'ON_LEAVE' : 'ABSENT',
        checkInAt: present ? new Date(day.getTime() + 8.5 * 3_600_000) : null,
        checkOutAt: present ? new Date(day.getTime() + 15.75 * 3_600_000) : null,
        workedMinutes: present ? 435 : null,
        source: 'MANUAL',
      });
    }
  }
  await prisma.staffAttendance.createMany({ data: staffRows, skipDuplicates: true });
}

// ---------------------------------------------------------------------------
// Homework
// ---------------------------------------------------------------------------

async function seedHomework(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  academics: AcademicsSeedResult,
  people: PeopleSeedResult,
  random: Random,
): Promise<void> {
  const { schoolId } = school;
  const today = dateOnly(new Date());

  const TITLES: Record<string, string[]> = {
    MATH: ['Practice: Quadratic Equations', 'Exercise 4.2 — Linear Equations', 'Revision: Trigonometry'],
    ENG: ['Essay: My Favourite Book', 'Grammar Worksheet — Tenses', 'Reading Comprehension Set 3'],
    SCI: ['Diagram: The Human Digestive System', 'Notes: Types of Chemical Reactions', 'Worksheet: Light and Reflection'],
    SST: ['Map Work: Indian Rivers', 'Notes: The French Revolution', 'Answer: Democracy and Diversity'],
    CS: ['Program: Sorting an Array', 'Worksheet: HTML Basics', 'Flowchart: Login Process'],
  };

  for (const cls of academics.classes) {
    for (const section of cls.sections) {
      const subjectTeachers = await prisma.subjectTeacher.findMany({
        where: { sectionId: section.id },
        take: 4,
        select: {
          subjectId: true,
          staffId: true,
          subject: { select: { code: true, name: true } },
        },
      });

      for (const [index, entry] of subjectTeachers.entries()) {
        const titles = TITLES[entry.subject.code] ?? [`Assignment — ${entry.subject.name}`];
        const assignedDate = addDays(today, -(index * 3 + random.int(1, 4)));
        const dueDate = addDays(assignedDate, random.int(2, 6));
        const isPast = dueDate < today;

        const homework = await prisma.homework.create({
          data: {
            schoolId,
            classId: cls.id,
            sectionId: section.id,
            subjectId: entry.subjectId,
            staffId: entry.staffId,
            title: random.pick(titles),
            description:
              'Complete the exercise in your notebook and submit it to the subject teacher on or before the due date. Show all working.',
            assignedDate,
            dueDate,
            priority: random.chance(0.2) ? Priority.IMPORTANT : Priority.NORMAL,
            status: HomeworkStatus.ASSIGNED,
            maxMarks: 10,
            publishedAt: assignedDate,
          },
          select: { id: true },
        });

        // Submissions only exist for homework whose due date has passed.
        if (!isPast) continue;

        const sectionStudents = people.students.filter(
          (student) => student.sectionId === section.id,
        );

        for (const student of sectionStudents) {
          const submitted = random.chance(0.85);
          if (!submitted) {
            await prisma.homeworkSubmission.create({
              data: {
                homeworkId: homework.id,
                studentId: student.id,
                status: SubmissionStatus.MISSED,
              },
            });
            continue;
          }

          const late = random.chance(0.15);
          const reviewed = random.chance(0.7);

          await prisma.homeworkSubmission.create({
            data: {
              homeworkId: homework.id,
              studentId: student.id,
              status: reviewed
                ? SubmissionStatus.REVIEWED
                : late
                  ? SubmissionStatus.LATE
                  : SubmissionStatus.SUBMITTED,
              content: 'Submitted in the notebook.',
              submittedAt: late ? addDays(dueDate, 1) : addDays(dueDate, -1),
              isLate: late,
              ...(reviewed
                ? {
                    marksAwarded: random.int(5, 10),
                    feedback: random.pick([
                      'Well done.',
                      'Good effort, watch your presentation.',
                      'Please redo question 3.',
                      'Excellent work.',
                    ]),
                    reviewedAt: addDays(dueDate, 2),
                  }
                : {}),
            },
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Examinations
// ---------------------------------------------------------------------------

async function seedExams(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  academics: AcademicsSeedResult,
  people: PeopleSeedResult,
  random: Random,
): Promise<string> {
  const { schoolId, academicYearId } = school;
  const today = dateOnly(new Date());

  const exam = await prisma.exam.create({
    data: {
      schoolId,
      academicYearId,
      gradeScaleId: academics.gradeScaleId,
      name: 'Unit Test 1',
      code: 'UT1',
      type: ExamType.UNIT_TEST,
      description: 'First unit test of the academic year',
      startDate: addDays(today, -30),
      endDate: addDays(today, -24),
      status: ExamStatus.PUBLISHED,
      weightage: 10,
      resultDate: addDays(today, -18),
      publishedAt: addDays(today, -18),
      marksLocked: true,
      showRank: true,
      instructions: 'All questions are compulsory. Calculators are not permitted.',
    },
    select: { id: true },
  });

  // An upcoming exam gives the dashboards something in the future to show.
  await prisma.exam.create({
    data: {
      schoolId,
      academicYearId,
      gradeScaleId: academics.gradeScaleId,
      name: 'Mid Term Examination',
      code: 'MID',
      type: ExamType.MID_TERM,
      startDate: addDays(today, 21),
      endDate: addDays(today, 30),
      status: ExamStatus.SCHEDULED,
      weightage: 30,
      instructions: 'Report to the examination hall 15 minutes before the start time.',
    },
  });

  const studentsByClass = new Map<string, PeopleSeedResult['students']>();
  for (const student of people.students) {
    const bucket = studentsByClass.get(student.classId) ?? [];
    bucket.push(student);
    studentsByClass.set(student.classId, bucket);
  }

  for (const cls of academics.classes) {
    await prisma.examClass.create({
      data: { examId: exam.id, classId: cls.id },
    });

    const classSubjects = await prisma.classSubject.findMany({
      where: { classId: cls.id },
      select: {
        subjectId: true,
        maxMarks: true,
        passMarks: true,
        subject: { select: { isGradedOnly: true } },
      },
    });

    // Co-scholastic subjects are graded, not examined in a unit test.
    const examinable = classSubjects.filter((entry) => !entry.subject.isGradedOnly);
    const classStudents = studentsByClass.get(cls.id) ?? [];

    for (const [index, entry] of examinable.entries()) {
      const examSubject = await prisma.examSubject.create({
        data: {
          examId: exam.id,
          classId: cls.id,
          subjectId: entry.subjectId,
          maxMarks: 25,
          passMarks: 9,
        },
        select: { id: true },
      });

      await prisma.examSchedule.create({
        data: {
          examId: exam.id,
          examSubjectId: examSubject.id,
          date: addDays(today, -30 + index),
          startTime: '09:00',
          endTime: '10:00',
          durationMinutes: 60,
        },
      });

      for (const student of classStudents) {
        const absent = random.chance(0.03);
        // Ability is stable per student so their marks correlate across subjects.
        const ability = 0.45 + ((student.id.charCodeAt(0) % 40) / 100);
        const raw = Math.min(
          25,
          Math.max(0, Math.round(25 * (ability + (random.next() - 0.5) * 0.3))),
        );

        const percentage = (raw / 25) * 100;
        const grade = gradeFor(percentage);

        await prisma.mark.create({
          data: {
            examId: exam.id,
            examSubjectId: examSubject.id,
            studentId: student.id,
            subjectId: entry.subjectId,
            marksObtained: absent ? null : raw,
            totalMarks: absent ? null : raw,
            grade: absent ? null : grade.grade,
            gradePoint: absent ? null : grade.point,
            isAbsent: absent,
            status: MarkStatus.PUBLISHED,
            enteredAt: addDays(today, -20),
            lockedAt: addDays(today, -19),
            publishedAt: addDays(today, -18),
          },
        });
      }
    }
  }

  return exam.id;
}

function gradeFor(percentage: number): { grade: string; point: number } {
  if (percentage >= 91) return { grade: 'A1', point: 10 };
  if (percentage >= 81) return { grade: 'A2', point: 9 };
  if (percentage >= 71) return { grade: 'B1', point: 8 };
  if (percentage >= 61) return { grade: 'B2', point: 7 };
  if (percentage >= 51) return { grade: 'C1', point: 6 };
  if (percentage >= 41) return { grade: 'C2', point: 5 };
  if (percentage >= 33) return { grade: 'D', point: 4 };
  return { grade: 'E', point: 0 };
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

async function seedFees(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  academics: AcademicsSeedResult,
  people: PeopleSeedResult,
  random: Random,
): Promise<void> {
  const { schoolId, academicYearId, academicYearName, currency } = school;
  const today = dateOnly(new Date());

  // --- Fee heads ---
  const headDefinitions = [
    { name: 'Admission Fee', code: 'ADMISSION', category: 'ADMISSION', frequency: 'ONE_TIME' as const },
    { name: 'Tuition Fee', code: 'TUITION', category: 'TUITION', frequency: 'ANNUAL' as const },
    { name: 'Examination Fee', code: 'EXAM', category: 'EXAM', frequency: 'ANNUAL' as const },
    { name: 'Library Fee', code: 'LIBRARY', category: 'LIBRARY', frequency: 'ANNUAL' as const },
    { name: 'Laboratory Fee', code: 'LAB', category: 'OTHER', frequency: 'ANNUAL' as const },
    { name: 'Activity Fee', code: 'ACTIVITY', category: 'ACTIVITY', frequency: 'ANNUAL' as const },
    { name: 'Transport Fee', code: 'TRANSPORT', category: 'TRANSPORT', frequency: 'ANNUAL' as const, linkedModule: 'transport', isOptional: true },
  ];

  const headIds: Record<string, string> = {};
  for (const [index, head] of headDefinitions.entries()) {
    const record = await prisma.feeHead.create({
      data: {
        schoolId,
        name: head.name,
        code: head.code,
        category: head.category,
        frequency: head.frequency,
        linkedModule: head.linkedModule ?? null,
        isOptional: head.isOptional ?? false,
        sortOrder: index,
      },
      select: { id: true },
    });
    headIds[head.code] = record.id;
  }

  // --- Discounts ---
  const siblingDiscount = await prisma.discount.create({
    data: {
      schoolId,
      name: 'Sibling Concession',
      code: 'SIBLING',
      kind: 'SIBLING',
      type: 'PERCENTAGE',
      value: 10,
      description: '10% off tuition for the second and subsequent child',
      feeHeadIds: [headIds.TUITION],
      requiresApproval: true,
    },
    select: { id: true },
  });

  await prisma.discount.create({
    data: {
      schoolId,
      name: 'Merit Scholarship',
      code: 'MERIT',
      kind: 'SCHOLARSHIP',
      type: 'PERCENTAGE',
      value: 25,
      description: '25% tuition waiver for students scoring above 90%',
      feeHeadIds: [headIds.TUITION],
      requiresApproval: true,
    },
  });

  await prisma.discount.create({
    data: {
      schoolId,
      name: 'Staff Ward Concession',
      code: 'STAFF_WARD',
      kind: 'STAFF_WARD',
      type: 'PERCENTAGE',
      value: 50,
      feeHeadIds: [headIds.TUITION],
      requiresApproval: true,
    },
  });

  // --- Fee structures, one per class, scaled by level ---
  const structureByClass = new Map<string, { id: string; total: number }>();

  for (const cls of academics.classes) {
    const tuition = 24_000 + cls.level * 2_000;
    const items = [
      { head: 'ADMISSION', amount: cls.level === 1 ? 15_000 : 0 },
      { head: 'TUITION', amount: tuition },
      { head: 'EXAM', amount: 2_500 },
      { head: 'LIBRARY', amount: 1_200 },
      { head: 'LAB', amount: cls.level >= 6 ? 3_000 : 0 },
      { head: 'ACTIVITY', amount: 2_000 },
    ].filter((item) => item.amount > 0);

    const total = items.reduce((sum, item) => sum + item.amount, 0);

    const structure = await prisma.feeStructure.create({
      data: {
        schoolId,
        academicYearId,
        classId: cls.id,
        name: `${cls.name} — ${academicYearName}`,
        description: `Annual fee structure for ${cls.name}`,
        totalAmount: total,
        currency,
        items: {
          create: items.map((item) => ({
            feeHeadId: headIds[item.head],
            amount: item.amount,
          })),
        },
        installments: {
          create: [
            { name: 'Term 1', sequence: 1, percentage: 40, dueDate: dateOnly(`${school.yearStart.getUTCFullYear()}-04-15`), lateFeeAfterDays: 7, lateFeePerDay: 20 },
            { name: 'Term 2', sequence: 2, percentage: 30, dueDate: dateOnly(`${school.yearStart.getUTCFullYear()}-08-15`), lateFeeAfterDays: 7, lateFeePerDay: 20 },
            { name: 'Term 3', sequence: 3, percentage: 30, dueDate: dateOnly(`${school.yearStart.getUTCFullYear()}-12-15`), lateFeeAfterDays: 7, lateFeePerDay: 20 },
          ],
        },
      },
      select: { id: true },
    });

    structureByClass.set(cls.id, { id: structure.id, total });
  }

  // --- Invoices and payments for term 1 ---
  let invoiceCounter = 1;
  let receiptCounter = 1;
  const period = academicYearName.replace(/[^\dA-Za-z-]/g, '');

  for (const student of people.students) {
    const structure = structureByClass.get(student.classId);
    if (!structure) continue;

    const installment = await prisma.feeInstallment.findFirstOrThrow({
      where: { feeStructureId: structure.id, sequence: 1 },
      select: { id: true, dueDate: true },
    });

    const items = await prisma.feeStructureItem.findMany({
      where: { feeStructureId: structure.id },
      select: { feeHeadId: true, amount: true, feeHead: { select: { name: true } } },
    });

    // Term 1 charges 40% of each line item.
    const lineItems = items.map((item) => ({
      feeHeadId: item.feeHeadId,
      description: `${item.feeHead.name} (Term 1)`,
      quantity: new Prisma.Decimal(1),
      unitAmount: new Prisma.Decimal(Number(item.amount) * 0.4),
      amount: new Prisma.Decimal(Number(item.amount) * 0.4),
    }));

    const subtotal = lineItems.reduce((sum, item) => sum + Number(item.amount), 0);

    // A tenth of students carry a sibling concession.
    const hasDiscount = random.chance(0.1);
    const discountTotal = hasDiscount ? Math.round(subtotal * 0.1) : 0;
    const total = subtotal - discountTotal;

    if (hasDiscount) {
      await prisma.studentDiscount.create({
        data: {
          studentId: student.id,
          discountId: siblingDiscount.id,
          academicYearId,
          reason: 'Second child studying in the school',
          approvedAt: school.yearStart,
          isActive: true,
        },
      });
    }

    // Roughly 70% paid in full, 15% part-paid, 15% unpaid.
    const roll = random.next();
    const paidAmount = roll < 0.7 ? total : roll < 0.85 ? Math.round(total * 0.5) : 0;
    const balance = total - paidAmount;
    const isOverdue = balance > 0 && installment.dueDate < today;

    const invoice = await prisma.invoice.create({
      data: {
        schoolId,
        academicYearId,
        studentId: student.id,
        feeStructureId: structure.id,
        installmentId: installment.id,
        invoiceNumber: `INV/${period}/${String(invoiceCounter++).padStart(5, '0')}`,
        status:
          balance === 0
            ? InvoiceStatus.PAID
            : paidAmount > 0
              ? InvoiceStatus.PARTIALLY_PAID
              : isOverdue
                ? InvoiceStatus.OVERDUE
                : InvoiceStatus.ISSUED,
        issueDate: school.yearStart,
        dueDate: installment.dueDate,
        subtotal,
        discountTotal,
        total,
        paidAmount,
        balance,
        currency,
        items: { create: lineItems },
      },
      select: { id: true },
    });

    await prisma.ledgerEntry.create({
      data: {
        schoolId,
        studentId: student.id,
        invoiceId: invoice.id,
        type: LedgerEntryType.INVOICE,
        debit: total,
        credit: 0,
        balanceAfter: total,
        currency,
        description: `Invoice raised for Term 1`,
        occurredAt: school.yearStart,
      },
    });

    if (paidAmount <= 0) continue;

    const method = random.pick([
      PaymentMethod.UPI,
      PaymentMethod.ONLINE_GATEWAY,
      PaymentMethod.CASH,
      PaymentMethod.NET_BANKING,
      PaymentMethod.CARD,
    ]);
    const paidAt = addDays(installment.dueDate, -random.int(0, 20));

    const payment = await prisma.payment.create({
      data: {
        schoolId,
        studentId: student.id,
        receiptNumber: `RCP/${period}/${String(receiptCounter++).padStart(5, '0')}`,
        method,
        status: PaymentStatus.SUCCESS,
        amount: paidAmount,
        allocatedAmount: paidAmount,
        currency,
        paidAt,
        ...(method === PaymentMethod.ONLINE_GATEWAY
          ? {
              gateway: 'razorpay',
              gatewayOrderId: `order_seed_${invoice.id.slice(0, 12)}`,
              gatewayPaymentId: `pay_seed_${invoice.id.slice(0, 12)}`,
            }
          : {}),
        allocations: { create: { invoiceId: invoice.id, amount: paidAmount } },
      },
      select: { id: true },
    });

    await prisma.ledgerEntry.create({
      data: {
        schoolId,
        studentId: student.id,
        invoiceId: invoice.id,
        paymentId: payment.id,
        type: LedgerEntryType.PAYMENT,
        debit: 0,
        credit: paidAmount,
        balanceAfter: balance,
        currency,
        description: `Payment received via ${method}`,
        occurredAt: paidAt,
      },
    });
  }

  // Seed the number sequences so future invoices continue from here.
  await prisma.numberSequence.createMany({
    data: [
      { schoolId, kind: 'INVOICE', period, prefix: 'INV', nextValue: invoiceCounter, padding: 5 },
      { schoolId, kind: 'RECEIPT', period, prefix: 'RCP', nextValue: receiptCounter, padding: 5 },
      { schoolId, kind: 'ADMISSION', period: '', prefix: 'ADM', nextValue: people.students.length + 1, padding: 5 },
    ],
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// Notices and events
// ---------------------------------------------------------------------------

async function seedNotices(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  people: PeopleSeedResult,
): Promise<void> {
  const { schoolId } = school;
  const today = dateOnly(new Date());
  const author = people.adminUserId;

  const notices = [
    {
      title: 'Parent–Teacher Meeting — Saturday',
      body: 'The first parent–teacher meeting of the academic year will be held on Saturday from 9:00 AM to 1:00 PM. Parents are requested to meet the class teacher first, followed by subject teachers. Please carry the student diary.',
      audience: NoticeAudience.PARENTS,
      priority: Priority.IMPORTANT,
      pinned: true,
      daysAgo: 2,
    },
    {
      title: 'Unit Test 1 results published',
      body: 'Results for Unit Test 1 are now available in the parent portal. Report cards can be downloaded from the Results section. Please contact the class teacher for any clarification.',
      audience: NoticeAudience.ALL,
      priority: Priority.NORMAL,
      pinned: false,
      daysAgo: 18,
    },
    {
      title: 'Annual Sports Day — call for participation',
      body: 'Registrations for Annual Sports Day are open. Students interested in track events, team sports or athletics should register with their physical education teacher before the end of this month.',
      audience: NoticeAudience.STUDENTS,
      priority: Priority.NORMAL,
      pinned: false,
      daysAgo: 5,
    },
    {
      title: 'Revised school timings from Monday',
      body: 'With effect from Monday, school will begin at 8:30 AM and close at 3:30 PM. School buses will run 15 minutes earlier on their existing routes. Parents are requested to plan accordingly.',
      audience: NoticeAudience.ALL,
      priority: Priority.URGENT,
      pinned: true,
      daysAgo: 1,
    },
    {
      title: 'Staff meeting — curriculum planning',
      body: 'All teaching staff are required to attend the curriculum planning meeting in the auditorium on Friday at 3:45 PM. Heads of department should bring their subject-wise progress reports.',
      audience: NoticeAudience.TEACHERS,
      priority: Priority.IMPORTANT,
      pinned: false,
      daysAgo: 3,
    },
    {
      title: 'Library book return reminder',
      body: 'Students holding library books beyond the due date are requested to return them this week. A fine of ₹2 per day applies after the due date.',
      audience: NoticeAudience.STUDENTS,
      priority: Priority.NORMAL,
      pinned: false,
      daysAgo: 7,
    },
  ];

  for (const notice of notices) {
    await prisma.notice.create({
      data: {
        schoolId,
        authorId: author,
        title: notice.title,
        body: notice.body,
        kind: 'NOTICE',
        audience: notice.audience,
        priority: notice.priority,
        status: NoticeStatus.PUBLISHED,
        isPinned: notice.pinned,
        publishAt: addDays(today, -notice.daysAgo),
        publishedAt: addDays(today, -notice.daysAgo),
        expiresAt: addDays(today, 30),
        sendPush: true,
      },
    });
  }
}

async function seedEvents(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  people: PeopleSeedResult,
): Promise<void> {
  const { schoolId, academicYearId } = school;
  const today = dateOnly(new Date());

  const events = [
    { title: 'Annual Sports Day', type: 'SPORTS_DAY' as const, days: 25, venue: 'School Grounds', registration: true },
    { title: 'Parent–Teacher Meeting', type: 'PARENT_MEETING' as const, days: 6, venue: 'Classrooms', registration: false },
    { title: 'Science Exhibition', type: 'COMPETITION' as const, days: 40, venue: 'Science Block', registration: true },
    { title: 'Annual Day Celebration', type: 'ANNUAL_DAY' as const, days: 75, venue: 'Auditorium', registration: false },
    { title: 'Educational Trip — Mysuru', type: 'TRIP' as const, days: 50, venue: 'Mysuru', registration: true },
  ];

  for (const event of events) {
    await prisma.event.create({
      data: {
        schoolId,
        academicYearId,
        title: event.title,
        description: `${event.title} organised by Greenfield International School.`,
        type: event.type,
        startAt: new Date(addDays(today, event.days).getTime() + 9 * 3_600_000),
        endAt: new Date(addDays(today, event.days).getTime() + 16 * 3_600_000),
        venue: event.venue,
        audience: NoticeAudience.ALL,
        requiresRegistration: event.registration,
        registrationDeadline: event.registration ? addDays(today, event.days - 7) : null,
        maxParticipants: event.registration ? 200 : null,
        isPublished: true,
        isPublic: true,
        createdById: people.adminUserId,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

async function seedLibrary(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  people: PeopleSeedResult,
  random: Random,
): Promise<void> {
  const { schoolId } = school;
  const today = dateOnly(new Date());

  const categories = [
    { name: 'Fiction', code: 'FIC' },
    { name: 'Science', code: 'SCI' },
    { name: 'Mathematics', code: 'MATH' },
    { name: 'History', code: 'HIST' },
    { name: 'Reference', code: 'REF' },
    { name: 'Children', code: 'CHILD' },
  ];

  const categoryIds: Record<string, string> = {};
  for (const category of categories) {
    const record = await prisma.bookCategory.create({
      data: { schoolId, ...category },
      select: { id: true },
    });
    categoryIds[category.code] = record.id;
  }

  const books = [
    { title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', category: 'FIC', isbn: '9788173711466', copies: 5 },
    { title: 'A Brief History of Time', author: 'Stephen Hawking', category: 'SCI', isbn: '9780553380163', copies: 3 },
    { title: 'The Man Who Knew Infinity', author: 'Robert Kanigel', category: 'MATH', isbn: '9781476763491', copies: 3 },
    { title: 'India After Gandhi', author: 'Ramachandra Guha', category: 'HIST', isbn: '9780330396110', copies: 4 },
    { title: 'Oxford English Dictionary', author: 'Oxford Press', category: 'REF', isbn: '9780199571123', copies: 6 },
    { title: 'Malgudi Days', author: 'R. K. Narayan', category: 'FIC', isbn: '9780143039655', copies: 5 },
    { title: 'The Jungle Book', author: 'Rudyard Kipling', category: 'CHILD', isbn: '9780141325293', copies: 4 },
    { title: 'Cosmos', author: 'Carl Sagan', category: 'SCI', isbn: '9780345539434', copies: 3 },
    { title: 'Panchatantra Tales', author: 'Vishnu Sharma', category: 'CHILD', isbn: '9788175994553', copies: 6 },
    { title: 'The Discovery of India', author: 'Jawaharlal Nehru', category: 'HIST', isbn: '9780143031031', copies: 3 },
  ];

  let accession = 1000;
  const copyIds: string[] = [];

  for (const book of books) {
    const record = await prisma.book.create({
      data: {
        schoolId,
        categoryId: categoryIds[book.category],
        title: book.title,
        author: book.author,
        publisher: 'Various',
        isbn: book.isbn,
        language: 'English',
        rackLocation: `Rack ${random.int(1, 12)}`,
        price: random.int(200, 900),
        totalCopies: book.copies,
        availableCopies: book.copies,
        copies: {
          create: Array.from({ length: book.copies }, () => ({
            accessionNumber: `ACC${accession++}`,
            status: 'AVAILABLE' as const,
            condition: 'GOOD',
          })),
        },
      },
      select: { id: true, copies: { select: { id: true } } },
    });
    copyIds.push(...record.copies.map((copy) => copy.id));
  }

  // Library memberships for senior students.
  const seniorStudents = people.students.filter((student) => student.level >= 5).slice(0, 20);
  let cardNumber = 1;

  for (const student of seniorStudents) {
    await prisma.libraryMembership.create({
      data: {
        schoolId,
        memberType: 'STUDENT',
        studentId: student.id,
        cardNumber: `LIB/${String(cardNumber++).padStart(4, '0')}`,
        maxBooks: 2,
        maxDays: 14,
        validFrom: school.yearStart,
        isActive: true,
      },
    });
  }

  // A handful of active and overdue loans so the module has real state.
  for (let index = 0; index < 12; index += 1) {
    const student = seniorStudents[index % seniorStudents.length];
    const copyId = copyIds[index];
    if (!student || !copyId) continue;

    const overdue = index % 4 === 0;
    const issueDate = addDays(today, overdue ? -25 : -6);
    const dueDate = addDays(issueDate, 14);
    const returned = index % 3 === 1;

    const issue = await prisma.libraryIssue.create({
      data: {
        schoolId,
        bookCopyId: copyId,
        studentId: student.id,
        issueDate,
        dueDate,
        returnDate: returned ? addDays(dueDate, -2) : null,
        status: returned ? 'RETURNED' : overdue ? 'OVERDUE' : 'ISSUED',
      },
      select: { id: true },
    });

    if (!returned) {
      await prisma.bookCopy.update({ where: { id: copyId }, data: { status: 'ISSUED' } });
    }

    if (overdue && !returned) {
      const daysLate = Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000);
      await prisma.libraryFine.create({
        data: {
          issueId: issue.id,
          reason: 'OVERDUE',
          amount: daysLate * 2,
          isSettled: false,
        },
      });
    }
  }

  // Keep the denormalised availability counters consistent.
  const allBooks = await prisma.book.findMany({
    where: { schoolId },
    select: { id: true, copies: { select: { status: true } } },
  });
  for (const book of allBooks) {
    await prisma.book.update({
      where: { id: book.id },
      data: {
        availableCopies: book.copies.filter((copy) => copy.status === 'AVAILABLE').length,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function seedTransport(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  people: PeopleSeedResult,
  random: Random,
): Promise<void> {
  const { schoolId, academicYearId } = school;

  const vehicles = [
    { registrationNumber: 'KA01AB1234', name: 'Bus 1', capacity: 45 },
    { registrationNumber: 'KA01AB5678', name: 'Bus 2', capacity: 45 },
    { registrationNumber: 'KA01AB9012', name: 'Bus 3', capacity: 35 },
  ];

  const drivers = [
    { name: 'Mahadev Patil', licenseNumber: 'KA0120150001234', phone: '+919845100001' },
    { name: 'Ravi Shankar', licenseNumber: 'KA0120160005678', phone: '+919845100002' },
    { name: 'Ganesh Rao', licenseNumber: 'KA0120170009012', phone: '+919845100003' },
  ];

  const routeDefinitions = [
    {
      name: 'Route A — Sarjapur',
      code: 'RT-A',
      fare: 12_000,
      stops: ['Sarjapur Signal', 'Dommasandra', 'Carmelaram', 'Kaikondrahalli'],
    },
    {
      name: 'Route B — Whitefield',
      code: 'RT-B',
      fare: 14_000,
      stops: ['Whitefield Market', 'Varthur Kodi', 'Gunjur', 'Balagere'],
    },
    {
      name: 'Route C — HSR Layout',
      code: 'RT-C',
      fare: 10_000,
      stops: ['HSR Sector 1', 'Agara Lake', 'Bellandur Gate'],
    },
  ];

  const routeIds: string[] = [];
  const stopIdsByRoute = new Map<string, string[]>();

  for (const [index, definition] of routeDefinitions.entries()) {
    const vehicle = await prisma.vehicle.create({
      data: {
        schoolId,
        ...vehicles[index],
        type: 'BUS',
        make: 'Tata',
        model: 'Starbus',
        status: 'ACTIVE',
        insuranceExpiry: dateOnly(`${new Date().getUTCFullYear() + 1}-03-31`),
        fitnessExpiry: dateOnly(`${new Date().getUTCFullYear() + 1}-06-30`),
        trackingEnabled: false,
      },
      select: { id: true },
    });

    const driver = await prisma.driver.create({
      data: {
        schoolId,
        ...drivers[index],
        licenseExpiry: dateOnly(`${new Date().getUTCFullYear() + 2}-12-31`),
        role: 'DRIVER',
        isActive: true,
      },
      select: { id: true },
    });

    const route = await prisma.transportRoute.create({
      data: {
        schoolId,
        vehicleId: vehicle.id,
        driverId: driver.id,
        name: definition.name,
        code: definition.code,
        distanceKm: random.int(8, 25),
        startTime: '07:00',
        endTime: '08:15',
        baseFare: definition.fare,
        isActive: true,
        stops: {
          create: definition.stops.map((stop, stopIndex) => ({
            name: stop,
            sequence: stopIndex + 1,
            pickupTime: `07:${String(stopIndex * 12).padStart(2, '0')}`,
            dropTime: `15:${String(45 + stopIndex * 12).padStart(2, '0')}`,
            fare: 0,
          })),
        },
      },
      select: { id: true, stops: { select: { id: true } } },
    });

    routeIds.push(route.id);
    stopIdsByRoute.set(route.id, route.stops.map((stop) => stop.id));
  }

  // About a third of students use school transport.
  for (const student of people.students) {
    if (!random.chance(0.35)) continue;

    const routeId = random.pick(routeIds);
    const stops = stopIdsByRoute.get(routeId) ?? [];

    await prisma.studentTransport.create({
      data: {
        studentId: student.id,
        academicYearId,
        routeId,
        pickupStopId: stops.length ? random.pick(stops) : null,
        direction: 'BOTH',
        fareAmount: routeDefinitions[routeIds.indexOf(routeId)]?.fare ?? 12_000,
        startDate: school.yearStart,
        isActive: true,
      },
    });
  }
}
