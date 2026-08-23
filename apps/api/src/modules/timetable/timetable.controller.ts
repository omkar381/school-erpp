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
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TimetableService } from './timetable.service';
import {
  BulkTimetableDto,
  CreatePeriodDto,
  CreateSubstitutionDto,
  UpsertSlotDto,
} from './dto/timetable.dto';

class YearQuery {
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;
}

class OptionalDateQuery {
  @IsOptional()
  @IsDateString()
  date?: string;
}

class AvailabilityQuery {
  @IsDateString()
  date!: string;

  @IsUUID('4')
  periodId!: string;
}

@ApiTags('Timetable')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.TIMETABLE)
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  // --- Periods --------------------------------------------------------------

  @Get('periods')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'List the daily period structure' })
  listPeriods(@CurrentSchool() schoolId: string | null, @Query() query: YearQuery) {
    return this.timetable.listPeriods(this.school(schoolId), query.academicYearId);
  }

  @Post('periods')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Period created')
  @ApiOperation({ summary: 'Add a period to the daily structure' })
  createPeriod(@CurrentSchool() schoolId: string | null, @Body() dto: CreatePeriodDto) {
    return this.timetable.createPeriod(this.school(schoolId), dto);
  }

  @Delete('periods/:id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Period removed')
  @ApiOperation({ summary: 'Remove an unused period' })
  removePeriod(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.timetable.removePeriod(this.school(schoolId), id);
  }

  // --- Views ----------------------------------------------------------------

  @Get('me/today')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: "The signed-in teacher's classes for a day" })
  myToday(@CurrentUser() user: AuthenticatedUser, @Query() query: OptionalDateQuery) {
    if (!user.staffId) {
      throw new ForbiddenError('This account is not linked to a staff record');
    }
    return this.timetable.todayForTeacher(this.school(user.schoolId), user.staffId, query.date);
  }

  @Get('me/week')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: "The signed-in teacher's weekly timetable" })
  myWeek(@CurrentUser() user: AuthenticatedUser, @Query() query: YearQuery) {
    if (!user.staffId) {
      throw new ForbiddenError('This account is not linked to a staff record');
    }
    return this.timetable.teacherTimetable(
      this.school(user.schoolId),
      user.staffId,
      query.academicYearId,
    );
  }

  @Get('sections/:sectionId')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Weekly timetable grid for a section' })
  sectionTimetable(
    @CurrentSchool() schoolId: string | null,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Query() query: YearQuery,
  ) {
    return this.timetable.sectionTimetable(
      this.school(schoolId),
      sectionId,
      query.academicYearId,
    );
  }

  @Get('teachers/:staffId')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Weekly timetable for a teacher' })
  teacherTimetable(
    @CurrentSchool() schoolId: string | null,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Query() query: YearQuery,
  ) {
    return this.timetable.teacherTimetable(this.school(schoolId), staffId, query.academicYearId);
  }

  @Get('rooms/:roomId')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Weekly occupancy for a room' })
  roomTimetable(
    @CurrentSchool() schoolId: string | null,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: YearQuery,
  ) {
    return this.timetable.roomTimetable(this.school(schoolId), roomId, query.academicYearId);
  }

  @Get('students/:studentId/today')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW, PERMISSIONS.SELF_TIMETABLE_VIEW)
  @ApiOperation({ summary: "A student's schedule for a day" })
  studentToday(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: OptionalDateQuery,
  ) {
    return this.timetable.todayForStudent(this.school(schoolId), studentId, query.date);
  }

  // --- Slots ----------------------------------------------------------------

  @Post('check-conflicts')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Conflict check completed')
  @ApiOperation({ summary: 'Check a slot for clashes without saving it' })
  checkConflicts(@CurrentSchool() schoolId: string | null, @Body() dto: UpsertSlotDto) {
    return this.timetable.checkConflicts(this.school(schoolId), dto);
  }

  @Post('slots')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Timetable slot saved')
  @ApiOperation({ summary: 'Create a timetable slot, rejecting any clash' })
  createSlot(@CurrentSchool() schoolId: string | null, @Body() dto: UpsertSlotDto) {
    return this.timetable.upsertSlot(this.school(schoolId), dto);
  }

  @Patch('slots/:id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Timetable slot updated')
  @ApiOperation({ summary: 'Update a timetable slot, rejecting any clash' })
  updateSlot(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertSlotDto,
  ) {
    return this.timetable.upsertSlot(this.school(schoolId), dto, id);
  }

  @Delete('slots/:id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Timetable slot removed')
  @ApiOperation({ summary: 'Remove a timetable slot' })
  removeSlot(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.timetable.removeSlot(this.school(schoolId), id);
  }

  @Post('sections/bulk')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Timetable saved')
  @ApiOperation({ summary: "Replace a section's entire weekly timetable atomically" })
  bulkUpsert(@CurrentSchool() schoolId: string | null, @Body() dto: BulkTimetableDto) {
    return this.timetable.bulkUpsert(this.school(schoolId), dto);
  }

  // --- Substitutions --------------------------------------------------------

  @Get('substitutions')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Substitutions arranged for a date' })
  listSubstitutions(
    @CurrentSchool() schoolId: string | null,
    @Query('date') date: string,
  ) {
    return this.timetable.listSubstitutions(this.school(schoolId), date);
  }

  @Get('substitutions/available-teachers')
  @RequirePermissions(PERMISSIONS.TIMETABLE_SUBSTITUTE)
  @ApiOperation({ summary: 'Teachers free to cover a given period' })
  availableTeachers(
    @CurrentSchool() schoolId: string | null,
    @Query() query: AvailabilityQuery,
  ) {
    return this.timetable.availableTeachers(this.school(schoolId), query.date, query.periodId);
  }

  @Post('substitutions')
  @RequirePermissions(PERMISSIONS.TIMETABLE_SUBSTITUTE)
  @ResponseMessage('Substitution arranged')
  @ApiOperation({ summary: 'Arrange a substitute teacher or cancel a class' })
  createSubstitution(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateSubstitutionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.timetable.createSubstitution(this.school(schoolId), dto, userId);
  }

  @Delete('substitutions/:id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_SUBSTITUTE)
  @ResponseMessage('Substitution removed')
  @ApiOperation({ summary: 'Remove a substitution' })
  removeSubstitution(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.timetable.removeSubstitution(this.school(schoolId), id);
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
