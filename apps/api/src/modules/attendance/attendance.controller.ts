import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendanceSessionType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
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
import { AttendanceService } from './attendance.service';
import {
  AttendanceQueryDto,
  AttendanceReportQueryDto,
  MarkAttendanceDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

class RegisterQueryDto {
  @IsUUID('4')
  sectionId!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsEnum(AttendanceSessionType)
  sessionType?: AttendanceSessionType;

  @IsOptional()
  @IsUUID('4')
  subjectId?: string;
}

class DateQueryDto {
  @IsDateString()
  date!: string;
}

class OptionalDateQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}

class StudentHistoryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

@ApiTags('Attendance')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.ATTENDANCE)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('register')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Attendance register for a section on a date' })
  register(@CurrentSchool() schoolId: string | null, @Query() query: RegisterQueryDto) {
    return this.attendance.register(
      this.school(schoolId),
      query.sectionId,
      query.date,
      query.sessionType ?? AttendanceSessionType.DAILY,
      query.subjectId,
    );
  }

  @Get('overview')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'School-wide attendance overview for a date' })
  overview(@CurrentSchool() schoolId: string | null, @Query() query: DateQueryDto) {
    return this.attendance.dailyOverview(this.school(schoolId), query.date);
  }

  @Get('pending')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Sections whose attendance has not been marked yet' })
  pending(@CurrentSchool() schoolId: string | null, @Query() query: OptionalDateQueryDto) {
    return this.attendance.pendingSections(this.school(schoolId), query.date);
  }

  @Get('reports/low-attendance')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_REPORTS)
  @ApiOperation({ summary: 'Students below the minimum attendance threshold' })
  lowAttendance(
    @CurrentSchool() schoolId: string | null,
    @Query() query: AttendanceReportQueryDto,
  ) {
    return this.attendance.lowAttendanceReport(this.school(schoolId), query);
  }

  @Get('students/:studentId')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Attendance history and percentage for one student' })
  studentSummary(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: StudentHistoryQueryDto,
  ) {
    return this.attendance.studentSummary(
      this.school(schoolId),
      studentId,
      query.from,
      query.to,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Search attendance records' })
  findAll(@CurrentSchool() schoolId: string | null, @Query() query: AttendanceQueryDto) {
    return this.attendance.findAll(this.school(schoolId), query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MARK)
  @ResponseMessage('Attendance saved')
  @ApiOperation({ summary: 'Mark or re-mark attendance for a section' })
  mark(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.mark(this.school(schoolId), dto, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_EDIT)
  @ResponseMessage('Attendance record updated')
  @ApiOperation({ summary: 'Correct a single attendance record' })
  updateOne(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.updateOne(this.school(schoolId), id, dto, user);
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
