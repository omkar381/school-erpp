import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffAttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CheckInDto {
  @ApiPropertyOptional({ description: 'Device latitude, when GPS check-in is enabled' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ enum: ['MANUAL', 'QR', 'BIOMETRIC', 'GPS'], default: 'MANUAL' })
  @IsOptional()
  @IsIn(['MANUAL', 'QR', 'BIOMETRIC', 'GPS'])
  source?: string;
}

export class CheckOutDto extends CheckInDto {}

export class StaffAttendanceRecordDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  staffId!: string;

  @ApiProperty({ enum: StaffAttendanceStatus })
  @IsEnum(StaffAttendanceStatus)
  status!: StaffAttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600)
  lateMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  remarks?: string;
}

export class MarkStaffAttendanceDto {
  @ApiProperty({ example: '2026-08-24' })
  @IsDateString()
  date!: string;

  @ApiProperty({ type: [StaffAttendanceRecordDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => StaffAttendanceRecordDto)
  records!: StaffAttendanceRecordDto[];
}

export class StaffAttendanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  staffId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  departmentId?: string;

  @ApiPropertyOptional({ enum: StaffAttendanceStatus })
  @IsOptional()
  @IsEnum(StaffAttendanceStatus)
  status?: StaffAttendanceStatus;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
