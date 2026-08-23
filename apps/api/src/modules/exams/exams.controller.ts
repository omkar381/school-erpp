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
import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
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
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from '../guardians/guardians.service';
import { ExamsService } from './services/exams.service';
import { MarksService } from './services/marks.service';
import { ReportCardsService } from './services/report-cards.service';
import {
  CorrectMarkDto,
  CreateExamDto,
  EnterMarksDto,
  ExamQueryDto,
  GenerateReportCardDto,
  LockMarksDto,
  PublishResultsDto,
  ReportCardRemarksDto,
  ScheduleExamSubjectDto,
  SetExamClassesDto,
  SetExamStatusDto,
  UpdateExamDto,
  UpdateExamSubjectDto,
} from './dto/exam.dto';

class EntrySheetQuery {
  @IsOptional()
  @IsUUID('4')
  sectionId?: string;
}

class ClassResultsQuery {
  @IsUUID('4')
  classId!: string;

  @IsOptional()
  @IsUUID('4')
  sectionId?: string;
}

class ReportCardQuery extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;

  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @IsOptional()
  @IsUUID('4')
  sectionId?: string;

  @IsOptional()
  @IsUUID('4')
  studentId?: string;

  @IsOptional()
  @IsString()
  term?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  publishedOnly?: boolean;
}

class PublishCardsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  reportCardIds!: string[];
}

