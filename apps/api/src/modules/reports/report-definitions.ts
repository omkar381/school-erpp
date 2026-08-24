import type { PrismaService } from '../../database/prisma.service';
import { PERMISSIONS } from '../../common/constants/permissions';
import { MODULES } from '../../common/constants/modules';
import type { ExportColumn } from './export.service';

/** A filter the caller may pass, described well enough to build a form from. */
export interface ReportFilter {
  key: string;
  label: string;
  type: 'date' | 'uuid' | 'text' | 'enum' | 'boolean';
  required?: boolean;
  options?: string[];
  /** Which lookup the UI should populate a picker from. */
  source?: 'class' | 'section' | 'academicYear' | 'subject' | 'staff' | 'feeHead' | 'route';
}

export interface ReportContext {
  prisma: PrismaService;
  schoolId: string;
  filters: Record<string, string | undefined>;
  /** Resolved from the filters, or the school's current year. */
  academicYearId: string;
  timezone: string;
}

export interface ReportResult {
  rows: Array<Record<string, string | number | null>>;
  /** Headline figures shown above the table. */
  summary?: Array<{ label: string; value: string }>;
  /** Column-keyed totals appended as a final row. */
  totals?: Record<string, string | number>;
}

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  module: string;
  permission: string;
  /** Printed landscape when the table is wide. */
  landscape?: boolean;
  filters: ReportFilter[];
  columns: ExportColumn[];
  run(context: ReportContext): Promise<ReportResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_RANGE: ReportFilter[] = [
  { key: 'from', label: 'From', type: 'date', required: true },
  { key: 'to', label: 'To', type: 'date', required: true },
];

const CLASS_SECTION: ReportFilter[] = [
  { key: 'classId', label: 'Class', type: 'uuid', source: 'class' },
  { key: 'sectionId', label: 'Section', type: 'uuid', source: 'section' },
];

