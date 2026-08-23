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
import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';
import {
  ApiSchoolHeader,
  CurrentSchool,
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import { parseDateOnly } from '../../common/utils/date.util';
import { AcademicYearService } from './services/academic-year.service';
import { CalendarService } from './services/calendar.service';
import { ClassesService } from './services/classes.service';
import { SubjectsService } from './services/subjects.service';
import {
  AssignSubjectTeacherDto,
  AssignSubjectsToClassDto,
  ClassQueryDto,
  CreateAcademicYearDto,
  CreateClassDto,
  CreateDepartmentDto,
  CreateDesignationDto,
  CreateHolidayDto,
  CreateRoomDto,
  CreateSectionDto,
  CreateSubjectDto,
  SubjectQueryDto,
  UpdateAcademicYearDto,
  UpdateClassDto,
  UpdateDepartmentDto,
  UpdateDesignationDto,
  UpdateHolidayDto,
  UpdateRoomDto,
  UpdateSectionDto,
  UpdateSubjectDto,
} from './dto/academics.dto';

class YearQuery {
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;
}

class SectionListQuery {
  @IsOptional()
  @IsUUID('4')
  classId?: string;
}

class CalendarQuery {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

class LockDto {
  @IsBoolean()
  isLocked!: boolean;
}

@ApiTags('Academics')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('academics')
export class AcademicsController {
  constructor(
    private readonly academicYears: AcademicYearService,
    private readonly classes: ClassesService,
    private readonly subjects: SubjectsService,
    private readonly calendar: CalendarService,
  ) {}

  // --- Academic years -------------------------------------------------------

  @Get('years')
  @RequirePermissions(PERMISSIONS.ACADEMIC_YEARS_VIEW)
  @ApiOperation({ summary: 'List academic years' })
  listYears(@CurrentSchool() schoolId: string | null) {
    return this.academicYears.findAll(this.school(schoolId));
  }

  @Get('years/current')
  @RequirePermissions(PERMISSIONS.ACADEMIC_YEARS_VIEW)
  @ApiOperation({ summary: 'Get the active academic year' })
  currentYear(@CurrentSchool() schoolId: string | null) {
    return this.academicYears.getCurrent(this.school(schoolId));
  }

  @Get('years/:id')
  @RequirePermissions(PERMISSIONS.ACADEMIC_YEARS_VIEW)
  @ApiOperation({ summary: 'Get one academic year with its classes' })
  getYear(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.academicYears.findOne(this.school(schoolId), id);
  }

  @Post('years')
  @RequirePermissions(PERMISSIONS.ACADEMIC_YEARS_MANAGE)
  @ResponseMessage('Academic year created')
  @ApiOperation({ summary: 'Create an academic year, optionally copying last year’s structure' })
  createYear(@CurrentSchool() schoolId: string | null, @Body() dto: CreateAcademicYearDto) {
    return this.academicYears.create(this.school(schoolId), dto);
  }

  @Patch('years/:id')
  @RequirePermissions(PERMISSIONS.ACADEMIC_YEARS_MANAGE)
  @ResponseMessage('Academic year updated')
  @ApiOperation({ summary: 'Update an academic year' })
  updateYear(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAcademicYearDto,
  ) {
    return this.academicYears.update(this.school(schoolId), id, dto);
  }

  @Post('years/:id/set-current')
  @RequirePermissions(PERMISSIONS.ACADEMIC_YEARS_MANAGE)
  @ResponseMessage('Current academic year updated')
  @ApiOperation({ summary: 'Make this the active academic year' })
  setCurrentYear(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.academicYears.setCurrent(this.school(schoolId), id);
  }

  @Patch('years/:id/lock')
  @RequirePermissions(PERMISSIONS.ACADEMIC_YEARS_MANAGE)
  @ResponseMessage('Academic year lock updated')
  @ApiOperation({ summary: 'Lock or unlock a completed academic year' })
  lockYear(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LockDto,
  ) {
    return this.academicYears.setLocked(this.school(schoolId), id, dto.isLocked);
  }

  @Delete('years/:id')
  @RequirePermissions(PERMISSIONS.ACADEMIC_YEARS_MANAGE)
  @ResponseMessage('Academic year deleted')
  @ApiOperation({ summary: 'Delete an academic year that has no records' })
  removeYear(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.academicYears.remove(this.school(schoolId), id);
  }

  // --- Classes --------------------------------------------------------------

  @Get('classes')
  @RequirePermissions(PERMISSIONS.CLASSES_VIEW)
  @ApiOperation({ summary: 'List classes with their sections and headcounts' })
  listClasses(@CurrentSchool() schoolId: string | null, @Query() query: ClassQueryDto) {
    return this.classes.findAll(this.school(schoolId), query);
  }

  @Get('classes/:id')
  @RequirePermissions(PERMISSIONS.CLASSES_VIEW)
  @ApiOperation({ summary: 'Get one class with sections and subjects' })
  getClass(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.classes.findOne(this.school(schoolId), id);
  }

  @Post('classes')
  @RequirePermissions(PERMISSIONS.CLASSES_MANAGE)
  @ResponseMessage('Class created')
  @ApiOperation({ summary: 'Create a class, optionally with sections' })
  createClass(@CurrentSchool() schoolId: string | null, @Body() dto: CreateClassDto) {
    return this.classes.create(this.school(schoolId), dto);
  }

  @Patch('classes/:id')
  @RequirePermissions(PERMISSIONS.CLASSES_MANAGE)
  @ResponseMessage('Class updated')
  @ApiOperation({ summary: 'Update a class' })
  updateClass(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
  ) {
    return this.classes.update(this.school(schoolId), id, dto);
  }

  @Delete('classes/:id')
  @RequirePermissions(PERMISSIONS.CLASSES_MANAGE)
  @ResponseMessage('Class deleted')
  @ApiOperation({ summary: 'Delete an empty class' })
  removeClass(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.classes.remove(this.school(schoolId), id);
  }

  @Patch('classes/:id/subjects')
  @RequirePermissions(PERMISSIONS.CLASSES_MANAGE)
  @ResponseMessage('Class subjects updated')
  @ApiOperation({ summary: 'Set the subjects taught in a class' })
  assignSubjects(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSubjectsToClassDto,
  ) {
    return this.classes.assignSubjects(this.school(schoolId), id, dto);
  }

  // --- Sections -------------------------------------------------------------

  @Get('sections')
  @RequirePermissions(PERMISSIONS.SECTIONS_VIEW)
  @ApiOperation({ summary: 'List sections with occupancy' })
  listSections(@CurrentSchool() schoolId: string | null, @Query() query: SectionListQuery) {
    return this.classes.listSections(this.school(schoolId), query.classId);
  }

  @Post('sections')
  @RequirePermissions(PERMISSIONS.SECTIONS_MANAGE)
  @ResponseMessage('Section created')
  @ApiOperation({ summary: 'Create a section within a class' })
  createSection(@CurrentSchool() schoolId: string | null, @Body() dto: CreateSectionDto) {
    return this.classes.createSection(this.school(schoolId), dto);
  }

  @Patch('sections/:id')
  @RequirePermissions(PERMISSIONS.SECTIONS_MANAGE)
  @ResponseMessage('Section updated')
  @ApiOperation({ summary: 'Update a section, its capacity or its class teacher' })
  updateSection(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSectionDto,
  ) {
    return this.classes.updateSection(this.school(schoolId), id, dto);
  }

  @Delete('sections/:id')
  @RequirePermissions(PERMISSIONS.SECTIONS_MANAGE)
  @ResponseMessage('Section deleted')
  @ApiOperation({ summary: 'Delete an empty section' })
  removeSection(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.classes.removeSection(this.school(schoolId), id);
  }

  // --- Subjects -------------------------------------------------------------

  @Get('subjects')
  @RequirePermissions(PERMISSIONS.SUBJECTS_VIEW)
  @ApiOperation({ summary: 'List subjects' })
  listSubjects(@CurrentSchool() schoolId: string | null, @Query() query: SubjectQueryDto) {
    return this.subjects.findAll(this.school(schoolId), query);
  }

  @Get('subjects/:id')
  @RequirePermissions(PERMISSIONS.SUBJECTS_VIEW)
  @ApiOperation({ summary: 'Get one subject with its classes and teachers' })
  getSubject(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.subjects.findOne(this.school(schoolId), id);
  }

  @Post('subjects')
  @RequirePermissions(PERMISSIONS.SUBJECTS_MANAGE)
  @ResponseMessage('Subject created')
  @ApiOperation({ summary: 'Create a subject' })
  createSubject(@CurrentSchool() schoolId: string | null, @Body() dto: CreateSubjectDto) {
    return this.subjects.create(this.school(schoolId), dto);
  }

  @Patch('subjects/:id')
  @RequirePermissions(PERMISSIONS.SUBJECTS_MANAGE)
  @ResponseMessage('Subject updated')
  @ApiOperation({ summary: 'Update a subject' })
  updateSubject(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.subjects.update(this.school(schoolId), id, dto);
  }

  @Delete('subjects/:id')
  @RequirePermissions(PERMISSIONS.SUBJECTS_MANAGE)
  @ResponseMessage('Subject deleted')
  @ApiOperation({ summary: 'Delete a subject with no recorded marks' })
  removeSubject(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.subjects.remove(this.school(schoolId), id);
  }

  @Post('subject-teachers')
  @RequirePermissions(PERMISSIONS.SUBJECTS_MANAGE)
  @ResponseMessage('Subject teacher assigned')
  @ApiOperation({ summary: 'Assign a teacher to a subject in a section' })
  assignTeacher(@CurrentSchool() schoolId: string | null, @Body() dto: AssignSubjectTeacherDto) {
    return this.subjects.assignTeacher(this.school(schoolId), dto);
  }

  @Delete('subject-teachers/:id')
  @RequirePermissions(PERMISSIONS.SUBJECTS_MANAGE)
  @ResponseMessage('Subject teacher removed')
  @ApiOperation({ summary: 'Remove a subject teacher assignment' })
  removeTeacher(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.subjects.removeTeacher(this.school(schoolId), id);
  }

  @Get('teachers/:staffId/workload')
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({ summary: 'Classes, subjects and period load for one teacher' })
  workload(
    @CurrentSchool() schoolId: string | null,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ) {
    return this.subjects.teacherWorkload(this.school(schoolId), staffId);
  }

  // --- Departments, designations, rooms -------------------------------------

  @Get('departments')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_VIEW)
  @ApiOperation({ summary: 'List departments' })
  listDepartments(@CurrentSchool() schoolId: string | null) {
    return this.subjects.listDepartments(this.school(schoolId));
  }

  @Post('departments')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  @ResponseMessage('Department created')
  @ApiOperation({ summary: 'Create a department' })
  createDepartment(@CurrentSchool() schoolId: string | null, @Body() dto: CreateDepartmentDto) {
    return this.subjects.createDepartment(this.school(schoolId), dto);
  }

  @Patch('departments/:id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  @ResponseMessage('Department updated')
  @ApiOperation({ summary: 'Update a department' })
  updateDepartment(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.subjects.updateDepartment(this.school(schoolId), id, dto);
  }

  @Delete('departments/:id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  @ResponseMessage('Department deleted')
  @ApiOperation({ summary: 'Delete an empty department' })
  removeDepartment(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.subjects.removeDepartment(this.school(schoolId), id);
  }

  @Get('designations')
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({ summary: 'List staff designations' })
  listDesignations(@CurrentSchool() schoolId: string | null) {
    return this.subjects.listDesignations(this.school(schoolId));
  }

  @Post('designations')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  @ResponseMessage('Designation created')
  @ApiOperation({ summary: 'Create a designation' })
  createDesignation(@CurrentSchool() schoolId: string | null, @Body() dto: CreateDesignationDto) {
    return this.subjects.createDesignation(this.school(schoolId), dto);
  }

  @Patch('designations/:id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  @ResponseMessage('Designation updated')
  @ApiOperation({ summary: 'Update a designation' })
  updateDesignation(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDesignationDto,
  ) {
    return this.subjects.updateDesignation(this.school(schoolId), id, dto);
  }

  @Delete('designations/:id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  @ResponseMessage('Designation deleted')
  @ApiOperation({ summary: 'Delete an unused designation' })
  removeDesignation(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.subjects.removeDesignation(this.school(schoolId), id);
  }

  @Get('rooms')
  @RequirePermissions(PERMISSIONS.CLASSES_VIEW)
  @ApiOperation({ summary: 'List rooms' })
  listRooms(@CurrentSchool() schoolId: string | null) {
    return this.subjects.listRooms(this.school(schoolId));
  }

  @Post('rooms')
  @RequirePermissions(PERMISSIONS.ROOMS_MANAGE)
  @ResponseMessage('Room created')
  @ApiOperation({ summary: 'Create a room' })
  createRoom(@CurrentSchool() schoolId: string | null, @Body() dto: CreateRoomDto) {
    return this.subjects.createRoom(this.school(schoolId), dto);
  }

  @Patch('rooms/:id')
  @RequirePermissions(PERMISSIONS.ROOMS_MANAGE)
  @ResponseMessage('Room updated')
  @ApiOperation({ summary: 'Update a room' })
  updateRoom(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.subjects.updateRoom(this.school(schoolId), id, dto);
  }

  @Delete('rooms/:id')
  @RequirePermissions(PERMISSIONS.ROOMS_MANAGE)
  @ResponseMessage('Room deleted')
  @ApiOperation({ summary: 'Delete an unused room' })
  removeRoom(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.subjects.removeRoom(this.school(schoolId), id);
  }

  // --- Calendar -------------------------------------------------------------

  @Get('holidays')
  @RequirePermissions(PERMISSIONS.CALENDAR_MANAGE, PERMISSIONS.CLASSES_VIEW)
  @ApiOperation({ summary: 'List holidays for an academic year' })
  listHolidays(@CurrentSchool() schoolId: string | null, @Query() query: YearQuery) {
    return this.calendar.listHolidays(this.school(schoolId), query.academicYearId);
  }

  @Post('holidays')
  @RequirePermissions(PERMISSIONS.CALENDAR_MANAGE)
  @ResponseMessage('Holiday added')
  @ApiOperation({ summary: 'Add a holiday or vacation period' })
  createHoliday(@CurrentSchool() schoolId: string | null, @Body() dto: CreateHolidayDto) {
    return this.calendar.createHoliday(this.school(schoolId), dto);
  }

  @Patch('holidays/:id')
  @RequirePermissions(PERMISSIONS.CALENDAR_MANAGE)
  @ResponseMessage('Holiday updated')
  @ApiOperation({ summary: 'Update a holiday' })
  updateHoliday(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.calendar.updateHoliday(this.school(schoolId), id, dto);
  }

  @Delete('holidays/:id')
  @RequirePermissions(PERMISSIONS.CALENDAR_MANAGE)
  @ResponseMessage('Holiday removed')
  @ApiOperation({ summary: 'Remove a holiday' })
  removeHoliday(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.removeHoliday(this.school(schoolId), id);
  }

  @Get('calendar')
  @RequirePermissions(PERMISSIONS.CLASSES_VIEW)
  @ApiOperation({ summary: 'Merged calendar of holidays, events and exams' })
  getCalendar(@CurrentSchool() schoolId: string | null, @Query() query: CalendarQuery) {
    return this.calendar.calendar(
      this.school(schoolId),
      parseDateOnly(query.from),
      parseDateOnly(query.to),
    );
  }

  @Get('working-days')
  @RequirePermissions(PERMISSIONS.CLASSES_VIEW)
  @ApiOperation({ summary: 'Working-day breakdown for a date range' })
  workingDays(@CurrentSchool() schoolId: string | null, @Query() query: CalendarQuery) {
    return this.calendar.workingDaysBetween(
      this.school(schoolId),
      parseDateOnly(query.from),
      parseDateOnly(query.to),
    );
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
