import { Injectable } from '@nestjs/common';
import { AuditAction, EnrollmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { buildPaginatedResult } from '../../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../common/exceptions/app.exception';
import { AuditService } from '../../audit/audit.service';
import { AcademicYearService } from './academic-year.service';
import type {
  AssignSubjectsToClassDto,
  ClassQueryDto,
  CreateClassDto,
  CreateSectionDto,
  UpdateClassDto,
  UpdateSectionDto,
} from '../dto/academics.dto';

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicYears: AcademicYearService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: ClassQueryDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, query.academicYearId);

    const where: Prisma.ClassWhereInput = {
      schoolId,
      academicYearId,
      ...(query.stream ? { stream: { equals: query.stream, mode: 'insensitive' } } : {}),
      ...(query.medium ? { medium: { equals: query.medium, mode: 'insensitive' } } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.class.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ level: 'asc' }, { name: 'asc' }],
        include: {
          sections: {
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              capacity: true,
              classTeacher: {
                select: { id: true, firstName: true, lastName: true, photoUrl: true },
              },
              room: { select: { id: true, name: true } },
              _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
            },
          },
          _count: { select: { classSubjects: true } },
        },
      }),
      this.prisma.class.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ sections, _count, ...cls }) => ({
        ...cls,
        subjectCount: _count.classSubjects,
        studentCount: sections.reduce((sum, section) => sum + section._count.enrollments, 0),
        sections: sections.map(({ _count: sectionCount, ...section }) => ({
          ...section,
          studentCount: sectionCount.enrollments,
        })),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id, schoolId },
      include: {
        academicYear: { select: { id: true, name: true, isCurrent: true } },
        sections: {
          orderBy: { name: 'asc' },
          include: {
            classTeacher: {
              select: { id: true, firstName: true, lastName: true, photoUrl: true, employeeId: true },
            },
            room: { select: { id: true, name: true, code: true } },
            _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
          },
        },
        classSubjects: {
          include: {
            subject: {
              select: { id: true, name: true, code: true, category: true, colorHex: true },
            },
          },
        },
      },
    });

    if (!cls) throw new NotFoundError('Class');

    const { sections, classSubjects, ...rest } = cls;
    return {
      ...rest,
      sections: sections.map(({ _count, ...section }) => ({
        ...section,
        studentCount: _count.enrollments,
        availableSeats: Math.max(0, section.capacity - _count.enrollments),
      })),
      subjects: classSubjects.map(({ subject, ...entry }) => ({ ...subject, ...entry })),
    };
  }

  async create(schoolId: string, dto: CreateClassDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const duplicate = await this.prisma.class.count({
      where: { schoolId, academicYearId, name: dto.name },
    });
    if (duplicate > 0) {
      throw new ConflictError(`A class named "${dto.name}" already exists in this academic year`);
    }

    const cls = await this.prisma.class.create({
      data: {
        schoolId,
        academicYearId,
        name: dto.name,
        level: dto.level,
        stream: dto.stream ?? null,
        medium: dto.medium ?? 'English',
        description: dto.description ?? null,
        ...(dto.sections?.length
          ? {
              sections: {
                create: dto.sections.map((name) => ({ schoolId, name: name.trim().toUpperCase() })),
              },
            }
          : {}),
      },
      include: { sections: true },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'academics',
      entity: 'Class',
      entityId: cls.id,
      description: `Created class "${cls.name}" with ${cls.sections.length} section(s)`,
      schoolId,
    });

    return cls;
  }

  async update(schoolId: string, id: string, dto: UpdateClassDto) {
    const existing = await this.prisma.class.findFirst({ where: { id, schoolId } });
    if (!existing) throw new NotFoundError('Class');

    const { sections: _sections, academicYearId: _year, ...data } = dto;

    const updated = await this.prisma.class.update({ where: { id }, data });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'academics',
      entity: 'Class',
      entityId: id,
      description: `Updated class "${updated.name}"`,
      ...this.audit.diff(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      ),
      schoolId,
    });

    return updated;
  }

  async remove(schoolId: string, id: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { enrollments: true } } },
    });
    if (!cls) throw new NotFoundError('Class');

    if (cls._count.enrollments > 0) {
      throw new ConflictError(
        `"${cls.name}" has ${cls._count.enrollments} enrolled student(s). Move them before deleting the class.`,
      );
    }

    await this.prisma.class.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'academics',
      entity: 'Class',
      entityId: id,
      description: `Deleted class "${cls.name}"`,
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  async listSections(schoolId: string, classId?: string) {
    const sections = await this.prisma.section.findMany({
      where: { schoolId, ...(classId ? { classId } : {}) },
      orderBy: [{ class: { level: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        capacity: true,
        class: { select: { id: true, name: true, level: true } },
        classTeacher: { select: { id: true, firstName: true, lastName: true } },
        room: { select: { id: true, name: true } },
        _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
      },
    });

    return sections.map(({ _count, ...section }) => ({
      ...section,
      studentCount: _count.enrollments,
      availableSeats: Math.max(0, section.capacity - _count.enrollments),
    }));
  }

  async createSection(schoolId: string, dto: CreateSectionDto) {
    const cls = await this.prisma.class.findFirst({
      where: { id: dto.classId, schoolId },
      select: { id: true, name: true },
    });
    if (!cls) throw new NotFoundError('Class');

    const name = dto.name.trim().toUpperCase();

    const duplicate = await this.prisma.section.count({ where: { classId: dto.classId, name } });
    if (duplicate > 0) {
      throw new ConflictError(`Section "${name}" already exists in ${cls.name}`);
    }

    if (dto.classTeacherId) await this.assertStaffExists(schoolId, dto.classTeacherId);

    const section = await this.prisma.section.create({
      data: {
        schoolId,
        classId: dto.classId,
        name,
        capacity: dto.capacity ?? 40,
        roomId: dto.roomId ?? null,
        classTeacherId: dto.classTeacherId ?? null,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'academics',
      entity: 'Section',
      entityId: section.id,
      description: `Created section "${cls.name} - ${name}"`,
      schoolId,
    });

    return section;
  }

  async updateSection(schoolId: string, id: string, dto: UpdateSectionDto) {
    const existing = await this.prisma.section.findFirst({
      where: { id, schoolId },
      select: {
        id: true,
        name: true,
        capacity: true,
        classTeacherId: true,
        roomId: true,
        _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
      },
    });
    if (!existing) throw new NotFoundError('Section');

    // Capacity must never drop below the number of students already placed.
    if (dto.capacity !== undefined && dto.capacity < existing._count.enrollments) {
      throw new BadRequestError(
        `Capacity cannot be less than the ${existing._count.enrollments} student(s) already enrolled`,
      );
    }

    if (dto.classTeacherId) await this.assertStaffExists(schoolId, dto.classTeacherId);

    const updated = await this.prisma.section.update({
      where: { id },
      data: {
        name: dto.name ? dto.name.trim().toUpperCase() : undefined,
        capacity: dto.capacity ?? undefined,
        roomId: dto.roomId ?? undefined,
        classTeacherId: dto.classTeacherId ?? undefined,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'academics',
      entity: 'Section',
      entityId: id,
      description: 'Updated section',
      schoolId,
    });

    return updated;
  }

  async removeSection(schoolId: string, id: string) {
    const section = await this.prisma.section.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { enrollments: true } } },
    });
    if (!section) throw new NotFoundError('Section');

    if (section._count.enrollments > 0) {
      throw new ConflictError(
        `This section has ${section._count.enrollments} enrolled student(s). Move them before deleting it.`,
      );
    }

    await this.prisma.section.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'academics',
      entity: 'Section',
      entityId: id,
      description: `Deleted section "${section.name}"`,
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Class-subject mapping
  // -------------------------------------------------------------------------

  async assignSubjects(schoolId: string, classId: string, dto: AssignSubjectsToClassDto) {
    const cls = await this.prisma.class.findFirst({
      where: { id: classId, schoolId },
      select: { id: true, name: true },
    });
    if (!cls) throw new NotFoundError('Class');

    const subjectIds = dto.subjects.map((entry) => entry.subjectId);
    const subjects = await this.prisma.subject.findMany({
      where: { id: { in: subjectIds }, schoolId },
      select: { id: true },
    });

    if (subjects.length !== new Set(subjectIds).size) {
      throw new BadRequestError('One or more subjects do not exist in this school');
    }

    await this.prisma.$transaction([
      this.prisma.classSubject.deleteMany({ where: { classId } }),
      this.prisma.classSubject.createMany({
        data: dto.subjects.map((entry) => ({
          classId,
          subjectId: entry.subjectId,
          weeklyPeriods: entry.weeklyPeriods ?? 5,
          maxMarks: entry.maxMarks ?? 100,
          passMarks: entry.passMarks ?? 35,
          isOptional: entry.isOptional ?? false,
        })),
        skipDuplicates: true,
      }),
    ]);

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'academics',
      entity: 'Class',
      entityId: classId,
      description: `Set ${dto.subjects.length} subject(s) for class "${cls.name}"`,
      newValue: { subjects: dto.subjects },
      schoolId,
    });

    return this.findOne(schoolId, classId);
  }

  private async assertStaffExists(schoolId: string, staffId: string): Promise<void> {
    const staff = await this.prisma.staff.count({
      where: { id: staffId, schoolId, deletedAt: null },
    });
    if (staff === 0) throw new NotFoundError('Staff member');
  }
}
