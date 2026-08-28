import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType } from '@prisma/client';
import {
  CurrentUser,
  RequirePermissions,
  RequireRoles,
  SkipTenantCheck,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SupportService } from './support.service';
import {
  AssignTicketDto,
  ReplyTicketDto,
  TicketQueryDto,
  TicketStatsQueryDto,
  UpdateTicketDto,
} from './dto/support.dto';

/**
 * The platform's support queue, across every school.
 *
 * Same service, same authorisation rules — the only difference is that these
 * routes run without a tenant, which is why they are locked to the super admin
 * role as well as the support permission.
 */
@ApiTags('Platform support')
@ApiBearerAuth()
@RequireRoles(RoleType.SUPER_ADMIN)
@SkipTenantCheck()
@Controller('platform/support')
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_VIEW)
  @ApiOperation({ summary: 'Open, pending, urgent and resolved counts across the platform' })
  statistics(@CurrentUser() user: AuthenticatedUser, @Query() query: TicketStatsQueryDto) {
    return this.support.statistics(null, user, query);
  }

  @Get('agents')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_MANAGE)
  @ApiOperation({ summary: 'Platform support staff a ticket can be assigned to' })
  agents(@CurrentUser() user: AuthenticatedUser) {
    return this.support.agents(null, user);
  }

  @Get('tickets')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_VIEW)
  @ApiOperation({ summary: 'Every ticket, filterable by school, status, priority and assignee' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: TicketQueryDto) {
    return this.support.findAll(null, user, query);
  }

  @Get('tickets/:id')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_VIEW)
  @ApiOperation({ summary: 'One ticket with its full conversation, notes and history' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.findOne(null, user, id);
  }

  @Post('tickets/:id/replies')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_MANAGE)
  @ResponseMessage('Reply added')
  @ApiOperation({ summary: 'Reply to the requester, or add an internal note' })
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyTicketDto,
  ) {
    return this.support.reply(null, user, id, dto);
  }

  @Patch('tickets/:id')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_MANAGE)
  @ResponseMessage('Ticket updated')
  @ApiOperation({ summary: 'Change status, priority or category' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.support.update(null, user, id, dto);
  }

  @Patch('tickets/:id/assignee')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_MANAGE)
  @ResponseMessage('Ticket assigned')
  @ApiOperation({ summary: 'Assign the ticket to a member of the support team' })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.support.assign(null, user, id, dto);
  }
}
