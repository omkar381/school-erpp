import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  InvoiceStatus,
  LedgerEntryType,
  PaymentStatus,
  Prisma,
  type Discount,
} from '@prisma/client';
import { PrismaService, type TransactionClient } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { SequenceService } from '../../../common/services/sequence.service';
import { parseDateOnly, todayInZone } from '../../../common/utils/date.util';
import { AuditService } from '../../audit/audit.service';
import { AcademicYearService } from '../../academics/services/academic-year.service';
import { FeeStructuresService } from './fee-structures.service';
import type {
  CancelInvoiceDto,
  CreateInvoiceDto,
  GenerateInvoicesDto,
  InvoiceQueryDto,
} from '../dto/fees.dto';

/** Money is handled as Decimal end-to-end; these helpers keep that consistent. */
const D = (value: Prisma.Decimal | number | string): Prisma.Decimal =>
  new Prisma.Decimal(value);
const ZERO = new Prisma.Decimal(0);

/**
 * Payment states in which the money reached the school. A refunded payment is
 * included: the funds were received and the refund is accounted for on its own.
 */
const SETTLED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.SUCCESS,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

interface ComputedLine {
  feeHeadId: string | null;
  discountId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxPercent: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  amount: Prisma.Decimal;
  sortOrder: number;
}

