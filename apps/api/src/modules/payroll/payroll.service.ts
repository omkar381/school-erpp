import { Injectable } from '@nestjs/common';
import { AuditAction, EmploymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { parseDateOnly, todayInZone } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import {
  PayrollAuditEntity,
  computeBreakdown,
  parseComponents,
  round2,
  type SalaryComponent,
} from './payroll.types';
import type {
  CreateSalaryStructureDto,
  PayrollRegisterQueryDto,
  PreviewSalaryDto,
  SalaryStructureQueryDto,
  UpdateSalaryStructureDto,
} from './dto/payroll.dto';

const STRUCTURE_SORT_FIELDS = ['effectiveFrom', 'basicSalary', 'grossSalary', 'netSalary'] as const;

const STAFF_SELECT = {
  id: true,
  employeeId: true,
  firstName: true,
  middleName: true,
  lastName: true,
  photoUrl: true,
  employmentStatus: true,
  employmentType: true,
  joiningDate: true,
  bankName: true,
  bankAccountNumber: true,
  bankIfsc: true,
  panNumber: true,
  department: { select: { id: true, name: true, code: true } },
  designation: { select: { id: true, name: true } },
} satisfies Prisma.StaffSelect;

type StructureWithStaff = Prisma.SalaryStructureGetPayload<{
  include: { staff: { select: typeof STAFF_SELECT } };
}>;

/** Employment states in which somebody is still owed a salary. */
const PAYABLE_STATUSES: EmploymentStatus[] = [
  EmploymentStatus.ACTIVE,
  EmploymentStatus.PROBATION,
  EmploymentStatus.NOTICE_PERIOD,
  EmploymentStatus.ON_LEAVE,
];

function dayBefore(date: Date): Date {
  return new Date(date.getTime() - 86_400_000);
}

/**
 * Salary structures, and what they add up to.
 *
 * A structure is effective-dated rather than edited in place: a raise creates a
 * new row starting on its own date and closes the previous one the day before,
 * so last year's payroll still reports what was actually paid last year. The
 * arithmetic lives in `payroll.types` and is applied on write and on read
 * alike, which is why a stored `netSalary` can never drift from a displayed one.
 */
@Injectable()
export class PayrollService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('PayrollService');
  }

  // -------------------------------------------------------------------------
  // Shaping
  // -------------------------------------------------------------------------

  /** Expands a stored row into the figures a payslip or a form needs. */
  private shape(structure: StructureWithStaff) {
    const components = parseComponents(structure.components);
    const breakdown = computeBreakdown(Number(structure.basicSalary), components);
    const today = todayInZone();

    return {
      id: structure.id,
      staffId: structure.staffId,
      staff: structure.staff
        ? {
            ...structure.staff,
            fullName: [
              structure.staff.firstName,
              structure.staff.middleName,
              structure.staff.lastName,
            ]
              .filter(Boolean)
              .join(' '),
          }
        : null,
      effectiveFrom: structure.effectiveFrom,
      effectiveTo: structure.effectiveTo,
      isCurrent:
        structure.effectiveFrom <= today &&
        (structure.effectiveTo === null || structure.effectiveTo >= today),
      basicSalary: Number(structure.basicSalary),
      grossSalary: Number(structure.grossSalary),
      netSalary: Number(structure.netSalary),
      currency: structure.currency,
      notes: structure.notes,
      components,
      breakdown,
      createdAt: structure.createdAt,
      updatedAt: structure.updatedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async statistics(schoolId: string) {
    const today = todayInZone();

    const [payableStaff, current, byDepartment] = await Promise.all([
      this.prisma.staff.count({
        where: { schoolId, deletedAt: null, employmentStatus: { in: PAYABLE_STATUSES } },
      }),
      this.prisma.salaryStructure.findMany({
        where: {
          schoolId,
          effectiveFrom: { lte: today },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          staff: { deletedAt: null, employmentStatus: { in: PAYABLE_STATUSES } },
        },
        select: { staffId: true, basicSalary: true, grossSalary: true, netSalary: true },
      }),
      this.prisma.staff.groupBy({
        by: ['departmentId'],
        where: { schoolId, deletedAt: null, employmentStatus: { in: PAYABLE_STATUSES } },
        _count: { _all: true },
      }),
    ]);

    const onPayroll = new Set(current.map((row) => row.staffId)).size;
    const monthlyGross = round2(current.reduce((sum, row) => sum + Number(row.grossSalary), 0));
    const monthlyNet = round2(current.reduce((sum, row) => sum + Number(row.netSalary), 0));

    const departments = await this.prisma.department.findMany({
      where: { schoolId },
      select: { id: true, name: true },
    });
    const departmentNames = new Map(departments.map((d) => [d.id, d.name]));

    return {
      payableStaff,
      onPayroll,
      // The number a finance lead chases: people who should be paid but have no
      // salary structure on file, so payroll would silently skip them.
      awaitingStructure: payableStaff - onPayroll,
      monthlyGross,
      monthlyNet,
      monthlyDeductions: round2(monthlyGross - monthlyNet),
      annualGross: round2(monthlyGross * 12),
      averageGross: onPayroll > 0 ? round2(monthlyGross / onPayroll) : 0,
      byDepartment: byDepartment
        .map((row) => ({
          departmentId: row.departmentId,
          name: row.departmentId
            ? (departmentNames.get(row.departmentId) ?? 'Unknown')
            : 'Unassigned',
          staffCount: row._count._all,
        }))
        .sort((a, b) => b.staffCount - a.staffCount),
    };
  }

  async list(schoolId: string, query: SalaryStructureQueryDto) {
    const today = todayInZone();

    const where: Prisma.SalaryStructureWhereInput = {
      schoolId,
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.currentOnly !== false
        ? {
            effectiveFrom: { lte: today },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          }
        : {}),
      staff: {
        deletedAt: null,
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.employmentStatus ? { employmentStatus: query.employmentStatus } : {}),
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { employeeId: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };

    const [rows, total] = await Promise.all([
      this.prisma.salaryStructure.findMany({
        where,
        include: { staff: { select: STAFF_SELECT } },
        orderBy: query.buildOrderBy(STRUCTURE_SORT_FIELDS, 'effectiveFrom'),
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.salaryStructure.count({ where }),
    ]);

    return buildPaginatedResult(
      rows.map((row) => this.shape(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const structure = await this.prisma.salaryStructure.findFirst({
      where: { id, schoolId },
      include: { staff: { select: STAFF_SELECT } },
    });
    if (!structure) throw new NotFoundError('Salary structure');

    return this.shape(structure);
  }

  /** Every structure a staff member has ever been on, newest first. */
  async historyFor(schoolId: string, staffId: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, schoolId, deletedAt: null },
      select: STAFF_SELECT,
    });
    if (!staff) throw new NotFoundError('Staff member');

    const structures = await this.prisma.salaryStructure.findMany({
      where: { schoolId, staffId },
      include: { staff: { select: STAFF_SELECT } },
      orderBy: { effectiveFrom: 'desc' },
    });

    const shaped = structures.map((row) => this.shape(row));

    return {
      staff: {
        ...staff,
        fullName: [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(' '),
      },
      current: shaped.find((row) => row.isCurrent) ?? null,
      history: shaped,
    };
  }

  /**
   * Who gets paid what for a given month.
   *
   * A structure counts for the month if it was in force on the last day of it,
   * which is the convention a monthly salary run follows. Staff with no
   * structure are listed too, with a null structure — leaving them out would
   * hide exactly the people payroll needs to notice.
   */
  async register(schoolId: string, query: PayrollRegisterQueryDto) {
    const today = todayInZone();
    const month = query.month ?? today.getUTCMonth() + 1;
    const year = query.year ?? today.getUTCFullYear();

    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 0));

    const staff = await this.prisma.staff.findMany({
      where: {
        schoolId,
        deletedAt: null,
        employmentStatus: { in: PAYABLE_STATUSES },
        joiningDate: { lte: periodEnd },
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      },
      select: STAFF_SELECT,
      orderBy: { employeeId: 'asc' },
    });

    const structures = await this.prisma.salaryStructure.findMany({
      where: {
        schoolId,
        staffId: { in: staff.map((row) => row.id) },
        effectiveFrom: { lte: periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodEnd } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    // Newest-first ordering means the first structure seen for a staff member is
    // the one in force at period end.
    const effective = new Map<string, (typeof structures)[number]>();
    for (const structure of structures) {
      if (!effective.has(structure.staffId)) effective.set(structure.staffId, structure);
    }

    const rows = staff.map((member) => {
      const structure = effective.get(member.id);
      const breakdown = structure
        ? computeBreakdown(Number(structure.basicSalary), parseComponents(structure.components))
        : null;

      return {
        staff: {
          ...member,
          fullName: [member.firstName, member.middleName, member.lastName]
            .filter(Boolean)
            .join(' '),
        },
        structureId: structure?.id ?? null,
        effectiveFrom: structure?.effectiveFrom ?? null,
        basicSalary: breakdown?.basic ?? null,
        grossSalary: breakdown?.gross ?? null,
        netSalary: breakdown?.net ?? null,
        totalDeductions: breakdown?.totalDeductions ?? null,
        breakdown,
      };
    });

    const paid = rows.filter((row) => row.breakdown !== null);

    return {
      period: {
        month,
        year,
        label: periodStart.toLocaleString('en-IN', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        from: periodStart,
        to: periodEnd,
      },
      totals: {
        staffCount: rows.length,
        payableCount: paid.length,
        missingStructureCount: rows.length - paid.length,
        gross: round2(paid.reduce((sum, row) => sum + (row.grossSalary ?? 0), 0)),
        deductions: round2(paid.reduce((sum, row) => sum + (row.totalDeductions ?? 0), 0)),
        net: round2(paid.reduce((sum, row) => sum + (row.netSalary ?? 0), 0)),
      },
      rows,
    };
  }

  /** What a basic and a set of components would pay, without storing anything. */
  preview(dto: PreviewSalaryDto) {
    return computeBreakdown(dto.basicSalary, (dto.components ?? []) as SalaryComponent[]);
  }

  /** Payable staff who have no salary structure in force today. */
  async unassignedStaff(schoolId: string) {
    const today = todayInZone();

    const staff = await this.prisma.staff.findMany({
      where: {
        schoolId,
        deletedAt: null,
        employmentStatus: { in: PAYABLE_STATUSES },
        salaryStructures: {
          none: {
            effectiveFrom: { lte: today },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          },
        },
      },
      select: STAFF_SELECT,
      orderBy: { employeeId: 'asc' },
    });

    return staff.map((member) => ({
      ...member,
      fullName: [member.firstName, member.middleName, member.lastName].filter(Boolean).join(' '),
    }));
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  async create(schoolId: string, dto: CreateSalaryStructureDto) {
    const staff = await this.prisma.staff.findFirst({
      where: { id: dto.staffId, schoolId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, employeeId: true, joiningDate: true },
    });
    if (!staff) throw new NotFoundError('Staff member');

    const effectiveFrom = parseDateOnly(dto.effectiveFrom);

    if (effectiveFrom < staff.joiningDate) {
      throw new BadRequestError(
        'A salary structure cannot start before the employee joined',
      );
    }

    const latest = await this.prisma.salaryStructure.findFirst({
      where: { schoolId, staffId: dto.staffId },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (latest) {
      if (latest.effectiveFrom.getTime() === effectiveFrom.getTime()) {
        throw new ConflictError(
          'This employee already has a salary structure starting on that date. Edit that one instead.',
        );
      }
      // Inserting behind the newest revision would leave two structures claiming
      // the same stretch of time, and payroll would have to guess.
      if (latest.effectiveFrom > effectiveFrom) {
        throw new ConflictError(
          `A later structure already starts on ${latest.effectiveFrom.toISOString().slice(0, 10)}. ` +
            'A revision must start after the most recent one.',
        );
      }
    }

    const components = (dto.components ?? []) as SalaryComponent[];
    const breakdown = computeBreakdown(dto.basicSalary, components);

    const created = await this.prisma.transaction(async (tx) => {
      // Close the structure this one supersedes, so the timeline stays a
      // timeline rather than a set of overlapping claims.
      if (latest && latest.effectiveTo === null) {
        await tx.salaryStructure.update({
          where: { id: latest.id },
          data: { effectiveTo: dayBefore(effectiveFrom) },
        });
      }

      return tx.salaryStructure.create({
        data: {
          schoolId,
          staffId: dto.staffId,
          effectiveFrom,
          effectiveTo: null,
          basicSalary: new Prisma.Decimal(breakdown.basic),
          components: components as unknown as Prisma.InputJsonValue,
          grossSalary: new Prisma.Decimal(breakdown.gross),
          netSalary: new Prisma.Decimal(breakdown.net),
          currency: dto.currency ?? 'INR',
          notes: dto.notes ?? null,
        },
        include: { staff: { select: STAFF_SELECT } },
      });
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'payroll',
      entity: PayrollAuditEntity,
      entityId: created.id,
      description:
        `Set salary for ${[staff.firstName, staff.lastName].filter(Boolean).join(' ')} ` +
        `(${staff.employeeId}) — net ${breakdown.net} effective ${dto.effectiveFrom}`,
      newValue: {
        basicSalary: breakdown.basic,
        grossSalary: breakdown.gross,
        netSalary: breakdown.net,
        effectiveFrom: dto.effectiveFrom,
      },
      schoolId,
    });

    this.log.info('Salary structure created', {
      schoolId,
      staffId: dto.staffId,
      structureId: created.id,
      net: breakdown.net,
    });

    return this.shape(created);
  }

  async update(schoolId: string, id: string, dto: UpdateSalaryStructureDto) {
    const existing = await this.prisma.salaryStructure.findFirst({
      where: { id, schoolId },
    });
    if (!existing) throw new NotFoundError('Salary structure');

    const basicSalary = dto.basicSalary ?? Number(existing.basicSalary);
    const components = (dto.components ?? parseComponents(existing.components)) as SalaryComponent[];
    const breakdown = computeBreakdown(basicSalary, components);

    const updated = await this.prisma.salaryStructure.update({
      where: { id },
      data: {
        basicSalary: new Prisma.Decimal(breakdown.basic),
        components: components as unknown as Prisma.InputJsonValue,
        grossSalary: new Prisma.Decimal(breakdown.gross),
        netSalary: new Prisma.Decimal(breakdown.net),
        notes: dto.notes ?? undefined,
      },
      include: { staff: { select: STAFF_SELECT } },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'payroll',
      entity: PayrollAuditEntity,
      entityId: id,
      description: `Revised salary structure — net ${breakdown.net}`,
      oldValue: {
        basicSalary: Number(existing.basicSalary),
        grossSalary: Number(existing.grossSalary),
        netSalary: Number(existing.netSalary),
      },
      newValue: {
        basicSalary: breakdown.basic,
        grossSalary: breakdown.gross,
        netSalary: breakdown.net,
      },
      schoolId,
    });

    return this.shape(updated);
  }

  /**
   * Removes a structure and hands its stretch of time back.
   *
   * Deleting the current structure reopens the one it superseded, so the
   * employee falls back to their previous salary rather than off payroll.
   */
  async remove(schoolId: string, id: string) {
    const existing = await this.prisma.salaryStructure.findFirst({
      where: { id, schoolId },
      include: { staff: { select: { employeeId: true, firstName: true, lastName: true } } },
    });
    if (!existing) throw new NotFoundError('Salary structure');

    await this.prisma.transaction(async (tx) => {
      await tx.salaryStructure.delete({ where: { id } });

      const previous = await tx.salaryStructure.findFirst({
        where: {
          schoolId,
          staffId: existing.staffId,
          effectiveFrom: { lt: existing.effectiveFrom },
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (previous) {
        await tx.salaryStructure.update({
          where: { id: previous.id },
          data: { effectiveTo: existing.effectiveTo },
        });
      }
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'payroll',
      entity: PayrollAuditEntity,
      entityId: id,
      description:
        `Removed salary structure for ${existing.staff.employeeId} ` +
        `effective ${existing.effectiveFrom.toISOString().slice(0, 10)}`,
      oldValue: {
        basicSalary: Number(existing.basicSalary),
        netSalary: Number(existing.netSalary),
      },
      schoolId,
    });

    return { id, deleted: true };
  }
}
