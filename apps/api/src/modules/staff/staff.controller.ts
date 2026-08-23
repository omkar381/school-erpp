import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
import { StaffService } from './staff.service';
import { StaffAttendanceService } from './staff-attendance.service';
import {
  ChangeEmploymentStatusDto,
  CreateStaffDto,
  StaffQueryDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import {
  CheckInDto,
  CheckOutDto,
  MarkStaffAttendanceDto,
  StaffAttendanceQueryDto,
} from './dto/staff-attendance.dto';

class RegisterQuery {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsUUID('4')
  departmentId?: string;
}

class HistoryQuery {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

class TeacherListQuery {
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;
}

@ApiTags('Staff')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.STAFF)
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly attendance: StaffAttendanceService,
  ) {}

  // --- Self-service ---------------------------------------------------------

  @Get('me')
  @ApiOperation({ summary: "The signed-in staff member's own profile" })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.staff.myProfile(this.school(user.schoolId), this.staffId(user));
  }

  @Get('me/attendance/today')
  @RequirePermissions(PERMISSIONS.STAFF_ATTENDANCE_VIEW)
  @ApiOperation({ summary: "Today's check-in state for the signed-in staff member" })
  myToday(@CurrentUser() user: AuthenticatedUser) {
    return this.attendance.myToday(this.school(user.schoolId), this.staffId(user));
  }

  @Post('me/attendance/check-in')
  @RequirePermissions(PERMISSIONS.STAFF_ATTENDANCE_MARK)
  @ResponseMessage('Checked in')
  @ApiOperation({ summary: 'Record your own arrival' })
  checkIn(@CurrentUser() user: AuthenticatedUser, @Body() dto: CheckInDto) {
    return this.attendance.checkIn(this.school(user.schoolId), this.staffId(user), dto);
  }

  @Post('me/attendance/check-out')
  @RequirePermissions(PERMISSIONS.STAFF_ATTENDANCE_MARK)
  @ResponseMessage('Checked out')
  @ApiOperation({ summary: 'Record your own departure' })
  checkOut(@CurrentUser() user: AuthenticatedUser, @Body() dto: CheckOutDto) {
    return this.attendance.checkOut(this.school(user.schoolId), this.staffId(user), dto);
  }

  @Get('me/attendance/history')
  @RequirePermissions(PERMISSIONS.STAFF_ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Your own attendance history' })
  myHistory(@CurrentUser() user: AuthenticatedUser, @Query() query: HistoryQuery) {
    return this.attendance.history(
      this.school(user.schoolId),
      this.staffId(user),
      query.from,
      query.to,
    );
  }

  // --- Directory ------------------------------------------------------------

  @Get('teachers')
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({ summary: 'Teachers available for assignment' })
  teachers(@CurrentSchool() schoolId: string | null, @Query() query: TeacherListQuery) {
    return this.staff.listTeachers(this.school(schoolId), query.subjectId);
  }

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({ summary: 'Staff counts by status and department' })
  statistics(@CurrentSchool() schoolId: string | null) {
    return this.staff.statistics(this.school(schoolId));
  }

  // --- Attendance administration -------------------------------------------

  @Get('attendance')
  @RequirePermissions(PERMISSIONS.STAFF_ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Search staff attendance records' })
  listAttendance(
    @CurrentSchool() schoolId: string | null,
    @Query() query: StaffAttendanceQueryDto,
  ) {
    return this.attendance.findAll(this.school(schoolId), query);
  }

  @Get('attendance/register')
  @RequirePermissions(PERMISSIONS.STAFF_ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Daily attendance register for all staff' })
  register(@CurrentSchool() schoolId: string | null, @Query() query: RegisterQuery) {
    return this.attendance.dailyRegister(this.school(schoolId), query.date, query.departmentId);
  }

  @Get('attendance/monthly/:year/:month')
  @RequirePermissions(PERMISSIONS.STAFF_ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Monthly attendance summary, suitable for payroll' })
  monthly(
    @CurrentSchool() schoolId: string | null,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Query('staffId') staffId?: string,
  ) {
    return this.attendance.monthlySummary(this.school(schoolId), year, month, staffId);
  }

  @Post('attendance')
  @RequirePermissions(PERMISSIONS.STAFF_ATTENDANCE_EDIT)
  @ResponseMessage('Staff attendance recorded')
  @ApiOperation({ summary: 'Record or correct staff attendance for a date' })
  markAttendance(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: MarkStaffAttendanceDto,
    @CurrentUser('id') actingUserId: string,
  ) {
    return this.attendance.mark(this.school(schoolId), dto, actingUserId);
  }

  @Get(':id/attendance')
  @RequirePermissions(PERMISSIONS.STAFF_ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Attendance history for one staff member' })
  staffHistory(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: HistoryQuery,
  ) {
    return this.attendance.history(this.school(schoolId), id, query.from, query.to);
  }

  // --- CRUD -----------------------------------------------------------------

  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({ summary: 'List staff members' })
  findAll(@CurrentSchool() schoolId: string | null, @Query() query: StaffQueryDto) {
    return this.staff.findAll(this.school(schoolId), query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({ summary: 'Full staff profile with assignments' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.findOne(this.school(schoolId), id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STAFF_CREATE)
  @ResponseMessage('Staff member added')
  @ApiOperation({ summary: 'Add a staff member and create their login' })
  create(@CurrentSchool() schoolId: string | null, @Body() dto: CreateStaffDto) {
    return this.staff.create(this.school(schoolId), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STAFF_UPDATE)
  @ResponseMessage('Staff member updated')
  @ApiOperation({ summary: 'Update a staff profile' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(this.school(schoolId), id, dto);
  }

  @Patch(':id/employment-status')
  @RequirePermissions(PERMISSIONS.STAFF_UPDATE)
  @ResponseMessage('Employment status updated')
  @ApiOperation({ summary: 'Record resignation, retirement or reinstatement' })
  changeStatus(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeEmploymentStatusDto,
  ) {
    return this.staff.changeEmploymentStatus(this.school(schoolId), id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.STAFF_DELETE)
  @ResponseMessage('Staff member removed')
  @ApiOperation({ summary: 'Soft-delete a staff member, retaining their records' })
  remove(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.remove(this.school(schoolId), id);
  }

  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError(
        'Select a school first. Super administrators must pass the X-School-Id header.',
      );
    }
    return schoolId;
  }

  private staffId(user: AuthenticatedUser): string {
    if (!user.staffId) {
      throw new ForbiddenError('This account is not linked to a staff record');
    }
    return user.staffId;
  }
}
