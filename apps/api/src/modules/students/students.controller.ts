import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiSchoolHeader,
  CurrentSchool,
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage, SkipEnvelope } from '../../common/interceptors/response.interceptor';
import { BadRequestError, ForbiddenError } from '../../common/exceptions/app.exception';
import { StudentsService } from './students.service';
import { StudentImportService } from './student-import.service';
import { StudentExportService } from './student-export.service';
import {
  BulkImportOptionsDto,
  ChangeStudentStatusDto,
  CreateStudentDto,
  LinkGuardianDto,
  PromoteStudentsDto,
  StudentQueryDto,
  TransferStudentDto,
  UpdateStudentDto,
} from './dto/student.dto';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

@ApiTags('Students')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.STUDENTS)
@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly importer: StudentImportService,
    private readonly exporter: StudentExportService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'List students with class, guardian and dues' })
  findAll(@CurrentSchool() schoolId: string | null, @Query() query: StudentQueryDto) {
    return this.students.findAll(this.school(schoolId), query);
  }

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Headcounts by status, gender and class' })
  statistics(
    @CurrentSchool() schoolId: string | null,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.students.statistics(this.school(schoolId), academicYearId);
  }

  @Get('import/template')
  @RequirePermissions(PERMISSIONS.STUDENTS_IMPORT)
  @SkipEnvelope()
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="student-import-template.xlsx"')
  @ApiOperation({ summary: 'Download the student import template' })
  async template(@Res() response: Response) {
    const buffer = await this.importer.buildTemplate();
    response.end(buffer);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.STUDENTS_EXPORT)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Export the filtered student list as Excel or CSV' })
  async export(
    @CurrentSchool() schoolId: string | null,
    @Query() query: StudentQueryDto & { format?: 'xlsx' | 'csv' },
    @Res() response: Response,
  ) {
    const format = query.format === 'csv' ? 'csv' : 'xlsx';
    const { buffer, filename, contentType } = await this.exporter.export(
      this.school(schoolId),
      query,
      format,
    );

    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.end(buffer);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Full student profile' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.findOne(this.school(schoolId), id);
  }

  @Get(':id/summary')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Compact student profile for mobile clients' })
  summary(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.summary(this.school(schoolId), id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STUDENTS_CREATE)
  @ResponseMessage('Student admitted successfully')
  @ApiOperation({ summary: 'Admit a student with enrollment and guardians' })
  create(@CurrentSchool() schoolId: string | null, @Body() dto: CreateStudentDto) {
    return this.students.create(this.school(schoolId), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_UPDATE)
  @ResponseMessage('Student updated')
  @ApiOperation({ summary: 'Update a student profile' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.students.update(this.school(schoolId), id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.STUDENTS_UPDATE)
  @ResponseMessage('Student status updated')
  @ApiOperation({ summary: 'Change status: transfer, suspend, mark alumni' })
  changeStatus(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStudentStatusDto,
  ) {
    return this.students.changeStatus(this.school(schoolId), id, dto);
  }

  @Post(':id/transfer')
  @RequirePermissions(PERMISSIONS.STUDENTS_TRANSFER)
  @ResponseMessage('Student moved to the new section')
  @ApiOperation({ summary: 'Move a student to another section' })
  transfer(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferStudentDto,
  ) {
    return this.students.transfer(this.school(schoolId), id, dto);
  }

  @Post('promote')
  @RequirePermissions(PERMISSIONS.STUDENTS_PROMOTE)
  @ResponseMessage('Students promoted')
  @ApiOperation({ summary: 'Promote a section into the next academic year' })
  promote(@CurrentSchool() schoolId: string | null, @Body() dto: PromoteStudentsDto) {
    return this.students.promote(this.school(schoolId), dto);
  }

  @Post(':id/guardians')
  @RequirePermissions(PERMISSIONS.STUDENTS_UPDATE)
  @ResponseMessage('Guardian linked')
  @ApiOperation({ summary: 'Link an existing guardian to a student' })
  linkGuardian(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkGuardianDto,
  ) {
    return this.students.linkGuardian(this.school(schoolId), id, dto);
  }

  @Delete(':id/guardians/:guardianId')
  @RequirePermissions(PERMISSIONS.STUDENTS_UPDATE)
  @ResponseMessage('Guardian unlinked')
  @ApiOperation({ summary: 'Unlink a guardian from a student' })
  unlinkGuardian(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
  ) {
    return this.students.unlinkGuardian(this.school(schoolId), id, guardianId);
  }

  @Post('import')
  @RequirePermissions(PERMISSIONS.STUDENTS_IMPORT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'sectionId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        sectionId: { type: 'string', format: 'uuid' },
        academicYearId: { type: 'string', format: 'uuid' },
        dryRun: { type: 'boolean' },
        createGuardianLogins: { type: 'boolean' },
      },
    },
  })
  @ResponseMessage('Import completed')
  @ApiOperation({ summary: 'Bulk import students from Excel or CSV' })
  importStudents(
    @CurrentSchool() schoolId: string | null,
    @UploadedFile() file: Express.Multer.File,
    @Body() options: BulkImportOptionsDto,
  ) {
    if (!file) throw new BadRequestError('Please attach a file to import');
    return this.importer.import(this.school(schoolId), file, options);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_DELETE)
  @ResponseMessage('Student removed')
  @ApiOperation({ summary: 'Soft-delete a student, retaining financial history' })
  remove(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.remove(this.school(schoolId), id);
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
