import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HomeworkStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sectionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  subjectId!: string;

  @ApiProperty({ example: 'Term Project — Renewable Energy' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({ description: 'Detailed instructions or a rubric' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  instructions?: string;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  maxMarks?: number;

  @ApiPropertyOptional({ description: 'Percentage contribution to the term grade' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weightage?: number;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ example: '2026-09-15T23:59:00.000Z' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;

  @ApiPropertyOptional({ description: 'Percentage deducted from a late submission' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  latePenaltyPercent?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpdateAssignmentDto {
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
  @IsString()
  @MaxLength(5000)
  instructions?: string;

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
  @Max(100)
  weightage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  latePenaltyPercent?: number;

  @ApiPropertyOptional({ enum: HomeworkStatus })
  @IsOptional()
  @IsEnum(HomeworkStatus)
  status?: HomeworkStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class SubmitAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;
}

export class GradeSubmissionDto {
  @ApiProperty({ description: 'Raw marks; any late penalty is applied on top' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  marksAwarded!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  grade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;
}

export class AssignmentQueryDto extends PaginationQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;
}
