import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek, PeriodType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreatePeriodDto {
  @ApiProperty({ example: 'Period 1' })
  @IsString()
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  sequence!: number;

  @ApiProperty({ example: '08:45' })
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @ApiProperty({ example: '09:30' })
  @Matches(TIME_PATTERN, { message: 'endTime must be HH:mm' })
  endTime!: string;

  @ApiPropertyOptional({ enum: PeriodType, default: PeriodType.CLASS })
  @IsOptional()
  @IsEnum(PeriodType)
  type?: PeriodType;

  @ApiPropertyOptional({ description: 'Restrict this period to one class level' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-5)
  @Max(15)
  appliesToLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;
}

export class UpsertSlotDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sectionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  periodId!: string;

  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  staffId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;
}

export class BulkSlotDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  periodId!: string;

  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  staffId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  roomId?: string;
}

export class BulkTimetableDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sectionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;

  @ApiProperty({ type: [BulkSlotDto], description: 'The complete week; anything omitted is removed' })
  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => BulkSlotDto)
  slots!: BulkSlotDto[];
}

export class CreateSubstitutionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  slotId!: string;

  @ApiProperty({ example: '2026-08-25' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Omit when cancelling the class instead' })
  @IsOptional()
  @IsUUID('4')
  substituteStaffId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @ApiPropertyOptional({ default: false, description: 'Cancel the class rather than substitute' })
  @IsOptional()
  @IsBoolean()
  isCancelled?: boolean;
}
