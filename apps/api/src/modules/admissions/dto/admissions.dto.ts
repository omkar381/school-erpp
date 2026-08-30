import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdmissionEnquiryStatus, Gender, GuardianRelation } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const lower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Where an enquiry came from. Held as a plain string rather than a database
 * enum so a school can report on a new campaign without a migration.
 */
export const ENQUIRY_SOURCES = [
  'WALK_IN',
  'WEBSITE',
  'PHONE',
  'REFERRAL',
  'SOCIAL_MEDIA',
  'ADVERTISEMENT',
] as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export class EnquiryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AdmissionEnquiryStatus })
  @IsOptional()
  @IsEnum(AdmissionEnquiryStatus)
  status?: AdmissionEnquiryStatus;

  @ApiPropertyOptional({ enum: ENQUIRY_SOURCES })
  @IsOptional()
  @IsIn(ENQUIRY_SOURCES as unknown as string[])
  source?: string;

  @ApiPropertyOptional({ description: 'Class the applicant is seeking' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  seekingClass?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiPropertyOptional({ description: 'Only enquiries whose follow-up date has passed' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdueOnly?: boolean;

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
// Intake and edits
// ---------------------------------------------------------------------------

export class CreateEnquiryDto {
  @ApiProperty({ example: 'Aarav' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(trim)
  studentFirstName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  studentLastName?: string;

  @ApiPropertyOptional({ example: '2018-06-15' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiProperty({ example: 'Grade 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Transform(trim)
  seekingClass!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  previousSchool?: string;

  @ApiProperty({ example: 'Rohan Sharma' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trim)
  parentName!: string;

  @ApiPropertyOptional({ enum: GuardianRelation, default: GuardianRelation.FATHER })
  @IsOptional()
  @IsEnum(GuardianRelation)
  relation?: GuardianRelation;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be a valid mobile number' })
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Transform(lower)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  city?: string;

  @ApiPropertyOptional({ enum: ENQUIRY_SOURCES, default: 'WALK_IN' })
  @IsOptional()
  @IsIn(ENQUIRY_SOURCES as unknown as string[])
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  notes?: string;

  @ApiPropertyOptional({ description: 'ISO date for the next follow-up call' })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @ApiPropertyOptional({ description: 'Staff user who owns this enquiry' })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;
}

export class UpdateEnquiryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(trim)
  studentFirstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  studentLastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Transform(trim)
  seekingClass?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  previousSchool?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trim)
  parentName?: string;

  @ApiPropertyOptional({ enum: GuardianRelation })
  @IsOptional()
  @IsEnum(GuardianRelation)
  relation?: GuardianRelation;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be a valid mobile number' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Transform(lower)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  city?: string;

  @ApiPropertyOptional({ enum: ENQUIRY_SOURCES })
  @IsOptional()
  @IsIn(ENQUIRY_SOURCES as unknown as string[])
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToId?: string;
}

export class UpdateEnquiryStatusDto {
  @ApiProperty({ enum: AdmissionEnquiryStatus })
  @IsEnum(AdmissionEnquiryStatus)
  status!: AdmissionEnquiryStatus;

  @ApiPropertyOptional({ description: 'Appended to the enquiry log with a timestamp' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  note?: string;

  @ApiPropertyOptional({ description: 'Required when moving to REJECTED' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  rejectionReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  followUpDate?: string;
}

export class AssignEnquiryDto {
  @ApiPropertyOptional({ description: 'Omit to clear the assignment' })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export class ConvertGuardianDto {
  @ApiPropertyOptional({ description: 'Link an existing guardian instead of creating one' })
  @IsOptional()
  @IsUUID('4')
  guardianId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  lastName?: string;

  @ApiProperty({ enum: GuardianRelation })
  @IsEnum(GuardianRelation)
  relation!: GuardianRelation;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Transform(lower)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be a valid mobile number' })
  phone?: string;
}

export class ConvertEnquiryDto {
  @ApiProperty({ description: 'Class to admit into' })
  @IsUUID()
  classId!: string;

  @ApiProperty({ description: 'Section to admit into' })
  @IsUUID()
  sectionId!: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  admissionDate!: string;

  @ApiPropertyOptional({ description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiPropertyOptional({ description: 'Generated automatically when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  admissionNumber?: string;

  @ApiPropertyOptional({ description: 'Required when the enquiry did not capture one' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    enum: Gender,
    description: 'Required when the enquiry did not capture one',
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    type: [ConvertGuardianDto],
    description: 'Defaults to a single guardian built from the enquiry contact',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConvertGuardianDto)
  guardians?: ConvertGuardianDto[];

  @ApiPropertyOptional({ description: 'Also create a portal login for the student' })
  @IsOptional()
  @IsBoolean()
  createLogin?: boolean;
}