@Injectable()
export class InvoicesService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly structures: FeeStructuresService,
    private readonly academicYears: AcademicYearService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('InvoicesService');
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: InvoiceQueryDto) {
    const where: Prisma.InvoiceWhereInput = {
      schoolId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.classId ? { student: { enrollments: { some: { classId: query.classId } } } } : {}),
      ...(query.sectionId
        ? { student: { enrollments: { some: { sectionId: query.sectionId } } } }
        : {}),
      ...(query.overdueOnly
        ? { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] }, dueDate: { lt: new Date() } }
        : {}),
      ...(query.from || query.to
        ? {
            issueDate: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
              { student: { admissionNumber: { contains: query.search, mode: 'insensitive' } } },
              { student: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { student: { lastName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total, totals] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { issueDate: query.sortOrder },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          issueDate: true,
          dueDate: true,
          subtotal: true,
          discountTotal: true,
          lateFee: true,
          total: true,
          paidAmount: true,
          refundedAmount: true,
          balance: true,
          currency: true,
          reminderCount: true,
          student: {
            select: {
              id: true,
              admissionNumber: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
              enrollments: {
                where: { status: 'ACTIVE' },
                take: 1,
                select: {
                  class: { select: { name: true } },
                  section: { select: { name: true } },
                },
              },
            },
          },
          installment: { select: { name: true, sequence: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.aggregate({
        where,
        _sum: { total: true, paidAmount: true, balance: true },
      }),
    ]);

    const now = new Date();

    return {
      ...buildPaginatedResult(
        items.map((invoice) => ({
          ...invoice,
          isOverdue:
            invoice.dueDate < now &&
            Number(invoice.balance) > 0 &&
            invoice.status !== InvoiceStatus.CANCELLED &&
            invoice.status !== InvoiceStatus.VOID,
          daysOverdue:
            invoice.dueDate < now
              ? Math.floor((now.getTime() - invoice.dueDate.getTime()) / 86_400_000)
              : 0,
        })),
        total,
        query.page,
        query.limit,
      ),
      totals: {
        billed: Number(totals._sum.total ?? 0),
        collected: Number(totals._sum.paidAmount ?? 0),
        outstanding: Number(totals._sum.balance ?? 0),
      },
    };
  }

  async findOne(schoolId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, schoolId },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            feeHead: { select: { id: true, name: true, code: true, category: true } },
            discount: { select: { id: true, name: true, code: true } },
          },
        },
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            photoUrl: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              take: 1,
              select: {
                rollNumber: true,
                class: { select: { name: true } },
                section: { select: { name: true } },
              },
            },
            guardians: {
              where: { isPayer: true },
              take: 1,
              select: {
                guardian: { select: { firstName: true, lastName: true, phone: true, email: true } },
              },
            },
          },
        },
        academicYear: { select: { id: true, name: true } },
        feeStructure: { select: { id: true, name: true } },
        installment: { select: { id: true, name: true, sequence: true } },
        allocations: {
          include: {
            payment: {
              select: {
                id: true,
                receiptNumber: true,
                method: true,
                status: true,
                paidAt: true,
                amount: true,
              },
            },
          },
        },
        refunds: {
          select: {
            id: true,
            refundNumber: true,
            amount: true,
            status: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });

    if (!invoice) throw new NotFoundError('Invoice');

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: {
        name: true,
        logoUrl: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        phone: true,
        email: true,
        currency: true,
        invoiceFooter: true,
      },
    });

    return { ...invoice, school };
  }

  /** A student's complete fee position: invoices, payments and running balance. */
  async studentLedger(schoolId: string, studentId: string, academicYearId?: string) {
    const yearId = academicYearId ?? (await this.academicYears.getCurrent(schoolId)).id;

    const [invoices, entries, totals] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where: { schoolId, studentId, academicYearId: yearId },
        orderBy: { issueDate: 'asc' },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          issueDate: true,
          dueDate: true,
          total: true,
          paidAmount: true,
          balance: true,
          currency: true,
          installment: { select: { name: true, sequence: true } },
        },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { schoolId, studentId },
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          type: true,
          debit: true,
          credit: true,
          description: true,
          occurredAt: true,
          invoiceId: true,
          paymentId: true,
        },
      }),
      this.prisma.invoice.aggregate({
        where: { schoolId, studentId, academicYearId: yearId },
        _sum: { total: true, paidAmount: true, balance: true, refundedAmount: true },
      }),
    ]);

    // Running balance is computed here rather than trusted from the stored
    // column, so a discrepancy would be visible rather than hidden.
    let running = 0;
    const ledger = entries.map((entry) => {
      running += Number(entry.debit) - Number(entry.credit);
      return { ...entry, runningBalance: Number(running.toFixed(2)) };
    });

    return {
      studentId,
      academicYearId: yearId,
      summary: {
        billed: Number(totals._sum.total ?? 0),
        paid: Number(totals._sum.paidAmount ?? 0),
        refunded: Number(totals._sum.refundedAmount ?? 0),
        outstanding: Number(totals._sum.balance ?? 0),
        invoiceCount: invoices.length,
        overdueCount: invoices.filter(
          (invoice) => Number(invoice.balance) > 0 && invoice.dueDate < new Date(),
        ).length,
      },
      invoices,
      ledger,
    };
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  async create(schoolId: string, dto: CreateInvoiceDto, createdById: string) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, schoolId, deletedAt: null },
      select: { id: true, admissionNumber: true, firstName: true, lastName: true },
    });
    if (!student) throw new NotFoundError('Student');

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { currency: true, timezone: true },
    });

    const lines = await this.buildManualLines(schoolId, dto);
    const totals = this.sumLines(lines);

    const year = await this.prisma.academicYear.findUniqueOrThrow({
      where: { id: academicYearId },
      select: { name: true },
    });
    const period = SequenceService.periodFromAcademicYear(year.name);

    const invoice = await this.prisma.transaction(async (tx) => {
      const invoiceNumber = await this.sequences.next(schoolId, 'INVOICE', { period }, tx);

      const created = await tx.invoice.create({
        data: {
          schoolId,
          academicYearId,
          studentId: dto.studentId,
          invoiceNumber,
          status: InvoiceStatus.ISSUED,
          issueDate: dto.issueDate ? parseDateOnly(dto.issueDate) : todayInZone(school.timezone),
          dueDate: parseDateOnly(dto.dueDate),
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          paidAmount: ZERO,
          balance: totals.total,
          currency: school.currency,
          notes: dto.notes ?? null,
          createdById,
          items: { create: lines },
        },
        select: { id: true, invoiceNumber: true, total: true },
      });

      await this.writeLedger(tx, {
        schoolId,
        studentId: dto.studentId,
        invoiceId: created.id,
        type: LedgerEntryType.INVOICE,
        debit: totals.total,
        credit: ZERO,
        description: `Invoice ${created.invoiceNumber} raised`,
        createdById,
      });

      return created;
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'fees',
      entity: 'Invoice',
      entityId: invoice.id,
      description:
        `Raised invoice ${invoice.invoiceNumber} for ${student.admissionNumber} ` +
        `totalling ${Number(invoice.total)}`,
      newValue: { total: Number(invoice.total), studentId: dto.studentId },
      schoolId,
    });

    return this.findOne(schoolId, invoice.id);
  }

  /**
   * Raises invoices in bulk for a class or section from a fee structure.
   *
   * Idempotent by design: a student who already has an invoice for the same
   * structure and installment is skipped, so re-running after a partial failure
   * never double-bills a family.
   */
  async generateBulk(schoolId: string, dto: GenerateInvoicesDto, createdById: string) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const structure = await this.prisma.feeStructure.findFirst({
      where: { id: dto.feeStructureId, schoolId, academicYearId },
      include: {
        items: { include: { feeHead: { select: { id: true, name: true, code: true } } } },
        installments: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!structure) throw new NotFoundError('Fee structure');

    const installment = dto.installmentId
      ? structure.installments.find((entry) => entry.id === dto.installmentId)
      : null;

    if (dto.installmentId && !installment) {
      throw new NotFoundError('Installment');
    }

    // Portion of each line item this invoice charges.
    const ratio = installment
      ? installment.percentage
        ? Number(installment.percentage) / 100
        : Number(installment.amount ?? 0) / Number(structure.totalAmount)
      : 1;

    if (ratio <= 0 || ratio > 1) {
      throw new BadRequestError('The installment portion could not be determined');
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        schoolId,
        academicYearId,
        status: 'ACTIVE',
        ...(dto.sectionId ? { sectionId: dto.sectionId } : {}),
        ...(dto.classId ? { classId: dto.classId } : {}),
        ...(dto.studentIds?.length ? { studentId: { in: dto.studentIds } } : {}),
        ...(!dto.sectionId && !dto.classId && !dto.studentIds?.length && structure.classId
          ? { classId: structure.classId }
          : {}),
        student: { deletedAt: null, status: 'ACTIVE' },
      },
      select: { studentId: true },
    });

    if (enrollments.length === 0) {
      throw new BadRequestError('No active students matched the given criteria');
    }

    const studentIds = enrollments.map((entry) => entry.studentId);

    // Skip anyone already billed for this structure and installment.
    const existing = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        academicYearId,
        feeStructureId: structure.id,
        installmentId: installment?.id ?? null,
        studentId: { in: studentIds },
        status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.VOID] },
      },
      select: { studentId: true },
    });
    const alreadyBilled = new Set(existing.map((entry) => entry.studentId));
    const targets = studentIds.filter((id) => !alreadyBilled.has(id));

    if (targets.length === 0) {
      return {
        generated: 0,
        skipped: alreadyBilled.size,
        totalBilled: 0,
        message: 'Every selected student has already been invoiced for this installment',
      };
    }

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { currency: true, timezone: true },
    });
    const year = await this.prisma.academicYear.findUniqueOrThrow({
      where: { id: academicYearId },
      select: { name: true },
    });
    const period = SequenceService.periodFromAcademicYear(year.name);

    const issueDate = dto.issueDate ? parseDateOnly(dto.issueDate) : todayInZone(school.timezone);
    const dueDate = dto.dueDate
      ? parseDateOnly(dto.dueDate)
      : (installment?.dueDate ?? issueDate);

    let generated = 0;
    let totalBilled = 0;

    // Processed in batches so one very large class does not hold a single
    // transaction open for minutes.
    for (let index = 0; index < targets.length; index += 25) {
      const batch = targets.slice(index, index + 25);

      await this.prisma.transaction(
        async (tx) => {
          const numbers = await this.sequences.nextBatch(
            schoolId,
            'INVOICE',
            batch.length,
            { period },
            tx,
          );

          for (const [offset, studentId] of batch.entries()) {
            const discounts = await this.structures.activeDiscountsFor(
              studentId,
              academicYearId,
              issueDate,
            );

            const lines = this.buildStructureLines(structure, ratio, discounts, installment?.name);
            const totals = this.sumLines(lines);

            const invoice = await tx.invoice.create({
              data: {
                schoolId,
                academicYearId,
                studentId,
                feeStructureId: structure.id,
                installmentId: installment?.id ?? null,
                invoiceNumber: numbers[offset],
                status: InvoiceStatus.ISSUED,
                issueDate,
                dueDate,
                subtotal: totals.subtotal,
                discountTotal: totals.discountTotal,
                taxTotal: totals.taxTotal,
                total: totals.total,
                paidAmount: ZERO,
                balance: totals.total,
                currency: school.currency,
                createdById,
                items: { create: lines },
              },
              select: { id: true, invoiceNumber: true, total: true },
            });

            await this.writeLedger(tx, {
              schoolId,
              studentId,
              invoiceId: invoice.id,
              type: LedgerEntryType.INVOICE,
              debit: totals.total,
              credit: ZERO,
              description: `Invoice ${invoice.invoiceNumber} raised${installment ? ` (${installment.name})` : ''}`,
              createdById,
              occurredAt: issueDate,
            });

            generated += 1;
            totalBilled += Number(totals.total);
          }
        },
        { timeout: 60_000 },
      );
    }

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'fees',
      entity: 'Invoice',
      description:
        `Generated ${generated} invoice(s) from "${structure.name}"` +
        (installment ? ` for ${installment.name}` : '') +
        ` totalling ${totalBilled.toFixed(2)}`,
      newValue: { generated, skipped: alreadyBilled.size, totalBilled },
      schoolId,
    });

    this.log.info('Bulk invoices generated', {
      schoolId,
      structureId: structure.id,
      generated,
      skipped: alreadyBilled.size,
    });

    return { generated, skipped: alreadyBilled.size, totalBilled };
  }

  // -------------------------------------------------------------------------
  // Cancellation and adjustment
  // -------------------------------------------------------------------------

  /**
   * Cancels an invoice. Financial records are never deleted: the invoice is
   * marked cancelled and a reversing ledger entry is written, so the trail
   * remains complete.
   */
  async cancel(schoolId: string, id: string, dto: CancelInvoiceDto, cancelledById: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, schoolId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        studentId: true,
        total: true,
        paidAmount: true,
        balance: true,
      },
    });
    if (!invoice) throw new NotFoundError('Invoice');

    if (invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestError('This invoice has already been cancelled');
    }

    // A paid invoice must be refunded, not cancelled, or the money would be
    // unaccounted for.
    if (Number(invoice.paidAmount) > 0) {
      throw new ConflictError(
        `${Number(invoice.paidAmount)} has already been paid against this invoice. ` +
          'Raise a refund instead of cancelling it.',
        ErrorCode.INVOICE_ALREADY_PAID,
      );
    }

    await this.prisma.transaction(async (tx) => {
      await tx.invoice.update({
        where: { id },
        data: {
          status: dto.void ? InvoiceStatus.VOID : InvoiceStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById,
          cancelReason: dto.reason,
          balance: ZERO,
          ...(dto.void ? { voidedAt: new Date() } : {}),
        },
      });

      await this.writeLedger(tx, {
        schoolId,
        studentId: invoice.studentId,
        invoiceId: id,
        type: dto.void ? LedgerEntryType.VOID : LedgerEntryType.ADJUSTMENT,
        debit: ZERO,
        credit: D(invoice.total),
        description: `Invoice ${invoice.invoiceNumber} ${dto.void ? 'voided' : 'cancelled'}: ${dto.reason}`,
        createdById: cancelledById,
      });
    });

    this.audit.record({
      action: AuditAction.VOID,
      module: 'fees',
      entity: 'Invoice',
      entityId: id,
      description: `${dto.void ? 'Voided' : 'Cancelled'} invoice ${invoice.invoiceNumber}: ${dto.reason}`,
      oldValue: { status: invoice.status, balance: Number(invoice.balance) },
      newValue: { status: dto.void ? 'VOID' : 'CANCELLED' },
      schoolId,
    });

    return { id, status: dto.void ? InvoiceStatus.VOID : InvoiceStatus.CANCELLED };
  }

  /**
   * Applies late fees to overdue invoices. Run by a scheduled job.
   * Recomputes rather than accumulates, so running it twice in one day is safe.
   */
  async applyLateFees(schoolId: string): Promise<{ updated: number; totalAdded: number }> {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { settings: true, timezone: true },
    });

    const feeSettings = (school.settings as { fees?: { lateFeeEnabled?: boolean } } | null)?.fees;
    if (feeSettings?.lateFeeEnabled === false) return { updated: 0, totalAdded: 0 };

    const today = todayInZone(school.timezone);

    const overdue = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
        dueDate: { lt: today },
        balance: { gt: 0 },
        installmentId: { not: null },
      },
      select: {
        id: true,
        invoiceNumber: true,
        studentId: true,
        dueDate: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        lateFee: true,
        paidAmount: true,
        refundedAmount: true,
        installment: {
          select: { lateFeeAfterDays: true, lateFeeAmount: true, lateFeePerDay: true },
        },
      },
    });

    let updated = 0;
    let totalAdded = 0;

    for (const invoice of overdue) {
      if (!invoice.installment) continue;

      const daysLate = Math.floor((today.getTime() - invoice.dueDate.getTime()) / 86_400_000);
      const chargeableDays = daysLate - invoice.installment.lateFeeAfterDays;
      if (chargeableDays <= 0) continue;

      const flat = D(invoice.installment.lateFeeAmount);
      const perDay = D(invoice.installment.lateFeePerDay).mul(chargeableDays);
      const newLateFee = flat.add(perDay);

      // Recompute from the base rather than adding to what is already there.
      if (newLateFee.equals(D(invoice.lateFee))) continue;

      const newTotal = D(invoice.subtotal)
        .sub(D(invoice.discountTotal))
        .add(D(invoice.taxTotal))
        .add(newLateFee);
      const newBalance = newTotal.sub(D(invoice.paidAmount)).add(D(invoice.refundedAmount));
      const delta = newLateFee.sub(D(invoice.lateFee));

      await this.prisma.transaction(async (tx) => {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            lateFee: newLateFee,
            total: newTotal,
            balance: newBalance,
            status: InvoiceStatus.OVERDUE,
          },
        });

        await this.writeLedger(tx, {
          schoolId,
          studentId: invoice.studentId,
          invoiceId: invoice.id,
          type: LedgerEntryType.LATE_FEE,
          debit: delta,
          credit: ZERO,
          description: `Late fee for ${invoice.invoiceNumber} (${chargeableDays} day(s) overdue)`,
        });
      });

      updated += 1;
      totalAdded += Number(delta);
    }

    if (updated > 0) {
      this.log.info('Late fees applied', { schoolId, updated, totalAdded });
    }

    return { updated, totalAdded: Number(totalAdded.toFixed(2)) };
  }

  /** Marks invoices past their due date as overdue. Run daily. */
  async markOverdue(schoolId: string): Promise<number> {
    const result = await this.prisma.invoice.updateMany({
      where: {
        schoolId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
        dueDate: { lt: new Date() },
        balance: { gt: 0 },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });
    return result.count;
  }

  // -------------------------------------------------------------------------
  // Shared helpers (used by PaymentsService too)
  // -------------------------------------------------------------------------

  /**
   * Recomputes an invoice's paid amount, balance and status from its
   * allocations. The single place invoice money state is derived, so payment,
   * refund and adjustment paths can never disagree.
   */
  async recalculate(tx: TransactionClient, invoiceId: string): Promise<void> {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: {
        id: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        lateFee: true,
        status: true,
        dueDate: true,
        allocations: {
          select: { amount: true, payment: { select: { status: true } } },
        },
        refunds: { select: { amount: true, status: true } },
      },
    });

    if (invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.VOID) {
      return;
    }

    // Money that actually arrived. A partially or fully refunded payment was
    // still received, so it stays in the paid total; the refund is subtracted
    // separately below. Filtering on SUCCESS alone would drop the whole payment
    // the moment any part of it was refunded.
    const paid = invoice.allocations
      .filter((allocation) => SETTLED_PAYMENT_STATUSES.includes(allocation.payment.status))
      .reduce((sum, allocation) => sum.add(D(allocation.amount)), ZERO);

    const refunded = invoice.refunds
      .filter((refund) => refund.status === 'COMPLETED')
      .reduce((sum, refund) => sum.add(D(refund.amount)), ZERO);

    const total = D(invoice.subtotal)
      .sub(D(invoice.discountTotal))
      .add(D(invoice.taxTotal))
      .add(D(invoice.lateFee));

    const balance = total.sub(paid).add(refunded);

    let status: InvoiceStatus;
    if (refunded.greaterThan(ZERO) && paid.lessThanOrEqualTo(refunded)) {
      status = InvoiceStatus.REFUNDED;
    } else if (balance.lessThanOrEqualTo(ZERO)) {
      status = InvoiceStatus.PAID;
    } else if (paid.greaterThan(ZERO)) {
      status = InvoiceStatus.PARTIALLY_PAID;
    } else if (invoice.dueDate < new Date()) {
      status = InvoiceStatus.OVERDUE;
    } else {
      status = InvoiceStatus.ISSUED;
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        total,
        paidAmount: paid,
        refundedAmount: refunded,
        // A negative balance would mean an overpayment; clamp and let the
        // credit show in the ledger instead.
        balance: balance.lessThan(ZERO) ? ZERO : balance,
        status,
      },
    });
  }

  /** Appends to the immutable ledger, carrying the running balance forward. */
  async writeLedger(
    tx: TransactionClient,
    entry: {
      schoolId: string;
      studentId: string | null;
      invoiceId?: string | null;
      paymentId?: string | null;
      refundId?: string | null;
      type: LedgerEntryType;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      description: string;
      createdById?: string | null;
      occurredAt?: Date;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    let balanceAfter: Prisma.Decimal | null = null;

    if (entry.studentId) {
      const previous = await tx.ledgerEntry.aggregate({
        where: { studentId: entry.studentId },
        _sum: { debit: true, credit: true },
      });
      const running = D(previous._sum.debit ?? 0).sub(D(previous._sum.credit ?? 0));
      balanceAfter = running.add(entry.debit).sub(entry.credit);
    }

    await tx.ledgerEntry.create({
      data: {
        schoolId: entry.schoolId,
        studentId: entry.studentId,
        invoiceId: entry.invoiceId ?? null,
        paymentId: entry.paymentId ?? null,
        refundId: entry.refundId ?? null,
        type: entry.type,
        debit: entry.debit,
        credit: entry.credit,
        balanceAfter,
        description: entry.description,
        createdById: entry.createdById ?? null,
        occurredAt: entry.occurredAt ?? new Date(),
        metadata: entry.metadata ?? {},
      },
    });
  }

  // -------------------------------------------------------------------------
  // Line construction
  // -------------------------------------------------------------------------

  private buildStructureLines(
    structure: {
      items: Array<{
        feeHeadId: string;
        amount: Prisma.Decimal;
        feeHead: { id: string; name: string; code: string };
      }>;
    },
    ratio: number,
    grants: Array<{ overrideValue: Prisma.Decimal | null; discount: Pick<Discount, 'id' | 'name' | 'type' | 'value' | 'maxAmount' | 'feeHeadIds'> }>,
    installmentName?: string,
  ): ComputedLine[] {
    return structure.items.map((item, index) => {
      const unit = D(item.amount).mul(ratio).toDecimalPlaces(2);

      // Apply every discount that targets this head (or all heads).
      let discountAmount = ZERO;
      let appliedDiscountId: string | null = null;

      for (const grant of grants) {
        const targets = grant.discount.feeHeadIds;
        if (targets.length > 0 && !targets.includes(item.feeHeadId)) continue;

        const value = grant.overrideValue ? D(grant.overrideValue) : D(grant.discount.value);
        let amount =
          grant.discount.type === 'PERCENTAGE' ? unit.mul(value).div(100) : value.mul(ratio);

        if (grant.discount.maxAmount) {
          const cap = D(grant.discount.maxAmount).mul(ratio);
          if (amount.greaterThan(cap)) amount = cap;
        }

        discountAmount = discountAmount.add(amount);
        appliedDiscountId ??= grant.discount.id;
      }

      // A discount can reduce a line to zero but never below it.
      if (discountAmount.greaterThan(unit)) discountAmount = unit;
      discountAmount = discountAmount.toDecimalPlaces(2);

      return {
        feeHeadId: item.feeHeadId,
        discountId: appliedDiscountId,
        description: installmentName
          ? `${item.feeHead.name} (${installmentName})`
          : item.feeHead.name,
        quantity: D(1),
        unitAmount: unit,
        discountAmount,
        taxPercent: ZERO,
        taxAmount: ZERO,
        amount: unit.sub(discountAmount),
        sortOrder: index,
      };
    });
  }

  private async buildManualLines(
    schoolId: string,
    dto: CreateInvoiceDto,
  ): Promise<ComputedLine[]> {
    const headIds = dto.items
      .map((item) => item.feeHeadId)
      .filter((id): id is string => Boolean(id));

    const heads = headIds.length
      ? await this.prisma.feeHead.findMany({
          where: { id: { in: headIds }, schoolId },
          select: { id: true, name: true },
        })
      : [];
    const headById = new Map(heads.map((head) => [head.id, head]));

    if (headIds.length !== new Set(headIds).size || heads.length !== new Set(headIds).size) {
      throw new BadRequestError('One or more fee heads do not exist in this school');
    }

    return dto.items.map((item, index) => {
      const quantity = D(item.quantity ?? 1);
      const unit = D(item.unitAmount);
      const gross = unit.mul(quantity);
      const discount = D(item.discountAmount ?? 0);

      if (discount.greaterThan(gross)) {
        throw new BadRequestError(
          `The discount on "${item.description}" exceeds the line amount`,
        );
      }

      const net = gross.sub(discount);
      const taxPercent = D(item.taxPercent ?? 0);
      const tax = net.mul(taxPercent).div(100).toDecimalPlaces(2);

      return {
        feeHeadId: item.feeHeadId ?? null,
        discountId: null,
        description:
          item.description ?? headById.get(item.feeHeadId ?? '')?.name ?? 'Fee',
        quantity,
        unitAmount: unit,
        discountAmount: discount,
        taxPercent,
        taxAmount: tax,
        amount: net.add(tax),
        sortOrder: index,
      };
    });
  }

  private sumLines(lines: ComputedLine[]): {
    subtotal: Prisma.Decimal;
    discountTotal: Prisma.Decimal;
    taxTotal: Prisma.Decimal;
    total: Prisma.Decimal;
  } {
    const subtotal = lines.reduce(
      (sum, line) => sum.add(line.unitAmount.mul(line.quantity)),
      ZERO,
    );
    const discountTotal = lines.reduce((sum, line) => sum.add(line.discountAmount), ZERO);
    const taxTotal = lines.reduce((sum, line) => sum.add(line.taxAmount), ZERO);

    return {
      subtotal: subtotal.toDecimalPlaces(2),
      discountTotal: discountTotal.toDecimalPlaces(2),
      taxTotal: taxTotal.toDecimalPlaces(2),
      total: subtotal.sub(discountTotal).add(taxTotal).toDecimalPlaces(2),
    };
  }
}
