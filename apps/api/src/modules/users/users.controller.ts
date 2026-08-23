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
import { UsersService } from './users.service';
import {
  AdminResetPasswordDto,
  CreateUserDto,
  SetUserStatusDto,
  UpdateProfileDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';

@ApiTags('Users')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Full profile of the signed-in user, including school branding' })
  me(@CurrentUser('id') userId: string) {
    return this.users.getProfile(userId);
  }

  @Patch('me')
  @ResponseMessage('Profile updated')
  @ApiOperation({ summary: 'Update your own profile' })
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(userId, dto);
  }

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  @ApiOperation({ summary: 'User counts by status and role' })
  statistics(@CurrentSchool() schoolId: string | null) {
    return this.users.statistics(this.requireSchool(schoolId));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  @ApiOperation({ summary: 'List user accounts in this school' })
  findAll(@CurrentSchool() schoolId: string | null, @Query() query: UserQueryDto) {
    return this.users.findAll(this.requireSchool(schoolId), query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  @ApiOperation({ summary: 'Get one user account' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(this.requireSchool(schoolId), id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_CREATE)
  @ResponseMessage('User account created')
  @ApiOperation({ summary: 'Create a user account and assign roles' })
  create(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateUserDto,
    @CurrentUser('id') actingUserId: string,
  ) {
    return this.users.create(this.requireSchool(schoolId), dto, actingUserId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ResponseMessage('User updated')
  @ApiOperation({ summary: 'Update a user account' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(this.requireSchool(schoolId), id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ResponseMessage('Account status updated')
  @ApiOperation({ summary: 'Activate, deactivate or suspend an account' })
  setStatus(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserStatusDto,
  ) {
    return this.users.setStatus(this.requireSchool(schoolId), id, dto.status, dto.reason);
  }

  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.USERS_RESET_PASSWORD)
  @ResponseMessage('Password reset')
  @ApiOperation({ summary: 'Issue a temporary password and end all sessions' })
  resetPassword(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminResetPasswordDto,
  ) {
    return this.users.resetPassword(this.requireSchool(schoolId), id, dto.notify !== false);
  }

  @Post(':id/unlock')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ResponseMessage('Account unlocked')
  @ApiOperation({ summary: 'Clear a lockout caused by failed sign-in attempts' })
  unlock(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.unlock(this.requireSchool(schoolId), id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.USERS_DELETE)
  @ResponseMessage('User deleted')
  @ApiOperation({ summary: 'Soft-delete a user account' })
  remove(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actingUserId: string,
  ) {
    return this.users.remove(this.requireSchool(schoolId), id, actingUserId);
  }

  private requireSchool(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError(
        'Select a school first. Super administrators must pass the X-School-Id header.',
      );
    }
    return schoolId;
  }
}
