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
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from '../guardians/guardians.service';
import { HomeworkService } from './homework.service';
import {
  BatchReviewDto,
  CreateHomeworkDto,
  HomeworkQueryDto,
  ReviewSubmissionDto,
  SubmitHomeworkDto,
  UpdateHomeworkDto,
} from './dto/homework.dto';

@ApiTags('Homework')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.HOMEWORK)
@Controller('homework')
export class HomeworkController {
  constructor(
    private readonly homework: HomeworkService,
    private readonly guardians: GuardiansService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.HOMEWORK_VIEW)
  @ApiOperation({ summary: 'List homework with submission progress' })
  findAll(
    @CurrentSchool() schoolId: string | null,
    @Query() query: HomeworkQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.homework.findAll(this.school(schoolId), query, user);
  }

  @Get('students/:studentId')
  @RequireAnyPermission(PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.SELF_HOMEWORK_VIEW)
  @ApiOperation({ summary: "Homework for one student, with their submission state" })
  async forStudent(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: HomeworkQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.homework.forStudent(this.school(schoolId), studentId, query);
  }

  @Get('students/:studentId/pending-count')
  @RequireAnyPermission(PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.SELF_HOMEWORK_VIEW)
  @ApiOperation({ summary: 'Pending, overdue and due-today counts for a student' })
  async pendingCount(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.homework.pendingCount(this.school(schoolId), studentId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.HOMEWORK_VIEW)
  @ApiOperation({ summary: 'Homework detail with the class roster and submissions' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.homework.findOne(this.school(schoolId), id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.HOMEWORK_CREATE)
  @ResponseMessage('Homework set')
  @ApiOperation({ summary: 'Set homework for a section' })
  create(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateHomeworkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.homework.create(this.school(schoolId), dto, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.HOMEWORK_UPDATE)
  @ResponseMessage('Homework updated')
  @ApiOperation({ summary: 'Update or publish homework' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHomeworkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.homework.update(this.school(schoolId), id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.HOMEWORK_DELETE)
  @ResponseMessage('Homework removed')
  @ApiOperation({ summary: 'Remove homework, retaining submissions' })
  remove(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.homework.remove(this.school(schoolId), id, user);
  }

  // --- Submissions ----------------------------------------------------------

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.HOMEWORK_SUBMIT)
  @ResponseMessage('Homework submitted')
  @ApiOperation({ summary: 'Submit homework as the signed-in student' })
  submit(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitHomeworkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!user.studentId) {
      throw new ForbiddenError('This account is not linked to a student record');
    }
    return this.homework.submit(this.school(schoolId), id, user.studentId, dto);
  }

  @Patch('submissions/:submissionId/review')
  @RequirePermissions(PERMISSIONS.HOMEWORK_REVIEW)
  @ResponseMessage('Submission reviewed')
  @ApiOperation({ summary: 'Mark a submission and give feedback' })
  review(
    @CurrentSchool() schoolId: string | null,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: ReviewSubmissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.homework.review(this.school(schoolId), submissionId, dto, user);
  }

  @Post(':id/review-batch')
  @RequirePermissions(PERMISSIONS.HOMEWORK_REVIEW)
  @ResponseMessage('Submissions reviewed')
  @ApiOperation({ summary: 'Mark many submissions at once' })
  reviewBatch(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BatchReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.homework.reviewBatch(this.school(schoolId), id, dto.reviews, user);
  }

  // --------------------------------------------------------------------------

  /**
   * A parent may only read their own children, and a student only themselves.
   * Staff with the homework-view permission may read anyone in the school.
   */
  private async assertStudentAccess(
    user: AuthenticatedUser,
    studentId: string,
  ): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.HOMEWORK_VIEW)) return;
    if (user.studentId === studentId) return;

    if (user.guardianId) {
      await this.guardians.assertChildAccess(user.guardianId, studentId);
      return;
    }

    throw new ForbiddenError('You do not have access to this student');
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
