import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeaveApplicantType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
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
import { LeaveService } from './leave.service';
import {
  ApplyLeaveDto,
  CreateLeaveTypeDto,
  LeaveQueryDto,
  ReviewLeaveDto,
} from './dto/leave.dto';

class TypeQuery {
  @IsOptional()
  @IsEnum(LeaveApplicantType)
  applicableTo?: LeaveApplicantType;
}

@ApiTags('Leave')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.LEAVE)
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  // --- Types ----------------------------------------------------------------

  @Get('types')
  @RequirePermissions(PERMISSIONS.LEAVE_VIEW)
  @ApiOperation({ summary: 'List leave types' })
  listTypes(@CurrentSchool() schoolId: string | null, @Query() query: TypeQuery) {
    return this.leave.listTypes(this.school(schoolId), query.applicableTo);
  }

  @Post('types')
  @RequirePermissions(PERMISSIONS.LEAVE_TYPES_MANAGE)
  @ResponseMessage('Leave type created')
  @ApiOperation({ summary: 'Create a leave type' })
  createType(@CurrentSchool() schoolId: string | null, @Body() dto: CreateLeaveTypeDto) {
    return this.leave.createType(this.school(schoolId), dto);
  }

  // --- Balances -------------------------------------------------------------

  @Get('me/balances')
  @RequirePermissions(PERMISSIONS.LEAVE_VIEW)
  @ApiOperation({ summary: "The signed-in staff member's own leave balances" })
  myBalances(@CurrentUser() user: AuthenticatedUser, @Query('year') year?: string) {
    if (!user.staffId) {
      throw new ForbiddenError('This account is not linked to a staff record');
    }
    return this.leave.balancesFor(
      this.school(user.schoolId),
      user.staffId,
      year ? Number(year) : undefined,
    );
  }

  @Get('staff/:staffId/balances')
  @RequirePermissions(PERMISSIONS.LEAVE_VIEW_ALL)
  @ApiOperation({ summary: 'Leave balances for a staff member' })
  staffBalances(
    @CurrentSchool() schoolId: string | null,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Query('year') year?: string,
  ) {
    return this.leave.balancesFor(this.school(schoolId), staffId, year ? Number(year) : undefined);
  }

  @Post('balances/allocate/:year')
  @RequirePermissions(PERMISSIONS.LEAVE_TYPES_MANAGE)
  @ResponseMessage('Annual balances allocated')
  @ApiOperation({ summary: "Create the year's balances, carrying forward where allowed" })
  allocate(
    @CurrentSchool() schoolId: string | null,
    @Param('year', ParseIntPipe) year: number,
  ) {
    return this.leave.allocateAnnualBalances(this.school(schoolId), year);
  }

  // --- Requests -------------------------------------------------------------

  @Get('pending-approvals')
  @RequirePermissions(PERMISSIONS.LEAVE_APPROVE)
  @ApiOperation({ summary: 'Requests awaiting the signed-in approver' })
  pendingApprovals(@CurrentUser() user: AuthenticatedUser) {
    return this.leave.pendingApprovals(this.school(user.schoolId), user);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.LEAVE_VIEW)
  @ApiOperation({ summary: 'List leave requests visible to the signed-in user' })
  findAll(
    @CurrentSchool() schoolId: string | null,
    @Query() query: LeaveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.findAll(this.school(schoolId), query, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.LEAVE_VIEW)
  @ApiOperation({ summary: 'Leave request detail' })
  findOne(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.findOne(this.school(schoolId), id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LEAVE_APPLY)
  @ResponseMessage('Leave request submitted')
  @ApiOperation({ summary: 'Apply for leave, for yourself or for your child' })
  apply(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: ApplyLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.apply(this.school(schoolId), dto, user);
  }

  @Patch(':id/review')
  @RequirePermissions(PERMISSIONS.LEAVE_APPROVE)
  @ResponseMessage('Leave request reviewed')
  @ApiOperation({ summary: 'Approve, reject or request changes' })
  review(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.review(this.school(schoolId), id, dto, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions(PERMISSIONS.LEAVE_APPLY)
  @ResponseMessage('Leave request withdrawn')
  @ApiOperation({ summary: 'Withdraw your own leave request' })
  cancel(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.cancel(this.school(schoolId), id, user);
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
