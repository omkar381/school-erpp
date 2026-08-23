import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiSchoolHeader, CurrentSchool, RequirePermissions } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AuditService } from './audit.service';

class AuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  module?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  entity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

@ApiTags('Audit Logs')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_LOGS_VIEW)
  @ApiOperation({ summary: 'Search the audit trail' })
  list(@CurrentSchool() schoolId: string | null, @Query() query: AuditQueryDto) {
    return this.audit.findMany(schoolId, query);
  }

  @Get('entity/:entity/:entityId')
  @RequirePermissions(PERMISSIONS.AUDIT_LOGS_VIEW)
  @ApiOperation({ summary: 'Full change history for one record' })
  forEntity(
    @CurrentSchool() schoolId: string | null,
    @Param('entity') entity: string,
    @Param('entityId') entityId: string,
    @Query() query: AuditQueryDto,
  ) {
    query.entity = entity;
    query.entityId = entityId;
    return this.audit.findMany(schoolId, query);
  }

  @Get('user/:userId')
  @RequirePermissions(PERMISSIONS.AUDIT_LOGS_VIEW)
  @ApiOperation({ summary: 'Everything a specific user has done' })
  forUser(
    @CurrentSchool() schoolId: string | null,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: AuditQueryDto,
  ) {
    query.userId = userId;
    return this.audit.findMany(schoolId, query);
  }
}
