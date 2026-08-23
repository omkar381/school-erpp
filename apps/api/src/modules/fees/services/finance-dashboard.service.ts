import { Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { parseDateOnly, todayInZone } from '../../../common/utils/date.util';
import { AcademicYearService } from '../../academics/services/academic-year.service';

export interface FinanceDashboard {
  currency: string;
  period: { from: string; to: string };
  collection: {
    today: number;
    thisMonth: number;
    thisYear: number;
    inPeriod: number;
  };
  outstanding: {
    total: number;
    overdue: number;
    studentsWithDues: number;
    overdueInvoices: number;
  };
  billed: { total: number; invoiceCount: number };
  refunds: { total: number; count: number; pending: number };
  byMethod: Array<{ method: string; amount: number; count: number; percentage: number }>;
  monthlyTrend: Array<{ month: string; billed: number; collected: number }>;
  byClass: Array<{
    classId: string;
    className: string;
    billed: number;
    collected: number;
    outstanding: number;
    collectionRate: number;
  }>;
  topDefaulters: Array<{
    studentId: string;
    admissionNumber: string;
    name: string;
    className: string | null;
    outstanding: number;
    daysOverdue: number;
  }>;
}

@Injectable()
export class FinanceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicYears: AcademicYearService,
  ) {}

  async build(
    schoolId: string,
    options: { from?: string; to?: string; academicYearId?: string } = {},
  ): Promise<FinanceDashboard> {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { currency: true, timezone: true },
    });

    const academicYearId = await this.academicYears.resolveId(schoolId, options.academicYearId);
    const year = await this.prisma.academicYear.findUniqueOrThrow({
      where: { id: academicYearId },
      select: { startDate: true, endDate: true },
    });

    const today = todayInZone(school.timezone);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const from = options.from ? parseDateOnly(options.from) : year.startDate;
    const to = options.to ? new Date(`${options.to}T23:59:59.999Z`) : new Date();

    const settled: Prisma.PaymentWhereInput = { schoolId, status: PaymentStatus.SUCCESS };
    const openInvoice: Prisma.InvoiceWhereInput = {
      schoolId,
      academicYearId,
      status: {
        in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
      },
    };

    const [
      todayCollection,
      monthCollection,
      yearCollection,
      periodCollection,
      billedTotals,
      outstandingTotals,
      overdueTotals,
      refundTotals,
      pendingRefunds,
      byMethod,
      defaulterRows,
    ] = await this.prisma.$transaction([
      this.prisma.payment.aggregate({
        where: { ...settled, paidAt: { gte: today } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...settled, paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...settled, paidAt: { gte: year.startDate, lte: year.endDate } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...settled, paidAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          schoolId,
          academicYearId,
          status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.VOID] },
        },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: openInvoice,
        _sum: { balance: true },
      }),
      this.prisma.invoice.aggregate({
        where: { ...openInvoice, dueDate: { lt: today } },
        _sum: { balance: true },
        _count: true,
      }),
      this.prisma.refund.aggregate({
        where: { schoolId, status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.refund.count({ where: { schoolId, status: 'REQUESTED' } }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { ...settled, paidAt: { gte: from, lte: to } },
        orderBy: undefined,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['studentId'],
        where: { ...openInvoice, dueDate: { lt: today } },
        orderBy: undefined,
        _sum: { balance: true },
        _min: { dueDate: true },
      }),
    ]);

    // --- Payment method split ---
    const methodTotal = byMethod.reduce((sum, row) => sum + Number(row._sum?.amount ?? 0), 0);
    const methods = byMethod
      .map((row) => {
        const amount = Number(row._sum?.amount ?? 0);
        return {
          method: row.method as string,
          amount,
          // Prisma types groupBy _count as a union; the shape here is always { _all }.
          count: (row._count as { _all?: number } | undefined)?._all ?? 0,
          percentage: methodTotal > 0 ? Number(((amount / methodTotal) * 100).toFixed(1)) : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    // --- Monthly trend ---
    const monthlyTrend = await this.monthlyTrend(schoolId, academicYearId, year.startDate, to);

    // --- Class-wise position ---
    const byClass = await this.byClass(schoolId, academicYearId);

    // --- Defaulters ---
    const sortedDefaulters = defaulterRows
      .map((row) => ({
        studentId: row.studentId,
        outstanding: Number(row._sum?.balance ?? 0),
        oldestDue: row._min?.dueDate ?? null,
      }))
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10);

    const defaulterStudents = sortedDefaulters.length
      ? await this.prisma.student.findMany({
          where: { id: { in: sortedDefaulters.map((entry) => entry.studentId) } },
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              take: 1,
              select: {
                class: { select: { name: true } },
                section: { select: { name: true } },
              },
            },
          },
        })
      : [];

    const studentById = new Map(defaulterStudents.map((student) => [student.id, student]));

    const studentsWithDues = await this.prisma.invoice.findMany({
      where: openInvoice,
      distinct: ['studentId'],
      select: { studentId: true },
    });

    return {
      currency: school.currency,
      period: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      },
      collection: {
        today: Number(todayCollection._sum.amount ?? 0),
        thisMonth: Number(monthCollection._sum.amount ?? 0),
        thisYear: Number(yearCollection._sum.amount ?? 0),
        inPeriod: Number(periodCollection._sum.amount ?? 0),
      },
      outstanding: {
        total: Number(outstandingTotals._sum.balance ?? 0),
        overdue: Number(overdueTotals._sum.balance ?? 0),
        studentsWithDues: studentsWithDues.length,
        overdueInvoices: overdueTotals._count,
      },
      billed: {
        total: Number(billedTotals._sum.total ?? 0),
        invoiceCount: billedTotals._count,
      },
      refunds: {
        total: Number(refundTotals._sum.amount ?? 0),
        count: refundTotals._count,
        pending: pendingRefunds,
      },
      byMethod: methods,
      monthlyTrend,
      byClass,
      topDefaulters: sortedDefaulters.map((entry) => {
        const student = studentById.get(entry.studentId);
        return {
          studentId: entry.studentId,
          admissionNumber: student?.admissionNumber ?? '',
          name: student
            ? [student.firstName, student.lastName].filter(Boolean).join(' ')
            : 'Unknown',
          className: student?.enrollments[0]
            ? `${student.enrollments[0].class.name} ${student.enrollments[0].section.name}`
            : null,
          outstanding: entry.outstanding,
          daysOverdue: entry.oldestDue
            ? Math.floor((today.getTime() - entry.oldestDue.getTime()) / 86_400_000)
            : 0,
        };
      }),
    };
  }

  /** Day-by-day collection, for the collection report. */
  async dailyCollection(schoolId: string, from: string, to: string) {
    const rows = await this.prisma.payment.findMany({
      where: {
        schoolId,
        status: PaymentStatus.SUCCESS,
        paidAt: { gte: parseDateOnly(from), lte: new Date(`${to}T23:59:59.999Z`) },
      },
      select: {
        paidAt: true,
        amount: true,
        method: true,
        collectedById: true,
      },
    });

    const byDay = new Map<string, { total: number; count: number; methods: Record<string, number> }>();

    for (const row of rows) {
      if (!row.paidAt) continue;
      const key = row.paidAt.toISOString().slice(0, 10);
      const bucket = byDay.get(key) ?? { total: 0, count: 0, methods: {} };
      bucket.total += Number(row.amount);
      bucket.count += 1;
      bucket.methods[row.method] = (bucket.methods[row.method] ?? 0) + Number(row.amount);
      byDay.set(key, bucket);
    }

    const days = [...byDay.entries()]
      .map(([date, value]) => ({ date, ...value }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      from,
      to,
      totalCollected: days.reduce((sum, day) => sum + day.total, 0),
      totalTransactions: days.reduce((sum, day) => sum + day.count, 0),
      days,
    };
  }

  /** Outstanding fees grouped by class, the report a principal asks for. */
  async outstandingReport(schoolId: string, academicYearId?: string) {
    const yearId = await this.academicYears.resolveId(schoolId, academicYearId);
    const today = new Date();

    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        academicYearId: yearId,
        status: {
          in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
        },
        balance: { gt: 0 },
      },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        total: true,
        paidAmount: true,
        balance: true,
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            enrollments: {
              where: { academicYearId: yearId },
              take: 1,
              select: {
                class: { select: { id: true, name: true, level: true } },
                section: { select: { id: true, name: true } },
              },
            },
            guardians: {
              where: { isPayer: true },
              take: 1,
              select: { guardian: { select: { firstName: true, phone: true } } },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    const rows = invoices.map((invoice) => {
      const enrollment = invoice.student.enrollments[0];
      const daysOverdue =
        invoice.dueDate < today
          ? Math.floor((today.getTime() - invoice.dueDate.getTime()) / 86_400_000)
          : 0;

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        dueDate: invoice.dueDate,
        daysOverdue,
        // Standard receivables buckets.
        ageBucket:
          daysOverdue === 0
            ? 'CURRENT'
            : daysOverdue <= 30
              ? '1-30'
              : daysOverdue <= 60
                ? '31-60'
                : daysOverdue <= 90
                  ? '61-90'
                  : '90+',
        total: Number(invoice.total),
        paid: Number(invoice.paidAmount),
        outstanding: Number(invoice.balance),
        student: {
          id: invoice.student.id,
          admissionNumber: invoice.student.admissionNumber,
          name: [invoice.student.firstName, invoice.student.lastName].filter(Boolean).join(' '),
        },
        classId: enrollment?.class.id ?? null,
        className: enrollment ? `${enrollment.class.name} ${enrollment.section.name}` : null,
        guardian: invoice.student.guardians[0]?.guardian ?? null,
      };
    });

    const buckets = rows.reduce<Record<string, { count: number; amount: number }>>((acc, row) => {
      const bucket = acc[row.ageBucket] ?? { count: 0, amount: 0 };
      bucket.count += 1;
      bucket.amount += row.outstanding;
      acc[row.ageBucket] = bucket;
      return acc;
    }, {});

    return {
      totalOutstanding: rows.reduce((sum, row) => sum + row.outstanding, 0),
      invoiceCount: rows.length,
      studentCount: new Set(rows.map((row) => row.student.id)).size,
      ageing: ['CURRENT', '1-30', '31-60', '61-90', '90+'].map((bucket) => ({
        bucket,
        count: buckets[bucket]?.count ?? 0,
        amount: buckets[bucket]?.amount ?? 0,
      })),
      rows,
    };
  }

  // -------------------------------------------------------------------------

  private async monthlyTrend(
    schoolId: string,
    academicYearId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ month: string; billed: number; collected: number }>> {
    const [invoices, payments] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where: {
          schoolId,
          academicYearId,
          issueDate: { gte: from, lte: to },
          status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.VOID] },
        },
        select: { issueDate: true, total: true },
      }),
      this.prisma.payment.findMany({
        where: {
          schoolId,
          status: PaymentStatus.SUCCESS,
          paidAt: { gte: from, lte: to },
        },
        select: { paidAt: true, amount: true },
      }),
    ]);

    const months = new Map<string, { billed: number; collected: number }>();

    const bucket = (key: string) => {
      const entry = months.get(key) ?? { billed: 0, collected: 0 };
      months.set(key, entry);
      return entry;
    };

    for (const invoice of invoices) {
      bucket(invoice.issueDate.toISOString().slice(0, 7)).billed += Number(invoice.total);
    }
    for (const payment of payments) {
      if (!payment.paidAt) continue;
      bucket(payment.paidAt.toISOString().slice(0, 7)).collected += Number(payment.amount);
    }

    return [...months.entries()]
      .map(([month, value]) => ({
        month,
        billed: Number(value.billed.toFixed(2)),
        collected: Number(value.collected.toFixed(2)),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  private async byClass(schoolId: string, academicYearId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        academicYearId,
        status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.VOID] },
      },
      select: {
        total: true,
        paidAmount: true,
        balance: true,
        student: {
          select: {
            enrollments: {
              where: { academicYearId },
              take: 1,
              select: { class: { select: { id: true, name: true, level: true } } },
            },
          },
        },
      },
    });

    const byClass = new Map<
      string,
      { name: string; level: number; billed: number; collected: number; outstanding: number }
    >();

    for (const invoice of invoices) {
      const cls = invoice.student.enrollments[0]?.class;
      if (!cls) continue;

      const entry = byClass.get(cls.id) ?? {
        name: cls.name,
        level: cls.level,
        billed: 0,
        collected: 0,
        outstanding: 0,
      };
      entry.billed += Number(invoice.total);
      entry.collected += Number(invoice.paidAmount);
      entry.outstanding += Number(invoice.balance);
      byClass.set(cls.id, entry);
    }

    return [...byClass.entries()]
      .map(([classId, value]) => ({
        classId,
        className: value.name,
        billed: Number(value.billed.toFixed(2)),
        collected: Number(value.collected.toFixed(2)),
        outstanding: Number(value.outstanding.toFixed(2)),
        collectionRate:
          value.billed > 0 ? Number(((value.collected / value.billed) * 100).toFixed(1)) : 0,
        level: value.level,
      }))
      .sort((a, b) => a.level - b.level)
      .map(({ level: _level, ...rest }) => rest);
  }
}
