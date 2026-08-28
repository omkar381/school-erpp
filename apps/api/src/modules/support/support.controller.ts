import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TicketPriority, TicketStatus } from '@prisma/client';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SupportService } from './support.service';
import {
  AssignTicketDto,
  CloseTicketDto,
  CreateTicketDto,
  ReplyTicketDto,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TicketQueryDto,
  TicketStatsQueryDto,
  UpdateTicketDto,
  type TicketCategory,
} from './dto/support.dto';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * The support desk, for everyone who uses it.
 *
 * Parents, students, teachers and school administrators all reach the same
 * routes; SupportService decides from the caller's identity which tickets exist
 * as far as they are concerned. Raising and reading a ticket needs only the
 * self-service permissions every portal user holds — managing one does not.
 */
@ApiTags('Support')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('categories')
  @RequireAnyPermission(
    PERMISSIONS.SUPPORT_TICKETS_VIEW,
    PERMISSIONS.SUPPORT_TICKETS_CREATE,
  )
  @ApiOperation({ summary: 'Categories and priorities the ticket form offers' })
  categories() {
    return {
      categories: TICKET_CATEGORIES.map((value) => ({
        value,
        label: TICKET_CATEGORY_LABELS[value as TicketCategory],
      })),
      priorities: [
        { value: TicketPriority.LOW, label: 'Low' },
        { value: TicketPriority.MEDIUM, label: 'Medium' },
        { value: TicketPriority.HIGH, label: 'High' },
        // The schema calls the top band CRITICAL; the product calls it urgent.
        { value: TicketPriority.CRITICAL, label: 'Urgent' },
      ],
      statuses: Object.values(TicketStatus),
    };
  }

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_VIEW)
  @ApiOperation({ summary: 'Open, pending, urgent and resolved counts for this caller' })
  statistics(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TicketStatsQueryDto,
  ) {
    return this.support.statistics(schoolId, user, query);
  }

  @Get('agents')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_MANAGE)
  @ApiOperation({ summary: 'People a ticket can be assigned to' })
  agents(@CurrentSchool() schoolId: string | null, @CurrentUser() user: AuthenticatedUser) {
    return this.support.agents(schoolId, user);
  }

  @Get('tickets')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_VIEW)
  @ApiOperation({ summary: 'Tickets this caller may see, filtered and paginated' })
  list(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TicketQueryDto,
  ) {
    return this.support.findAll(schoolId, user, query);
  }

  @Post('tickets')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_CREATE)
  @ResponseMessage('Ticket raised — our team will respond shortly')
  @ApiOperation({ summary: 'Raise a support ticket' })
  create(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTicketDto,
  ) {
    return this.support.create(schoolId, user, dto);
  }

  @Post('tickets/attachments')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_CREATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ResponseMessage('File uploaded')
  @ApiOperation({ summary: 'Upload a file, then send its id with the ticket or reply' })
  upload(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.support.uploadAttachment(schoolId, user, file);
  }

  @Get('tickets/:id')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_VIEW)
  @ApiOperation({ summary: 'One ticket with its conversation and attachments' })
  detail(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.support.findOne(schoolId, user, id);
  }

  @Post('tickets/:id/replies')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_VIEW)
  @ResponseMessage('Reply added')
  @ApiOperation({ summary: 'Reply to a ticket, or add an internal note as support staff' })
  reply(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyTicketDto,
  ) {
    return this.support.reply(schoolId, user, id, dto);
  }

  @Patch('tickets/:id')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_MANAGE)
  @ResponseMessage('Ticket updated')
  @ApiOperation({ summary: 'Change status, priority or category' })
  update(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.support.update(schoolId, user, id, dto);
  }

  @Patch('tickets/:id/assignee')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_MANAGE)
  @ResponseMessage('Ticket assigned')
  @ApiOperation({ summary: 'Assign a ticket to an agent, or clear the assignment' })
  assign(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.support.assign(schoolId, user, id, dto);
  }

  @Post('tickets/:id/close')
  @RequirePermissions(PERMISSIONS.SUPPORT_TICKETS_VIEW)
  @ResponseMessage('Ticket closed')
  @ApiOperation({ summary: 'Close a resolved ticket you raised' })
  close(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseTicketDto,
  ) {
    return this.support.close(schoolId, user, id, dto);
  }
}
