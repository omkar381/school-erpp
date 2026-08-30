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
import { ComplaintStatus } from '@prisma/client';
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
import { ComplaintsService } from './complaints.service';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_LABELS,
  ComplaintQueryDto,
  CreateComplaintDto,
  UpdateComplaintDto,
  UpdateComplaintStatusDto,
  type ComplaintCategory,
} from './dto/complaints.dto';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Grievance redressal.
 *
 * Parents, students and staff all reach the same routes; the service decides
 * from the caller's permissions whose complaints exist as far as they are
 * concerned. Raising one needs only COMPLAINTS_CREATE, which every portal user
 * holds — ruling on one needs COMPLAINTS_MANAGE.
 */
@ApiTags('Complaints')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get('categories')
  @RequireAnyPermission(PERMISSIONS.COMPLAINTS_VIEW, PERMISSIONS.COMPLAINTS_CREATE)
  @ApiOperation({ summary: 'Categories and statuses the complaint form offers' })
  categories() {
    return {
      categories: COMPLAINT_CATEGORIES.map((value) => ({
        value,
        label: COMPLAINT_CATEGORY_LABELS[value as ComplaintCategory],
      })),
      statuses: Object.values(ComplaintStatus),
    };
  }

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.COMPLAINTS_VIEW)
  @ApiOperation({ summary: 'Open, resolved and dismissed counts for this caller' })
  statistics(@CurrentSchool() schoolId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.complaints.statistics(schoolId, user);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.COMPLAINTS_VIEW)
  @ApiOperation({ summary: 'Complaints this caller may see, filtered and paginated' })
  list(
    @CurrentSchool() schoolId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ComplaintQueryDto,
  ) {
    return this.complaints.list(schoolId, user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.COMPLAINTS_CREATE)
  @ResponseMessage('Complaint raised — the school has been notified')
  @ApiOperation({ summary: 'Raise a complaint, optionally anonymously' })
  create(
    @CurrentSchool() schoolId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateComplaintDto,
  ) {
    return this.complaints.create(schoolId, user, dto);
  }

  @Post('attachments')
  @RequirePermissions(PERMISSIONS.COMPLAINTS_CREATE)
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
  @ApiOperation({ summary: 'Upload a file, then send its id with the complaint' })
  upload(
    @CurrentSchool() schoolId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.complaints.uploadAttachment(schoolId, user, file);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.COMPLAINTS_VIEW)
  @ApiOperation({ summary: 'One complaint with its attachments and outcome' })
  detail(
    @CurrentSchool() schoolId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.complaints.findOne(schoolId, user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.COMPLAINTS_CREATE)
  @ResponseMessage('Complaint updated')
  @ApiOperation({ summary: 'Correct a complaint you raised, before it is ruled on' })
  update(
    @CurrentSchool() schoolId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComplaintDto,
  ) {
    return this.complaints.update(schoolId, user, id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.COMPLAINTS_MANAGE)
  @ResponseMessage('Complaint updated')
  @ApiOperation({ summary: 'Move a complaint through review to an outcome' })
  updateStatus(
    @CurrentSchool() schoolId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComplaintStatusDto,
  ) {
    return this.complaints.updateStatus(schoolId, user, id, dto);
  }
}
