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
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { NoticesService } from './notices.service';
import { CreateNoticeDto, NoticeQueryDto, UpdateNoticeDto } from './dto/notice.dto';

@ApiTags('Notices')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.COMMUNICATION)
@Controller('notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get('feed')
  @RequirePermissions(PERMISSIONS.NOTICES_VIEW)
  @ApiOperation({ summary: 'The notice board as the signed-in user sees it' })
  feed(@CurrentUser() user: AuthenticatedUser, @Query() query: NoticeQueryDto) {
    return this.notices.feedFor(this.school(user.schoolId), user, query);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.NOTICES_CREATE)
  @ApiOperation({ summary: 'Manage view: every notice including drafts' })
  findAll(@CurrentSchool() schoolId: string | null, @Query() query: NoticeQueryDto) {
    return this.notices.findAll(this.school(schoolId), query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.NOTICES_VIEW)
  @ApiOperation({ summary: 'Notice detail with attachments and readers' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.notices.findOne(this.school(schoolId), id);
  }

  @Get(':id/read-report')
  @RequirePermissions(PERMISSIONS.NOTICES_CREATE)
  @ApiOperation({ summary: 'Who has and has not read a notice' })
  readReport(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.notices.readReport(this.school(schoolId), id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.NOTICES_CREATE)
  @ResponseMessage('Notice created')
  @ApiOperation({ summary: 'Create a notice, circular or announcement' })
  create(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateNoticeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.create(this.school(schoolId), dto, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.NOTICES_UPDATE)
  @ResponseMessage('Notice updated')
  @ApiOperation({ summary: 'Update a notice' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoticeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.update(this.school(schoolId), id, dto, user);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.NOTICES_PUBLISH)
  @ResponseMessage('Notice published')
  @ApiOperation({ summary: 'Publish a notice and notify its audience' })
  publish(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.publish(this.school(schoolId), id, user);
  }

  @Post(':id/read')
  @RequirePermissions(PERMISSIONS.NOTICES_VIEW)
  @ResponseMessage('Notice marked as read')
  @ApiOperation({ summary: 'Record that the signed-in user has read a notice' })
  markRead(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notices.markRead(userId, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.NOTICES_DELETE)
  @ResponseMessage('Notice removed')
  @ApiOperation({ summary: 'Remove a notice' })
  remove(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.remove(this.school(schoolId), id, user);
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
