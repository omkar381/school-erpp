import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HomeworkStatus, Priority } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateHomeworkDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sectionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  subjectId!: string;

  @ApiProperty({ example: 'Exercise 4.2 — Linear Equations' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  assignedDate?: string;

  @ApiProperty({ example: '2026-08-28' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ enum: Priority, default: Priority.NORMAL })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxMarks?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notifyParents?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Set false to save as a draft' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpdateHomeworkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxMarks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;

  @ApiPropertyOptional({ enum: HomeworkStatus })
  @IsOptional()
  @IsEnum(HomeworkStatus)
  status?: HomeworkStatus;

  @ApiPropertyOptional({ description: 'Publish a draft' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class SubmitHomeworkDto {
  @ApiPropertyOptional({ description: 'Typed answer or a note to the teacher' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;
}

export class ReviewSubmissionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  marksAwarded?: number;

  @ApiPropertyOptional({ example: 'A' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  grade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;

  @ApiPropertyOptional({ default: false, description: 'Ask the student to submit again' })
  @IsOptional()
  @IsBoolean()
  requestResubmission?: boolean;
}

export class BatchReviewItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  submissionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  marksAwarded?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}

export class BatchReviewDto {
  @ApiProperty({ type: [BatchReviewItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BatchReviewItemDto)
  reviews!: BatchReviewItemDto[];
}

export class HomeworkQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  sectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;

  @ApiPropertyOptional({ enum: HomeworkStatus })
  @IsOptional()
  @IsEnum(HomeworkStatus)
  status?: HomeworkStatus;

  @ApiPropertyOptional({ description: 'Only homework set by the signed-in teacher' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