function day(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/** Exclusive upper bound for an inclusive `to` date. */
function endOf(value: string | undefined, fallback: Date): Date {
  return new Date(day(value, fallback).getTime() + 86_400_000);
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Number(((part / whole) * 100).toFixed(2)) : 0;
}

function fullName(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function money(value: unknown): number {
  return Number(value ?? 0);
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

const studentRoll: ReportDefinition = {
  key: 'student-roll',
  name: 'Student roll',
  description: 'Every enrolled student with class, guardian and contact details.',
  module: MODULES.STUDENTS,
  permission: PERMISSIONS.STUDENTS_VIEW,
  landscape: true,
  filters: [
    ...CLASS_SECTION,
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      options: ['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'ALUMNI', 'SUSPENDED'],
    },
  ],
  columns: [
    { key: 'admissionNumber', label: 'Admission No.' },
    { key: 'rollNumber', label: 'Roll No.' },
    { key: 'name', label: 'Student' },
    { key: 'className', label: 'Class' },
    { key: 'sectionName', label: 'Section' },
    { key: 'gender', label: 'Gender' },
    { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
    { key: 'guardianName', label: 'Guardian' },
    { key: 'guardianPhone', label: 'Phone' },
    { key: 'status', label: 'Status' },
  ],
  async run({ prisma, schoolId, filters, academicYearId }) {
    const students = await prisma.student.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filters.status ? { status: filters.status as never } : { status: 'ACTIVE' }),
        enrollments: {
          some: {
            academicYearId,
            status: 'ACTIVE',
            ...(filters.classId ? { classId: filters.classId } : {}),
            ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
          },
        },
      },
      select: {
        admissionNumber: true,
        firstName: true,
        middleName: true,
        lastName: true,
        gender: true,
        dateOfBirth: true,
        status: true,
        enrollments: {
          where: { academicYearId, status: 'ACTIVE' },
          take: 1,
          select: {
            rollNumber: true,
            class: { select: { name: true, level: true } },
            section: { select: { name: true } },
          },
        },
        guardians: {
          orderBy: { isPrimary: 'desc' },
          take: 1,
          select: { guardian: { select: { firstName: true, lastName: true, phone: true } } },
        },
      },
      orderBy: [{ admissionNumber: 'asc' }],
    });

    const rows = students.map((student) => {
      const enrollment = student.enrollments[0];
      const guardian = student.guardians[0]?.guardian;
      return {
        admissionNumber: student.admissionNumber,
        rollNumber: enrollment?.rollNumber ?? '—',
        name: fullName([student.firstName, student.middleName, student.lastName]),
        className: enrollment?.class?.name ?? '—',
        sectionName: enrollment?.section?.name ?? '—',
        gender: student.gender,
        dateOfBirth: student.dateOfBirth.toISOString().slice(0, 10),
        guardianName: guardian ? fullName([guardian.firstName, guardian.lastName]) : '—',
        guardianPhone: guardian?.phone ?? '—',
        status: student.status,
      };
    });

    const boys = rows.filter((row) => row.gender === 'MALE').length;
    const girls = rows.filter((row) => row.gender === 'FEMALE').length;

    return {
      rows,
      summary: [
        { label: 'Students', value: String(rows.length) },
        { label: 'Boys', value: String(boys) },
        { label: 'Girls', value: String(girls) },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

const attendanceSummary: ReportDefinition = {
  key: 'attendance-summary',
  name: 'Student attendance summary',
  description: 'Present, absent and late days per student over a date range, with percentage.',
  module: MODULES.ATTENDANCE,
  permission: PERMISSIONS.ATTENDANCE_REPORTS,
  landscape: true,
  filters: [...DATE_RANGE, ...CLASS_SECTION],
  columns: [
    { key: 'admissionNumber', label: 'Admission No.' },
    { key: 'name', label: 'Student' },
    { key: 'className', label: 'Class' },
    { key: 'sectionName', label: 'Section' },
    { key: 'present', label: 'Present', type: 'number' },
    { key: 'absent', label: 'Absent', type: 'number' },
    { key: 'late', label: 'Late', type: 'number' },
    { key: 'halfDay', label: 'Half day', type: 'number' },
    { key: 'excused', label: 'Excused', type: 'number' },
    { key: 'marked', label: 'Days marked', type: 'number' },
    { key: 'percentage', label: 'Attendance %', type: 'percent' },
  ],
  async run({ prisma, schoolId, filters, academicYearId }) {
    const from = day(filters.from, new Date(Date.now() - 30 * 86_400_000));
    const to = endOf(filters.to, new Date());

    const grouped = await prisma.attendance.groupBy({
      by: ['studentId', 'status'],
      where: {
        schoolId,
        date: { gte: from, lt: to },
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
      },
      _count: { _all: true },
    });

    const studentIds = [...new Set(grouped.map((row) => row.studentId))];
    if (studentIds.length === 0) return { rows: [] };

    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        admissionNumber: true,
        firstName: true,
        middleName: true,
        lastName: true,
        enrollments: {
          where: { academicYearId, status: 'ACTIVE' },
          take: 1,
          select: { class: { select: { name: true } }, section: { select: { name: true } } },
        },
      },
    });

    const byStudent = new Map(students.map((student) => [student.id, student]));

    const rows = studentIds
      .map((studentId) => {
        const student = byStudent.get(studentId);
        const counts = grouped.filter((row) => row.studentId === studentId);
        const of = (status: string) =>
          counts.find((row) => row.status === status)?._count._all ?? 0;

        const present = of('PRESENT');
        const late = of('LATE');
        const halfDay = of('HALF_DAY');
        const absent = of('ABSENT');
        const excused = of('EXCUSED');
        const marked = present + late + halfDay + absent + excused;

        // A half day counts as half a day present, which is what the
        // attendance percentage on a report card has to reflect.
        const attended = present + late + halfDay * 0.5 + excused;

        return {
          admissionNumber: student?.admissionNumber ?? '—',
          name: student
            ? fullName([student.firstName, student.middleName, student.lastName])
            : '—',
          className: student?.enrollments[0]?.class?.name ?? '—',
          sectionName: student?.enrollments[0]?.section?.name ?? '—',
          present,
          absent,
          late,
          halfDay,
          excused,
          marked,
          percentage: percent(attended, marked),
        };
      })
      .sort((a, b) => a.percentage - b.percentage);

    const totalMarked = rows.reduce((sum, row) => sum + row.marked, 0);
    const totalPresent = rows.reduce((sum, row) => sum + row.present, 0);

    return {
      rows,
      summary: [
        { label: 'Students', value: String(rows.length) },
        { label: 'Overall attendance', value: `${percent(totalPresent, totalMarked)}%` },
        { label: 'Below 75%', value: String(rows.filter((row) => row.percentage < 75).length) },
      ],
      totals: {
        present: totalPresent,
        absent: rows.reduce((sum, row) => sum + row.absent, 0),
        marked: totalMarked,
      },
    };
  },
};

const lowAttendance: ReportDefinition = {
  key: 'low-attendance',
  name: 'Students below the attendance threshold',
  description: 'Students whose attendance has fallen below a threshold, worst first.',
  module: MODULES.ATTENDANCE,
  permission: PERMISSIONS.ATTENDANCE_REPORTS,
  filters: [
    ...DATE_RANGE,
    ...CLASS_SECTION,
    { key: 'threshold', label: 'Threshold %', type: 'text' },
  ],
  columns: [
    { key: 'admissionNumber', label: 'Admission No.' },
    { key: 'name', label: 'Student' },
    { key: 'className', label: 'Class' },
    { key: 'sectionName', label: 'Section' },
    { key: 'present', label: 'Present', type: 'number' },
    { key: 'absent', label: 'Absent', type: 'number' },
    { key: 'percentage', label: 'Attendance %', type: 'percent' },
    { key: 'guardianPhone', label: 'Guardian phone' },
  ],
  async run(context) {
    const threshold = Number(context.filters.threshold ?? 75);
    const base = await attendanceSummary.run(context);

    const flagged = base.rows.filter((row) => Number(row.percentage) < threshold);
    if (flagged.length === 0) return { rows: [] };

    const contacts = await context.prisma.student.findMany({
      where: {
        schoolId: context.schoolId,
        admissionNumber: { in: flagged.map((row) => String(row.admissionNumber)) },
      },
      select: {
        admissionNumber: true,
        guardians: {
          orderBy: { isPrimary: 'desc' },
          take: 1,
          select: { guardian: { select: { phone: true } } },
        },
      },
    });

    const phones = new Map(
      contacts.map((student) => [
        student.admissionNumber,
        student.guardians[0]?.guardian.phone ?? '—',
      ]),
    );

    return {
      rows: flagged.map((row) => ({
        admissionNumber: row.admissionNumber,
        name: row.name,
        className: row.className,
        sectionName: row.sectionName,
        present: row.present,
        absent: row.absent,
        percentage: row.percentage,
        guardianPhone: phones.get(String(row.admissionNumber)) ?? '—',
      })),
      summary: [
        { label: 'Below threshold', value: String(flagged.length) },
        { label: 'Threshold', value: `${threshold}%` },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

const feeCollection: ReportDefinition = {
  key: 'fee-collection',
  name: 'Fee collection',
  description: 'Every settled payment in a date range, with method and collector.',
  module: MODULES.FEES,
  permission: PERMISSIONS.FEES_REPORTS,
  landscape: true,
  filters: [
    ...DATE_RANGE,
    ...CLASS_SECTION,
    {
      key: 'method',
      label: 'Method',
      type: 'enum',
      options: ['CASH', 'UPI', 'CARD', 'NET_BANKING', 'CHEQUE', 'ONLINE', 'BANK_TRANSFER'],
    },
  ],
  columns: [
    { key: 'receiptNumber', label: 'Receipt No.' },
    { key: 'paidAt', label: 'Date', type: 'date' },
    { key: 'admissionNumber', label: 'Admission No.' },
    { key: 'name', label: 'Student' },
    { key: 'className', label: 'Class' },
    { key: 'method', label: 'Method' },
    { key: 'reference', label: 'Reference' },
    { key: 'amount', label: 'Amount', type: 'currency' },
  ],
  async run({ prisma, schoolId, filters, academicYearId }) {
    const from = day(filters.from, new Date(Date.now() - 30 * 86_400_000));
    const to = endOf(filters.to, new Date());

    const payments = await prisma.payment.findMany({
      where: {
        schoolId,
        status: 'SUCCESS',
        paidAt: { gte: from, lt: to },
        ...(filters.method ? { method: filters.method as never } : {}),
        ...(filters.classId || filters.sectionId
          ? {
              student: {
                enrollments: {
                  some: {
                    academicYearId,
                    status: 'ACTIVE',
                    ...(filters.classId ? { classId: filters.classId } : {}),
                    ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
                  },
                },
              },
            }
          : {}),
      },
      orderBy: { paidAt: 'asc' },
      select: {
        receiptNumber: true,
        paidAt: true,
        method: true,
        amount: true,
        referenceNumber: true,
        gatewayPaymentId: true,
        student: {
          select: {
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            enrollments: {
              where: { academicYearId, status: 'ACTIVE' },
              take: 1,
              select: {
                class: { select: { name: true } },
                section: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const rows = payments.map((payment) => {
      const enrollment = payment.student.enrollments[0];
      return {
        receiptNumber: payment.receiptNumber,
        paidAt: (payment.paidAt ?? new Date()).toISOString().slice(0, 10),
        admissionNumber: payment.student.admissionNumber,
        name: fullName([
          payment.student.firstName,
          payment.student.middleName,
          payment.student.lastName,
        ]),
        className: enrollment
          ? `${enrollment.class?.name ?? ''} ${enrollment.section?.name ?? ''}`.trim()
          : '—',
        method: payment.method,
        reference: payment.referenceNumber ?? payment.gatewayPaymentId ?? '—',
        amount: money(payment.amount),
      };
    });

    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    const byMethod = new Map<string, number>();
    for (const row of rows) {
      byMethod.set(row.method, (byMethod.get(row.method) ?? 0) + row.amount);
    }

    return {
      rows,
      summary: [
        { label: 'Receipts', value: String(rows.length) },
        { label: 'Collected', value: total.toLocaleString('en-IN') },
        ...[...byMethod.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([method, amount]) => ({
            label: method.replace(/_/g, ' '),
            value: amount.toLocaleString('en-IN'),
          })),
      ],
      totals: { amount: total },
    };
  },
};

const outstandingFees: ReportDefinition = {
  key: 'outstanding-fees',
  name: 'Outstanding fees',
  description: 'Unpaid invoice balances by student, with how long they have been overdue.',
  module: MODULES.FEES,
  permission: PERMISSIONS.FEES_REPORTS,
  landscape: true,
  filters: [...CLASS_SECTION, { key: 'minAmount', label: 'Minimum balance', type: 'text' }],
  columns: [
    { key: 'admissionNumber', label: 'Admission No.' },
    { key: 'name', label: 'Student' },
    { key: 'className', label: 'Class' },
    { key: 'invoices', label: 'Invoices', type: 'number' },
    { key: 'billed', label: 'Billed', type: 'currency' },
    { key: 'paid', label: 'Paid', type: 'currency' },
    { key: 'balance', label: 'Outstanding', type: 'currency' },
    { key: 'oldestDueDate', label: 'Oldest due', type: 'date' },
    { key: 'daysOverdue', label: 'Days overdue', type: 'number' },
    { key: 'guardianPhone', label: 'Guardian phone' },
  ],
  async run({ prisma, schoolId, filters, academicYearId }) {
    const minAmount = Number(filters.minAmount ?? 0);

    const invoices = await prisma.invoice.findMany({
      where: {
        schoolId,
        academicYearId,
        status: { notIn: ['CANCELLED', 'VOID', 'PAID'] },
        balance: { gt: 0 },
        ...(filters.classId || filters.sectionId
          ? {
              student: {
                enrollments: {
                  some: {
                    academicYearId,
                    status: 'ACTIVE',
                    ...(filters.classId ? { classId: filters.classId } : {}),
                    ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
                  },
                },
              },
            }
          : {}),
      },
      select: {
        studentId: true,
        total: true,
        paidAmount: true,
        balance: true,
        dueDate: true,
        student: {
          select: {
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            enrollments: {
              where: { academicYearId, status: 'ACTIVE' },
              take: 1,
              select: {
                class: { select: { name: true } },
                section: { select: { name: true } },
              },
            },
            guardians: {
              orderBy: { isPrimary: 'desc' },
              take: 1,
              select: { guardian: { select: { phone: true } } },
            },
          },
        },
      },
    });

    const byStudent = new Map<
      string,
      {
        admissionNumber: string;
        name: string;
        className: string;
        invoices: number;
        billed: number;
        paid: number;
        balance: number;
        oldestDueDate: Date;
        guardianPhone: string;
      }
    >();

    for (const invoice of invoices) {
      const existing = byStudent.get(invoice.studentId);
      const enrollment = invoice.student.enrollments[0];

      if (existing) {
        existing.invoices += 1;
        existing.billed += money(invoice.total);
        existing.paid += money(invoice.paidAmount);
        existing.balance += money(invoice.balance);
        if (invoice.dueDate < existing.oldestDueDate) existing.oldestDueDate = invoice.dueDate;
        continue;
      }

      byStudent.set(invoice.studentId, {
        admissionNumber: invoice.student.admissionNumber,
        name: fullName([
          invoice.student.firstName,
          invoice.student.middleName,
          invoice.student.lastName,
        ]),
        className: enrollment
          ? `${enrollment.class?.name ?? ''} ${enrollment.section?.name ?? ''}`.trim()
          : '—',
        invoices: 1,
        billed: money(invoice.total),
        paid: money(invoice.paidAmount),
        balance: money(invoice.balance),
        oldestDueDate: invoice.dueDate,
        guardianPhone: invoice.student.guardians[0]?.guardian.phone ?? '—',
      });
    }

    const now = Date.now();
    const rows = [...byStudent.values()]
      .filter((entry) => entry.balance >= minAmount)
      .map((entry) => ({
        admissionNumber: entry.admissionNumber,
        name: entry.name,
        className: entry.className,
        invoices: entry.invoices,
        billed: Number(entry.billed.toFixed(2)),
        paid: Number(entry.paid.toFixed(2)),
        balance: Number(entry.balance.toFixed(2)),
        oldestDueDate: entry.oldestDueDate.toISOString().slice(0, 10),
        daysOverdue: Math.max(
          0,
          Math.floor((now - entry.oldestDueDate.getTime()) / 86_400_000),
        ),
        guardianPhone: entry.guardianPhone,
      }))
      .sort((a, b) => b.balance - a.balance);

    const total = rows.reduce((sum, row) => sum + row.balance, 0);

    return {
      rows,
      summary: [
        { label: 'Students owing', value: String(rows.length) },
        { label: 'Outstanding', value: total.toLocaleString('en-IN') },
        {
          label: 'Overdue 30+ days',
          value: String(rows.filter((row) => row.daysOverdue >= 30).length),
        },
      ],
      totals: {
        billed: Number(rows.reduce((sum, row) => sum + row.billed, 0).toFixed(2)),
        paid: Number(rows.reduce((sum, row) => sum + row.paid, 0).toFixed(2)),
        balance: Number(total.toFixed(2)),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Examinations
// ---------------------------------------------------------------------------

const examResults: ReportDefinition = {
  key: 'exam-results',
  name: 'Exam results',
  description: 'Subject-wise marks for one exam, with totals, percentage and rank.',
  module: MODULES.EXAMS,
  permission: PERMISSIONS.EXAMS_VIEW,
  landscape: true,
  filters: [
    { key: 'examId', label: 'Exam', type: 'uuid', required: true },
    ...CLASS_SECTION,
  ],
  columns: [
    { key: 'rank', label: 'Rank', type: 'number' },
    { key: 'admissionNumber', label: 'Admission No.' },
    { key: 'name', label: 'Student' },
    { key: 'className', label: 'Class' },
    { key: 'obtained', label: 'Obtained', type: 'number' },
    { key: 'maximum', label: 'Maximum', type: 'number' },
    { key: 'percentage', label: 'Percentage', type: 'percent' },
    { key: 'subjectsPassed', label: 'Passed', type: 'number' },
    { key: 'subjectsFailed', label: 'Failed', type: 'number' },
    { key: 'result', label: 'Result' },
  ],
  async run({ prisma, schoolId, filters, academicYearId }) {
    if (!filters.examId) return { rows: [] };

    const marks = await prisma.mark.findMany({
      where: {
        examSubject: { exam: { id: filters.examId, schoolId } },
        ...(filters.classId
          ? { student: { enrollments: { some: { academicYearId, classId: filters.classId } } } }
          : {}),
        ...(filters.sectionId
          ? { student: { enrollments: { some: { academicYearId, sectionId: filters.sectionId } } } }
          : {}),
      },
      select: {
        studentId: true,
        marksObtained: true,
        isAbsent: true,
        examSubject: { select: { maxMarks: true, passMarks: true } },
        student: {
          select: {
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            enrollments: {
              where: { academicYearId, status: 'ACTIVE' },
              take: 1,
              select: {
                class: { select: { name: true } },
                section: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const byStudent = new Map<
      string,
      {
        admissionNumber: string;
        name: string;
        className: string;
        obtained: number;
        maximum: number;
        passed: number;
        failed: number;
      }
    >();

    for (const mark of marks) {
      const enrollment = mark.student.enrollments[0];
      const entry = byStudent.get(mark.studentId) ?? {
        admissionNumber: mark.student.admissionNumber,
        name: fullName([
          mark.student.firstName,
          mark.student.middleName,
          mark.student.lastName,
        ]),
        className: enrollment
          ? `${enrollment.class?.name ?? ''} ${enrollment.section?.name ?? ''}`.trim()
          : '—',
        obtained: 0,
        maximum: 0,
        passed: 0,
        failed: 0,
      };

      const obtained = mark.isAbsent ? 0 : Number(mark.marksObtained ?? 0);
      entry.obtained += obtained;
      entry.maximum += Number(mark.examSubject.maxMarks);

      if (obtained >= Number(mark.examSubject.passMarks)) entry.passed += 1;
      else entry.failed += 1;

      byStudent.set(mark.studentId, entry);
    }

    const ranked = [...byStudent.values()]
      .map((entry) => ({
        ...entry,
        percentage: percent(entry.obtained, entry.maximum),
      }))
      .sort((a, b) => b.percentage - a.percentage);

    // Equal percentages share a rank, and the next rank skips accordingly.
    let lastPercentage = Number.NaN;
    let lastRank = 0;

    const rows = ranked.map((entry, index) => {
      if (entry.percentage !== lastPercentage) {
        lastRank = index + 1;
        lastPercentage = entry.percentage;
      }
      return {
        rank: lastRank,
        admissionNumber: entry.admissionNumber,
        name: entry.name,
        className: entry.className,
        obtained: Number(entry.obtained.toFixed(2)),
        maximum: Number(entry.maximum.toFixed(2)),
        percentage: entry.percentage,
        subjectsPassed: entry.passed,
        subjectsFailed: entry.failed,
        result: entry.failed === 0 ? 'PASS' : 'FAIL',
      };
    });

    const passes = rows.filter((row) => row.result === 'PASS').length;

    return {
      rows,
      summary: [
        { label: 'Students', value: String(rows.length) },
        { label: 'Pass rate', value: `${percent(passes, rows.length)}%` },
        {
          label: 'Class average',
          value: `${
            rows.length > 0
              ? (rows.reduce((sum, row) => sum + row.percentage, 0) / rows.length).toFixed(2)
              : '0.00'
          }%`,
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

const staffAttendance: ReportDefinition = {
  key: 'staff-attendance',
  name: 'Staff attendance',
  description: 'Days present, late and on leave per staff member over a date range.',
  module: MODULES.STAFF,
  permission: PERMISSIONS.STAFF_ATTENDANCE_VIEW,
  filters: DATE_RANGE,
  columns: [
    { key: 'employeeId', label: 'Employee ID' },
    { key: 'name', label: 'Staff' },
    { key: 'department', label: 'Department' },
    { key: 'present', label: 'Present', type: 'number' },
    { key: 'late', label: 'Late', type: 'number' },
    { key: 'absent', label: 'Absent', type: 'number' },
    { key: 'onLeave', label: 'On leave', type: 'number' },
    { key: 'marked', label: 'Days marked', type: 'number' },
    { key: 'percentage', label: 'Attendance %', type: 'percent' },
  ],
  async run({ prisma, schoolId, filters }) {
    const from = day(filters.from, new Date(Date.now() - 30 * 86_400_000));
    const to = endOf(filters.to, new Date());

    const grouped = await prisma.staffAttendance.groupBy({
      by: ['staffId', 'status'],
      where: { schoolId, date: { gte: from, lt: to } },
      _count: { _all: true },
    });

    const staffIds = [...new Set(grouped.map((row) => row.staffId))];
    if (staffIds.length === 0) return { rows: [] };

    const staff = await prisma.staff.findMany({
      where: { id: { in: staffIds } },
      select: {
        id: true,
        employeeId: true,
        department: { select: { name: true } },
        user: { select: { firstName: true, middleName: true, lastName: true } },
      },
    });

    const byId = new Map(staff.map((member) => [member.id, member]));

    const rows = staffIds
      .map((staffId) => {
        const member = byId.get(staffId);
        const counts = grouped.filter((row) => row.staffId === staffId);
        const of = (status: string) =>
          counts.find((row) => row.status === status)?._count._all ?? 0;

        const present = of('PRESENT');
        const late = of('LATE');
        const absent = of('ABSENT');
        const onLeave = of('ON_LEAVE');
        const marked = present + late + absent + onLeave + of('HALF_DAY');

        return {
          employeeId: member?.employeeId ?? '—',
          name: member
            ? fullName([
                member.user?.firstName,
                member.user?.middleName,
                member.user?.lastName,
              ])
            : '—',
          department: member?.department?.name ?? '—',
          present,
          late,
          absent,
          onLeave,
          marked,
          percentage: percent(present + late, marked),
        };
      })
      .sort((a, b) => a.percentage - b.percentage);

    return {
      rows,
      summary: [{ label: 'Staff', value: String(rows.length) }],
    };
  },
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

const libraryCirculation: ReportDefinition = {
  key: 'library-circulation',
  name: 'Library circulation',
  description: 'Loans issued in a date range, with returns, overdue days and fines.',
  module: MODULES.LIBRARY,
  permission: PERMISSIONS.LIBRARY_VIEW,
  landscape: true,
  filters: [
    ...DATE_RANGE,
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      options: ['ISSUED', 'RETURNED', 'OVERDUE', 'LOST'],
    },
  ],
  columns: [
    { key: 'accessionNumber', label: 'Accession' },
    { key: 'title', label: 'Title' },
    { key: 'borrower', label: 'Borrower' },
    { key: 'admissionNumber', label: 'Admission No.' },
    { key: 'issueDate', label: 'Issued', type: 'date' },
    { key: 'dueDate', label: 'Due', type: 'date' },
    { key: 'returnDate', label: 'Returned', type: 'date' },
    { key: 'status', label: 'Status' },
    { key: 'daysOverdue', label: 'Days overdue', type: 'number' },
    { key: 'fine', label: 'Fine', type: 'currency' },
  ],
  async run({ prisma, schoolId, filters }) {
    const from = day(filters.from, new Date(Date.now() - 90 * 86_400_000));
    const to = endOf(filters.to, new Date());

    const issues = await prisma.libraryIssue.findMany({
      where: {
        schoolId,
        issueDate: { gte: from, lt: to },
        ...(filters.status ? { status: filters.status as never } : {}),
      },
      orderBy: { issueDate: 'desc' },
      select: {
        issueDate: true,
        dueDate: true,
        returnDate: true,
        status: true,
        bookCopy: {
          select: { accessionNumber: true, book: { select: { title: true } } },
        },
        student: {
          select: {
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        },
        fines: { select: { amount: true, paidAmount: true, waivedAmount: true } },
      },
    });

    const now = Date.now();

    const rows = issues.map((issue) => {
      const end = issue.returnDate?.getTime() ?? now;
      const daysOverdue = Math.max(
        0,
        Math.floor((end - issue.dueDate.getTime()) / 86_400_000),
      );

      return {
        accessionNumber: issue.bookCopy.accessionNumber,
        title: issue.bookCopy.book.title,
        borrower: issue.student
          ? fullName([issue.student.firstName, issue.student.middleName, issue.student.lastName])
          : 'Staff',
        admissionNumber: issue.student?.admissionNumber ?? '—',
        issueDate: issue.issueDate.toISOString().slice(0, 10),
        dueDate: issue.dueDate.toISOString().slice(0, 10),
        returnDate: issue.returnDate?.toISOString().slice(0, 10) ?? '—',
        status: issue.status,
        daysOverdue,
        fine: Number(
          issue.fines.reduce((sum, fine) => sum + money(fine.amount), 0).toFixed(2),
        ),
      };
    });

    return {
      rows,
      summary: [
        { label: 'Loans', value: String(rows.length) },
        {
          label: 'Still out',
          value: String(rows.filter((row) => row.returnDate === '—').length),
        },
        { label: 'Overdue', value: String(rows.filter((row) => row.daysOverdue > 0).length) },
      ],
      totals: { fine: Number(rows.reduce((sum, row) => sum + row.fine, 0).toFixed(2)) },
    };
  },
};

const transportRoster: ReportDefinition = {
  key: 'transport-roster',
  name: 'Transport roster',
  description: 'Every student on school transport with route, bus, stop and fare.',
  module: MODULES.TRANSPORT,
  permission: PERMISSIONS.TRANSPORT_VIEW,
  landscape: true,
  filters: [{ key: 'routeId', label: 'Route', type: 'uuid', source: 'route' }],
  columns: [
    { key: 'routeName', label: 'Route' },
    { key: 'busNumber', label: 'Bus' },
    { key: 'driver', label: 'Driver' },
    { key: 'admissionNumber', label: 'Admission No.' },
    { key: 'name', label: 'Student' },
    { key: 'className', label: 'Class' },
    { key: 'stop', label: 'Pickup stop' },
    { key: 'pickupTime', label: 'Pickup' },
    { key: 'direction', label: 'Direction' },
    { key: 'fare', label: 'Fare', type: 'currency' },
    { key: 'guardianPhone', label: 'Guardian phone' },
  ],
  async run({ prisma, schoolId, filters, academicYearId }) {
    const assignments = await prisma.studentTransport.findMany({
      where: {
        isActive: true,
        academicYearId,
        route: { schoolId, ...(filters.routeId ? { id: filters.routeId } : {}) },
      },
      select: {
        direction: true,
        fareAmount: true,
        route: {
          select: {
            name: true,
            vehicle: { select: { registrationNumber: true } },
            driver: { select: { name: true, phone: true } },
          },
        },
        pickupStop: { select: { name: true, pickupTime: true } },
        student: {
          select: {
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            enrollments: {
              where: { academicYearId, status: 'ACTIVE' },
              take: 1,
              select: {
                class: { select: { name: true } },
                section: { select: { name: true } },
              },
            },
            guardians: {
              orderBy: { isPrimary: 'desc' },
              take: 1,
              select: { guardian: { select: { phone: true } } },
            },
          },
        },
      },
    });

    const rows = assignments
      .map((assignment) => {
        const enrollment = assignment.student.enrollments[0];
        return {
          routeName: assignment.route.name,
          busNumber: assignment.route.vehicle?.registrationNumber ?? '—',
          driver: assignment.route.driver?.name ?? '—',
          admissionNumber: assignment.student.admissionNumber,
          name: fullName([
            assignment.student.firstName,
            assignment.student.middleName,
            assignment.student.lastName,
          ]),
          className: enrollment
            ? `${enrollment.class?.name ?? ''} ${enrollment.section?.name ?? ''}`.trim()
            : '—',
          stop: assignment.pickupStop?.name ?? '—',
          pickupTime: assignment.pickupStop?.pickupTime ?? '—',
          direction: assignment.direction,
          fare: money(assignment.fareAmount),
          guardianPhone: assignment.student.guardians[0]?.guardian.phone ?? '—',
        };
      })
      .sort(
        (a, b) =>
          a.routeName.localeCompare(b.routeName) || a.stop.localeCompare(b.stop),
      );

    return {
      rows,
      summary: [
        { label: 'Riders', value: String(rows.length) },
        { label: 'Routes', value: String(new Set(rows.map((row) => row.routeName)).size) },
      ],
      totals: { fare: Number(rows.reduce((sum, row) => sum + row.fare, 0).toFixed(2)) },
    };
  },
};

const inventoryStock: ReportDefinition = {
  key: 'inventory-stock',
  name: 'Inventory stock',
  description: 'Current stock on hand with valuation and reorder flags.',
  module: MODULES.INVENTORY,
  permission: PERMISSIONS.INVENTORY_VIEW,
  filters: [{ key: 'categoryId', label: 'Category', type: 'uuid' }],
  columns: [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Item' },
    { key: 'category', label: 'Category' },
    { key: 'unit', label: 'Unit' },
    { key: 'quantity', label: 'On hand', type: 'number' },
    { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
    { key: 'unitCost', label: 'Unit cost', type: 'currency' },
    { key: 'stockValue', label: 'Value', type: 'currency' },
    { key: 'location', label: 'Location' },
    { key: 'flag', label: 'Flag' },
  ],
  async run({ prisma, schoolId, filters }) {
    const items = await prisma.inventoryItem.findMany({
      where: {
        schoolId,
        isActive: true,
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        code: true,
        name: true,
        unit: true,
        quantity: true,
        reorderLevel: true,
        unitCost: true,
        location: true,
        category: { select: { name: true } },
      },
    });

    const rows = items.map((item) => {
      const quantity = money(item.quantity);
      const reorderLevel = money(item.reorderLevel);
      const unitCost = money(item.unitCost);

      return {
        code: item.code,
        name: item.name,
        category: item.category?.name ?? '—',
        unit: item.unit,
        quantity,
        reorderLevel,
        unitCost,
        stockValue: Number((quantity * unitCost).toFixed(2)),
        location: item.location ?? '—',
        flag: quantity <= 0 ? 'OUT OF STOCK' : quantity <= reorderLevel ? 'REORDER' : '',
      };
    });

    const value = rows.reduce((sum, row) => sum + row.stockValue, 0);

    return {
      rows,
      summary: [
        { label: 'Items', value: String(rows.length) },
        { label: 'Stock value', value: value.toLocaleString('en-IN') },
        { label: 'Need reordering', value: String(rows.filter((row) => row.flag).length) },
      ],
      totals: { stockValue: Number(value.toFixed(2)) },
    };
  },
};

const leaveRegister: ReportDefinition = {
  key: 'leave-register',
  name: 'Leave register',
  description: 'Leave requests in a date range with their approval outcome.',
  module: MODULES.LEAVE,
  permission: PERMISSIONS.LEAVE_VIEW_ALL,
  landscape: true,
  filters: [
    ...DATE_RANGE,
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      options: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
    },
  ],
  columns: [
    { key: 'applicant', label: 'Applicant' },
    { key: 'applicantType', label: 'Type' },
    { key: 'identifier', label: 'ID' },
    { key: 'leaveType', label: 'Leave type' },
    { key: 'fromDate', label: 'From', type: 'date' },
    { key: 'toDate', label: 'To', type: 'date' },
    { key: 'days', label: 'Days', type: 'number' },
    { key: 'reason', label: 'Reason' },
    { key: 'status', label: 'Status' },
    { key: 'decidedOn', label: 'Decided', type: 'date' },
  ],
  async run({ prisma, schoolId, filters }) {
    const from = day(filters.from, new Date(Date.now() - 90 * 86_400_000));
    const to = endOf(filters.to, new Date());

    const requests = await prisma.leaveRequest.findMany({
      where: {
        schoolId,
        fromDate: { gte: from, lt: to },
        ...(filters.status ? { status: filters.status as never } : {}),
      },
      orderBy: { fromDate: 'desc' },
      select: {
        fromDate: true,
        toDate: true,
        totalDays: true,
        reason: true,
        status: true,
        reviewedAt: true,
        leaveType: { select: { name: true } },
        student: {
          select: {
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        },
        staff: {
          select: {
            employeeId: true,
            user: { select: { firstName: true, middleName: true, lastName: true } },
          },
        },
      },
    });

    const rows = requests.map((request) => ({
      applicant: request.student
        ? fullName([
            request.student.firstName,
            request.student.middleName,
            request.student.lastName,
          ])
        : fullName([
            request.staff?.user?.firstName,
            request.staff?.user?.middleName,
            request.staff?.user?.lastName,
          ]),
      applicantType: request.student ? 'STUDENT' : 'STAFF',
      identifier: request.student?.admissionNumber ?? request.staff?.employeeId ?? '—',
      leaveType: request.leaveType?.name ?? '—',
      fromDate: request.fromDate.toISOString().slice(0, 10),
      toDate: request.toDate.toISOString().slice(0, 10),
      days: Number(request.totalDays ?? 0),
      reason: request.reason,
      status: request.status,
      decidedOn: request.reviewedAt?.toISOString().slice(0, 10) ?? '—',
    }));

    return {
      rows,
      summary: [
        { label: 'Requests', value: String(rows.length) },
        {
          label: 'Pending',
          value: String(rows.filter((row) => row.status === 'PENDING').length),
        },
        {
          label: 'Days approved',
          value: String(
            rows
              .filter((row) => row.status === 'APPROVED')
              .reduce((sum, row) => sum + row.days, 0),
          ),
        },
      ],
    };
  },
};

const homeworkCompletion: ReportDefinition = {
  key: 'homework-completion',
  name: 'Homework completion',
  description: 'Submission and review rates per homework assignment.',
  module: MODULES.HOMEWORK,
  permission: PERMISSIONS.HOMEWORK_VIEW,
  landscape: true,
  filters: [...DATE_RANGE, ...CLASS_SECTION],
  columns: [
    { key: 'title', label: 'Homework' },
    { key: 'subject', label: 'Subject' },
    { key: 'className', label: 'Class' },
    { key: 'assignedOn', label: 'Assigned', type: 'date' },
    { key: 'dueDate', label: 'Due', type: 'date' },
    { key: 'expected', label: 'Expected', type: 'number' },
    { key: 'submitted', label: 'Submitted', type: 'number' },
    { key: 'late', label: 'Late', type: 'number' },
    { key: 'reviewed', label: 'Reviewed', type: 'number' },
    { key: 'completionRate', label: 'Completion %', type: 'percent' },
  ],
  async run({ prisma, schoolId, filters, academicYearId }) {
    const from = day(filters.from, new Date(Date.now() - 30 * 86_400_000));
    const to = endOf(filters.to, new Date());

    const homework = await prisma.homework.findMany({
      where: {
        schoolId,
        dueDate: { gte: from, lt: to },
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
      },
      orderBy: { dueDate: 'desc' },
      select: {
        id: true,
        title: true,
        assignedDate: true,
        dueDate: true,
        classId: true,
        sectionId: true,
        subject: { select: { name: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
        submissions: { select: { status: true } },
      },
    });

    if (homework.length === 0) return { rows: [] };

    // How many students each homework was actually set for.
    const cohorts = await prisma.enrollment.groupBy({
      by: ['classId', 'sectionId'],
      where: {
        academicYearId,
        status: 'ACTIVE',
        classId: { in: [...new Set(homework.map((item) => item.classId))] },
      },
      _count: { _all: true },
    });

    const cohortSize = new Map(
      cohorts.map((cohort) => [`${cohort.classId}:${cohort.sectionId}`, cohort._count._all]),
    );

    const rows = homework.map((item) => {
      const expected = cohortSize.get(`${item.classId}:${item.sectionId}`) ?? 0;
      const submitted = item.submissions.filter((submission) =>
        ['SUBMITTED', 'LATE', 'REVIEWED', 'GRADED'].includes(submission.status),
      ).length;
      const late = item.submissions.filter((submission) => submission.status === 'LATE').length;
      const reviewed = item.submissions.filter((submission) =>
        ['REVIEWED', 'GRADED'].includes(submission.status),
      ).length;

      return {
        title: item.title,
        subject: item.subject?.name ?? '—',
        className: `${item.class?.name ?? ''} ${item.section?.name ?? ''}`.trim(),
        assignedOn: item.assignedDate.toISOString().slice(0, 10),
        dueDate: item.dueDate.toISOString().slice(0, 10),
        expected,
        submitted,
        late,
        reviewed,
        completionRate: percent(submitted, expected),
      };
    });

    return {
      rows,
      summary: [
        { label: 'Assignments', value: String(rows.length) },
        {
          label: 'Average completion',
          value: `${
            rows.length > 0
              ? (rows.reduce((sum, row) => sum + row.completionRate, 0) / rows.length).toFixed(1)
              : '0.0'
          }%`,
        },
        {
          label: 'Awaiting review',
          value: String(rows.reduce((sum, row) => sum + (row.submitted - row.reviewed), 0)),
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  studentRoll,
  attendanceSummary,
  lowAttendance,
  feeCollection,
  outstandingFees,
  examResults,
  staffAttendance,
  homeworkCompletion,
  leaveRegister,
  libraryCirculation,
  transportRoster,
  inventoryStock,
];

export const REPORTS_BY_KEY = new Map(
  REPORT_DEFINITIONS.map((definition) => [definition.key, definition]),
);
