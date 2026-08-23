import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  InvoiceStatus,
  LedgerEntryType,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Priority,
  RefundStatus,
} from '@prisma/client';
import { PrismaService, type TransactionClient } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../../common/dto/api-response.dto';
import {
  BadRequestError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { SequenceService } from '../../../common/services/sequence.service';
import { formatDate, parseDateOnly } from '../../../common/utils/date.util';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { InvoicesService } from '../../fees/services/invoices.service';
import { AcademicYearService } from '../../academics/services/academic-year.service';
import type {
  ApproveRefundDto,
  CollectPaymentDto,
  PaymentQueryDto,
  RequestRefundDto,
} from '../dto/payment.dto';

const D = (value: Prisma.Decimal | number | string): Prisma.Decimal => new Prisma.Decimal(value);
const ZERO = new Prisma.Decimal(0);

@Injectable()
export class PaymentsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly academicYears: AcademicYearService,
    private readonly sequences: SequenceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('PaymentsService');
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: PaymentQueryDto) {
    const where: Prisma.PaymentWhereInput = {
      schoolId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.collectedById ? { collectedById: query.collectedById } : {}),
      ...(query.from || query.to
        ? {
            paidAt: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { receiptNumber: { contains: query.search, mode: 'insensitive' } },
              { referenceNumber: { contains: query.search, mode: 'insensitive' } },
              { gatewayPaymentId: { contains: query.search, mode: 'insensitive' } },
              { student: { admissionNumber: { contains: query.search, mode: 'insensitive' } } },
              { student: { firstName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total, sums] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { paidAt: query.sortOrder },
        select: {
          id: true,
          receiptNumber: true,
          method: true,
          status: true,
          amount: true,
          refundedAmount: true,
          currency: true,
          paidAt: true,
          referenceNumber: true,
          gateway: true,
          gatewayPaymentId: true,
          createdAt: true,
          student: {
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
          },
          allocations: {
            select: { amount: true, invoice: { select: { id: true, invoiceNumber: true } } },
          },
        },
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({
        where: { ...where, status: PaymentStatus.SUCCESS },
        _sum: { amount: true, refundedAmount: true },
      }),
    ]);

    return {
      ...buildPaginatedResult(items, total, query.page, query.limit),
      totals: {
        collected: Number(sums._sum.amount ?? 0),
        refunded: Number(sums._sum.refundedAmount ?? 0),
        net: Number(sums._sum.amount ?? 0) - Number(sums._sum.refundedAmount ?? 0),
      },
    };
  }

  async findOne(schoolId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, schoolId },
      include: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              take: 1,
              select: {
                class: { select: { name: true } },
                section: { select: { name: true } },
              },
            },
            guardians: {
              where: { isPayer: true },
              take: 1,
              select: { guardian: { select: { firstName: true, lastName: true, phone: true } } },
            },
          },
        },
        allocations: {
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                total: true,
                balance: true,
                dueDate: true,
                installment: { select: { name: true } },
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
            processedAt: true,
          },
        },
      },
    });

    if (!payment) throw new NotFoundError('Payment');

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: {
        name: true,
        logoUrl: true,
        addressLine1: true,
        city: true,
        state: true,
        postalCode: true,
        phone: true,
        email: true,
        currency: true,
        invoiceFooter: true,
      },
    });

    // The gateway payload can contain card metadata; it is never returned.
    const { gatewayPayload: _payload, gatewaySignature: _signature, ...safe } = payment;

    return { ...safe, school };
  }

  // -------------------------------------------------------------------------
  // Collection
  // -------------------------------------------------------------------------

  /**
   * Records an offline payment (cash, cheque, UPI reference and so on) and
   * allocates it across invoices.
   *
   * The whole operation runs in one transaction: the payment, its allocations,
   * every affected invoice's recomputed balance and the ledger entries either
   * all land or none do.
   */
  async collect(schoolId: string, dto: CollectPaymentDto, collectedById: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, schoolId, deletedAt: null },
      select: { id: true, admissionNumber: true, firstName: true, lastName: true },
    });
    if (!student) throw new NotFoundError('Student');

    // An idempotency key lets a retried request return the original receipt
    // rather than taking the money twice.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.payment.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        select: { id: true, schoolId: true },
      });
      if (existing) {
        if (existing.schoolId !== schoolId) {
          throw new ConflictError('That idempotency key belongs to another school');
        }
        this.log.info('Returning existing payment for idempotency key', {
          paymentId: existing.id,
        });
        return this.findOne(schoolId, existing.id);
      }
    }

    const amount = D(dto.amount);
    if (amount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestError('The payment amount must be greater than zero');
    }

    // Resolve which invoices this payment settles.
    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        studentId: dto.studentId,
        ...(dto.invoiceIds?.length
          ? { id: { in: dto.invoiceIds } }
          : {
              status: {
                in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
              },
            }),
      },
      orderBy: { dueDate: 'asc' },
      select: { id: true, invoiceNumber: true, balance: true, status: true, dueDate: true },
    });

    if (dto.invoiceIds?.length && invoices.length !== dto.invoiceIds.length) {
      throw new BadRequestError('One or more invoices do not belong to this student');
    }

    const settleable = invoices.filter(
      (invoice) =>
        invoice.status !== InvoiceStatus.CANCELLED &&
        invoice.status !== InvoiceStatus.VOID &&
        D(invoice.balance).greaterThan(ZERO),
    );

    if (settleable.length === 0) {
      throw new BadRequestError(
        'This student has no outstanding invoices to pay',
        ErrorCode.INVOICE_ALREADY_PAID,
      );
    }

    const outstanding = settleable.reduce((sum, invoice) => sum.add(D(invoice.balance)), ZERO);

    // Overpayment is refused rather than silently held as credit.
    if (amount.greaterThan(outstanding)) {
      throw new BusinessRuleError(
        `The amount exceeds the outstanding balance of ${outstanding.toFixed(2)}`,
        ErrorCode.PAYMENT_AMOUNT_EXCEEDS_BALANCE,
        { outstanding: Number(outstanding) },
      );
    }

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { currency: true, name: true },
    });
    const year = await this.academicYears.getCurrent(schoolId);
    const period = SequenceService.periodFromAcademicYear(year.name);

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    const payment = await this.prisma.transaction(
      async (tx) => {
        const receiptNumber = await this.sequences.next(schoolId, 'RECEIPT', { period }, tx);

        // A cheque is not money until it clears, so it is recorded as pending.
        const isCheque =
          dto.method === PaymentMethod.CHEQUE || dto.method === PaymentMethod.DEMAND_DRAFT;
        const status = isCheque ? PaymentStatus.PROCESSING : PaymentStatus.SUCCESS;

        const created = await tx.payment.create({
          data: {
            schoolId,
            studentId: dto.studentId,
            receiptNumber,
            method: dto.method,
            status,
            amount,
            allocatedAmount: amount,
            currency: school.currency,
            paidAt: isCheque ? null : paidAt,
            referenceNumber: dto.referenceNumber ?? null,
            bankName: dto.bankName ?? null,
            chequeNumber: dto.chequeNumber ?? null,
            chequeDate: dto.chequeDate ? parseDateOnly(dto.chequeDate) : null,
            idempotencyKey: dto.idempotencyKey ?? null,
            notes: dto.notes ?? null,
            collectedById,
          },
          select: { id: true, receiptNumber: true, status: true },
        });

        // Allocate oldest-due first, so the most overdue bill clears first.
        let remaining = amount;
        const touched: string[] = [];

        for (const invoice of settleable) {
          if (remaining.lessThanOrEqualTo(ZERO)) break;

          const balance = D(invoice.balance);
          const applied = remaining.greaterThan(balance) ? balance : remaining;

          await tx.paymentAllocation.create({
            data: { paymentId: created.id, invoiceId: invoice.id, amount: applied },
          });

          remaining = remaining.sub(applied);
          touched.push(invoice.id);
        }

        // Only a settled payment moves an invoice balance.
        if (status === PaymentStatus.SUCCESS) {
          for (const invoiceId of touched) {
            await this.invoices.recalculate(tx, invoiceId);
          }

          await this.invoices.writeLedger(tx, {
            schoolId,
            studentId: dto.studentId,
            paymentId: created.id,
            invoiceId: touched[0] ?? null,
            type: LedgerEntryType.PAYMENT,
            debit: ZERO,
            credit: amount,
            description: `Payment ${created.receiptNumber} received via ${dto.method}`,
            createdById: collectedById,
            occurredAt: paidAt,
          });
        }

        return created;
      },
      { timeout: 30_000 },
    );

    this.audit.record({
      action: AuditAction.PAYMENT,
      module: 'payments',
      entity: 'Payment',
      entityId: payment.id,
      description:
        `Collected ${amount.toFixed(2)} from ${student.admissionNumber} via ${dto.method} ` +
        `(receipt ${payment.receiptNumber})`,
      newValue: {
        amount: Number(amount),
        method: dto.method,
        receiptNumber: payment.receiptNumber,
      },
      schoolId,
    });

    this.log.info('Payment collected', {
      schoolId,
      paymentId: payment.id,
      amount: Number(amount),
      method: dto.method,
    });

    if (payment.status === PaymentStatus.SUCCESS) {
      void this.notifyReceipt(schoolId, school.name, payment.id).catch(() => undefined);
    }

    return this.findOne(schoolId, payment.id);
  }

  /** Marks a cheque as cleared, at which point it becomes real money. */
  async clearCheque(schoolId: string, paymentId: string, clearedById: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, schoolId },
      select: {
        id: true,
        status: true,
        method: true,
        amount: true,
        studentId: true,
        receiptNumber: true,
        allocations: { select: { invoiceId: true } },
      },
    });
    if (!payment) throw new NotFoundError('Payment');

    if (payment.status !== PaymentStatus.PROCESSING) {
      throw new BadRequestError(`This payment is already ${payment.status}`);
    }

    const paidAt = new Date();

    await this.prisma.transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.SUCCESS, paidAt, clearedAt: paidAt },
      });

      for (const allocation of payment.allocations) {
        await this.invoices.recalculate(tx, allocation.invoiceId);
      }

      await this.invoices.writeLedger(tx, {
        schoolId,
        studentId: payment.studentId,
        paymentId: payment.id,
        type: LedgerEntryType.PAYMENT,
        debit: ZERO,
        credit: D(payment.amount),
        description: `Cheque cleared for ${payment.receiptNumber}`,
        createdById: clearedById,
        occurredAt: paidAt,
      });
    });

    this.audit.record({
      action: AuditAction.PAYMENT,
      module: 'payments',
      entity: 'Payment',
      entityId: paymentId,
      description: `Cheque cleared for receipt ${payment.receiptNumber}`,
      schoolId,
    });

    return this.findOne(schoolId, paymentId);
  }

  /** Marks a cheque as bounced; the invoice balance is restored. */
  async failPayment(schoolId: string, paymentId: string, reason: string, actingUserId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, schoolId },
      select: {
        id: true,
        status: true,
        receiptNumber: true,
        studentId: true,
        allocations: { select: { invoiceId: true } },
      },
    });
    if (!payment) throw new NotFoundError('Payment');

    if (payment.status === PaymentStatus.FAILED) {
      throw new BadRequestError('This payment is already marked as failed');
    }
    if (payment.status === PaymentStatus.REFUNDED) {
      throw new BadRequestError('A refunded payment cannot be marked as failed');
    }

    await this.prisma.transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.FAILED, failureReason: reason },
      });

      // Recalculation drops this payment from the paid total automatically.
      for (const allocation of payment.allocations) {
        await this.invoices.recalculate(tx, allocation.invoiceId);
      }

      await this.invoices.writeLedger(tx, {
        schoolId,
        studentId: payment.studentId,
        paymentId: payment.id,
        type: LedgerEntryType.ADJUSTMENT,
        debit: ZERO,
        credit: ZERO,
        description: `Payment ${payment.receiptNumber} failed: ${reason}`,
        createdById: actingUserId,
      });
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'payments',
      entity: 'Payment',
      entityId: paymentId,
      description: `Payment ${payment.receiptNumber} marked as failed: ${reason}`,
      schoolId,
    });

    return { id: paymentId, status: PaymentStatus.FAILED };
  }

  // -------------------------------------------------------------------------
  // Refunds
  // -------------------------------------------------------------------------

  async requestRefund(schoolId: string, dto: RequestRefundDto, requestedById: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: dto.paymentId, schoolId },
      select: {
        id: true,
        receiptNumber: true,
        status: true,
        amount: true,
        refundedAmount: true,
        studentId: true,
        method: true,
        allocations: { select: { invoiceId: true, amount: true } },
      },
    });
    if (!payment) throw new NotFoundError('Payment');

    if (payment.status !== PaymentStatus.SUCCESS && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new BadRequestError(
        `Only a settled payment can be refunded; this one is ${payment.status}`,
      );
    }

    const amount = D(dto.amount);
    const refundable = D(payment.amount).sub(D(payment.refundedAmount));

    if (amount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestError('The refund amount must be greater than zero');
    }
    if (amount.greaterThan(refundable)) {
      throw new BusinessRuleError(
        `Only ${refundable.toFixed(2)} remains refundable on this payment`,
        ErrorCode.REFUND_EXCEEDS_PAYMENT,
        { refundable: Number(refundable) },
      );
    }

    const year = await this.academicYears.getCurrent(schoolId);
    const period = SequenceService.periodFromAcademicYear(year.name);

    const refund = await this.prisma.transaction(async (tx) => {
      const refundNumber = await this.sequences.next(schoolId, 'REFUND', { period }, tx);

      return tx.refund.create({
        data: {
          schoolId,
          paymentId: payment.id,
          invoiceId: dto.invoiceId ?? payment.allocations[0]?.invoiceId ?? null,
          refundNumber,
          amount,
          status: RefundStatus.REQUESTED,
          reason: dto.reason,
          method: dto.method ?? payment.method,
          requestedById,
        },
        select: { id: true, refundNumber: true, amount: true, status: true },
      });
    });

    this.audit.record({
      action: AuditAction.REFUND,
      module: 'payments',
      entity: 'Refund',
      entityId: refund.id,
      description:
        `Requested refund ${refund.refundNumber} of ${amount.toFixed(2)} ` +
        `against receipt ${payment.receiptNumber}: ${dto.reason}`,
      schoolId,
    });

    return refund;
  }

  /**
   * Approves and settles a refund.
   *
   * The money movement happens here, not at request time, so an unapproved
   * request never touches an invoice balance.
   */
  async approveRefund(
    schoolId: string,
    refundId: string,
    dto: ApproveRefundDto,
    approvedById: string,
  ) {
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId, schoolId },
      select: {
        id: true,
        refundNumber: true,
        status: true,
        amount: true,
        invoiceId: true,
        payment: {
          select: {
            id: true,
            receiptNumber: true,
            amount: true,
            refundedAmount: true,
            studentId: true,
            allocations: { select: { invoiceId: true } },
          },
        },
      },
    });
    if (!refund) throw new NotFoundError('Refund');

    if (refund.status !== RefundStatus.REQUESTED) {
      throw new BadRequestError(`This refund is already ${refund.status}`);
    }

    if (!dto.approve) {
      await this.prisma.refund.update({
        where: { id: refundId },
        data: {
          status: RefundStatus.REJECTED,
          rejectedReason: dto.reason ?? 'Not approved',
          approvedById,
          approvedAt: new Date(),
        },
      });

      this.audit.record({
        action: AuditAction.REJECT,
        module: 'payments',
        entity: 'Refund',
        entityId: refundId,
        description: `Rejected refund ${refund.refundNumber}: ${dto.reason ?? 'no reason given'}`,
        schoolId,
      });

      return { id: refundId, status: RefundStatus.REJECTED };
    }

    // Re-check refundability at approval time; another refund may have landed.
    const alreadyRefunded = D(refund.payment.refundedAmount);
    const refundable = D(refund.payment.amount).sub(alreadyRefunded);

    if (D(refund.amount).greaterThan(refundable)) {
      throw new BusinessRuleError(
        `Only ${refundable.toFixed(2)} remains refundable on this payment`,
        ErrorCode.REFUND_EXCEEDS_PAYMENT,
      );
    }

    const processedAt = new Date();

    await this.prisma.transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refundId },
        data: {
          status: RefundStatus.COMPLETED,
          approvedById,
          approvedAt: processedAt,
          processedAt,
          gatewayRefundId: dto.gatewayRefundId ?? null,
        },
      });

      const totalRefunded = alreadyRefunded.add(D(refund.amount));

      await tx.payment.update({
        where: { id: refund.payment.id },
        data: {
          refundedAmount: totalRefunded,
          status: totalRefunded.greaterThanOrEqualTo(D(refund.payment.amount))
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED,
        },
      });

      // The refunded amount goes back onto the invoice as owing again.
      const affected = refund.invoiceId
        ? [refund.invoiceId]
        : refund.payment.allocations.map((allocation) => allocation.invoiceId);

      for (const invoiceId of affected) {
        await this.invoices.recalculate(tx, invoiceId);
      }

      await this.invoices.writeLedger(tx, {
        schoolId,
        studentId: refund.payment.studentId,
        paymentId: refund.payment.id,
        refundId: refund.id,
        invoiceId: refund.invoiceId,
        type: LedgerEntryType.REFUND,
        debit: D(refund.amount),
        credit: ZERO,
        description: `Refund ${refund.refundNumber} issued against receipt ${refund.payment.receiptNumber}`,
        createdById: approvedById,
        occurredAt: processedAt,
      });
    });

    this.audit.record({
      action: AuditAction.REFUND,
      module: 'payments',
      entity: 'Refund',
      entityId: refundId,
      description:
        `Approved and issued refund ${refund.refundNumber} of ${Number(refund.amount)} ` +
        `against receipt ${refund.payment.receiptNumber}`,
      newValue: { amount: Number(refund.amount), approvedById },
      schoolId,
    });

    this.log.warn('Refund issued', {
      schoolId,
      refundId,
      amount: Number(refund.amount),
      approvedById,
    });

    return { id: refundId, status: RefundStatus.COMPLETED, processedAt };
  }

  async listRefunds(schoolId: string, status?: RefundStatus) {
    return this.prisma.refund.findMany({
      where: { schoolId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        payment: {
          select: {
            receiptNumber: true,
            method: true,
            amount: true,
            student: {
              select: { id: true, admissionNumber: true, firstName: true, lastName: true },
            },
          },
        },
        invoice: { select: { invoiceNumber: true } },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Internal helpers used by the gateway service
  // -------------------------------------------------------------------------

  /**
   * Settles a verified gateway payment. Called only after the signature has
   * been checked, never directly from a client request.
   */
  async settleGatewayPayment(
    tx: TransactionClient,
    input: {
      schoolId: string;
      paymentId: string;
      gatewayPaymentId: string;
      gatewaySignature: string;
      gatewayPayload?: Prisma.InputJsonValue;
      gatewayFee?: number;
    },
  ): Promise<void> {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: input.paymentId },
      select: {
        id: true,
        receiptNumber: true,
        amount: true,
        studentId: true,
        status: true,
        allocations: { select: { invoiceId: true } },
      },
    });

    // Idempotency: a webhook and the client callback often both arrive.
    if (payment.status === PaymentStatus.SUCCESS) {
      this.log.debug('Gateway payment already settled; ignoring duplicate', {
        paymentId: payment.id,
      });
      return;
    }

    const paidAt = new Date();

    await tx.payment.update({
      where: { id: input.paymentId },
      data: {
        status: PaymentStatus.SUCCESS,
        paidAt,
        gatewayPaymentId: input.gatewayPaymentId,
        gatewaySignature: input.gatewaySignature,
        gatewayPayload: input.gatewayPayload,
        gatewayFee: input.gatewayFee ?? null,
      },
    });

    for (const allocation of payment.allocations) {
      await this.invoices.recalculate(tx, allocation.invoiceId);
    }

    await this.invoices.writeLedger(tx, {
      schoolId: input.schoolId,
      studentId: payment.studentId,
      paymentId: payment.id,
      invoiceId: payment.allocations[0]?.invoiceId ?? null,
      type: LedgerEntryType.PAYMENT,
      debit: ZERO,
      credit: D(payment.amount),
      description: `Online payment ${payment.receiptNumber} confirmed`,
      occurredAt: paidAt,
    });
  }

  private async notifyReceipt(
    schoolId: string,
    schoolName: string,
    paymentId: string,
  ): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        receiptNumber: true,
        amount: true,
        currency: true,
        method: true,
        paidAt: true,
        student: {
          select: {
            firstName: true,
            lastName: true,
            guardians: {
              where: { isPayer: true },
              select: { guardian: { select: { userId: true, firstName: true } } },
            },
          },
        },
      },
    });
    if (!payment) return;

    const recipients = payment.student.guardians
      .map((link) => link.guardian.userId)
      .filter((id): id is string => Boolean(id));

    if (recipients.length === 0) return;

    const studentName = [payment.student.firstName, payment.student.lastName]
      .filter(Boolean)
      .join(' ');

    await this.notifications.dispatch({
      schoolId,
      userIds: recipients,
      type: NotificationType.FEE,
      title: 'Payment received',
      body: `${payment.currency} ${Number(payment.amount).toFixed(2)} received for ${studentName}. Receipt ${payment.receiptNumber}.`,
      priority: Priority.NORMAL,
      // Payment confirmations are sent regardless of preference: a family must
      // always be told that money moved.
      force: true,
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
      data: { paymentId, receiptNumber: payment.receiptNumber },
      actionUrl: `/parent/fees/receipts/${paymentId}`,
      email: {
        subject: `${schoolName}: payment receipt ${payment.receiptNumber}`,
        template: 'payment-receipt',
        data: {
          guardianName: payment.student.guardians[0]?.guardian.firstName ?? 'Parent',
          studentName,
          receiptNumber: payment.receiptNumber,
          amount: Number(payment.amount).toFixed(2),
          currency: payment.currency,
          method: payment.method,
          paidAt: formatDate(payment.paidAt),
        },
      },
    });
  }
}
