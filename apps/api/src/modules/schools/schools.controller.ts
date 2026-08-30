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
import { SchoolStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import { SchoolsService } from './schools.service';
import {
  CreateSchoolDto,
  SchoolQueryDto,
  SchoolTimingsDto,
  UpdateBrandingDto,
  UpdateModulesDto,
  UpdateSchoolDto,
  UpdateSettingsDto,
} from './dto/school.dto';

class SetStatusDto {
  @IsEnum(SchoolStatus)
  status!: SchoolStatus;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class OnboardingStepDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  step!: number;
}

@ApiTags('Schools')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('schools')
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_CREATE)
  @ResponseMessage('School created successfully')
  @ApiOperation({ summary: 'Provision a new school with roles, admin and academic year' })
  create(@Body() dto: CreateSchoolDto, @CurrentUser('id') userId: string) {
    return this.schools.create(dto, userId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_VIEW)
  @ApiOperation({ summary: 'List all schools on the platform' })
  findAll(@Query() query: SchoolQueryDto) {
    return this.schools.findAll(query);
  }

  @Get('current')
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  @ApiOperation({ summary: "Get the signed-in user's own school" })
  current(@CurrentSchool() schoolId: string | null) {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return this.schools.findOne(schoolId);
  }

  /**
   * Readable by anyone signed in, including parents and students.
   *
   * The app shell needs the branding, the currency and the enabled modules on
   * every page; gating that behind `school.view` left every non-staff user
   * with an empty module map and a sidebar missing most of its links.
   */
  @Get('current/context')
  @ApiOperation({ summary: "Branding, currency and enabled modules for the caller's school" })
  currentContext(@CurrentSchool() schoolId: string | null) {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return this.schools.currentContext(schoolId);
  }

  @Get('current/settings')
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  @ApiOperation({ summary: 'Get school settings, modules and locale configuration' })
  currentSettings(@CurrentSchool() schoolId: string | null) {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return this.schools.getSettings(schoolId);
  }

  @Public()
  @Get('by-slug/:slug')
  @ApiOperation({ summary: 'Public school profile for the marketing website' })
  bySlug(@Param('slug') slug: string) {
    return this.schools.findBySlug(slug);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_VIEW)
  @ApiOperation({ summary: 'Get one school by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.findOne(id);
  }

  @Patch('current')
  @RequirePermissions(PERMISSIONS.SCHOOL_UPDATE)
  @ResponseMessage('School profile updated')
  @ApiOperation({ summary: "Update the signed-in user's school profile" })
  updateCurrent(@CurrentSchool() schoolId: string | null, @Body() dto: UpdateSchoolDto) {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return this.schools.update(schoolId, dto);
  }

  @Patch('current/branding')
  @RequirePermissions(PERMISSIONS.SCHOOL_BRANDING_UPDATE)
  @ResponseMessage('Branding updated')
  @ApiOperation({ summary: 'Update logo, colours and document branding' })
  updateBranding(@CurrentSchool() schoolId: string | null, @Body() dto: UpdateBrandingDto) {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return this.schools.updateBranding(schoolId, dto);
  }

  @Patch('current/modules')
  @RequirePermissions(PERMISSIONS.SCHOOL_MODULES_MANAGE)
  @ResponseMessage('Modules updated')
  @ApiOperation({ summary: 'Enable or disable feature modules within the plan limits' })
  updateModules(@CurrentSchool() schoolId: string | null, @Body() dto: UpdateModulesDto) {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return this.schools.updateModules(schoolId, dto);
  }

  @Patch('current/settings')
  @RequirePermissions(PERMISSIONS.SCHOOL_SETTINGS_UPDATE)
  @ResponseMessage('Settings updated')
  @ApiOperation({ summary: 'Merge a partial settings object into the school settings' })
  updateSettings(@CurrentSchool() schoolId: string | null, @Body() dto: UpdateSettingsDto) {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return this.schools.updateSettings(schoolId, dto);
  }

  @Patch('current/timings')
  @RequirePermissions(PERMISSIONS.SCHOOL_SETTINGS_UPDATE)
  @ResponseMessage('School timings updated')
  @ApiOperation({ summary: 'Set school hours and working days' })
  updateTimings(@CurrentSchool() schoolId: string | null, @Body() dto: SchoolTimingsDto) {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return this.schools.updateTimings(schoolId, dto);
  }

  @Patch('current/onboarding')
  @RequirePermissions(PERMISSIONS.SCHOOL_UPDATE)
  @ResponseMessage('Onboarding progress saved')
  @ApiOperation({ summary: 'Record progress through the onboarding wizard' })
  onboarding(@CurrentSchool() schoolId: string | null, @Body() dto: OnboardingStepDto) {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return this.schools.completeOnboardingStep(schoolId, dto.step);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_UPDATE)
  @ResponseMessage('School updated')
  @ApiOperation({ summary: 'Update any school (platform administrators)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSchoolDto) {
    return this.schools.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_SUSPEND)
  @ResponseMessage('School status updated')
  @ApiOperation({ summary: 'Activate, suspend or archive a school' })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStatusDto) {
    return this.schools.setStatus(id, dto.status, dto.reason);
  }

  @Patch(':id/modules')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_UPDATE)
  @ResponseMessage('Modules updated')
  @ApiOperation({ summary: "Override a school's modules, ignoring plan limits" })
  overrideModules(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModulesDto) {
    return this.schools.updateModules(id, dto, false);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_DELETE)
  @ResponseMessage('School archived')
  @ApiOperation({ summary: 'Archive a school and revoke every active session' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.remove(id);
  }
}
