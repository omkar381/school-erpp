import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsHexColor,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// --- Academic year ----------------------------------------------------------

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2026-27' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  name!: string;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2027-03-31' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Make this the active academic year' })
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;

  @ApiPropertyOptional({
    description: 'Copy classes, sections and subjects from this academic year',
  })
  @IsOptional()
  @IsUUID('4')
  copyStructureFromId?: string;
}

export class UpdateAcademicYearDto extends PartialType(CreateAcademicYearDto) {}

// --- Department -------------------------------------------------------------

export class CreateDepartmentDto {
  @ApiProperty({ example: 'Science' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'SCI' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  @Transform(upper)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ description: 'Staff member who heads this department' })
  @IsOptional()
  @IsUUID('4')
  headStaffId?: string;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

// --- Designation ------------------------------------------------------------

export class CreateDesignationDto {
  @ApiProperty({ example: 'Senior Teacher' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'SR_TCH' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  @Transform(upper)
  code!: string;

  @ApiPropertyOptional({ description: 'Seniority level, used for ordering' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  level?: number;
}

export class UpdateDesignationDto extends PartialType(CreateDesignationDto) {}

// --- Class ------------------------------------------------------------------

export class CreateClassDto {
  @ApiProperty({ example: 'Class 10' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: 10, description: 'Numeric ordering; Nursery = -2, LKG = -1, UKG = 0' })
  @Type(() => Number)
  @IsInt()
  @Min(-5)
  @Max(15)
  level!: number;

  @ApiPropertyOptional({ description: 'Academic year; defaults to the current one' })
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;

  @ApiPropertyOptional({ example: 'Science' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  stream?: string;

  @ApiPropertyOptional({ example: 'English' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  medium?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Section names to create alongside the class, e.g. ["A", "B"]',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sections?: string[];
}

export class UpdateClassDto extends PartialType(CreateClassDto) {}

// --- Section ----------------------------------------------------------------

export class CreateSectionDto {
  @ApiProperty({ example: 'A' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  name!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  classId!: string;

  @ApiPropertyOptional({ default: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @ApiPropertyOptional({ description: 'Staff id of the class teacher' })
  @IsOptional()
  @IsUUID('4')
  classTeacherId?: string;
}

export class UpdateSectionDto extends PartialType(CreateSectionDto) {}

// --- Subject ----------------------------------------------------------------

export class CreateSubjectDto {
  @ApiProperty({ example: 'Mathematics' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'MATH' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  @Transform(upper)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  departmentId?: string;

  @ApiPropertyOptional({
    enum: ['CORE', 'ELECTIVE', 'LANGUAGE', 'ACTIVITY', 'CO_SCHOLASTIC'],
    default: 'CORE',
  })
  @IsOptional()
  @IsIn(['CORE', 'ELECTIVE', 'LANGUAGE', 'ACTIVITY', 'CO_SCHOLASTIC'])
  category?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isElective?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hasPractical?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Graded only; excluded from percentage and rank calculations',
  })
  @IsOptional()
  @IsBoolean()
  isGradedOnly?: boolean;

  @ApiPropertyOptional({ example: '#2563EB' })
  @IsOptional()
  @IsHexColor()
  colorHex?: string;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {}

export class AssignSubjectsToClassDto {
  @ApiProperty({ type: [Object] })
  @IsArray()
  subjects!: Array<{
    subjectId: string;
    weeklyPeriods?: number;
    maxMarks?: number;
    passMarks?: number;
    isOptional?: boolean;
  }>;
}

export class AssignSubjectTeacherDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sectionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  subjectId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  staffId!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

// --- Room -------------------------------------------------------------------

export class CreateRoomDto {
  @ApiProperty({ example: 'Room 101' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: 'R101' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{1,20}$/)
  @Transform(upper)
  code!: string;

  @ApiPropertyOptional({
    enum: ['CLASSROOM', 'LAB', 'LIBRARY', 'AUDITORIUM', 'SPORTS', 'OTHER'],
    default: 'CLASSROOM',
  })
  @IsOptional()
  @IsIn(['CLASSROOM', 'LAB', 'LIBRARY', 'AUDITORIUM', 'SPORTS', 'OTHER'])
  type?: string;

  @ApiPropertyOptional({ default: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  building?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  floor?: string;
}

export class UpdateRoomDto extends PartialType(CreateRoomDto) {}

// --- Holiday ----------------------------------------------------------------

export class CreateHolidayDto {
  @ApiProperty({ example: 'Diwali' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '2026-11-08' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-11-12' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ enum: ['PUBLIC', 'SCHOOL', 'EXAM', 'VACATION'], default: 'SCHOOL' })
  @IsOptional()
  @IsIn(['PUBLIC', 'SCHOOL', 'EXAM', 'VACATION'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;
}

export class UpdateHolidayDto extends PartialType(CreateHolidayDto) {}

// --- Queries ----------------------------------------------------------------

export class ClassQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stream?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  medium?: string;
}

export class SubjectQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  classId?: string;
}
