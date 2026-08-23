import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { SchoolStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsHexColor,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class SchoolAdminSeedDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiProperty()
  @IsEmail()
  @Transform(lower)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Leave blank to auto-generate and email a temporary password',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

export class CreateSchoolDto {
  @ApiProperty({ example: 'Greenfield International School' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(160)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ example: 'Greenfield Education Trust' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  legalName?: string;

  @ApiProperty({ example: 'GFIS', description: 'Short unique code used in document numbering' })
  @IsString()
  @Matches(/^[A-Z0-9]{2,12}$/, {
    message: 'code must be 2-12 uppercase letters or digits',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;

  @ApiPropertyOptional({
    example: 'greenfield-international',
    description: 'URL slug for the public website. Derived from the name when omitted.',
  })
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lowercase and hyphen-separated' })
  @MaxLength(80)
  slug?: string;

  @ApiProperty({ example: 'office@greenfield.edu' })
  @IsEmail()
  @Transform(lower)
  email!: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be a valid number' })
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  alternatePhone?: string;

  @ApiPropertyOptional({ example: 'https://greenfield.edu' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  website?: string;

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

  @ApiPropertyOptional({ example: 'Bengaluru' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ example: 'Karnataka' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional({ default: 'India' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional({ example: '560001' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ example: 'CBSE' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  board?: string;

  @ApiPropertyOptional({ example: '830245' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  affiliationNumber?: string;

  @ApiPropertyOptional({ example: 1998 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1800)
  @Max(2100)
  establishedYear?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  principalName?: string;

  @ApiPropertyOptional({ default: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional({ default: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ default: 'en', enum: ['en', 'hi', 'kn'] })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  locale?: string;

  @ApiPropertyOptional({ description: 'Subscription plan code to start the school on' })
  @IsOptional()
  @IsString()
  planCode?: string;

  @ApiPropertyOptional({ description: 'Details of the first school administrator account' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SchoolAdminSeedDto)
  admin?: SchoolAdminSeedDto;
}


export class UpdateSchoolDto extends PartialType(
  OmitType(CreateSchoolDto, ['code', 'planCode', 'admin'] as const),
) {}

export class UpdateBrandingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  faviconUrl?: string;

  @ApiPropertyOptional({ example: '#0F172A' })
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#2563EB' })
  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @ApiPropertyOptional({ description: 'Header line printed on report cards' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reportCardHeader?: string;

  @ApiPropertyOptional({ description: 'Footer text printed on invoices and receipts' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  invoiceFooter?: string;
}

export class UpdateModulesDto {
  @ApiProperty({
    description: 'Module key to enabled flag, e.g. { "library": true, "transport": false }',
    example: { library: true, transport: false },
  })
  @IsObject()
  modules!: Record<string, boolean>;
}

export class UpdateSettingsDto {
  @ApiProperty({ description: 'Partial settings object; merged with the existing settings' })
  @IsObject()
  settings!: Record<string, unknown>;
}

export class SchoolQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SchoolStatus })
  @IsOptional()
  @IsEnum(SchoolStatus)
  status?: SchoolStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  board?: string;

  @ApiPropertyOptional({ description: 'Only schools with an active subscription' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  activeOnly?: boolean;
}

export class SchoolTimingsDto {
  @ApiProperty({ example: '08:30' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @ApiProperty({ example: '15:30' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:mm' })
  endTime!: string;

  @ApiProperty({
    example: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    isArray: true,
  })
  @IsString({ each: true })
  workingDays!: string[];

  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  lunchStart?: string;

  @ApiPropertyOptional({ example: '13:40' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  lunchEnd?: string;
}
