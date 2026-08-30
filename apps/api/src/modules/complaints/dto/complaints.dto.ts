import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplaintStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

/**
 * The grievance categories the form offers.
 *
 * Held as strings rather than a database enum so a school can add a category
 * without a migration, but fixed at the API so reporting stays possible.
 */
export const COMPLAINT_CATEGORIES = [
  'ACADEMIC',
  'DISCIPLINE',
  'BULLYING',
  'HARASSMENT',
  'INFRASTRUCTURE',
  'TRANSPORT',
  'HOSTEL',
  'CANTEEN',
  'FEES',
  'STAFF_CONDUCT',
  'SAFETY',
  'OTHER',
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  ACADEMIC: 'Academic',
  DISCIPLINE: 'Discipline',
  BULLYING: 'Bullying',
  HARASSMENT: 'Harassment',
  INFRASTRUCTURE: 'Infrastructure and facilities',
  TRANSPORT: 'Transport',
  HOSTEL: 'Hostel',
  CANTEEN: 'Canteen and food',
  FEES: 'Fees and billing',
  STAFF_CONDUCT: 'Staff conduct',
  SAFETY: 'Safety and security',
  OTHER: 'Other',
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export class ComplaintQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @ApiPropertyOptional({ enum: COMPLAINT_CATEGORIES })
  @IsOptional()
  @IsIn(COMPLAINT_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional({ description: 'Complaints raised about this student' })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ description: 'Only complaints still awaiting an outcome' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  openOnly?: boolean;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export class CreateComplaintDto {
  @ApiProperty({ enum: COMPLAINT_CATEGORIES })
  @IsIn(COMPLAINT_CATEGORIES as unknown as string[])
  category!: string;

  @ApiProperty({ example: 'Bus 12 has been arriving 20 minutes late all week' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(200)
  @Transform(trim)
  subject!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  @Transform(trim)
  description!: string;

  @ApiPropertyOptional({ description: 'The student this complaint concerns, if any' })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Hides the reporter from everyone but the complaint handlers',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isAnonymous?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Ids from the attachment upload endpoint' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}

export class UpdateComplaintStatusDto {
  @ApiProperty({ enum: ComplaintStatus })
  @IsEnum(ComplaintStatus)
  status!: ComplaintStatus;

  @ApiPropertyOptional({
    description: 'What was done about it. Required when resolving or dismissing.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  resolution?: string;
}

export class UpdateComplaintDto {
  @ApiPropertyOptional({ enum: COMPLAINT_CATEGORIES })
  @IsOptional()
  @IsIn(COMPLAINT_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  @Transform(trim)
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  @Transform(trim)
  description?: string;
}
