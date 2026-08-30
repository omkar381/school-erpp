import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentOwnerType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export class CreateCategoryDto {
  @ApiProperty({ example: 'Birth certificate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiProperty({ example: 'BIRTH_CERT' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '_') : value,
  )
  code!: string;

  @ApiPropertyOptional({ enum: DocumentOwnerType, default: DocumentOwnerType.GENERIC })
  @IsOptional()
  @IsEnum(DocumentOwnerType)
  ownerType?: DocumentOwnerType;

  @ApiPropertyOptional({ description: 'Flagged on records that have not supplied it' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ description: 'Documents in this category carry an expiry date' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasExpiry?: boolean;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export class DocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DocumentOwnerType })
  @IsOptional()
  @IsEnum(DocumentOwnerType)
  ownerType?: DocumentOwnerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  guardianId?: string;

  @ApiPropertyOptional({ description: 'Only documents still awaiting verification' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unverifiedOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only documents already past their expiry date' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  expiredOnly?: boolean;

  @ApiPropertyOptional({ description: 'Documents expiring within this many days' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  expiringWithinDays?: number;
}

/**
 * The metadata that travels alongside an upload.
 *
 * Multipart form fields arrive as strings, so the booleans are coerced rather
 * than validated strictly.
 */
export class UploadDocumentDto {
  @ApiProperty({ enum: DocumentOwnerType })
  @IsEnum(DocumentOwnerType)
  ownerType!: DocumentOwnerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Required when ownerType is STUDENT' })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ description: 'Required when ownerType is STAFF' })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional({ description: 'Required when ownerType is PARENT' })
  @IsOptional()
  @IsUUID()
  guardianId?: string;

  @ApiProperty({ example: "Aarav's birth certificate" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(trim)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Public documents are served directly; everything else needs a signed link',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdateDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(trim)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class VerifyDocumentDto {
  @ApiProperty({ description: 'False sends the document back as unverified' })
  @Transform(toBoolean)
  @IsBoolean()
  isVerified!: boolean;
}
