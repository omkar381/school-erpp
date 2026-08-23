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
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from './guardians.service';
import { CreateGuardianDto, GuardianQueryDto, UpdateGuardianDto } from './dto/guardian.dto';

@ApiTags('Guardians')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get('my-children')
  @RequirePermissions(PERMISSIONS.SELF_CHILDREN_VIEW)
  @ApiOperation({ summary: "A parent's own children, with today's attendance and dues" })
  myChildren(@CurrentUser() user: AuthenticatedUser) {
    if (!user.guardianId) {
      throw new ForbiddenError('This account is not linked to a guardian record');
    }
    return this.guardians.myChildren(this.school(user.schoolId), user.guardianId);
  }

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.GUARDIANS_VIEW)
  @ApiOperation({ summary: 'Guardian counts by relation and login status' })
  statistics(@CurrentSchool() schoolId: string | null) {
    return this.guardians.statistics(this.school(schoolId));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.GUARDIANS_VIEW)
  @ApiOperation({ summary: 'List guardians with their children' })
  findAll(@CurrentSchool() schoolId: string | null, @Query() query: GuardianQueryDto) {
    return this.guardians.findAll(this.school(schoolId), query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.GUARDIANS_VIEW)
  @ApiOperation({ summary: 'Full guardian profile' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.guardians.findOne(this.school(schoolId), id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GUARDIANS_CREATE)
  @ResponseMessage('Guardian created')
  @ApiOperation({ summary: 'Create a guardian and optionally a parent login' })
  create(@CurrentSchool() schoolId: string | null, @Body() dto: CreateGuardianDto) {
    return this.guardians.create(this.school(schoolId), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.GUARDIANS_UPDATE)
  @ResponseMessage('Guardian updated')
  @ApiOperation({ summary: 'Update guardian details' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuardianDto,
  ) {
    return this.guardians.update(this.school(schoolId), id, dto);
  }

  @Post(':id/create-login')
  @RequirePermissions(PERMISSIONS.GUARDIANS_UPDATE)
  @ResponseMessage('Parent login created')
  @ApiOperation({ summary: 'Create a portal login for an existing guardian' })
  createLogin(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.guardians.createLogin(this.school(schoolId), id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.GUARDIANS_DELETE)
  @ResponseMessage('Guardian deleted')
  @ApiOperation({ summary: 'Delete a guardian who is not the sole contact for any student' })
  remove(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.guardians.remove(this.school(schoolId), id);
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
