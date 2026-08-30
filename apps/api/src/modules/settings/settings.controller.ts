import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SettingsService } from './settings.service';
import { UpdateSequencesDto } from './dto/settings.dto';

/**
 * School configuration that has no other home.
 *
 * Editing the school record itself, its branding and its module switches lives
 * on `/schools/current/*`; this controller owns the settings screen's combined
 * read and the document numbering nobody else configures.
 */
@ApiTags('Settings')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  @ApiOperation({ summary: 'School, modules, numbering and setup progress in one call' })
  overview(@CurrentSchool() schoolId: string | null) {
    return this.settings.overview(this.school(schoolId));
  }

  @Get('sequences')
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  @ApiOperation({ summary: 'Document numbering for invoices, receipts and the rest' })
  sequences(@CurrentSchool() schoolId: string | null) {
    return this.settings.listSequences(this.school(schoolId));
  }

  @Patch('sequences')
  @RequirePermissions(PERMISSIONS.SCHOOL_SETTINGS_UPDATE)
  @ResponseMessage('Document numbering updated')
  @ApiOperation({ summary: 'Set the prefix, padding and next number for a counter' })
  updateSequences(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: UpdateSequencesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.updateSequences(this.school(schoolId), dto, user.id);
  }

  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError('Select a school to view its settings.');
    }
    return schoolId;
  }
}
