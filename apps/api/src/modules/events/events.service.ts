import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  EventType,
  NoticeAudience,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { formatDateTime } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AcademicYearService } from '../academics/services/academic-year.service';
import type {
  CreateEventDto,
  EventQueryDto,
  RegisterForEventDto,
  UpdateEventDto,
} from './dto/event.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicYears: AcademicYearService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async findAll(schoolId: string, query: EventQueryDto) {
    const where: Prisma.EventWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.publishedOnly ? { isPublished: true } : {}),
      ...(query.upcomingOnly ? { startAt: { gte: new Date() } } : {}),
      ...(query.from || query.to
        ? {
            startAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { startAt: query.sortOrder },
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          startAt: true,
          endAt: true,
          isAllDay: true,
          venue: true,
          audience: true,
          coverImageUrl: true,
          requiresRegistration: true,
          registrationDeadline: true,
          maxParticipants: true,
          isPublished: true,
          isPublic: true,
          _count: { select: { registrations: true, attachments: true } },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    const now = new Date();

    return buildPaginatedResult(
      items.map(({ _count, ...event }) => ({
        ...event,
        registrationCount: _count.registrations,
        attachmentCount: _count.attachments,
        isUpcoming: event.startAt > now,
        isOngoing: event.startAt <= now && event.endAt >= now,
        seatsRemaining:
          event.maxParticipants !== null
            ? Math.max(0, event.maxParticipants - _count.registrations)
            : null,
        registrationOpen:
          event.requiresRegistration &&
          (!event.registrationDeadline || event.registrationDeadline > now) &&
          (event.maxParticipants === null || _count.registrations < event.maxParticipants),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        attachments: { select: { id: true, fileName: true, mimeType: true, url: true } },
        registrations: {
          include: {
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
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!event) throw new NotFoundError('Event');

    return {
      ...event,
      seatsRemaining:
        event.maxParticipants !== null
          ? Math.max(0, event.maxParticipants - event.registrations.length)
          : null,
    };
  }

  /** Public event listing for the school website; no authentication required. */
  async publicEvents(schoolSlug: string, limit = 20) {
    const school = await this.prisma.school.findFirst({
      where: { slug: schoolSlug, deletedAt: null },
      select: { id: true },
    });
    if (!school) throw new NotFoundError('School');

    return this.prisma.event.findMany({
      where: {
        schoolId: school.id,
        deletedAt: null,
        isPublished: true,
        isPublic: true,
        endAt: { gte: new Date() },
      },
      orderBy: { startAt: 'asc' },
      take: limit,
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        startAt: true,
        endAt: true,
        isAllDay: true,
        venue: true,
        coverImageUrl: true,
      },
    });
  }

  async create(schoolId: string, dto: CreateEventDto, createdById: string) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    if (endAt < startAt) {
      throw new BadRequestError('The event cannot end before it starts');
    }
    if (dto.registrationDeadline && new Date(dto.registrationDeadline) > startAt) {
      throw new BadRequestError('The registration deadline must fall before the event starts');
    }

    const academicYearId = dto.academicYearId
      ? await this.academicYears.resolveId(schoolId, dto.academicYearId)
      : (await this.academicYears.getCurrent(schoolId)).id;

    const event = await this.prisma.event.create({
      data: {
        schoolId,
        academicYearId,
        title: dto.title,
        description: dto.description ?? null,
        type: dto.type ?? EventType.OTHER,
        startAt,
        endAt,
        isAllDay: dto.isAllDay ?? false,
        venue: dto.venue ?? null,
        audience: dto.audience ?? NoticeAudience.ALL,
        classIds: dto.classIds ?? [],
        coverImageUrl: dto.coverImageUrl ?? null,
        requiresRegistration: dto.requiresRegistration ?? false,
        registrationDeadline: dto.registrationDeadline
          ? new Date(dto.registrationDeadline)
          : null,
        maxParticipants: dto.maxParticipants ?? null,
        isPublished: dto.publish ?? false,
        isPublic: dto.isPublic ?? false,
        createdById,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'events',
      entity: 'Event',
      entityId: event.id,
      description: `Created event "${event.title}" on ${formatDateTime(event.startAt)}`,
      schoolId,
    });

    if (event.isPublished) {
      void this.notifyAudience(schoolId, event.id).catch(() => undefined);
    }

    return event;
  }

  async update(schoolId: string, id: string, dto: UpdateEventDto) {
    const existing = await this.prisma.event.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, title: true, isPublished: true, startAt: true, endAt: true },
    });
    if (!existing) throw new NotFoundError('Event');

    const startAt = dto.startAt ? new Date(dto.startAt) : existing.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : existing.endAt;

    if (endAt < startAt) {
      throw new BadRequestError('The event cannot end before it starts');
    }

    const wasPublished = existing.isPublished;

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        description: dto.description ?? undefined,
        type: dto.type ?? undefined,
        startAt: dto.startAt ? startAt : undefined,
        endAt: dto.endAt ? endAt : undefined,
        isAllDay: dto.isAllDay ?? undefined,
        venue: dto.venue ?? undefined,
        coverImageUrl: dto.coverImageUrl ?? undefined,
        requiresRegistration: dto.requiresRegistration ?? undefined,
        registrationDeadline: dto.registrationDeadline
          ? new Date(dto.registrationDeadline)
          : undefined,
        maxParticipants: dto.maxParticipants ?? undefined,
        isPublished: dto.publish ?? undefined,
        isPublic: dto.isPublic ?? undefined,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'events',
      entity: 'Event',
      entityId: id,
      description: `Updated event "${updated.title}"`,
      schoolId,
    });

    // Announce the event the first time it becomes visible.
    if (!wasPublished && updated.isPublished) {
      void this.notifyAudience(schoolId, id).catch(() => undefined);
    }

    return updated;
  }

  async remove(schoolId: string, id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, title: true, _count: { select: { registrations: true } } },
    });
    if (!event) throw new NotFoundError('Event');

    await this.prisma.event.update({
      where: { id },
      data: { deletedAt: new Date(), isPublished: false },
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'events',
      entity: 'Event',
      entityId: id,
      description:
        `Removed event "${event.title}"` +
        (event._count.registrations > 0
          ? ` (${event._count.registrations} registration(s) retained)`
          : ''),
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Registers a student for an event.
   *
   * Capacity is enforced inside the transaction, and a student past the limit
   * is waitlisted rather than rejected outright.
   */
  async register(schoolId: string, eventId: string, dto: RegisterForEventDto, registeredById: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, schoolId, deletedAt: null },
      select: {
        id: true,
        title: true,
        isPublished: true,
        requiresRegistration: true,
        registrationDeadline: true,
        maxParticipants: true,
        startAt: true,
      },
    });
    if (!event) throw new NotFoundError('Event');

    if (!event.isPublished) {
      throw new BadRequestError('This event is not open for registration yet');
    }
    if (!event.requiresRegistration) {
      throw new BadRequestError('This event does not require registration');
    }
    if (event.registrationDeadline && event.registrationDeadline < new Date()) {
      throw new BadRequestError(
        `Registration closed on ${formatDateTime(event.registrationDeadline)}`,
      );
    }

    const student = await this.prisma.student.count({
      where: { id: dto.studentId, schoolId, deletedAt: null, status: 'ACTIVE' },
    });
    if (student === 0) throw new NotFoundError('Student');

    const existing = await this.prisma.eventRegistration.findUnique({
      where: { eventId_studentId: { eventId, studentId: dto.studentId } },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== 'CANCELLED') {
      throw new ConflictError('This student is already registered for the event');
    }

    const registration = await this.prisma.transaction(async (tx) => {
      const confirmed = await tx.eventRegistration.count({
        where: { eventId, status: { in: ['REGISTERED', 'ATTENDED'] } },
      });

      const status =
        event.maxParticipants !== null && confirmed >= event.maxParticipants
          ? 'WAITLISTED'
          : 'REGISTERED';

      return tx.eventRegistration.upsert({
        where: { eventId_studentId: { eventId, studentId: dto.studentId } },
        create: {
          eventId,
          studentId: dto.studentId,
          status,
          notes: dto.notes ?? null,
          registeredById,
        },
        update: { status, notes: dto.notes ?? null, registeredById },
      });
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'events',
      entity: 'EventRegistration',
      entityId: registration.id,
      description: `Registered a student for "${event.title}" (${registration.status})`,
      schoolId,
    });

    return registration;
  }

  async cancelRegistration(schoolId: string, eventId: string, studentId: string) {
    const registration = await this.prisma.eventRegistration.findFirst({
      where: { eventId, studentId, event: { schoolId } },
      select: { id: true, status: true },
    });
    if (!registration) throw new NotFoundError('Registration');

    await this.prisma.transaction(async (tx) => {
      await tx.eventRegistration.update({
        where: { id: registration.id },
        data: { status: 'CANCELLED' },
      });

      // Free seat: promote the first person waiting.
      if (registration.status === 'REGISTERED') {
        const next = await tx.eventRegistration.findFirst({
          where: { eventId, status: 'WAITLISTED' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (next) {
          await tx.eventRegistration.update({
            where: { id: next.id },
            data: { status: 'REGISTERED' },
          });
        }
      }
    });

    return { cancelled: true };
  }

  async markAttendance(schoolId: string, eventId: string, studentIds: string[]) {
    const event = await this.prisma.event.count({
      where: { id: eventId, schoolId, deletedAt: null },
    });
    if (event === 0) throw new NotFoundError('Event');

    const result = await this.prisma.eventRegistration.updateMany({
      where: { eventId, studentId: { in: studentIds } },
      data: { status: 'ATTENDED' },
    });

    return { marked: result.count };
  }

  // -------------------------------------------------------------------------

  private async notifyAudience(schoolId: string, eventId: string): Promise<void> {
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        startAt: true,
        venue: true,
        audience: true,
        classIds: true,
        requiresRegistration: true,
      },
    });

    const userIds = new Set<string>();

    if (event.audience === NoticeAudience.ALL || event.classIds.length === 0) {
      const users = await this.prisma.user.findMany({
        where: { schoolId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      });
      for (const user of users) userIds.add(user.id);
    } else {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { schoolId, status: 'ACTIVE', classId: { in: event.classIds } },
        select: {
          student: {
            select: {
              userId: true,
              guardians: { select: { guardian: { select: { userId: true } } } },
            },
          },
        },
      });
      for (const enrollment of enrollments) {
        if (enrollment.student.userId) userIds.add(enrollment.student.userId);
        for (const link of enrollment.student.guardians) {
          if (link.guardian.userId) userIds.add(link.guardian.userId);
        }
      }
    }

    if (userIds.size === 0) return;

    await this.notifications.dispatch({
      schoolId,
      userIds: [...userIds],
      type: NotificationType.EVENT,
      title: event.title,
      body:
        `${formatDateTime(event.startAt)}${event.venue ? ` at ${event.venue}` : ''}` +
        (event.requiresRegistration ? ' — registration required' : ''),
      data: { eventId: event.id },
      actionUrl: `/events/${event.id}`,
    });
  }
}
