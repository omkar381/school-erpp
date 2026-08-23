import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { buildPaginatedResult } from '../../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../common/exceptions/app.exception';
import { parseDateOnly } from '../../../common/utils/date.util';
import { AuditService } from '../../audit/audit.service';
import { AcademicYearService } from '../../academics/services/academic-year.service';
import type {
  CreateDiscountDto,
  CreateFeeHeadDto,
  CreateFeeStructureDto,
  GrantDiscountDto,
  UpdateFeeStructureDto,
} from '../dto/fees.dto';

@Injectable()
export class FeeStructuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicYears: AcademicYearService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Fee heads
  // -------------------------------------------------------------------------

  async listHeads(schoolId: string, includeInactive = false) {
    return this.prisma.feeHead.findMany({
      where: { schoolId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true, invoiceItems: true } } },
    });
  }

  async createHead(schoolId: string, dto: CreateFeeHeadDto) {
    const duplicate = await this.prisma.feeHead.count({ where: { schoolId, code: dto.code } });
    if (duplicate > 0) {
      throw new ConflictError(`A fee head with the code "${dto.code}" already exists`);
    }

    const head = await this.prisma.feeHead.create({
      data: {
        schoolId,
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        category: dto.category ?? 'OTHER',
        frequency: dto.frequency ?? 'ONE_TIME',
        isRefundable: dto.isRefundable ?? false,
        isOptional: dto.isOptional ?? false,
        linkedModule: dto.linkedModule ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'fees',
      entity: 'FeeHead',
      entityId: head.id,
      description: `Created fee head "${head.name}"`,
      schoolId,
    });

    return head;
  }

  async updateHead(schoolId: string, id: string, dto: Partial<CreateFeeHeadDto> & { isActive?: boolean }) {
    const existing = await this.prisma.feeHead.findFirst({ where: { id, schoolId } });
    if (!existing) throw new NotFoundError('Fee head');

    return this.prisma.feeHead.update({ where: { id }, data: { ...dto } });
  }

  async removeHead(schoolId: string, id: string) {
    const head = await this.prisma.feeHead.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { invoiceItems: true, items: true } } },
    });
    if (!head) throw new NotFoundError('Fee head');

    // A head that has been billed is part of financial history.
    if (head._count.invoiceItems > 0) {
      throw new ConflictError(
        `"${head.name}" appears on ${head._count.invoiceItems} invoice line(s) and cannot be deleted. Deactivate it instead.`,
      );
    }

    await this.prisma.feeHead.delete({ where: { id } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Fee structures
  // -------------------------------------------------------------------------

  async findAll(
    schoolId: string,
    query: { page: number; limit: number; skip: number; take: number; academicYearId?: string; classId?: string },
  ) {
    const academicYearId = await this.academicYears.resolveId(schoolId, query.academicYearId);

    const where: Prisma.FeeStructureWhereInput = {
      schoolId,
      academicYearId,
      ...(query.classId ? { classId: query.classId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.feeStructure.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { class: { level: 'asc' } },
        include: {
          class: { select: { id: true, name: true, level: true } },
          items: { include: { feeHead: { select: { id: true, name: true, code: true, category: true } } } },
          installments: { orderBy: { sequence: 'asc' } },
          _count: { select: { invoices: true } },
        },
      }),
      this.prisma.feeStructure.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  async findOne(schoolId: string, id: string) {
    const structure = await this.prisma.feeStructure.findFirst({
      where: { id, schoolId },
      include: {
        class: { select: { id: true, name: true, level: true } },
        academicYear: { select: { id: true, name: true } },
        items: {
          include: { feeHead: { select: { id: true, name: true, code: true, category: true } } },
        },
        installments: { orderBy: { sequence: 'asc' } },
        _count: { select: { invoices: true } },
      },
    });

    if (!structure) throw new NotFoundError('Fee structure');
    return structure;
  }

  async create(schoolId: string, dto: CreateFeeStructureDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const duplicate = await this.prisma.feeStructure.count({
      where: { schoolId, academicYearId, name: dto.name },
    });
    if (duplicate > 0) {
      throw new ConflictError(`A fee structure named "${dto.name}" already exists this year`);
    }

    const headIds = dto.items.map((item) => item.feeHeadId);
    const heads = await this.prisma.feeHead.findMany({
      where: { id: { in: headIds }, schoolId },
      select: { id: true },
    });
    if (heads.length !== new Set(headIds).size) {
      throw new BadRequestError('One or more fee heads do not exist in this school');
    }

    this.assertInstallmentsValid(dto.installments ?? []);

    const total = dto.items.reduce((sum, item) => sum + item.amount, 0);

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { currency: true },
    });

    const structure = await this.prisma.feeStructure.create({
      data: {
        schoolId,
        academicYearId,
        classId: dto.classId ?? null,
        name: dto.name,
        description: dto.description ?? null,
        totalAmount: total,
        currency: school.currency,
        items: {
          create: dto.items.map((item) => ({
            feeHeadId: item.feeHeadId,
            amount: item.amount,
            isOptional: item.isOptional ?? false,
            dueDate: item.dueDate ? parseDateOnly(item.dueDate) : null,
          })),
        },
        ...(dto.installments?.length
          ? {
              installments: {
                create: dto.installments.map((installment) => ({
                  name: installment.name,
                  sequence: installment.sequence,
                  percentage: installment.percentage ?? null,
                  amount: installment.amount ?? null,
                  dueDate: parseDateOnly(installment.dueDate),
                  lateFeeAfterDays: installment.lateFeeAfterDays ?? 0,
                  lateFeeAmount: installment.lateFeeAmount ?? 0,
                  lateFeePerDay: installment.lateFeePerDay ?? 0,
                })),
              },
            }
          : {}),
      },
      include: { items: true, installments: true },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'fees',
      entity: 'FeeStructure',
      entityId: structure.id,
      description: `Created fee structure "${structure.name}" totalling ${total}`,
      newValue: { total, items: dto.items.length },
      schoolId,
    });

    return structure;
  }

  async update(schoolId: string, id: string, dto: UpdateFeeStructureDto) {
    const existing = await this.prisma.feeStructure.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { invoices: true } } },
    });
    if (!existing) throw new NotFoundError('Fee structure');

    // Changing amounts after invoicing would silently disagree with issued bills.
    if (dto.items && existing._count.invoices > 0) {
      throw new ConflictError(
        `${existing._count.invoices} invoice(s) have already been raised from this structure. ` +
          'Create a new structure instead of changing this one.',
      );
    }

    if (dto.installments) this.assertInstallmentsValid(dto.installments);

    const updated = await this.prisma.transaction(async (tx) => {
      if (dto.items) {
        await tx.feeStructureItem.deleteMany({ where: { feeStructureId: id } });
        await tx.feeStructureItem.createMany({
          data: dto.items.map((item) => ({
            feeStructureId: id,
            feeHeadId: item.feeHeadId,
            amount: item.amount,
            isOptional: item.isOptional ?? false,
            dueDate: item.dueDate ? parseDateOnly(item.dueDate) : null,
          })),
        });
      }

      if (dto.installments) {
        await tx.feeInstallment.deleteMany({ where: { feeStructureId: id } });
        await tx.feeInstallment.createMany({
          data: dto.installments.map((installment) => ({
            feeStructureId: id,
            name: installment.name,
            sequence: installment.sequence,
            percentage: installment.percentage ?? null,
            amount: installment.amount ?? null,
            dueDate: parseDateOnly(installment.dueDate),
            lateFeeAfterDays: installment.lateFeeAfterDays ?? 0,
            lateFeeAmount: installment.lateFeeAmount ?? 0,
            lateFeePerDay: installment.lateFeePerDay ?? 0,
          })),
        });
      }

      return tx.feeStructure.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          description: dto.description ?? undefined,
          isActive: dto.isActive ?? undefined,
          ...(dto.items
            ? { totalAmount: dto.items.reduce((sum, item) => sum + item.amount, 0) }
            : {}),
        },
        include: { items: true, installments: true },
      });
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'fees',
      entity: 'FeeStructure',
      entityId: id,
      description: `Updated fee structure "${updated.name}"`,
      schoolId,
    });

    return updated;
  }

  async remove(schoolId: string, id: string) {
    const structure = await this.prisma.feeStructure.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { invoices: true } } },
    });
    if (!structure) throw new NotFoundError('Fee structure');

    if (structure._count.invoices > 0) {
      throw new ConflictError(
        `${structure._count.invoices} invoice(s) reference this structure. Deactivate it instead.`,
      );
    }

    await this.prisma.feeStructure.delete({ where: { id } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Discounts and scholarships
  // -------------------------------------------------------------------------

  async listDiscounts(schoolId: string) {
    return this.prisma.discount.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { students: true } } },
    });
  }

  async createDiscount(schoolId: string, dto: CreateDiscountDto) {
    const duplicate = await this.prisma.discount.count({ where: { schoolId, code: dto.code } });
    if (duplicate > 0) {
      throw new ConflictError(`A discount with the code "${dto.code}" already exists`);
    }

    if (dto.type === 'PERCENTAGE' && dto.value > 100) {
      throw new BadRequestError('A percentage discount cannot exceed 100%');
    }

    const discount = await this.prisma.discount.create({
      data: {
        schoolId,
        name: dto.name,
        code: dto.code,
        kind: dto.kind ?? 'DISCOUNT',
        type: dto.type,
        value: dto.value,
        maxAmount: dto.maxAmount ?? null,
        feeHeadIds: dto.feeHeadIds ?? [],
        description: dto.description ?? null,
        validFrom: dto.validFrom ? parseDateOnly(dto.validFrom) : null,
        validTo: dto.validTo ? parseDateOnly(dto.validTo) : null,
        requiresApproval: dto.requiresApproval ?? true,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'fees',
      entity: 'Discount',
      entityId: discount.id,
      description: `Created ${dto.kind ?? 'discount'} "${discount.name}"`,
      schoolId,
    });

    return discount;
  }

  /** Awards a discount to a student. Approval is recorded on the grant itself. */
  async grantDiscount(
    schoolId: string,
    dto: GrantDiscountDto,
    approvedById: string,
    canApprove: boolean,
  ) {
    const [student, discount] = await this.prisma.$transaction([
      this.prisma.student.findFirst({
        where: { id: dto.studentId, schoolId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, admissionNumber: true },
      }),
      this.prisma.discount.findFirst({
        where: { id: dto.discountId, schoolId, isActive: true },
        select: { id: true, name: true, requiresApproval: true, type: true, value: true },
      }),
    ]);

    if (!student) throw new NotFoundError('Student');
    if (!discount) throw new NotFoundError('Discount');

    if (discount.requiresApproval && !canApprove) {
      throw new BadRequestError(
        `"${discount.name}" requires approval. Ask an authorised user to grant it.`,
      );
    }

    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const grant = await this.prisma.studentDiscount.upsert({
      where: {
        studentId_discountId_academicYearId: {
          studentId: dto.studentId,
          discountId: dto.discountId,
          academicYearId,
        },
      },
      create: {
        studentId: dto.studentId,
        discountId: dto.discountId,
        academicYearId,
        overrideValue: dto.overrideValue ?? null,
        reason: dto.reason ?? null,
        approvedById,
        approvedAt: new Date(),
        validFrom: dto.validFrom ? parseDateOnly(dto.validFrom) : null,
        validTo: dto.validTo ? parseDateOnly(dto.validTo) : null,
        isActive: true,
      },
      update: {
        overrideValue: dto.overrideValue ?? null,
        reason: dto.reason ?? null,
        approvedById,
        approvedAt: new Date(),
        isActive: true,
      },
    });

    this.audit.record({
      action: AuditAction.APPROVE,
      module: 'fees',
      entity: 'StudentDiscount',
      entityId: grant.id,
      description:
        `Granted "${discount.name}" to ${student.admissionNumber} ` +
        `(${[student.firstName, student.lastName].filter(Boolean).join(' ')})`,
      newValue: { discountId: dto.discountId, overrideValue: dto.overrideValue },
      schoolId,
    });

    return grant;
  }

  async revokeDiscount(schoolId: string, grantId: string, reason?: string) {
    const grant = await this.prisma.studentDiscount.findFirst({
      where: { id: grantId, student: { schoolId } },
      select: { id: true, discount: { select: { name: true } } },
    });
    if (!grant) throw new NotFoundError('Discount grant');

    await this.prisma.studentDiscount.update({
      where: { id: grantId },
      data: { isActive: false, reason: reason ?? undefined },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'fees',
      entity: 'StudentDiscount',
      entityId: grantId,
      description: `Revoked "${grant.discount.name}"${reason ? `: ${reason}` : ''}`,
      schoolId,
    });

    return { revoked: true };
  }

  /**
   * The discounts that apply to a student right now, resolved against the
   * validity window. Used by the invoice generator.
   */
  async activeDiscountsFor(studentId: string, academicYearId: string, on: Date = new Date()) {
    const grants = await this.prisma.studentDiscount.findMany({
      where: {
        studentId,
        isActive: true,
        approvedAt: { not: null },
        OR: [{ academicYearId }, { academicYearId: null }],
      },
      include: {
        discount: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
            value: true,
            maxAmount: true,
            feeHeadIds: true,
            isActive: true,
            validFrom: true,
            validTo: true,
          },
        },
      },
    });

    return grants.filter((grant) => {
      if (!grant.discount.isActive) return false;

      const from = grant.validFrom ?? grant.discount.validFrom;
      const to = grant.validTo ?? grant.discount.validTo;

      if (from && on < from) return false;
      if (to && on > to) return false;
      return true;
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Installments must be sequential and, when expressed as percentages, add up
   * to exactly 100 — otherwise a student would be under- or over-billed.
   */
  private assertInstallmentsValid(
    installments: Array<{ sequence: number; percentage?: number; amount?: number; name: string }>,
  ): void {
    if (installments.length === 0) return;

    const sequences = installments.map((entry) => entry.sequence).sort((a, b) => a - b);
    const expected = Array.from({ length: sequences.length }, (_, index) => index + 1);

    if (sequences.join(',') !== expected.join(',')) {
      throw new BadRequestError(
        `Installment sequences must run 1 to ${sequences.length} without gaps`,
      );
    }

    const usingPercentages = installments.every((entry) => entry.percentage !== undefined);
    const usingAmounts = installments.every((entry) => entry.amount !== undefined);

    if (!usingPercentages && !usingAmounts) {
      throw new BadRequestError(
        'Every installment must specify a percentage, or every installment must specify an amount',
      );
    }

    if (usingPercentages) {
      const total = installments.reduce((sum, entry) => sum + (entry.percentage ?? 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        throw new BadRequestError(
          `Installment percentages must total 100%, but they total ${total}%`,
        );
      }
    }
  }
}
