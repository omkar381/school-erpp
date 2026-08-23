import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeaveApplicantType, LeaveStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateLeaveTypeDto {
  @ApiProperty({ example: 'Casual Leave' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'CL' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{1,20}$/)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;

  @ApiProperty({ enum: LeaveApplicantType })
  @IsEnum(LeaveApplicantType)
  applicableTo!: LeaveApplicantType;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  annualQuota?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  carryForward?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  maxCarryForward?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresDocument?: boolean;
}

export class ApplyLeaveDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Apply for a student; omit to apply as the signed-in staff member',
  })
  @IsOptional()
  @IsUUID('4')
  studentId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Apply on behalf of another staff member' })
  @IsOptional()
  @IsUUID('4')
  staffId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  leaveTypeId?: string;

  @ApiProperty({ example: '2026-09-10' })
  @IsDateString()
  fromDate!: string;

  @ApiProperty({ example: '2026-09-12' })
  @IsDateString()
  toDate!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean;

  @ApiProperty({ example: 'Attending a family function out of town' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class ReviewLeaveDto {
  @ApiProperty({
    enum: [LeaveStatus.APPROVED, LeaveStatus.REJECTED, LeaveStatus.CHANGES_REQUESTED],
  })
  @IsIn([LeaveStatus.APPROVED, LeaveStatus.REJECTED, LeaveStatus.CHANGES_REQUESTED])
  status!: LeaveStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class LeaveQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LeaveStatus })
  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @ApiPropertyOptional({ enum: LeaveApplicantType })
  @IsOptional()
  @IsEnum(LeaveApplicantType)
  applicantType?: LeaveApplicantType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  staffId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
