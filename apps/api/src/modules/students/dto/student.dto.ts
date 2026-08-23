import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { BloodGroup, Gender, GuardianRelation, StudentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class GuardianInputDto {
  @ApiPropertyOptional({ description: 'Link an existing guardian instead of creating a new one' })
  @IsOptional()
  @IsUUID('4')
  guardianId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  organization?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  qualification?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Receives fee invoices and can pay' })
  @IsOptional()
  @IsBoolean()
  isPayer?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  canPickup?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Create a parent portal login' })
  @IsOptional()
  @IsBoolean()
  createLogin?: boolean;
}

export class CreateStudentDto {
  @ApiPropertyOptional({ description: 'Generated automatically when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  admissionNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  rollNumber?: string;

  @ApiProperty({ example: 'Aarav' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(trim)
  firstName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  middleName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiProperty({ example: '2014-06-15' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty({ enum: Gender })
  @IsEnum(Gender)
  gender!: Gender;

  @ApiPropertyOptional({ enum: BloodGroup, default: BloodGroup.UNKNOWN })
  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @ApiPropertyOptional({ default: 'Indian' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nationality?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  religion?: string;

  @ApiPropertyOptional({ example: 'GENERAL' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  motherTongue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{12}$/, { message: 'aadhaarNumber must be 12 digits' })
  aadhaarNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Transform(lower)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  emergencyContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  emergencyContactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  emergencyRelation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  medicalConditions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  allergies?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  medications?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialNeeds?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  previousSchool?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  previousClass?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  transferCertificateNo?: string;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  admissionDate!: string;

  // --- Enrollment ---

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  classId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sectionId!: string;

  @ApiPropertyOptional({ description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;

  // --- Related records ---

  @ApiPropertyOptional({ type: [GuardianInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => GuardianInputDto)
  guardians?: GuardianInputDto[];

  @ApiPropertyOptional({ default: false, description: 'Create a student portal login' })
  @IsOptional()
  @IsBoolean()
  createLogin?: boolean;

  @ApiPropertyOptional({ description: 'School-specific extra fields' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateStudentDto extends PartialType(
  OmitType(CreateStudentDto, [
    'classId',
    'sectionId',
    'academicYearId',
    'guardians',
    'createLogin',
    'admissionNumber',
  ] as const),
) {}

export class StudentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: StudentStatus })
  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

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
  academicYearId?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Only students with an outstanding fee balance' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasDues?: boolean;

  @ApiPropertyOptional({ description: 'Students below this attendance percentage' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  attendanceBelow?: number;
}

export class TransferStudentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  toSectionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @ApiPropertyOptional({ description: 'Keep the existing roll number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  rollNumber?: string;
}

export class PromoteStudentsDto {
  @ApiProperty({ format: 'uuid', description: 'Academic year to promote into' })
  @IsUUID('4')
  toAcademicYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  fromSectionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  toSectionId!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Specific students to promote; all active students when omitted',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(500)
  studentIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Students to detain in the current class',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(500)
  detainedStudentIds?: string[];

  @ApiPropertyOptional({ default: true, description: 'Renumber roll numbers alphabetically' })
  @IsOptional()
  @IsBoolean()
  regenerateRollNumbers?: boolean;
}

export class ChangeStudentStatusDto {
  @ApiProperty({ enum: StudentStatus })
  @IsEnum(StudentStatus)
  status!: StudentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}

export class LinkGuardianDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  guardianId!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPayer?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  canPickup?: boolean;
}

export class BulkImportOptionsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sectionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Validate the file and report problems without writing anything',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Create parent portal logins' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  createGuardianLogins?: boolean;
}
