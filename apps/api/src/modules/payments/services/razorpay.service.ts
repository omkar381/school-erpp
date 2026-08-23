import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, InvoiceStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { SequenceService } from '../../../common/services/sequence.service';
import { AuditService } from '../../audit/audit.service';
import { AcademicYearService } from '../../academics/services/academic-year.service';
import { PaymentsService } from './payments.service';
import type { CreateOrderDto, VerifyPaymentDto } from '../dto/payment.dto';

const D = (value: Prisma.Decimal | number | string): Prisma.Decimal => new Prisma.Decimal(value);
const ZERO = new Prisma.Decimal(0);

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}

/**
 * Razorpay integration.
 *
 * The governing rule is that the client is never trusted about money. The
 * server creates the order with an amount it computed itself, and a payment is
 * only ever marked successful after an HMAC signature check against the
 * server-held secret.
 */
@Injectable()
export class RazorpayService implements OnModuleInit {
  private client: Razorpay | null = null;
  private readonly log: AppLogger;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly academicYears: AcademicYearService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('RazorpayService');
  }

  onModuleInit(): void {
    const keyId = this.config.get<string>('payments.razorpay.keyId');
    const keySecret = this.config.get<string>('payments.razorpay.keySecret');

    if (!this.config.get<boolean>('payments.enabled')) {
      this.log.warn('Online payments are disabled');
      return;
    }
    if (!keyId || !keySecret) {
      this.log.warn(
        'Razorpay credentials are not configured; online payment endpoints will report the gateway as unavailable',
      );
      return;
    }

    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    this.log.info('Razorpay client initialised');
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  /** The publishable key the checkout widget needs. The secret never leaves the server. */
  getPublicKey(): { keyId: string; enabled: boolean } {
    return {
      keyId: this.config.get<string>('payments.razorpay.keyId', ''),
      enabled: this.isConfigured(),
    };
  }

  // -------------------------------------------------------------------------
  // Order creation
  // -------------------------------------------------------------------------

  /**
   * Creates a gateway order for the invoices a parent selected.
   *
   * The amount is derived on the server from the outstanding balances; any
   * amount supplied by the client is ignored entirely.
   */
  async createOrder(schoolId: string, dto: CreateOrderDto, requestedByUserId: string) {
    if (!this.client) {
      throw new ServiceUnavailableError(
        'Online payments are not available at the moment. Please pay at the school office.',
        ErrorCode.GATEWAY_ERROR,
      );
    }

    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, schoolId, deletedAt: null },
      select: {
        id: true,
        admissionNumber: true,
        firstName: true,
        lastName: true,
        guardians: { select: { guardian: { select: { userId: true, phone: true, email: true } } } },
      },
    });
    if (!student) throw new NotFoundError('Student');

    // A parent may only pay for their own child.
    const guardianUserIds = student.guardians
      .map((link) => link.guardian.userId)
      .filter((id): id is string => Boolean(id));

    const isGuardian = guardianUserIds.includes(requestedByUserId);
    if (!isGuardian) {
      const isStaff = await this.prisma.staff.count({
        where: { userId: requestedByUserId, schoolId, deletedAt: null },
      });
      if (isStaff === 0) {
        throw new ForbiddenError('You are not authorised to pay for this student');
      }
    }

    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        studentId: dto.studentId,
        id: { in: dto.invoiceIds },
        status: {
          in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
        },
      },
      select: { id: true, invoiceNumber: true, balance: true },
    });

    if (invoices.length === 0) {
      throw new BadRequestError('None of the selected invoices are payable');
    }
    if (invoices.length !== dto.invoiceIds.length) {
      throw new BadRequestError(
        'One or more selected invoices are already settled or do not belong to this student',
      );
    }

    // The authoritative amount.
    const amount = invoices.reduce((sum, invoice) => sum.add(D(invoice.balance)), ZERO);

    if (amount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestError('There is nothing outstanding on the selected invoices');
    }

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { currency: true, name: true },
    });
    const year = await this.academicYears.getCurrent(schoolId);
    const period = SequenceService.periodFromAcademicYear(year.name);

    // Razorpay works in the smallest currency unit.
    const amountInPaise = Math.round(Number(amount) * 100);

    const result = await this.prisma.transaction(async (tx) => {
      const receiptNumber = await this.sequences.next(schoolId, 'RECEIPT', { period }, tx);

      let order: RazorpayOrder;
      try {
        order = (await this.client!.orders.create({
          amount: amountInPaise,
          currency: school.currency,
          receipt: receiptNumber,
          notes: {
            schoolId,
            studentId: student.id,
            admissionNumber: student.admissionNumber,
            invoiceIds: dto.invoiceIds.join(','),
          },
        })) as unknown as RazorpayOrder;
      } catch (error) {
        this.log.error('Razorpay order creation failed', error, { schoolId, amount: Number(amount) });
        throw new ServiceUnavailableError(
          'The payment gateway could not be reached. Please try again shortly.',
          ErrorCode.GATEWAY_ERROR,
        );
      }

      // The payment is recorded as PENDING and only becomes SUCCESS after the
      // signature is verified.
      const payment = await tx.payment.create({
        data: {
          schoolId,
          studentId: student.id,
          receiptNumber,
          method: PaymentMethod.ONLINE_GATEWAY,
          status: PaymentStatus.PENDING,
          amount,
          allocatedAmount: amount,
          currency: school.currency,
          gateway: 'razorpay',
          gatewayOrderId: order.id,
          collectedById: requestedByUserId,
        },
        select: { id: true, receiptNumber: true },
      });

      // Allocations are fixed at order time so the settlement path has nothing
      // to decide once the money arrives.
      for (const invoice of invoices) {
        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: D(invoice.balance),
          },
        });
      }

      return { payment, order };
    });

    this.log.info('Razorpay order created', {
      schoolId,
      orderId: result.order.id,
      amount: Number(amount),
    });

    const primaryGuardian = student.guardians[0]?.guardian;

    return {
      orderId: result.order.id,
      paymentId: result.payment.id,
      receiptNumber: result.payment.receiptNumber,
      amount: Number(amount),
      amountInPaise,
      currency: school.currency,
      keyId: this.config.get<string>('payments.razorpay.keyId'),
      schoolName: school.name,
      studentName: [student.firstName, student.lastName].filter(Boolean).join(' '),
      prefill: {
        name: [student.firstName, student.lastName].filter(Boolean).join(' '),
        email: primaryGuardian?.email ?? undefined,
        contact: primaryGuardian?.phone ?? undefined,
      },
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: Number(invoice.balance),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  /**
   * Verifies the checkout callback and settles the payment.
   *
   * The signature is `HMAC_SHA256(order_id + "|" + payment_id, key_secret)`.
   * Nothing the client sends other than these three fields is trusted.
   */
  async verifyAndSettle(schoolId: string, dto: VerifyPaymentDto) {
    const secret = this.config.get<string>('payments.razorpay.keySecret');
    if (!secret) {
      throw new ServiceUnavailableError('Payment verification is unavailable', ErrorCode.GATEWAY_ERROR);
    }

    const payment = await this.prisma.payment.findFirst({
      where: { schoolId, gatewayOrderId: dto.razorpayOrderId },
      select: {
        id: true,
        status: true,
        amount: true,
        receiptNumber: true,
        studentId: true,
        allocations: { select: { invoiceId: true } },
      },
    });

    if (!payment) {
      this.log.warn('Verification attempted for an unknown order', {
        schoolId,
        orderId: dto.razorpayOrderId,
      });
      throw new NotFoundError('Payment');
    }

    // A duplicate callback is a success, not an error.
    if (payment.status === PaymentStatus.SUCCESS) {
      return {
        paymentId: payment.id,
        receiptNumber: payment.receiptNumber,
        status: PaymentStatus.SUCCESS,
        alreadyProcessed: true,
      };
    }

    const expected = createHmac('sha256', secret)
      .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
      .digest('hex');

    if (!this.safeCompare(expected, dto.razorpaySignature)) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: 'Signature verification failed',
        },
      });

      this.audit.record({
        action: AuditAction.PAYMENT,
        module: 'payments',
        entity: 'Payment',
        entityId: payment.id,
        description:
          `Signature verification FAILED for order ${dto.razorpayOrderId}. ` +
          'The payment was not credited.',
        schoolId,
      });

      this.log.error('Razorpay signature verification failed', undefined, {
        schoolId,
        orderId: dto.razorpayOrderId,
        paymentId: payment.id,
      });

      throw new BadRequestError(
        'Payment verification failed. If money was deducted it will be returned automatically.',
        ErrorCode.PAYMENT_VERIFICATION_FAILED,
      );
    }

    // Confirm with the gateway that the payment is genuinely captured and for
    // the right amount — a valid signature alone does not prove capture.
    let gatewayPayment: { amount?: number; status?: string; fee?: number } | null = null;
    if (this.client) {
      try {
        gatewayPayment = (await this.client.payments.fetch(
          dto.razorpayPaymentId,
        )) as unknown as { amount?: number; status?: string; fee?: number };
      } catch (error) {
        this.log.warn('Could not fetch the payment from Razorpay; proceeding on signature alone', {
          paymentId: dto.razorpayPaymentId,
          error: (error as Error).message,
        });
      }
    }

    if (gatewayPayment?.amount !== undefined) {
      const expectedPaise = Math.round(Number(payment.amount) * 100);
      if (gatewayPayment.amount !== expectedPaise) {
        this.log.error('Razorpay amount mismatch', undefined, {
          paymentId: payment.id,
          expected: expectedPaise,
          received: gatewayPayment.amount,
        });
        throw new BadRequestError(
          'The payment amount did not match the invoice. Please contact the school office.',
          ErrorCode.PAYMENT_VERIFICATION_FAILED,
        );
      }
    }

    await this.prisma.transaction(async (tx) => {
      await this.payments.settleGatewayPayment(tx, {
        schoolId,
        paymentId: payment.id,
        gatewayPaymentId: dto.razorpayPaymentId,
        gatewaySignature: dto.razorpaySignature,
        gatewayPayload: (gatewayPayment ?? {}) as Prisma.InputJsonValue,
        gatewayFee: gatewayPayment?.fee ? gatewayPayment.fee / 100 : undefined,
      });
    });

    this.audit.record({
      action: AuditAction.PAYMENT,
      module: 'payments',
      entity: 'Payment',
      entityId: payment.id,
      description:
        `Online payment verified and credited: ${Number(payment.amount)} ` +
        `(receipt ${payment.receiptNumber})`,
      newValue: { gatewayPaymentId: dto.razorpayPaymentId, amount: Number(payment.amount) },
      schoolId,
    });

    this.log.info('Razorpay payment verified and settled', {
      schoolId,
      paymentId: payment.id,
      amount: Number(payment.amount),
    });

    return {
      paymentId: payment.id,
      receiptNumber: payment.receiptNumber,
      status: PaymentStatus.SUCCESS,
      alreadyProcessed: false,
    };
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  /**
   * Handles a Razorpay webhook.
   *
   * Webhooks are the safety net for the case where the browser closed before
   * the callback fired. The signature is computed over the exact raw bytes
   * received, which is why the raw body is preserved in main.ts.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<{ handled: boolean; event?: string }> {
    const secret = this.config.get<string>('payments.razorpay.webhookSecret');
    if (!secret) {
      this.log.warn('Webhook received but RAZORPAY_WEBHOOK_SECRET is not configured');
      return { handled: false };
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!this.safeCompare(expected, signature)) {
      this.log.error('Razorpay webhook signature verification failed');
      throw new ForbiddenError('Invalid webhook signature', ErrorCode.PAYMENT_VERIFICATION_FAILED);
    }

    let payload: {
      event: string;
      payload?: {
        payment?: { entity?: { id: string; order_id: string; amount: number; fee?: number; status: string } };
        refund?: { entity?: { id: string; payment_id: string; amount: number; status: string } };
      };
    };

    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestError('Malformed webhook payload');
    }

    this.log.info('Razorpay webhook received', { event: payload.event });

    switch (payload.event) {
      case 'payment.captured':
        await this.onPaymentCaptured(payload.payload?.payment?.entity);
        break;
      case 'payment.failed':
        await this.onPaymentFailed(payload.payload?.payment?.entity);
        break;
      case 'refund.processed':
        await this.onRefundProcessed(payload.payload?.refund?.entity);
        break;
      default:
        this.log.debug('Unhandled webhook event', { event: payload.event });
        return { handled: false, event: payload.event };
    }

    return { handled: true, event: payload.event };
  }

  private async onPaymentCaptured(
    entity?: { id: string; order_id: string; amount: number; fee?: number },
  ): Promise<void> {
    if (!entity?.order_id) return;

    const payment = await this.prisma.payment.findFirst({
      where: { gatewayOrderId: entity.order_id },
      select: { id: true, schoolId: true, status: true, amount: true, receiptNumber: true },
    });

    if (!payment) {
      this.log.warn('Webhook referenced an unknown order', { orderId: entity.order_id });
      return;
    }

    if (payment.status === PaymentStatus.SUCCESS) return;

    const expectedPaise = Math.round(Number(payment.amount) * 100);
    if (entity.amount !== expectedPaise) {
      this.log.error('Webhook amount mismatch; refusing to credit', undefined, {
        paymentId: payment.id,
        expected: expectedPaise,
        received: entity.amount,
      });
      return;
    }

    await this.prisma.transaction(async (tx) => {
      await this.payments.settleGatewayPayment(tx, {
        schoolId: payment.schoolId,
        paymentId: payment.id,
        gatewayPaymentId: entity.id,
        gatewaySignature: 'webhook',
        gatewayPayload: entity as unknown as Prisma.InputJsonValue,
        gatewayFee: entity.fee ? entity.fee / 100 : undefined,
      });
    });

    this.audit.record({
      action: AuditAction.PAYMENT,
      module: 'payments',
      entity: 'Payment',
      entityId: payment.id,
      description: `Payment ${payment.receiptNumber} credited via webhook`,
      schoolId: payment.schoolId,
    });

    this.log.info('Payment settled from webhook', { paymentId: payment.id });
  }

  private async onPaymentFailed(entity?: { id: string; order_id: string }): Promise<void> {
    if (!entity?.order_id) return;

    const payment = await this.prisma.payment.findFirst({
      where: { gatewayOrderId: entity.order_id },
      select: { id: true, status: true },
    });

    // A payment that already succeeded is never downgraded by a late failure event.
    if (!payment || payment.status === PaymentStatus.SUCCESS) return;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureReason: 'Reported as failed by the payment gateway',
        gatewayPaymentId: entity.id,
      },
    });
  }

  private async onRefundProcessed(
    entity?: { id: string; payment_id: string; amount: number },
  ): Promise<void> {
    if (!entity?.id) return;

    await this.prisma.refund.updateMany({
      where: { gatewayRefundId: entity.id, status: { not: 'COMPLETED' } },
      data: { status: 'COMPLETED', processedAt: new Date() },
    });
  }

  // -------------------------------------------------------------------------
  // Reconciliation
  // -------------------------------------------------------------------------

  /**
   * Finds payments left PENDING and asks the gateway what actually happened.
   * Run on a schedule so an abandoned browser never loses a real payment.
   */
  async reconcile(schoolId: string, olderThanMinutes = 15) {
    if (!this.client) return { checked: 0, settled: 0, failed: 0 };

    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

    const pending = await this.prisma.payment.findMany({
      where: {
        schoolId,
        gateway: 'razorpay',
        status: PaymentStatus.PENDING,
        createdAt: { lt: cutoff },
        gatewayOrderId: { not: null },
      },
      select: { id: true, gatewayOrderId: true, amount: true, receiptNumber: true },
      take: 100,
    });

    let settled = 0;
    let failed = 0;

    for (const payment of pending) {
      try {
        const orderPayments = (await this.client.orders.fetchPayments(
          payment.gatewayOrderId!,
        )) as unknown as { items: Array<{ id: string; status: string; amount: number; fee?: number }> };

        const captured = orderPayments.items?.find((entry) => entry.status === 'captured');

        if (captured) {
          const expectedPaise = Math.round(Number(payment.amount) * 100);
          if (captured.amount !== expectedPaise) {
            this.log.error('Reconciliation found an amount mismatch', undefined, {
              paymentId: payment.id,
            });
            continue;
          }

          await this.prisma.transaction(async (tx) => {
            await this.payments.settleGatewayPayment(tx, {
              schoolId,
              paymentId: payment.id,
              gatewayPaymentId: captured.id,
              gatewaySignature: 'reconciliation',
              gatewayPayload: captured as unknown as Prisma.InputJsonValue,
              gatewayFee: captured.fee ? captured.fee / 100 : undefined,
            });
          });

          settled += 1;
          this.log.info('Reconciliation settled a pending payment', { paymentId: payment.id });
        } else if (orderPayments.items?.length === 0) {
          // The customer never completed checkout.
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.CANCELLED,
              failureReason: 'Checkout was not completed',
            },
          });
          failed += 1;
        }
      } catch (error) {
        this.log.warn('Reconciliation could not check an order', {
          paymentId: payment.id,
          error: (error as Error).message,
        });
      }
    }

    if (settled > 0 || failed > 0) {
      this.log.info('Payment reconciliation completed', {
        schoolId,
        checked: pending.length,
        settled,
        failed,
      });
    }

    return { checked: pending.length, settled, failed };
  }

  private safeCompare(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b ?? '', 'utf8');
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }
}
