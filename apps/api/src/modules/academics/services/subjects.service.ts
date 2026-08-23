import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { buildPaginatedResult } from '../../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../common/exceptions/app.exception';
import { AuditService } from '../../audit/audit.service';
import type {
  AssignSubjectTeacherDto,
  CreateDepartmentDto,
  CreateDesignationDto,
  CreateRoomDto,
  CreateSubjectDto,
  SubjectQueryDto,
  UpdateDepartmentDto,
  UpdateDesignationDto,
  UpdateRoomDto,
  UpdateSubjectDto,
} from '../dto/academics.dto';

@Injectable()
export class SubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Subjects
  // -------------------------------------------------------------------------

  async findAll(schoolId: string, query: SubjectQueryDto) {
    const where: Prisma.SubjectWhereInput = {
      schoolId,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.classId ? { classSubjects: { some: { classId: query.classId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.subject.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { name: 'asc' },
        include: {
          department: { select: { id: true, name: true, code: true } },
          _count: { select: { classSubjects: true, subjectTeachers: true } },
        },
      }),
      this.prisma.subject.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ _count, ...subject }) => ({
        ...subject,
        classCount: _count.classSubjects,
        teacherCount: _count.subjectTeachers,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id, schoolId },
      include: {
        department: { select: { id: true, name: true } },
        classSubjects: {
          include: { class: { select: { id: true, name: true, level: true } } },
        },
        subjectTeachers: {
          include: {
            staff: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
            section: {
              select: { id: true, name: true, class: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    if (!subject) throw new NotFoundError('Subject');
    return subject;
  }

  async create(schoolId: string, dto: CreateSubjectDto) {
    const duplicate = await this.prisma.subject.count({ where: { schoolId, code: dto.code } });
    if (duplicate > 0) {
      throw new ConflictError(`A subject with the code "${dto.code}" already exists`);
    }

    if (dto.departmentId) {
      const department = await this.prisma.department.count({
        where: { id: dto.departmentId, schoolId },
      });
      if (department === 0) throw new NotFoundError('Department');
    }

    const subject = await this.prisma.subject.create({
      data: {
        schoolId,
        name: dto.name,
        code: dto.code,
        departmentId: dto.departmentId ?? null,
        category: dto.category ?? 'CORE',
        isElective: dto.isElective ?? false,
        hasPractical: dto.hasPractical ?? false,
        isGradedOnly: dto.isGradedOnly ?? false,
        colorHex: dto.colorHex ?? null,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'academics',
      entity: 'Subject',
      entityId: subject.id,
      description: `Created subject "${subject.name}"`,
      schoolId,
    });

    return subject;
  }

  async update(schoolId: string, id: string, dto: UpdateSubjectDto) {
    const existing = await this.prisma.subject.findFirst({ where: { id, schoolId } });
    if (!existing) throw new NotFoundError('Subject');

    if (dto.code && dto.code !== existing.code) {
      const duplicate = await this.prisma.subject.count({
        where: { schoolId, code: dto.code, id: { not: id } },
      });
      if (duplicate > 0) {
        throw new ConflictError(`A subject with the code "${dto.code}" already exists`);
      }
    }

    const updated = await this.prisma.subject.update({ where: { id }, data: { ...dto } });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'academics',
      entity: 'Subject',
      entityId: id,
      description: `Updated subject "${updated.name}"`,
      ...this.audit.diff(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      ),
      schoolId,
    });

    return updated;
  }

  async remove(schoolId: string, id: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id, schoolId },
      select: {
        id: true,
        name: true,
        _count: { select: { marks: true, classSubjects: true, timetableSlots: true } },
      },
    });
    if (!subject) throw new NotFoundError('Subject');

    if (subject._count.marks > 0) {
      throw new ConflictError(
        `"${subject.name}" has examination marks recorded against it and cannot be deleted.`,
      );
    }

    await this.prisma.subject.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'academics',
      entity: 'Subject',
      entityId: id,
      description: `Deleted subject "${subject.name}"`,
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Subject teachers
  // -------------------------------------------------------------------------

  async assignTeacher(schoolId: string, dto: AssignSubjectTeacherDto) {
    const [section, subject, staff] = await this.prisma.$transaction([
      this.prisma.section.findFirst({
        where: { id: dto.sectionId, schoolId },
        select: { id: true, name: true, classId: true, class: { select: { name: true } } },
      }),
      this.prisma.subject.findFirst({
        where: { id: dto.subjectId, schoolId },
        select: { id: true, name: true },
      }),
      this.prisma.staff.findFirst({
        where: { id: dto.staffId, schoolId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, isTeacher: true },
      }),
    ]);

    if (!section) throw new NotFoundError('Section');
    if (!subject) throw new NotFoundError('Subject');
    if (!staff) throw new NotFoundError('Staff member');
    if (!staff.isTeacher) {
      throw new BadRequestError('This staff member is not marked as a teacher');
    }

    // The subject must actually be taught in this section's class.
    const mapped = await this.prisma.classSubject.count({
      where: { classId: section.classId, subjectId: dto.subjectId },
    });
    if (mapped === 0) {
      throw new BadRequestError(
        `"${subject.name}" is not assigned to ${section.class.name}. Add it to the class first.`,
      );
    }

    const assignment = await this.prisma.subjectTeacher.upsert({
      where: {
        sectionId_subjectId_staffId: {
          sectionId: dto.sectionId,
          subjectId: dto.subjectId,
          staffId: dto.staffId,
        },
      },
      create: {
        sectionId: dto.sectionId,
        subjectId: dto.subjectId,
        staffId: dto.staffId,
        isPrimary: dto.isPrimary ?? true,
      },
      update: { isPrimary: dto.isPrimary ?? true },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'academics',
      entity: 'SubjectTeacher',
      entityId: assignment.id,
      description:
        `Assigned ${[staff.firstName, staff.lastName].filter(Boolean).join(' ')} to teach ` +
        `${subject.name} in ${section.class.name} ${section.name}`,
      schoolId,
    });

    return assignment;
  }

  async removeTeacher(schoolId: string, assignmentId: string) {
    const assignment = await this.prisma.subjectTeacher.findFirst({
      where: { id: assignmentId, section: { schoolId } },
      select: { id: true },
    });
    if (!assignment) throw new NotFoundError('Subject teacher assignment');

    await this.prisma.subjectTeacher.delete({ where: { id: assignmentId } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'academics',
      entity: 'SubjectTeacher',
      entityId: assignmentId,
      description: 'Removed a subject teacher assignment',
      schoolId,
    });

    return { deleted: true };
  }

  /** Everything a teacher teaches: their class-teacher sections and subjects. */
  async teacherWorkload(schoolId: string, staffId: string) {
    const [subjects, classTeacherOf, periodCount] = await this.prisma.$transaction([
      this.prisma.subjectTeacher.findMany({
        where: { staffId, section: { schoolId } },
        include: {
          subject: { select: { id: true, name: true, code: true, colorHex: true } },
          section: {
            select: {
              id: true,
              name: true,
              class: { select: { id: true, name: true, level: true } },
              _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
            },
          },
        },
      }),
      this.prisma.section.findMany({
        where: { schoolId, classTeacherId: staffId },
        select: {
          id: true,
          name: true,
          class: { select: { id: true, name: true } },
          _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
        },
      }),
      this.prisma.timetableSlot.count({ where: { schoolId, staffId, isActive: true } }),
    ]);

    return {
      subjects: subjects.map(({ section, subject, ...entry }) => ({
        ...entry,
        subject,
        section: { id: section.id, name: section.name, class: section.class },
        studentCount: section._count.enrollments,
      })),
      classTeacherOf: classTeacherOf.map(({ _count, ...section }) => ({
        ...section,
        studentCount: _count.enrollments,
      })),
      weeklyPeriods: periodCount,
      totalStudents: classTeacherOf.reduce((sum, s) => sum + s._count.enrollments, 0),
    };
  }

  // -------------------------------------------------------------------------
  // Departments
  // -------------------------------------------------------------------------

  async listDepartments(schoolId: string) {
    const departments = await this.prisma.department.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      include: {
        head: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
        _count: { select: { staff: true, subjects: true } },
      },
    });

    return departments.map(({ _count, ...department }) => ({
      ...department,
      staffCount: _count.staff,
      subjectCount: _count.subjects,
    }));
  }

  async createDepartment(schoolId: string, dto: CreateDepartmentDto) {
    const duplicate = await this.prisma.department.count({ where: { schoolId, code: dto.code } });
    if (duplicate > 0) {
      throw new ConflictError(`A department with the code "${dto.code}" already exists`);
    }

    const department = await this.prisma.department.create({
      data: {
        schoolId,
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        headStaffId: dto.headStaffId ?? null,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'academics',
      entity: 'Department',
      entityId: department.id,
      description: `Created department "${department.name}"`,
      schoolId,
    });

    return department;
  }

  async updateDepartment(schoolId: string, id: string, dto: UpdateDepartmentDto) {
    const existing = await this.prisma.department.findFirst({ where: { id, schoolId } });
    if (!existing) throw new NotFoundError('Department');

    return this.prisma.department.update({ where: { id }, data: { ...dto } });
  }

  async removeDepartment(schoolId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { staff: true, subjects: true } } },
    });
    if (!department) throw new NotFoundError('Department');

    if (department._count.staff > 0 || department._count.subjects > 0) {
      throw new ConflictError(
        `"${department.name}" still has ${department._count.staff} staff member(s) and ` +
          `${department._count.subjects} subject(s) assigned to it.`,
      );
    }

    await this.prisma.department.delete({ where: { id } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Designations
  // -------------------------------------------------------------------------

  async listDesignations(schoolId: string) {
    return this.prisma.designation.findMany({
      where: { schoolId },
      orderBy: [{ level: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { staff: true } } },
    });
  }

  async createDesignation(schoolId: string, dto: CreateDesignationDto) {
    const duplicate = await this.prisma.designation.count({ where: { schoolId, code: dto.code } });
    if (duplicate > 0) {
      throw new ConflictError(`A designation with the code "${dto.code}" already exists`);
    }

    return this.prisma.designation.create({
      data: { schoolId, name: dto.name, code: dto.code, level: dto.level ?? 0 },
    });
  }

  async updateDesignation(schoolId: string, id: string, dto: UpdateDesignationDto) {
    const existing = await this.prisma.designation.count({ where: { id, schoolId } });
    if (existing === 0) throw new NotFoundError('Designation');
    return this.prisma.designation.update({ where: { id }, data: { ...dto } });
  }

  async removeDesignation(schoolId: string, id: string) {
    const designation = await this.prisma.designation.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { staff: true } } },
    });
    if (!designation) throw new NotFoundError('Designation');

    if (designation._count.staff > 0) {
      throw new ConflictError(
        `${designation._count.staff} staff member(s) hold the "${designation.name}" designation.`,
      );
    }

    await this.prisma.designation.delete({ where: { id } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  async listRooms(schoolId: string) {
    return this.prisma.room.findMany({
      where: { schoolId },
      orderBy: [{ building: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { sections: true, timetableSlots: true } } },
    });
  }

  async createRoom(schoolId: string, dto: CreateRoomDto) {
    const duplicate = await this.prisma.room.count({ where: { schoolId, code: dto.code } });
    if (duplicate > 0) {
      throw new ConflictError(`A room with the code "${dto.code}" already exists`);
    }

    return this.prisma.room.create({
      data: {
        schoolId,
        name: dto.name,
        code: dto.code,
        type: dto.type ?? 'CLASSROOM',
        capacity: dto.capacity ?? 40,
        building: dto.building ?? null,
        floor: dto.floor ?? null,
      },
    });
  }

  async updateRoom(schoolId: string, id: string, dto: UpdateRoomDto) {
    const existing = await this.prisma.room.count({ where: { id, schoolId } });
    if (existing === 0) throw new NotFoundError('Room');
    return this.prisma.room.update({ where: { id }, data: { ...dto } });
  }

  async removeRoom(schoolId: string, id: string) {
    const room = await this.prisma.room.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { timetableSlots: true } } },
    });
    if (!room) throw new NotFoundError('Room');

    if (room._count.timetableSlots > 0) {
      throw new ConflictError(
        `"${room.name}" is used in ${room._count.timetableSlots} timetable slot(s).`,
      );
    }

    await this.prisma.room.delete({ where: { id } });
    return { deleted: true };
  }
}
