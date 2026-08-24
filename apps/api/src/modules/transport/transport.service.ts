import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, TransportDirection, VehicleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { parseDateOnly } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AcademicYearService } from '../academics/services/academic-year.service';
import type {
  AssignTransportDto,
  CreateDriverDto,
  CreateRouteDto,
  CreateVehicleDto,
  UpdateRouteStopsDto,
  VehiclePositionDto,
} from './dto/transport.dto';

@Injectable()
export class TransportService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly academicYears: AcademicYearService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('TransportService');
  }

  // -------------------------------------------------------------------------
  // Vehicles
  // -------------------------------------------------------------------------

  async listVehicles(schoolId: string, query: PaginationQueryDto & { status?: VehicleStatus }) {
    const where: Prisma.VehicleWhereInput = {
      schoolId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { registrationNumber: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { registrationNumber: 'asc' },
        include: {
          routes: {
            select: {
              id: true,
              name: true,
              code: true,
              _count: { select: { assignments: { where: { isActive: true } } } },
            },
          },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    const soon = new Date(Date.now() + 30 * 86_400_000);

    return buildPaginatedResult(
      items.map((vehicle) => ({
        ...vehicle,
        occupancy: vehicle.routes.reduce((sum, route) => sum + route._count.assignments, 0),
        // Surfacing expiring paperwork is the point of holding these dates.
        documentAlerts: [
          ...(vehicle.insuranceExpiry && vehicle.insuranceExpiry < soon
            ? [{ document: 'Insurance', expiresOn: vehicle.insuranceExpiry }]
            : []),
          ...(vehicle.fitnessExpiry && vehicle.fitnessExpiry < soon
            ? [{ document: 'Fitness certificate', expiresOn: vehicle.fitnessExpiry }]
            : []),
          ...(vehicle.permitExpiry && vehicle.permitExpiry < soon
            ? [{ document: 'Permit', expiresOn: vehicle.permitExpiry }]
            : []),
          ...(vehicle.pollutionExpiry && vehicle.pollutionExpiry < soon
            ? [{ document: 'Pollution certificate', expiresOn: vehicle.pollutionExpiry }]
            : []),
        ],
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async createVehicle(schoolId: string, dto: CreateVehicleDto) {
    const duplicate = await this.prisma.vehicle.count({
      where: { schoolId, registrationNumber: dto.registrationNumber },
    });
    if (duplicate > 0) {
      throw new ConflictError(
        `A vehicle registered as "${dto.registrationNumber}" already exists`,
      );
    }

    const vehicle = await this.prisma.vehicle.create({
      data: {
        schoolId,
        registrationNumber: dto.registrationNumber,
        name: dto.name ?? null,
        type: dto.type ?? 'BUS',
        make: dto.make ?? null,
        model: dto.model ?? null,
        capacity: dto.capacity,
        insuranceNumber: dto.insuranceNumber ?? null,
        insuranceExpiry: dto.insuranceExpiry ? parseDateOnly(dto.insuranceExpiry) : null,
        fitnessExpiry: dto.fitnessExpiry ? parseDateOnly(dto.fitnessExpiry) : null,
        permitExpiry: dto.permitExpiry ? parseDateOnly(dto.permitExpiry) : null,
        pollutionExpiry: dto.pollutionExpiry ? parseDateOnly(dto.pollutionExpiry) : null,
        gpsDeviceId: dto.gpsDeviceId ?? null,
        trackingEnabled: dto.trackingEnabled ?? false,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'transport',
      entity: 'Vehicle',
      entityId: vehicle.id,
      description: `Added vehicle ${vehicle.registrationNumber}`,
      schoolId,
    });

    return vehicle;
  }

  async updateVehicle(schoolId: string, id: string, dto: Partial<CreateVehicleDto> & { status?: VehicleStatus }) {
    const existing = await this.prisma.vehicle.findFirst({
      where: { id, schoolId },
      select: { id: true, capacity: true, routes: { select: { _count: { select: { assignments: { where: { isActive: true } } } } } } },
    });
    if (!existing) throw new NotFoundError('Vehicle');

    // Capacity cannot drop below the students already riding.
    if (dto.capacity !== undefined) {
      const riders = existing.routes.reduce((sum, route) => sum + route._count.assignments, 0);
      if (dto.capacity < riders) {
        throw new BadRequestError(
          `Capacity cannot be less than the ${riders} student(s) currently assigned`,
          ErrorCode.VEHICLE_CAPACITY_EXCEEDED,
        );
      }
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: {
        ...dto,
        insuranceExpiry: dto.insuranceExpiry ? parseDateOnly(dto.insuranceExpiry) : undefined,
        fitnessExpiry: dto.fitnessExpiry ? parseDateOnly(dto.fitnessExpiry) : undefined,
        permitExpiry: dto.permitExpiry ? parseDateOnly(dto.permitExpiry) : undefined,
        pollutionExpiry: dto.pollutionExpiry ? parseDateOnly(dto.pollutionExpiry) : undefined,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Drivers
  // -------------------------------------------------------------------------

  async listDrivers(schoolId: string) {
    const drivers = await this.prisma.driver.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      include: {
        routes: { select: { id: true, name: true, code: true } },
        attendantRoutes: { select: { id: true, name: true, code: true } },
      },
    });

    const soon = new Date(Date.now() + 60 * 86_400_000);

    return drivers.map((driver) => ({
      ...driver,
      licenceExpiringSoon: driver.licenseExpiry ? driver.licenseExpiry < soon : false,
    }));
  }

  async createDriver(schoolId: string, dto: CreateDriverDto) {
    const duplicate = await this.prisma.driver.count({
      where: { schoolId, licenseNumber: dto.licenseNumber },
    });
    if (duplicate > 0) {
      throw new ConflictError('A driver with this licence number already exists');
    }

    const driver = await this.prisma.driver.create({
      data: {
        schoolId,
        name: dto.name,
        phone: dto.phone,
        alternatePhone: dto.alternatePhone ?? null,
        photoUrl: dto.photoUrl ?? null,
        licenseNumber: dto.licenseNumber,
        licenseExpiry: dto.licenseExpiry ? parseDateOnly(dto.licenseExpiry) : null,
        address: dto.address ?? null,
        bloodGroup: dto.bloodGroup ?? 'UNKNOWN',
        role: dto.role ?? 'DRIVER',
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'transport',
      entity: 'Driver',
      entityId: driver.id,
      description: `Added ${driver.role.toLowerCase()} ${driver.name}`,
      schoolId,
    });

    return driver;
  }

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  async listRoutes(schoolId: string) {
    const routes = await this.prisma.transportRoute.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      include: {
        vehicle: {
          select: { id: true, registrationNumber: true, name: true, capacity: true, status: true },
        },
        driver: { select: { id: true, name: true, phone: true, photoUrl: true } },
        attendant: { select: { id: true, name: true, phone: true } },
        stops: { orderBy: { sequence: 'asc' } },
        _count: { select: { assignments: { where: { isActive: true } } } },
      },
    });

    return routes.map(({ _count, ...route }) => ({
      ...route,
      studentCount: _count.assignments,
      seatsRemaining: route.vehicle
        ? Math.max(0, route.vehicle.capacity - _count.assignments)
        : null,
      isOverCapacity: route.vehicle ? _count.assignments > route.vehicle.capacity : false,
    }));
  }

  async getRoute(schoolId: string, id: string) {
    const route = await this.prisma.transportRoute.findFirst({
      where: { id, schoolId },
      include: {
        vehicle: true,
        driver: true,
        attendant: true,
        stops: { orderBy: { sequence: 'asc' } },
        assignments: {
          where: { isActive: true },
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
                guardians: {
                  where: { isPrimary: true },
                  take: 1,
                  select: { guardian: { select: { firstName: true, phone: true } } },
                },
              },
            },
            pickupStop: { select: { id: true, name: true, pickupTime: true } },
          },
        },
      },
    });

    if (!route) throw new NotFoundError('Route');

    // Same occupancy figures the list view reports, so a dispatcher opening a
    // route can see whether there is a seat before assigning a student.
    return {
      ...route,
      studentCount: route.assignments.length,
      seatsRemaining: route.vehicle
        ? Math.max(0, route.vehicle.capacity - route.assignments.length)
        : null,
      isOverCapacity: route.vehicle
        ? route.assignments.length > route.vehicle.capacity
        : false,
    };
  }

  async createRoute(schoolId: string, dto: CreateRouteDto) {
    const duplicate = await this.prisma.transportRoute.count({
      where: { schoolId, code: dto.code },
    });
    if (duplicate > 0) {
      throw new ConflictError(`A route with the code "${dto.code}" already exists`);
    }

    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.count({
        where: { id: dto.vehicleId, schoolId },
      });
      if (vehicle === 0) throw new NotFoundError('Vehicle');
    }

    const route = await this.prisma.transportRoute.create({
      data: {
        schoolId,
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        vehicleId: dto.vehicleId ?? null,
        driverId: dto.driverId ?? null,
        attendantId: dto.attendantId ?? null,
        distanceKm: dto.distanceKm ?? null,
        startTime: dto.startTime ?? null,
        endTime: dto.endTime ?? null,
        baseFare: dto.baseFare ?? 0,
        ...(dto.stops?.length
          ? {
              stops: {
                create: dto.stops.map((stop, index) => ({
                  name: stop.name,
                  sequence: stop.sequence ?? index + 1,
                  pickupTime: stop.pickupTime ?? null,
                  dropTime: stop.dropTime ?? null,
                  latitude: stop.latitude ?? null,
                  longitude: stop.longitude ?? null,
                  landmark: stop.landmark ?? null,
                  fare: stop.fare ?? 0,
                })),
              },
            }
          : {}),
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'transport',
      entity: 'TransportRoute',
      entityId: route.id,
      description: `Created route "${route.name}" with ${route.stops.length} stop(s)`,
      schoolId,
    });

    return route;
  }

  async updateStops(schoolId: string, routeId: string, dto: UpdateRouteStopsDto) {
    const route = await this.prisma.transportRoute.findFirst({
      where: { id: routeId, schoolId },
      select: { id: true, name: true },
    });
    if (!route) throw new NotFoundError('Route');

    const sequences = dto.stops.map((stop) => stop.sequence).sort((a, b) => a - b);
    const expected = Array.from({ length: sequences.length }, (_, index) => index + 1);
    if (sequences.join(',') !== expected.join(',')) {
      throw new BadRequestError(
        `Stop sequences must run 1 to ${sequences.length} without gaps`,
      );
    }

    // Students assigned to a stop that is being removed would be left without a
    // pickup point, so that is refused.
    const keptIds = dto.stops.map((stop) => stop.id).filter(Boolean) as string[];
    const orphaned = await this.prisma.studentTransport.count({
      where: {
        routeId,
        isActive: true,
        pickupStopId: { not: null, notIn: keptIds },
      },
    });
    if (orphaned > 0) {
      throw new ConflictError(
        `${orphaned} student(s) are assigned to a stop you are removing. Reassign them first.`,
      );
    }

    const updated = await this.prisma.transaction(async (tx) => {
      await tx.routeStop.deleteMany({
        where: { routeId, ...(keptIds.length ? { id: { notIn: keptIds } } : {}) },
      });

      for (const stop of dto.stops) {
        if (stop.id) {
          await tx.routeStop.update({
            where: { id: stop.id },
            data: {
              name: stop.name,
              sequence: stop.sequence,
              pickupTime: stop.pickupTime ?? null,
              dropTime: stop.dropTime ?? null,
              latitude: stop.latitude ?? null,
              longitude: stop.longitude ?? null,
              landmark: stop.landmark ?? null,
              fare: stop.fare ?? 0,
            },
          });
        } else {
          await tx.routeStop.create({
            data: {
              routeId,
              name: stop.name,
              sequence: stop.sequence,
              pickupTime: stop.pickupTime ?? null,
              dropTime: stop.dropTime ?? null,
              latitude: stop.latitude ?? null,
              longitude: stop.longitude ?? null,
              landmark: stop.landmark ?? null,
              fare: stop.fare ?? 0,
            },
          });
        }
      }

      return tx.routeStop.findMany({ where: { routeId }, orderBy: { sequence: 'asc' } });
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'transport',
      entity: 'TransportRoute',
      entityId: routeId,
      description: `Updated stops on route "${route.name}" (${updated.length} stop(s))`,
      schoolId,
    });

    return updated;
  }

  async removeRoute(schoolId: string, id: string) {
    const route = await this.prisma.transportRoute.findFirst({
      where: { id, schoolId },
      select: {
        id: true,
        name: true,
        _count: { select: { assignments: { where: { isActive: true } } } },
      },
    });
    if (!route) throw new NotFoundError('Route');

    if (route._count.assignments > 0) {
      throw new ConflictError(
        `${route._count.assignments} student(s) still use this route. Reassign them first.`,
      );
    }

    await this.prisma.transportRoute.update({ where: { id }, data: { isActive: false } });
    return { deactivated: true };
  }

  // -------------------------------------------------------------------------
  // Student assignment
  // -------------------------------------------------------------------------

  /** Assigns a student to a route, enforcing the vehicle's seat count. */
  async assignStudent(schoolId: string, dto: AssignTransportDto) {
    const academicYearId = await this.academicYears.resolveId(schoolId, dto.academicYearId);

    const [student, route] = await this.prisma.$transaction([
      this.prisma.student.findFirst({
        where: { id: dto.studentId, schoolId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, admissionNumber: true, firstName: true, lastName: true },
      }),
      this.prisma.transportRoute.findFirst({
        where: { id: dto.routeId, schoolId, isActive: true },
        select: {
          id: true,
          name: true,
          baseFare: true,
          vehicle: { select: { id: true, capacity: true, registrationNumber: true } },
          stops: { select: { id: true, fare: true } },
          _count: { select: { assignments: { where: { isActive: true } } } },
        },
      }),
    ]);

    if (!student) throw new NotFoundError('Student');
    if (!route) throw new NotFoundError('Route');

    if (dto.pickupStopId && !route.stops.some((stop) => stop.id === dto.pickupStopId)) {
      throw new BadRequestError('The selected stop does not belong to this route');
    }

    const existing = await this.prisma.studentTransport.findUnique({
      where: {
        studentId_academicYearId: { studentId: dto.studentId, academicYearId },
      },
      select: { id: true, routeId: true, isActive: true },
    });

    // Seat check only applies when this is a genuinely new rider on the route.
    const isNewRider = !existing || existing.routeId !== route.id || !existing.isActive;

    if (isNewRider && route.vehicle && route._count.assignments >= route.vehicle.capacity) {
      throw new ConflictError(
        `${route.name} is full: ${route.vehicle.registrationNumber} seats ${route.vehicle.capacity}.`,
        ErrorCode.VEHICLE_CAPACITY_EXCEEDED,
      );
    }

    // Fare is the route base plus any stop-specific surcharge.
    const stopFare = dto.pickupStopId
      ? Number(route.stops.find((stop) => stop.id === dto.pickupStopId)?.fare ?? 0)
      : 0;
    const fareAmount = dto.fareAmount ?? Number(route.baseFare) + stopFare;

    const assignment = await this.prisma.studentTransport.upsert({
      where: {
        studentId_academicYearId: { studentId: dto.studentId, academicYearId },
      },
      create: {
        studentId: dto.studentId,
        academicYearId,
        routeId: route.id,
        pickupStopId: dto.pickupStopId ?? null,
        dropStopId: dto.dropStopId ?? null,
        direction: dto.direction ?? TransportDirection.BOTH,
        fareAmount,
        startDate: dto.startDate ? parseDateOnly(dto.startDate) : new Date(),
        isActive: true,
      },
      update: {
        routeId: route.id,
        pickupStopId: dto.pickupStopId ?? null,
        dropStopId: dto.dropStopId ?? null,
        direction: dto.direction ?? TransportDirection.BOTH,
        fareAmount,
        isActive: true,
        endDate: null,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'transport',
      entity: 'StudentTransport',
      entityId: assignment.id,
      description:
        `Assigned ${student.admissionNumber} to route "${route.name}" at a fare of ${fareAmount}`,
      schoolId,
    });

    return assignment;
  }

  async unassignStudent(schoolId: string, studentId: string, academicYearId?: string) {
    const yearId = await this.academicYears.resolveId(schoolId, academicYearId);

    const assignment = await this.prisma.studentTransport.findUnique({
      where: { studentId_academicYearId: { studentId, academicYearId: yearId } },
      select: { id: true },
    });
    if (!assignment) throw new NotFoundError('Transport assignment');

    await this.prisma.studentTransport.update({
      where: { id: assignment.id },
      data: { isActive: false, endDate: new Date() },
    });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'transport',
      entity: 'StudentTransport',
      entityId: assignment.id,
      description: 'Removed a student from transport',
      schoolId,
    });

    return { unassigned: true };
  }

  /** What a parent sees: the bus, driver, stop and timings for their child. */
  async forStudent(schoolId: string, studentId: string) {
    const assignment = await this.prisma.studentTransport.findFirst({
      where: { studentId, isActive: true, route: { schoolId } },
      include: {
        route: {
          select: {
            id: true,
            name: true,
            code: true,
            startTime: true,
            endTime: true,
            vehicle: {
              select: {
                id: true,
                registrationNumber: true,
                name: true,
                trackingEnabled: true,
              },
            },
            driver: { select: { name: true, phone: true, photoUrl: true } },
            attendant: { select: { name: true, phone: true } },
            stops: { orderBy: { sequence: 'asc' } },
          },
        },
        pickupStop: true,
      },
    });

    if (!assignment) return null;

    return {
      routeName: assignment.route.name,
      routeCode: assignment.route.code,
      busNumber: assignment.route.vehicle?.registrationNumber ?? null,
      busName: assignment.route.vehicle?.name ?? null,
      trackingEnabled: assignment.route.vehicle?.trackingEnabled ?? false,
      vehicleId: assignment.route.vehicle?.id ?? null,
      driver: assignment.route.driver,
      attendant: assignment.route.attendant,
      pickupPoint: assignment.pickupStop?.name ?? null,
      pickupTime: assignment.pickupStop?.pickupTime ?? assignment.route.startTime,
      dropPoint: assignment.pickupStop?.name ?? null,
      dropTime: assignment.pickupStop?.dropTime ?? assignment.route.endTime,
      direction: assignment.direction,
      fareAmount: Number(assignment.fareAmount),
      allStops: assignment.route.stops,
    };
  }

  // -------------------------------------------------------------------------
  // Live tracking
  // -------------------------------------------------------------------------

  /**
   * Records a GPS ping and broadcasts it to anyone watching that vehicle.
   *
   * Positions are stored as a breadcrumb trail and pruned by a scheduled job;
   * the live view is served from the socket broadcast, not the table.
   */
  async recordPosition(schoolId: string, vehicleId: string, dto: VehiclePositionDto) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, schoolId },
      select: { id: true, trackingEnabled: true, registrationNumber: true },
    });
    if (!vehicle) throw new NotFoundError('Vehicle');

    if (!vehicle.trackingEnabled) {
      throw new BadRequestError('Tracking is not enabled for this vehicle');
    }

    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();

    const position = await this.prisma.vehiclePosition.create({
      data: {
        vehicleId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        speedKph: dto.speedKph ?? null,
        heading: dto.heading ?? null,
        accuracy: dto.accuracy ?? null,
        recordedAt,
      },
      select: { id: true, latitude: true, longitude: true, speedKph: true, recordedAt: true },
    });

    this.realtime.emitVehiclePosition(vehicleId, {
      vehicleId,
      registrationNumber: vehicle.registrationNumber,
      ...position,
    });

    return position;
  }

  async latestPosition(schoolId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, schoolId },
      select: { id: true, registrationNumber: true, trackingEnabled: true },
    });
    if (!vehicle) throw new NotFoundError('Vehicle');

    const position = await this.prisma.vehiclePosition.findFirst({
      where: { vehicleId },
      orderBy: { recordedAt: 'desc' },
    });

    return {
      vehicle,
      position,
      // A stale ping is worse than none; the client should say "last seen".
      isStale: position ? Date.now() - position.recordedAt.getTime() > 5 * 60_000 : true,
    };
  }

  /** Removes breadcrumbs older than the retention window. */
  async prunePositions(retentionDays = 7): Promise<number> {
    const result = await this.prisma.vehiclePosition.deleteMany({
      where: { recordedAt: { lt: new Date(Date.now() - retentionDays * 86_400_000) } },
    });
    return result.count;
  }

  // -------------------------------------------------------------------------

  async statistics(schoolId: string) {
    const [vehicles, drivers, routes, riders] = await this.prisma.$transaction([
      this.prisma.vehicle.count({ where: { schoolId, status: VehicleStatus.ACTIVE } }),
      this.prisma.driver.count({ where: { schoolId, isActive: true } }),
      this.prisma.transportRoute.count({ where: { schoolId, isActive: true } }),
      this.prisma.studentTransport.count({ where: { isActive: true, route: { schoolId } } }),
    ]);

    const capacity = await this.prisma.vehicle.aggregate({
      where: { schoolId, status: VehicleStatus.ACTIVE },
      _sum: { capacity: true },
    });

    const totalCapacity = capacity._sum.capacity ?? 0;

    return {
      activeVehicles: vehicles,
      activeDrivers: drivers,
      activeRoutes: routes,
      studentsUsingTransport: riders,
      totalCapacity,
      utilisationPercent:
        totalCapacity > 0 ? Number(((riders / totalCapacity) * 100).toFixed(1)) : 0,
    };
  }
}
