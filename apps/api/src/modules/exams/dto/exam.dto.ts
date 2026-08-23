import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExamStatus, ExamType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateExamDto {
  @ApiProperty({ example: 'Mid Term Examination' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'MID' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,20}$/, { message: 'code must be uppercase letters, digits, _ or -' })
  code!: string;

  @ApiProperty({ enum: ExamType })
  @IsEnum(ExamType)
  type!: ExamType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: '2026-09-15' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-09-25' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Percentage contribution to the term aggregate' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weightage?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showRank?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiPropertyOptional({ description: 'Defaults to the school default grading scale' })
  @IsOptional()
  @IsUUID('4')
  gradeScaleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;
}

export class UpdateExamDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ExamType })
  @IsOptional()
  @IsEnum(ExamType)
  type?: ExamType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  resultDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weightage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showRank?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  gradeScaleId?: string;
}

export class SetExamClassesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  classIds!: string[];

  @ApiPropertyOptional({ description: "Overrides each subject's default maximum" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  defaultMaxMarks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  defaultPassMarks?: number;
}

export class UpdateExamSubjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  maxMarks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  passMarks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  maxMarksPractical?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  passMarksPractical?: number;
}

export class ScheduleExamSubjectDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  examSubjectId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Update an existing schedule row' })
  @IsOptional()
  @IsUUID('4')
  scheduleId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Omit to apply to every section' })
  @IsOptional()
  @IsUUID('4')
  sectionId?: string;

  @ApiProperty({ example: '2026-09-16' })
  @IsDateString()
  date!: string;

  @ApiProperty({ example: '09:00' })
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @ApiProperty({ example: '12:00' })
  @Matches(TIME_PATTERN, { message: 'endTime must be HH:mm' })
  endTime!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  invigilatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;
}

export class MarkEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  studentId!: string;

  @ApiPropertyOptional({ description: 'Required unless the student is absent or exempted' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  marksObtained?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  practicalMarks?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAbsent?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Excluded from the total and percentage' })
  @IsOptional()
  @IsBoolean()
  isExempted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  remarks?: string;
}

export class EnterMarksDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  examSubjectId!: string;

  @ApiProperty({ type: [MarkEntryDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => MarkEntryDto)
  marks!: MarkEntryDto[];
}

export class CorrectMarkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  marksObtained?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  practicalMarks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAbsent?: boolean;

  @ApiProperty({ description: 'Why the mark is being changed; recorded permanently' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Who authorised the correction' })
  @IsOptional()
  @IsUUID('4')
  approvedById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  remarks?: string;
}

export class PublishResultsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  resultDate?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Publish even though some subjects have incomplete marks',
  })
  @IsOptional()
  @IsBoolean()
  publishIncomplete?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

export class SetExamStatusDto {
  @ApiProperty({ enum: ExamStatus })
  @IsEnum(ExamStatus)
  status!: ExamStatus;
}

export class LockMarksDto {
  @ApiProperty()
  @IsBoolean()
  locked!: boolean;
}

export class ExamQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ExamStatus })
  @IsOptional()
  @IsEnum(ExamStatus)
  status?: ExamStatus;

  @ApiPropertyOptional({ enum: ExamType })
  @IsOptional()
  @IsEnum(ExamType)
  type?: ExamType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;
}

export class GenerateReportCardDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Exams to aggregate' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  examIds!: string[];

  @ApiProperty({ example: 'Term 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  term!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Generate for one section only' })
  @IsOptional()
  @IsUUID('4')
  sectionId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Generate for one student only' })
  @IsOptional()
  @IsUUID('4')
  studentId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  principalRemarks?: string;
}

export class ReportCardRemarksDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  classTeacherRemarks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  principalRemarks?: string;
}
