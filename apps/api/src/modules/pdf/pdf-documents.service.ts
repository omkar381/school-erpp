import { Injectable } from '@nestjs/common';
import { AuditAction, CertificateType, EnrollmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { ForbiddenError, NotFoundError } from '../../common/exceptions/app.exception';
import { formatDateIn, todayInZone } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { PdfService, type RenderedPdf } from './pdf.service';
import {
  type FeeStatementDocument,
  type InvoiceDocument,
  type ReceiptDocument,
  feeStatementTemplate,
  invoiceTemplate,
  receiptTemplate,
} from './templates/finance.template';
import {
  type CertificateDocument,
  type IdCardHolder,
  type ReportCardDocument,
  certificateTemplate,
  idCardSheetTemplate,
  reportCardTemplate,
} from './templates/academic.template';

interface StudentIdentity {
  name: string;
  admissionNumber: string;
  rollNumber: string | null;
  className: string;
  sectionName: string;
  guardianName: string | null;
  guardianPhone: string | null;
}

/** Shared student projection so every document names a student the same way. */
const STUDENT_SELECT = Prisma.validator<Prisma.StudentSelect>()({
  id: true,
  admissionNumber: true,
  rollNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  dateOfBirth: true,
  photoUrl: true,
  bloodGroup: true,
  addressLine1: true,
  city: true,
  enrollments: {
    where: { status: EnrollmentStatus.ACTIVE },
    take: 1,
    orderBy: { createdAt: 'desc' },
    select: {
      rollNumber: true,
      class: { select: { name: true } },
      section: { select: { name: true } },
    },
  },
  guardians: {
    orderBy: { isPrimary: 'desc' },
    take: 1,
    select: {
      guardian: { select: { firstName: true, lastName: true, phone: true } },
    },
  },
});

type StudentRow = Prisma.StudentGetPayload<{ select: typeof STUDENT_SELECT }>;

function identify(student: StudentRow): StudentIdentity {
  const enrollment = student.enrollments[0];
  const guardian = student.guardians[0]?.guardian;

  return {
    name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '),
    admissionNumber: student.admissionNumber,
    rollNumber: enrollment?.rollNumber ?? student.rollNumber,
    className: enrollment?.class?.name ?? '—',
    sectionName: enrollment?.section?.name ?? '—',
    guardianName: guardian ? [guardian.firstName, guardian.lastName].filter(Boolean).join(' ') : null,
    guardianPhone: guardian?.phone ?? null,
  };
}

/**
 * Builds every printable document the platform issues.
 *
 * Each method reads exactly what its template needs, renders it and — for the
 * documents that are records rather than views — writes the storage key back
 * onto the row so a reprint returns the same file rather than a new rendering.
 */
@Injectable()
export class PdfDocumentsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('PdfDocumentsService');
  }

  // -------------------------------------------------------------------------
  // Finance
  // -------------------------------------------------------------------------

  async invoice(schoolId: string, invoiceId: string, force = false): Promise<RenderedPdf> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, schoolId },
      include: {
        academicYear: { select: { name: true } },
        student: { select: STUDENT_SELECT },
        items: { orderBy: { sortOrder: 'asc' } },
        allocations: {
          where: { payment: { status: 'SUCCESS' } },
          include: {
            payment: { select: { receiptNumber: true, paidAt: true, method: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!invoice) throw new NotFoundError('Invoice');

    const cached = await this.reuse(invoice.pdfStorageKey, force, `${invoice.invoiceNumber}.pdf`);
    if (cached) return cached;

    const brand = await this.pdf.brandFor(schoolId);
    const student = identify(invoice.student);

    const document: InvoiceDocument = {
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issueDate: formatDateIn(invoice.issueDate, brand.timezone),
      dueDate: formatDateIn(invoice.dueDate, brand.timezone),
      academicYear: invoice.academicYear.name,
      currency: invoice.currency,
      student,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitAmount: Number(item.unitAmount),
        discountAmount: Number(item.discountAmount),
        taxAmount: Number(item.taxAmount),
        amount: Number(item.amount),
      })),
      subtotal: Number(invoice.subtotal),
      discountTotal: Number(invoice.discountTotal),
      taxTotal: Number(invoice.taxTotal),
      lateFee: Number(invoice.lateFee),
      total: Number(invoice.total),
      paidAmount: Number(invoice.paidAmount),
      balance: Number(invoice.balance),
      notes: invoice.notes,
      payments: invoice.allocations.map((allocation) => ({
        receiptNumber: allocation.payment.receiptNumber,
        paidAt: allocation.payment.paidAt
          ? formatDateIn(allocation.payment.paidAt, brand.timezone)
          : '—',
        method: allocation.payment.method,
        amount: Number(allocation.amount),
      })),
    };

    const rendered = await this.pdf.render(invoiceTemplate(brand, document), schoolId, {
      folder: `schools/${schoolId}/invoices`,
      fileName: `${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`,
    });

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { pdfStorageKey: rendered.storageKey },
    });

    return rendered;
  }

  async receipt(schoolId: string, paymentId: string, force = false): Promise<RenderedPdf> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, schoolId },
      include: {
        student: { select: STUDENT_SELECT },
        allocations: {
          include: { invoice: { select: { invoiceNumber: true, dueDate: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!payment) throw new NotFoundError('Payment');

    const cached = await this.reuse(payment.pdfStorageKey, force, `${payment.receiptNumber}.pdf`);
    if (cached) return cached;

    const brand = await this.pdf.brandFor(schoolId);
    const student = identify(payment.student);

    const [outstanding, collector] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: {
          studentId: payment.studentId,
          status: { notIn: ['CANCELLED', 'VOID', 'PAID'] },
        },
        _sum: { balance: true },
      }),
      payment.collectedById
        ? this.prisma.user.findUnique({
            where: { id: payment.collectedById },
            select: { firstName: true, lastName: true },
          })
        : Promise.resolve(null),
    ]);

    const document: ReceiptDocument = {
      receiptNumber: payment.receiptNumber,
      paidAt: formatDateIn(payment.paidAt ?? payment.createdAt, brand.timezone),
      method: payment.method,
      status: payment.status,
      currency: payment.currency,
      amount: Number(payment.amount),
      referenceNumber: payment.referenceNumber ?? payment.gatewayPaymentId,
      bankName: payment.bankName,
      chequeNumber: payment.chequeNumber,
      collectedBy: collector
        ? [collector.firstName, collector.lastName].filter(Boolean).join(' ')
        : null,
      student: {
        name: student.name,
        admissionNumber: student.admissionNumber,
        className: student.className,
        sectionName: student.sectionName,
      },
      allocations: payment.allocations.map((allocation) => ({
        invoiceNumber: allocation.invoice.invoiceNumber,
        dueDate: formatDateIn(allocation.invoice.dueDate, brand.timezone),
        amount: Number(allocation.amount),
      })),
      outstandingAfter: Number(outstanding._sum.balance ?? 0),
    };

    const rendered = await this.pdf.render(receiptTemplate(brand, document), schoolId, {
      folder: `schools/${schoolId}/receipts`,
      fileName: `${payment.receiptNumber.replace(/\//g, '-')}.pdf`,
    });

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { pdfStorageKey: rendered.storageKey },
    });

    return rendered;
  }

  /**
   * A student's fee ledger for one academic year.
   *
   * Always re-rendered: unlike an invoice or a receipt, a statement is a view
   * of a moving balance, so a cached copy would be wrong the moment the next
   * payment lands.
   */
  async feeStatement(
    schoolId: string,
    studentId: string,
    academicYearId?: string,
  ): Promise<RenderedPdf> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId, deletedAt: null },
      select: STUDENT_SELECT,
    });
    if (!student) throw new NotFoundError('Student');

    const year = academicYearId
      ? await this.prisma.academicYear.findFirst({
          where: { id: academicYearId, schoolId },
          select: { id: true, name: true, startDate: true, endDate: true },
        })
      : await this.prisma.academicYear.findFirst({
          where: { schoolId, isCurrent: true },
          select: { id: true, name: true, startDate: true, endDate: true },
        });
    if (!year) throw new NotFoundError('Academic year');

    const brand = await this.pdf.brandFor(schoolId);
    const identity = identify(student);

    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        schoolId,
        studentId,
        occurredAt: { gte: year.startDate, lte: year.endDate },
      },
      orderBy: { occurredAt: 'asc' },
      include: {
        invoice: { select: { invoiceNumber: true } },
        payment: { select: { receiptNumber: true } },
      },
    });

    // Recompute the running balance rather than trusting balanceAfter, which
    // reflects the order rows were written, not the order they are displayed.
    let running = 0;
    const rows = entries.map((entry) => {
      running += Number(entry.debit) - Number(entry.credit);
      return {
        date: formatDateIn(entry.occurredAt, brand.timezone),
        particulars: entry.description,
        reference: entry.invoice?.invoiceNumber ?? entry.payment?.receiptNumber ?? '—',
        debit: Number(entry.debit),
        credit: Number(entry.credit),
        balance: running,
      };
    });

    const billed = rows.reduce((sum, row) => sum + row.debit, 0);
    const paid = rows.reduce((sum, row) => sum + row.credit, 0);

    const refunded = await this.prisma.refund.aggregate({
      where: { schoolId, payment: { studentId }, status: 'COMPLETED' },
      _sum: { amount: true },
    });

    const document: FeeStatementDocument = {
      academicYear: year.name,
      currency: brand.currency,
      generatedOn: formatDateIn(todayInZone(brand.timezone), brand.timezone),
      student: {
        name: identity.name,
        admissionNumber: identity.admissionNumber,
        className: identity.className,
        sectionName: identity.sectionName,
        guardianName: identity.guardianName,
      },
      entries: rows,
      billed,
      paid,
      refunded: Number(refunded._sum.amount ?? 0),
      outstanding: running,
    };

    return this.pdf.render(feeStatementTemplate(brand, document), schoolId, {
      folder: `schools/${schoolId}/statements`,
      fileName: `statement-${identity.admissionNumber.replace(/\//g, '-')}-${year.name}.pdf`,
      ephemeral: true,
    });
  }

  // -------------------------------------------------------------------------
  // Academic
  // -------------------------------------------------------------------------

  async reportCard(schoolId: string, reportCardId: string, force = false): Promise<RenderedPdf> {
    const card = await this.prisma.reportCard.findFirst({
      where: { id: reportCardId, schoolId },
      include: {
        academicYear: { select: { name: true } },
        student: { select: STUDENT_SELECT },
        class: { select: { name: true } },
        section: { select: { name: true } },
      },
    });
    if (!card) throw new NotFoundError('Report card');

    const fileName = `report-card-${card.student.admissionNumber.replace(/\//g, '-')}-${card.term.replace(/\s+/g, '-')}.pdf`;
    const cached = await this.reuse(card.pdfStorageKey, force, fileName);
    if (cached) return cached;

    const brand = await this.pdf.brandFor(schoolId);
    const identity = identify(card.student);

    // The snapshot is the marks as they stood at generation, which is what a
    // report card must show even if a later correction changes the mark rows.
    const snapshot = (card.snapshot ?? {}) as {
      subjects?: Array<{
        subject?: string;
        code?: string | null;
        maxMarks?: number;
        obtainedMarks?: number | null;
        grade?: string | null;
        remarks?: string | null;
        isAbsent?: boolean;
      }>;
    };

    const scale = await this.prisma.gradeScale.findFirst({
      where: { schoolId, isDefault: true },
      include: { bands: { orderBy: { sortOrder: 'asc' } } },
    });

    const document: ReportCardDocument = {
      term: card.term,
      academicYear: card.academicYear.name,
      generatedOn: formatDateIn(card.generatedAt, brand.timezone),
      student: {
        name: identity.name,
        admissionNumber: identity.admissionNumber,
        rollNumber: identity.rollNumber,
        className: card.class.name,
        sectionName: card.section.name,
        dateOfBirth: card.student.dateOfBirth
          ? formatDateIn(card.student.dateOfBirth, brand.timezone)
          : null,
        guardianName: identity.guardianName,
        photoDataUri: await this.pdf.toDataUri(card.student.photoUrl),
      },
      subjects: (snapshot.subjects ?? []).map((subject) => ({
        subject: subject.subject ?? '—',
        code: subject.code ?? null,
        maxMarks: subject.maxMarks ?? 0,
        obtainedMarks: subject.obtainedMarks ?? null,
        grade: subject.grade ?? null,
        remarks: subject.remarks ?? null,
        isAbsent: subject.isAbsent ?? false,
      })),
      totalMarks: card.totalMarks !== null ? Number(card.totalMarks) : null,
      obtainedMarks: card.obtainedMarks !== null ? Number(card.obtainedMarks) : null,
      percentage: card.percentage !== null ? Number(card.percentage) : null,
      grade: card.grade,
      gradePoint: card.gradePoint !== null ? Number(card.gradePoint) : null,
      rank: card.rank,
      rankOutOf: card.rankOutOf,
      result: card.result,
      attendedDays: card.attendedDays,
      totalDays: card.totalDays,
      attendancePercent:
        card.attendancePercent !== null ? Number(card.attendancePercent) : null,
      classTeacherRemarks: card.classTeacherRemarks,
      principalRemarks: card.principalRemarks,
      gradeScale: (scale?.bands ?? []).map((band) => ({
        grade: band.grade,
        from: Number(band.minValue),
        to: Number(band.maxValue),
        description: band.remark,
      })),
      isProvisional: card.publishedAt === null,
    };

    const rendered = await this.pdf.render(reportCardTemplate(brand, document), schoolId, {
      folder: `schools/${schoolId}/report-cards`,
      fileName,
    });

    await this.prisma.reportCard.update({
      where: { id: reportCardId },
      data: { pdfStorageKey: rendered.storageKey },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'pdf',
      entity: 'ReportCard',
      entityId: reportCardId,
      description: `Rendered the ${card.term} report card for ${identity.name}`,
      schoolId,
    });

    return rendered;
  }

  /** One printable sheet for a batch of student ID cards. */
  async studentIdCards(schoolId: string, cardIds: string[]): Promise<RenderedPdf> {
    const cards = await this.prisma.idCard.findMany({
      where: { id: { in: cardIds }, schoolId, studentId: { not: null } },
      include: { student: { select: STUDENT_SELECT } },
      orderBy: { cardNumber: 'asc' },
    });

    if (cards.length === 0) throw new NotFoundError('ID card');

    const brand = await this.pdf.brandFor(schoolId);

    const holders: IdCardHolder[] = await Promise.all(
      cards.map(async (card) => {
        const identity = identify(card.student!);
        return {
          name: identity.name,
          identifier: identity.admissionNumber,
          subtitle: `${identity.className} — ${identity.sectionName}`,
          qrPayload: card.qrPayload,
          photoDataUri: await this.pdf.toDataUri(card.student!.photoUrl),
          validTill: card.validTill ? formatDateIn(card.validTill, brand.timezone) : null,
          bloodGroup: card.student!.bloodGroup,
          guardianPhone: identity.guardianPhone,
          address: [card.student!.addressLine1, card.student!.city].filter(Boolean).join(', ') || null,
          rows: [
            ['Roll', identity.rollNumber ?? '—'],
            ['Card', card.cardNumber],
          ] as Array<[string, string]>,
        };
      }),
    );

    return this.pdf.render(idCardSheetTemplate(brand, holders, 'Student Identity Cards'), schoolId, {
      folder: `schools/${schoolId}/id-cards`,
      fileName: `id-cards-${Date.now()}.pdf`,
      ephemeral: true,
    });
  }

  /** One printable sheet for a batch of staff ID cards. */
  async staffIdCards(schoolId: string, cardIds: string[]): Promise<RenderedPdf> {
    const cards = await this.prisma.idCard.findMany({
      where: { id: { in: cardIds }, schoolId, staffId: { not: null } },
      include: {
        staff: {
          select: {
            employeeId: true,
            designation: true,
            bloodGroup: true,
            photoUrl: true,
            phone: true,
            department: { select: { name: true } },
            user: { select: { firstName: true, middleName: true, lastName: true } },
          },
        },
      },
      orderBy: { cardNumber: 'asc' },
    });

    if (cards.length === 0) throw new NotFoundError('ID card');

    const brand = await this.pdf.brandFor(schoolId);

    const holders: IdCardHolder[] = await Promise.all(
      cards.map(async (card) => {
        const staff = card.staff!;
        return {
          name: [staff.user?.firstName, staff.user?.middleName, staff.user?.lastName]
            .filter(Boolean)
            .join(' '),
          identifier: staff.employeeId,
          subtitle: [staff.designation, staff.department?.name].filter(Boolean).join(' — '),
          qrPayload: card.qrPayload,
          photoDataUri: await this.pdf.toDataUri(staff.photoUrl),
          validTill: card.validTill ? formatDateIn(card.validTill, brand.timezone) : null,
          bloodGroup: staff.bloodGroup,
          guardianPhone: staff.phone,
          address: null,
          rows: [['Card', card.cardNumber]] as Array<[string, string]>,
        };
      }),
    );

    return this.pdf.render(idCardSheetTemplate(brand, holders, 'Staff Identity Cards'), schoolId, {
      folder: `schools/${schoolId}/id-cards`,
      fileName: `staff-id-cards-${Date.now()}.pdf`,
      ephemeral: true,
    });
  }

  async certificate(schoolId: string, certificateId: string, force = false): Promise<RenderedPdf> {
    const certificate = await this.prisma.certificate.findFirst({
      where: { id: certificateId, schoolId },
      include: {
        template: { select: { name: true, bodyTemplate: true } },
        student: { select: STUDENT_SELECT },
      },
    });
    if (!certificate) throw new NotFoundError('Certificate');

    const fileName = `${certificate.certificateNumber.replace(/\//g, '-')}.pdf`;
    const cached = await this.reuse(certificate.pdfStorageKey, force, fileName);
    if (cached) return cached;

    const brand = await this.pdf.brandFor(schoolId);
    const data = (certificate.data ?? {}) as Record<string, string>;

    const document: CertificateDocument = {
      type: certificate.type,
      title: certificate.template?.name ?? CERTIFICATE_TITLES[certificate.type],
      certificateNumber: certificate.certificateNumber,
      issuedOn: formatDateIn(certificate.issuedOn, brand.timezone),
      body: this.certificateBody(certificate.template?.bodyTemplate ?? null, data),
      details: Object.entries(data)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, value]) => [humanise(key), String(value)] as [string, string]),
      signatories: ['Class Teacher', 'Principal'],
    };

    const rendered = await this.pdf.render(certificateTemplate(brand, document), schoolId, {
      folder: `schools/${schoolId}/certificates`,
      fileName,
    });

    await this.prisma.certificate.update({
      where: { id: certificateId },
      data: { pdfStorageKey: rendered.storageKey },
    });

    return rendered;
  }

  // -------------------------------------------------------------------------
  // Ownership checks used by the controller before it streams a document
  // -------------------------------------------------------------------------

  /**
   * Resolves which student a document belongs to.
   *
   * The controller needs this before it will stream a personal document to a
   * parent or a student, and it must not leak whether a document in another
   * school exists — so a miss is a plain not-found.
   */
  async ownerOf(
    kind: 'invoice' | 'payment' | 'reportCard',
    schoolId: string,
    id: string,
  ): Promise<string> {
    const row =
      kind === 'invoice'
        ? await this.prisma.invoice.findFirst({
            where: { id, schoolId },
            select: { studentId: true },
          })
        : kind === 'payment'
          ? await this.prisma.payment.findFirst({
              where: { id, schoolId },
              select: { studentId: true },
            })
          : await this.prisma.reportCard.findFirst({
              where: { id, schoolId },
              select: { studentId: true },
            });

    if (!row) throw new NotFoundError('Document');
    return row.studentId;
  }

  /** Keeps a draft report card out of a parent's hands until it is published. */
  async assertReportCardPublished(schoolId: string, reportCardId: string): Promise<void> {
    const card = await this.prisma.reportCard.findFirst({
      where: { id: reportCardId, schoolId },
      select: { publishedAt: true },
    });
    if (!card) throw new NotFoundError('Report card');

    if (!card.publishedAt) {
      throw new ForbiddenError('This report card has not been published yet');
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Splits a template body into paragraphs, filling `{{placeholders}}` from the
   * certificate's retained data so a reprint reads exactly as the original.
   */
  private certificateBody(body: string | null, data: Record<string, string>): string[] {
    if (!body) {
      return [
        'This is to certify that the particulars recorded below are true to the best of our ' +
          'knowledge and are extracted from the records maintained by this institution.',
      ];
    }

    const filled = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) =>
      data[key] !== undefined ? String(data[key]) : match,
    );

    return filled
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  /**
   * Returns an already-stored PDF instead of re-rendering it.
   *
   * A missing object is not an error — storage may have been cleared — so the
   * caller simply renders again.
   */
  private async reuse(
    storageKey: string | null,
    force: boolean,
    fileName: string,
  ): Promise<RenderedPdf | null> {
    if (force || !storageKey) return null;

    const buffer = await this.pdf.fetchStored(storageKey);
    if (!buffer) return null;

    return { buffer, fileName, storageKey, sizeBytes: buffer.length };
  }
}

const CERTIFICATE_TITLES: Record<CertificateType, string> = {
  BONAFIDE: 'Bonafide Certificate',
  TRANSFER: 'Transfer Certificate',
  CHARACTER: 'Character Certificate',
  PARTICIPATION: 'Certificate of Participation',
  ACHIEVEMENT: 'Certificate of Achievement',
  CUSTOM: 'Certificate',
};

function humanise(key: string): string {
  return key
    .replace(/[_.]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}
