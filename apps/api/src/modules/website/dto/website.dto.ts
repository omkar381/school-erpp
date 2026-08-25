import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, GuardianRelation } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const slugify = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    : value;

// ---------------------------------------------------------------------------
// Content pages
// ---------------------------------------------------------------------------

/**
 * One block of page content.
 *
 * The public site renders a known set of block types; anything unrecognised is
 * skipped rather than crashing the page, so a newer editor cannot break an
 * older renderer.
 */
export class ContentBlockDto {
  @ApiProperty({
    enum: ['heading', 'paragraph', 'image', 'list', 'quote', 'stats', 'cards', 'cta'],
  })
  @IsIn(['heading', 'paragraph', 'image', 'list', 'quote', 'stats', 'cards', 'cta'])
  type!: string;

  @ApiPropertyOptional({ description: 'Block payload; shape depends on the type' })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class UpsertWebsitePageDto {
  @ApiProperty({ example: 'about' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(slugify)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug may contain only lowercase letters, numbers and hyphens' })
  slug!: string;

  @ApiProperty({ example: 'About our school' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @Transform(trim)
  title!: string;

  @ApiPropertyOptional({ type: [ContentBlockDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => ContentBlockDto)
  content?: ContentBlockDto[];

  @ApiPropertyOptional({ description: 'Short summary used in listings and link previews' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  excerpt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverImageUrl?: string;

  @ApiPropertyOptional({ description: 'Overrides the page title in search results' })
  @IsOptional()
  @IsString()
  @MaxLength(70)
  metaTitle?: string;

  @ApiPropertyOptional({ description: 'The snippet search engines show' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  metaDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  ogImageUrl?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  showInMenu?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

export class GalleryPhotoDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  storageKey?: string;
}

export class UpsertGalleryAlbumDto {
  @ApiProperty({ example: 'Annual Day 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trim)
  title!: string;

  @ApiPropertyOptional({ description: 'Derived from the title when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(slugify)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverImageUrl?: string;

  @ApiPropertyOptional({ example: '2026-11-06' })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ type: [GalleryPhotoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GalleryPhotoDto)
  photos?: GalleryPhotoDto[];
}

// ---------------------------------------------------------------------------
// Admission enquiry, submitted from the public site
// ---------------------------------------------------------------------------

export class PublicEnquiryDto {
  @ApiProperty({ example: 'Aarav' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(80)
  @Transform(trim)
  studentFirstName!: string;

  @ApiPropertyOptional({ example: 'Sharma' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  studentLastName?: string;

  @ApiPropertyOptional({ example: '2019-05-14' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiProperty({ example: 'Class 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Transform(trim)
  seekingClass!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  previousSchool?: string;

  @ApiProperty({ example: 'Rajesh Sharma' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  parentName!: string;

  @ApiPropertyOptional({ enum: GuardianRelation, default: GuardianRelation.FATHER })
  @IsOptional()
  @IsEnum(GuardianRelation)
  relation?: GuardianRelation;

  @ApiProperty({ example: '9845012345' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Enter a valid phone number' })
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  city?: string;

  @ApiPropertyOptional({ description: 'Anything else the parent wants to tell the school' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  notes?: string;

  /**
   * Honeypot. A real applicant never sees this field, so anything in it came
   * from a bot filling every input on the form.
   */
  @ApiPropertyOptional({ description: 'Leave empty' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
