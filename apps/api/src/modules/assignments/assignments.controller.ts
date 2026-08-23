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
  RequireAnyPermission,
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from '../guardians/guardians.service';
import { AssignmentsService } from './assignments.service';
import {
  AssignmentQueryDto,
  CreateAssignmentDto,
  GradeSubmissionDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from './dto/assignment.dto';

@ApiTags('Assignments')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.ASSIGNMENTS)
@Controller('assignments')
export class AssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly guardians: GuardiansService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ASSIGNMENTS_VIEW)
  @ApiOperation({ summary: 'List assignments' })
  findAll(
    @CurrentSchool() schoolId: string | null,
    @Query() query: AssignmentQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignments.findAll(this.school(schoolId), query, user);
  }

  @Get('students/:studentId')
  @RequireAnyPermission(PERMISSIONS.ASSIGNMENTS_VIEW, PERMISSIONS.SELF_HOMEWORK_VIEW)
  @ApiOperation({ summary: 'Assignments for one student with submission state' })
  async forStudent(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: AssignmentQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.assignments.forStudent(this.school(schoolId), studentId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ASSIGNMENTS_VIEW)
  @ApiOperation({ summary: 'Assignment detail with submissions and statistics' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.findOne(this.school(schoolId), id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ASSIGNMENTS_CREATE)
  @ResponseMessage('Assignment created')
  @ApiOperation({ summary: 'Create an assignment' })
  create(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignments.create(this.school(schoolId), dto, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ASSIGNMENTS_UPDATE)
  @ResponseMessage('Assignment updated')
  @ApiOperation({ summary: 'Update or publish an assignment' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignments.update(this.school(schoolId), id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ASSIGNMENTS_DELETE)
  @ResponseMessage('Assignment removed')
  @ApiOperation({ summary: 'Remove an assignment' })
  remove(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignments.remove(this.school(schoolId), id, user);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.ASSIGNMENTS_SUBMIT)
  @ResponseMessage('Assignment submitted')
  @ApiOperation({ summary: 'Submit an assignment as the signed-in student' })
  submit(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!user.studentId) {
      throw new ForbiddenError('This account is not linked to a student record');
    }
    return this.assignments.submit(this.school(schoolId), id, user.studentId, dto);
  }

  @Patch('submissions/:submissionId/grade')
  @RequirePermissions(PERMISSIONS.ASSIGNMENTS_GRADE)
  @ResponseMessage('Submission graded')
  @ApiOperation({ summary: 'Grade a submission, applying any late penalty' })
  grade(
    @CurrentSchool() schoolId: string | null,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: GradeSubmissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignments.grade(this.school(schoolId), submissionId, dto, user);
  }

  private async assertStudentAccess(user: AuthenticatedUser, studentId: string): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.ASSIGNMENTS_VIEW)) return;
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
