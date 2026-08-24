import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VehicleStatus } from '@prisma/client';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequireAnyPermission,
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from '../guardians/guardians.service';
import { TransportService } from './transport.service';
import {
  AssignTransportDto,
  CreateDriverDto,
  CreateRouteDto,
  CreateVehicleDto,
  UpdateRouteStopsDto,
  VehicleQueryDto,
  VehiclePositionDto,
} from './dto/transport.dto';

@ApiTags('Transport')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.TRANSPORT)
@Controller('transport')
export class TransportController {
  constructor(
    private readonly transport: TransportService,
    private readonly guardians: GuardiansService,
  ) {}

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.TRANSPORT_VIEW)
  @ApiOperation({ summary: 'Fleet, route and utilisation summary' })
  statistics(@CurrentSchool() schoolId: string | null) {
    return this.transport.statistics(this.school(schoolId));
  }

  // --- Vehicles -------------------------------------------------------------

  @Get('vehicles')
  @RequirePermissions(PERMISSIONS.TRANSPORT_VIEW)
  @ApiOperation({ summary: 'List vehicles with occupancy and document alerts' })
  listVehicles(@CurrentSchool() schoolId: string | null, @Query() query: VehicleQueryDto) {
    return this.transport.listVehicles(this.school(schoolId), query);
  }

  @Post('vehicles')
  @RequirePermissions(PERMISSIONS.TRANSPORT_MANAGE)
  @ResponseMessage('Vehicle added')
  @ApiOperation({ summary: 'Add a vehicle' })
  createVehicle(@CurrentSchool() schoolId: string | null, @Body() dto: CreateVehicleDto) {
    return this.transport.createVehicle(this.school(schoolId), dto);
  }

  @Patch('vehicles/:id')
  @RequirePermissions(PERMISSIONS.TRANSPORT_MANAGE)
  @ResponseMessage('Vehicle updated')
  @ApiOperation({ summary: 'Update a vehicle' })
  updateVehicle(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateVehicleDto> & { status?: VehicleStatus },
  ) {
    return this.transport.updateVehicle(this.school(schoolId), id, dto);
  }

  // --- Drivers --------------------------------------------------------------

  @Get('drivers')
  @RequirePermissions(PERMISSIONS.TRANSPORT_VIEW)
  @ApiOperation({ summary: 'List drivers and attendants' })
  listDrivers(@CurrentSchool() schoolId: string | null) {
    return this.transport.listDrivers(this.school(schoolId));
  }

  @Post('drivers')
  @RequirePermissions(PERMISSIONS.TRANSPORT_MANAGE)
  @ResponseMessage('Driver added')
  @ApiOperation({ summary: 'Add a driver or attendant' })
  createDriver(@CurrentSchool() schoolId: string | null, @Body() dto: CreateDriverDto) {
    return this.transport.createDriver(this.school(schoolId), dto);
  }

  // --- Routes ---------------------------------------------------------------

  @Get('routes')
  @RequirePermissions(PERMISSIONS.TRANSPORT_VIEW)
  @ApiOperation({ summary: 'List routes with seats remaining' })
  listRoutes(@CurrentSchool() schoolId: string | null) {
    return this.transport.listRoutes(this.school(schoolId));
  }

  @Get('routes/:id')
  @RequirePermissions(PERMISSIONS.TRANSPORT_VIEW)
  @ApiOperation({ summary: 'Route detail with stops and riders' })
  getRoute(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.transport.getRoute(this.school(schoolId), id);
  }

  @Post('routes')
  @RequirePermissions(PERMISSIONS.TRANSPORT_MANAGE)
  @ResponseMessage('Route created')
  @ApiOperation({ summary: 'Create a route with its stops' })
  createRoute(@CurrentSchool() schoolId: string | null, @Body() dto: CreateRouteDto) {
    return this.transport.createRoute(this.school(schoolId), dto);
  }

  @Patch('routes/:id/stops')
  @RequirePermissions(PERMISSIONS.TRANSPORT_MANAGE)
  @ResponseMessage('Stops updated')
  @ApiOperation({ summary: 'Replace the stop list, refusing to orphan riders' })
  updateStops(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRouteStopsDto,
  ) {
    return this.transport.updateStops(this.school(schoolId), id, dto);
  }

  @Delete('routes/:id')
  @RequirePermissions(PERMISSIONS.TRANSPORT_MANAGE)
  @ResponseMessage('Route deactivated')
  @ApiOperation({ summary: 'Deactivate a route with no riders' })
  removeRoute(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.transport.removeRoute(this.school(schoolId), id);
  }

  // --- Assignment -----------------------------------------------------------

  @Post('assignments')
  @RequirePermissions(PERMISSIONS.TRANSPORT_ASSIGN)
  @ResponseMessage('Student assigned to transport')
  @ApiOperation({ summary: 'Assign a student to a route, enforcing seat capacity' })
  assign(@CurrentSchool() schoolId: string | null, @Body() dto: AssignTransportDto) {
    return this.transport.assignStudent(this.school(schoolId), dto);
  }

  @Delete('assignments/:studentId')
  @RequirePermissions(PERMISSIONS.TRANSPORT_ASSIGN)
  @ResponseMessage('Student removed from transport')
  @ApiOperation({ summary: 'Remove a student from transport' })
  unassign(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.transport.unassignStudent(this.school(schoolId), studentId, academicYearId);
  }

  @Get('students/:studentId')
  @RequireAnyPermission(PERMISSIONS.TRANSPORT_VIEW, PERMISSIONS.SELF_TRANSPORT_VIEW)
  @ApiOperation({ summary: 'Bus, driver, stop and timings for one student' })
  async forStudent(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.transport.forStudent(this.school(schoolId), studentId);
  }

  // --- Tracking -------------------------------------------------------------

  @Post('vehicles/:id/position')
  @RequirePermissions(PERMISSIONS.TRANSPORT_TRACK)
  @ResponseMessage('Position recorded')
  @ApiOperation({ summary: 'Record a GPS ping and broadcast it to watchers' })
  recordPosition(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VehiclePositionDto,
  ) {
    return this.transport.recordPosition(this.school(schoolId), id, dto);
  }

  @Get('vehicles/:id/position')
  @RequireAnyPermission(PERMISSIONS.TRANSPORT_TRACK, PERMISSIONS.SELF_TRANSPORT_VIEW)
  @ApiOperation({ summary: 'Latest known position, flagged when stale' })
  latestPosition(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transport.latestPosition(this.school(schoolId), id);
  }

  // --------------------------------------------------------------------------

  private async assertStudentAccess(user: AuthenticatedUser, studentId: string): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.TRANSPORT_VIEW)) return;
    if (user.studentId === studentId) return;
    if (user.guardianId) {
      await this.guardians.assertChildAccess(user.guardianId, studentId);
      return;
    }
    throw new ForbiddenError('You do not have access to this student');
  }

  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError(
        'Select a school first. Super administrators must pass the X-School-Id header.',
      );
    }
    return schoolId;
  }
}
