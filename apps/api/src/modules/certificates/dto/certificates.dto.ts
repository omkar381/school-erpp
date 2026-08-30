import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CertificateType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export class CreateTemplateDto {
  @ApiProperty({ enum: CertificateType })
  @IsEnum(CertificateType)
  type!: CertificateType;

  @ApiProperty({ example: 'Bonafide certificate (English)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiProperty({
    description: 'Body text. Placeholders are written as {{name}} and filled at issue time.',
    example: 'This is to certify that {{studentName}} is a bonafide student of {{className}}.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  bodyTemplate!: string;

  @ApiPropertyOptional({ description: 'Text printed above the body' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  headerHtml?: string;

  @ApiPropertyOptional({ description: 'Text printed below the body' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  footerHtml?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Extra placeholders this template expects beyond the built-in ones',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  variables?: string[];
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trim)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  bodyTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  headerHtml?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  footerHtml?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  variables?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

export class CertificateQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CertificateType })
  @IsOptional()
  @IsEnum(CertificateType)
  type?: CertificateType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ description: 'Include revoked certificates' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeRevoked?: boolean;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class IssueCertificateDto {
  @ApiProperty({ enum: CertificateType })
  @IsEnum(CertificateType)
  type!: CertificateType;

  @ApiPropertyOptional({ description: 'Defaults to the active template for this type' })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({ description: 'The student this certificate is about' })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ description: 'The staff member this certificate is about' })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  issuedOn?: string;

  @ApiPropertyOptional({
    description: 'Values for the template placeholders, merged over the auto-filled ones',
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;
}

export class BulkIssueCertificateDto {
  @ApiProperty({ enum: CertificateType })
  @IsEnum(CertificateType)
  type!: CertificateType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiProperty({ type: [String], description: 'Students to issue for' })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  studentIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  issuedOn?: string;

  @ApiPropertyOptional({ description: 'Applied to every certificate in the batch' })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;
}

export class RevokeCertificateDto {
  @ApiProperty({ example: 'Issued against the wrong academic year' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

// ---------------------------------------------------------------------------
// ID cards
// ---------------------------------------------------------------------------

export class IdCardQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional({ description: 'Include cards that have been deactivated' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

export class IssueIdCardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  issuedOn?: string;

  @ApiPropertyOptional({ description: 'Defaults to the end of the current academic year' })
  @IsOptional()
  @IsDateString()
  validTill?: string;
}