@ApiTags('Examinations')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.EXAMS)
@Controller('exams')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly marks: MarksService,
    private readonly reportCards: ReportCardsService,
    private readonly guardians: GuardiansService,
  ) {}

  // --- Exams ----------------------------------------------------------------

  @Get()
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'List exams' })
  findAll(@CurrentSchool() schoolId: string | null, @Query() query: ExamQueryDto) {
    return this.exams.findAll(this.school(schoolId), query);
  }

  @Get('report-cards')
  @RequirePermissions(PERMISSIONS.REPORT_CARDS_VIEW)
  @ApiOperation({ summary: 'List generated report cards' })
  listReportCards(@CurrentSchool() schoolId: string | null, @Query() query: ReportCardQuery) {
    return this.reportCards.findAll(this.school(schoolId), query);
  }

  @Get('report-cards/:id')
  @RequirePermissions(PERMISSIONS.REPORT_CARDS_VIEW)
  @ApiOperation({ summary: 'Full report card with school branding' })
  getReportCard(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.reportCards.findOne(this.school(schoolId), id);
  }

  @Get('students/:studentId')
  @RequireAnyPermission(PERMISSIONS.EXAMS_VIEW, PERMISSIONS.SELF_RESULTS_VIEW)
  @ApiOperation({ summary: 'Exams and datesheets visible to one student' })
  async forStudent(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.exams.forStudent(this.school(schoolId), studentId, academicYearId);
  }

  @Get('students/:studentId/next')
  @RequireAnyPermission(PERMISSIONS.EXAMS_VIEW, PERMISSIONS.SELF_RESULTS_VIEW)
  @ApiOperation({ summary: 'The next scheduled paper for a student' })
  async nextExam(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.exams.nextExam(this.school(schoolId), studentId);
  }

  @Get('students/:studentId/report-cards')
  @RequireAnyPermission(PERMISSIONS.REPORT_CARDS_VIEW, PERMISSIONS.SELF_RESULTS_VIEW)
  @ApiOperation({ summary: 'Published report cards for a student' })
  async studentReportCards(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.reportCards.forStudent(this.school(schoolId), studentId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Exam detail with subjects, schedule and marks progress' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.exams.findOne(this.school(schoolId), id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EXAMS_CREATE)
  @ResponseMessage('Exam created')
  @ApiOperation({ summary: 'Create an exam' })
  create(@CurrentSchool() schoolId: string | null, @Body() dto: CreateExamDto) {
    return this.exams.create(this.school(schoolId), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_UPDATE)
  @ResponseMessage('Exam updated')
  @ApiOperation({ summary: 'Update an exam' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamDto,
  ) {
    return this.exams.update(this.school(schoolId), id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.EXAMS_UPDATE)
  @ResponseMessage('Exam status updated')
  @ApiOperation({ summary: 'Move an exam through its lifecycle' })
  setStatus(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetExamStatusDto,
  ) {
    return this.exams.setStatus(this.school(schoolId), id, dto.status);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_DELETE)
  @ResponseMessage('Exam deleted')
  @ApiOperation({ summary: 'Delete an exam that has no marks' })
  remove(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.exams.remove(this.school(schoolId), id);
  }

  // --- Classes and subjects -------------------------------------------------

  @Patch(':id/classes')
  @RequirePermissions(PERMISSIONS.EXAMS_UPDATE)
  @ResponseMessage('Exam classes updated')
  @ApiOperation({ summary: 'Set which classes sit the exam and create subject rows' })
  setClasses(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetExamClassesDto,
  ) {
    return this.exams.setClasses(this.school(schoolId), id, dto);
  }

  @Patch('subjects/:examSubjectId')
  @RequirePermissions(PERMISSIONS.EXAMS_UPDATE)
  @ResponseMessage('Exam subject updated')
  @ApiOperation({ summary: 'Change the marks ceiling for one exam subject' })
  updateExamSubject(
    @CurrentSchool() schoolId: string | null,
    @Param('examSubjectId', ParseUUIDPipe) examSubjectId: string,
    @Body() dto: UpdateExamSubjectDto,
  ) {
    return this.exams.updateExamSubject(this.school(schoolId), examSubjectId, dto);
  }

  // --- Scheduling -----------------------------------------------------------

  @Get(':id/datesheet')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Datesheet grouped by day' })
  datesheet(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('classId') classId?: string,
  ) {
    return this.exams.datesheet(this.school(schoolId), id, classId);
  }

  @Post('schedules')
  @RequirePermissions(PERMISSIONS.EXAMS_SCHEDULE)
  @ResponseMessage('Paper scheduled')
  @ApiOperation({ summary: 'Schedule a paper, rejecting clashes' })
  schedule(@CurrentSchool() schoolId: string | null, @Body() dto: ScheduleExamSubjectDto) {
    return this.exams.schedule(this.school(schoolId), dto);
  }

  @Delete('schedules/:id')
  @RequirePermissions(PERMISSIONS.EXAMS_SCHEDULE)
  @ResponseMessage('Schedule removed')
  @ApiOperation({ summary: 'Remove a scheduled paper' })
  removeSchedule(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.exams.removeSchedule(this.school(schoolId), id);
  }

  // --- Marks ----------------------------------------------------------------

  @Get('subjects/:examSubjectId/entry-sheet')
  @RequirePermissions(PERMISSIONS.EXAMS_ENTER_MARKS)
  @ApiOperation({ summary: 'Marks-entry grid for a subject' })
  entrySheet(
    @CurrentSchool() schoolId: string | null,
    @Param('examSubjectId', ParseUUIDPipe) examSubjectId: string,
    @Query() query: EntrySheetQuery,
  ) {
    return this.marks.entrySheet(this.school(schoolId), examSubjectId, query.sectionId);
  }

  @Post('marks')
  @RequirePermissions(PERMISSIONS.EXAMS_ENTER_MARKS)
  @ResponseMessage('Marks saved')
  @ApiOperation({ summary: 'Enter marks for a subject; all-or-nothing' })
  enterMarks(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: EnterMarksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.marks.enter(this.school(schoolId), dto, user);
  }

  @Patch('marks/:markId/correct')
  @RequirePermissions(PERMISSIONS.EXAMS_EDIT_LOCKED_MARKS)
  @ResponseMessage('Mark corrected')
  @ApiOperation({ summary: 'Correct a locked mark, recording an immutable revision' })
  correctMark(
    @CurrentSchool() schoolId: string | null,
    @Param('markId', ParseUUIDPipe) markId: string,
    @Body() dto: CorrectMarkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.marks.correct(this.school(schoolId), markId, dto, user);
  }

  @Get('marks/:markId/revisions')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Change history for a mark' })
  markRevisions(
    @CurrentSchool() schoolId: string | null,
    @Param('markId', ParseUUIDPipe) markId: string,
  ) {
    return this.marks.revisionHistory(this.school(schoolId), markId);
  }

  @Patch(':id/lock')
  @RequirePermissions(PERMISSIONS.EXAMS_PUBLISH_RESULTS)
  @ResponseMessage('Marks lock updated')
  @ApiOperation({ summary: 'Lock or unlock marks for an exam' })
  lockMarks(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LockMarksDto,
  ) {
    return this.marks.lock(this.school(schoolId), id, dto.locked);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.EXAMS_PUBLISH_RESULTS)
  @ResponseMessage('Results published')
  @ApiOperation({ summary: 'Publish results and notify families' })
  publish(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishResultsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.marks.publish(this.school(schoolId), id, dto, user);
  }

  // --- Results --------------------------------------------------------------

  @Get(':id/results/:studentId')
  @RequireAnyPermission(PERMISSIONS.EXAMS_VIEW, PERMISSIONS.SELF_RESULTS_VIEW)
  @ApiOperation({ summary: "A student's result for one exam" })
  async studentResult(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) examId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.marks.studentResult(this.school(schoolId), examId, studentId);
  }

  @Get(':id/results')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Class result sheet with ranks and statistics' })
  classResults(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) examId: string,
    @Query() query: ClassResultsQuery,
  ) {
    return this.marks.classResults(
      this.school(schoolId),
      examId,
      query.classId,
      query.sectionId,
    );
  }

  // --- Report cards ---------------------------------------------------------

  @Post('report-cards/generate')
  @RequirePermissions(PERMISSIONS.REPORT_CARDS_GENERATE)
  @ResponseMessage('Report cards generated')
  @ApiOperation({ summary: 'Generate report cards by aggregating published exams' })
  generateReportCards(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: GenerateReportCardDto,
  ) {
    return this.reportCards.generate(this.school(schoolId), dto);
  }

  @Patch('report-cards/:id/remarks')
  @RequirePermissions(PERMISSIONS.REPORT_CARDS_GENERATE)
  @ResponseMessage('Remarks saved')
  @ApiOperation({ summary: 'Add class teacher and principal remarks' })
  setRemarks(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportCardRemarksDto,
  ) {
    return this.reportCards.setRemarks(this.school(schoolId), id, dto);
  }

  @Post('report-cards/publish')
  @RequirePermissions(PERMISSIONS.REPORT_CARDS_PUBLISH)
  @ResponseMessage('Report cards published')
  @ApiOperation({ summary: 'Release report cards to parents' })
  publishReportCards(@CurrentSchool() schoolId: string | null, @Body() dto: PublishCardsDto) {
    return this.reportCards.publish(this.school(schoolId), dto.reportCardIds);
  }

  // --------------------------------------------------------------------------

  private async assertStudentAccess(user: AuthenticatedUser, studentId: string): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.EXAMS_VIEW)) return;
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
