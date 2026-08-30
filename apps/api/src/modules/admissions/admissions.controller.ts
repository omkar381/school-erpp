import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { AdmissionsService } from './admissions.service';
import {
  AssignEnquiryDto,
  ConvertEnquiryDto,
  CreateEnquiryDto,
  EnquiryQueryDto,
  UpdateEnquiryDto,
  UpdateEnquiryStatusDto,
} from './dto/admissions.dto';

@ApiTags('Admissions')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.ADMISSIONS)
@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_VIEW)
  @ApiOperation({ summary: 'Enquiry funnel, conversion rate and overdue follow-ups' })
  statistics(@CurrentSchool() schoolId: string | null) {
    return this.admissions.statistics(this.school(schoolId));
  }

  @Get('enquiries')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_VIEW)
  @ApiOperation({ summary: 'Search the admission pipeline' })
  list(@CurrentSchool() schoolId: string | null, @Query() query: EnquiryQueryDto) {
    return this.admissions.list(this.school(schoolId), query);
  }

  @Get('enquiries/:id')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_VIEW)
  @ApiOperation({ summary: 'Enquiry detail with attachments and allowed next steps' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.admissions.findOne(this.school(schoolId), id);
  }

  @Post('enquiries')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Enquiry recorded')
  @ApiOperation({ summary: 'Record a walk-in, phone or referral enquiry' })
  create(@CurrentSchool() schoolId: string | null, @Body() dto: CreateEnquiryDto) {
    return this.admissions.create(this.school(schoolId), dto);
  }

  @Patch('enquiries/:id')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Enquiry updated')
  @ApiOperation({ summary: 'Correct the details captured on an enquiry' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnquiryDto,
  ) {
    return this.admissions.update(this.school(schoolId), id, dto);
  }

  @Patch('enquiries/:id/status')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Enquiry updated')
  @ApiOperation({ summary: 'Move an enquiry along the pipeline' })
  updateStatus(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnquiryStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admissions.updateStatus(this.school(schoolId), id, dto, user.id);
  }

  @Patch('enquiries/:id/assignee')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Enquiry reassigned')
  @ApiOperation({ summary: 'Hand an enquiry to a member of the admissions team' })
  assign(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignEnquiryDto,
  ) {
    return this.admissions.assign(this.school(schoolId), id, dto);
  }

  @Post('enquiries/:id/convert')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_CONVERT)
  @ResponseMessage('Student admitted')
  @ApiOperation({ summary: 'Admit the applicant, creating the student and enrolment' })
  convert(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertEnquiryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admissions.convert(this.school(schoolId), id, dto, user.id);
  }

  /** Admissions are always a school-level concern; there is no platform view. */
  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError('Select a school before working with admissions.');
    }
    return schoolId;
  }
}
