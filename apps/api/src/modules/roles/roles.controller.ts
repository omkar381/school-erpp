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
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
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
import { RolesService } from './roles.service';
import {
  AssignRolesDto,
  CreateRoleDto,
  SetRolePermissionsDto,
  SetUserPermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';

class ListPermissionsQuery {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includePlatform?: boolean;
}

@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  // --- Permission catalogue -------------------------------------------------

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  @ApiOperation({ summary: 'The permission catalogue, grouped by module' })
  listPermissions(
    @Query() query: ListPermissionsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roles.listPermissions(Boolean(query.includePlatform) && user.isSuperAdmin);
  }

  // --- Roles ----------------------------------------------------------------

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  @ApiOperation({ summary: 'List roles defined for this school' })
  listRoles(@CurrentSchool() schoolId: string | null) {
    return this.roles.listRoles(this.requireSchool(schoolId));
  }

  @Get('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  @ApiOperation({ summary: 'Get one role with its permissions' })
  getRole(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.getRole(this.requireSchool(schoolId), id);
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLES_CREATE)
  @ResponseMessage('Role created')
  @ApiOperation({ summary: 'Create a custom role' })
  createRole(@CurrentSchool() schoolId: string | null, @Body() dto: CreateRoleDto) {
    return this.roles.createRole(this.requireSchool(schoolId), dto);
  }

  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_UPDATE)
  @ResponseMessage('Role updated')
  @ApiOperation({ summary: 'Rename a role or change its description' })
  updateRole(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.updateRole(this.requireSchool(schoolId), id, dto);
  }

  @Patch('roles/:id/permissions')
  @RequirePermissions(PERMISSIONS.PERMISSIONS_ASSIGN)
  @ResponseMessage('Role permissions updated')
  @ApiOperation({ summary: "Replace a role's permission set" })
  setRolePermissions(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.roles.setRolePermissions(this.requireSchool(schoolId), id, dto);
  }

  @Post('roles/:id/reset')
  @RequirePermissions(PERMISSIONS.PERMISSIONS_ASSIGN)
  @ResponseMessage('Role reset to default permissions')
  @ApiOperation({ summary: 'Restore a role to its factory permission set' })
  resetRole(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.resetRoleToDefaults(this.requireSchool(schoolId), id);
  }

  @Delete('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_DELETE)
  @ResponseMessage('Role deleted')
  @ApiOperation({ summary: 'Delete a custom role that has no users' })
  deleteRole(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.deleteRole(this.requireSchool(schoolId), id);
  }

  // --- User assignments -----------------------------------------------------

  @Get('users/:userId/permissions')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  @ApiOperation({ summary: 'Effective permissions for a user and where they come from' })
  getUserPermissions(
    @CurrentSchool() schoolId: string | null,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.roles.getUserPermissions(this.requireSchool(schoolId), userId);
  }

  @Patch('users/:userId/roles')
  @RequirePermissions(PERMISSIONS.PERMISSIONS_ASSIGN)
  @ResponseMessage('User roles updated')
  @ApiOperation({ summary: "Replace a user's roles" })
  assignRoles(
    @CurrentSchool() schoolId: string | null,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AssignRolesDto,
  ) {
    return this.roles.assignRoles(this.requireSchool(schoolId), userId, dto);
  }

  @Patch('users/:userId/permissions')
  @RequirePermissions(PERMISSIONS.PERMISSIONS_ASSIGN)
  @ResponseMessage('User permission overrides updated')
  @ApiOperation({ summary: 'Grant or deny individual permissions for one user' })
  setUserPermissions(
    @CurrentSchool() schoolId: string | null,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetUserPermissionsDto,
  ) {
    return this.roles.setUserPermissions(this.requireSchool(schoolId), userId, dto);
  }

  private requireSchool(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError(
        'Select a school before managing roles. Super administrators must pass the X-School-Id header.',
      );
    }
    return schoolId;
  }
}
