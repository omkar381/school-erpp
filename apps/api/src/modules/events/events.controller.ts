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
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  Public,
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import { EventsService } from './events.service';
import {
  CreateEventDto,
  EventQueryDto,
  MarkAttendanceDto,
  RegisterForEventDto,
  UpdateEventDto,
} from './dto/event.dto';

@ApiTags('Events')
@ApiSchoolHeader()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Public()
  @Get('public/:schoolSlug')
  @ApiOperation({ summary: 'Public upcoming events for the school website' })
  publicEvents(@Param('schoolSlug') schoolSlug: string) {
    return this.events.publicEvents(schoolSlug);
  }

  @Get()
  @ApiBearerAuth()
  @RequireModule(MODULES.EVENTS)
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  @ApiOperation({ summary: 'List events with registration status' })
  findAll(@CurrentSchool() schoolId: string | null, @Query() query: EventQueryDto) {
    return this.events.findAll(this.school(schoolId), query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @RequireModule(MODULES.EVENTS)
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  @ApiOperation({ summary: 'Event detail with registrations' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.findOne(this.school(schoolId), id);
  }

  @Post()
  @ApiBearerAuth()
  @RequireModule(MODULES.EVENTS)
  @RequirePermissions(PERMISSIONS.EVENTS_CREATE)
  @ResponseMessage('Event created')
  @ApiOperation({ summary: 'Create an event' })
  create(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateEventDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.events.create(this.school(schoolId), dto, userId);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @RequireModule(MODULES.EVENTS)
  @RequirePermissions(PERMISSIONS.EVENTS_UPDATE)
  @ResponseMessage('Event updated')
  @ApiOperation({ summary: 'Update or publish an event' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.events.update(this.school(schoolId), id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @RequireModule(MODULES.EVENTS)
  @RequirePermissions(PERMISSIONS.EVENTS_DELETE)
  @ResponseMessage('Event removed')
  @ApiOperation({ summary: 'Remove an event' })
  remove(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.remove(this.school(schoolId), id);
  }

  @Post(':id/register')
  @ApiBearerAuth()
  @RequireModule(MODULES.EVENTS)
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  @ResponseMessage('Registered for the event')
  @ApiOperation({ summary: 'Register a student, waitlisting past capacity' })
  register(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterForEventDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.events.register(this.school(schoolId), id, dto, userId);
  }

  @Delete(':id/register/:studentId')
  @ApiBearerAuth()
  @RequireModule(MODULES.EVENTS)
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  @ResponseMessage('Registration cancelled')
  @ApiOperation({ summary: 'Cancel a registration and promote from the waitlist' })
  cancelRegistration(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.events.cancelRegistration(this.school(schoolId), id, studentId);
  }

  @Post(':id/attendance')
  @ApiBearerAuth()
  @RequireModule(MODULES.EVENTS)
  @RequirePermissions(PERMISSIONS.EVENTS_UPDATE)
  @ResponseMessage('Attendance recorded')
  @ApiOperation({ summary: 'Mark students as having attended' })
  markAttendance(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkAttendanceDto,
  ) {
    return this.events.markAttendance(this.school(schoolId), id, dto.studentIds);
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
