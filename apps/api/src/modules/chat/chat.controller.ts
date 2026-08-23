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
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ChatService } from './chat.service';
import {
  CreateConversationDto,
  LockConversationDto,
  MessageQueryDto,
  ReportMessageDto,
  SendMessageDto,
} from './dto/chat.dto';

@ApiTags('Messaging')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.CHAT)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('contacts')
  @RequirePermissions(PERMISSIONS.MESSAGES_SEND)
  @ApiOperation({ summary: 'People the signed-in user may start a conversation with' })
  contacts(@CurrentUser() user: AuthenticatedUser, @Query('search') search?: string) {
    return this.chat.contactsFor(this.school(user.schoolId), user, search);
  }

  @Get('conversations')
  @RequirePermissions(PERMISSIONS.MESSAGES_VIEW)
  @ApiOperation({ summary: 'Conversations with unread counts and presence' })
  listConversations(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.chat.listConversations(this.school(user.schoolId), user.id, query);
  }

  @Post('conversations')
  @RequirePermissions(PERMISSIONS.MESSAGES_SEND)
  @ResponseMessage('Conversation ready')
  @ApiOperation({ summary: 'Open a conversation, reusing an existing direct thread' })
  createConversation(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chat.createConversation(this.school(schoolId), dto, user);
  }

  @Get('conversations/:id')
  @RequirePermissions(PERMISSIONS.MESSAGES_VIEW)
  @ApiOperation({ summary: 'Conversation detail with participants' })
  getConversation(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chat.getConversation(this.school(schoolId), id, userId);
  }

  @Get('conversations/:id/messages')
  @RequirePermissions(PERMISSIONS.MESSAGES_VIEW)
  @ApiOperation({ summary: 'Message history, newest page first' })
  listMessages(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Query() query: MessageQueryDto,
  ) {
    return this.chat.listMessages(this.school(schoolId), id, userId, query);
  }

  @Post('conversations/:id/messages')
  @RequirePermissions(PERMISSIONS.MESSAGES_SEND)
  @ResponseMessage('Message sent')
  @ApiOperation({ summary: 'Send a message; de-duplicated by clientRef' })
  sendMessage(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chat.sendMessage(this.school(schoolId), id, dto, user);
  }

  @Post('conversations/:id/read')
  @RequirePermissions(PERMISSIONS.MESSAGES_VIEW)
  @ResponseMessage('Conversation marked as read')
  @ApiOperation({ summary: 'Clear the unread count and send read receipts' })
  markRead(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chat.markRead(this.school(schoolId), id, userId);
  }

  @Delete('messages/:id')
  @RequirePermissions(PERMISSIONS.MESSAGES_SEND)
  @ResponseMessage('Message deleted')
  @ApiOperation({ summary: 'Delete your own message, or any message as a moderator' })
  deleteMessage(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chat.deleteMessage(this.school(schoolId), id, user);
  }

  @Post('messages/:id/report')
  @RequirePermissions(PERMISSIONS.MESSAGES_VIEW)
  @ResponseMessage('Message reported')
  @ApiOperation({ summary: 'Flag a message for moderator review' })
  reportMessage(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chat.reportMessage(this.school(schoolId), id, dto, user);
  }

  // --- Moderation -----------------------------------------------------------

  @Get('moderation/flagged')
  @RequirePermissions(PERMISSIONS.MESSAGES_MODERATE)
  @ApiOperation({ summary: 'Messages awaiting moderator review' })
  listFlagged(@CurrentSchool() schoolId: string | null, @Query() query: PaginationQueryDto) {
    return this.chat.listFlagged(this.school(schoolId), query);
  }

  @Patch('conversations/:id/lock')
  @RequirePermissions(PERMISSIONS.MESSAGES_MODERATE)
  @ResponseMessage('Conversation updated')
  @ApiOperation({ summary: 'Close or reopen a conversation to new messages' })
  lockConversation(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LockConversationDto,
  ) {
    return this.chat.setConversationLocked(this.school(schoolId), id, dto.locked);
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
