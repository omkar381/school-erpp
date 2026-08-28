import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchoolStatus, SubscriptionPlanTier, SubscriptionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ALL_MODULES } from '../../../common/constants/modules';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export class PlanQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionPlanTier })
  @IsOptional()
  @IsEnum(SubscriptionPlanTier)
  tier?: SubscriptionPlanTier;

  @ApiPropertyOptional({ description: 'Only plans that can be sold today' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  activeOnly?: boolean;
}

export class CreatePlanDto {
  @ApiProperty({ example: 'PROFESSIONAL_PLUS', description: 'Immutable machine code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'code must be upper snake case, e.g. PROFESSIONAL_PLUS',
  })
  @Transform(trim)
  code!: string;

  @ApiProperty({ example: 'Professional Plus' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(trim)
  name!: string;

  @ApiProperty({ enum: SubscriptionPlanTier })
  @IsEnum(SubscriptionPlanTier)
  tier!: SubscriptionPlanTier;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({ example: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  priceMonthly?: number;

  @ApiPropertyOptional({ example: 99990 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  priceYearly?: number;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ example: 2000, description: 'Enrolled students allowed' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxStudents?: number;

  @ApiPropertyOptional({ example: 250, description: 'Teaching and non-teaching staff allowed' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200_000)
  maxStaff?: number;

  @ApiPropertyOptional({ example: 25600, description: 'Total file storage in megabytes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(64)
  @Max(10_485_760)
  storageMb?: number;

  @ApiPropertyOptional({ type: [String], enum: ALL_MODULES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsIn(ALL_MODULES, { each: true })
  modules?: string[];

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Display order on the pricing page' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

/** Everything except `code`, which is referenced by billing records. */
export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(trim)
  name?: string;

  @ApiPropertyOptional({ enum: SubscriptionPlanTier })
  @IsOptional()
  @IsEnum(SubscriptionPlanTier)
  tier?: SubscriptionPlanTier;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  priceMonthly?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  priceYearly?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxStudents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200_000)
  maxStaff?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(64)
  @Max(10_485_760)
  storageMb?: number;

  @ApiPropertyOptional({ type: [String], enum: ALL_MODULES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsIn(ALL_MODULES, { each: true })
  modules?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class SetPlanActiveDto {
  @ApiProperty()
  @Transform(toBoolean)
  @IsBoolean()
  isActive!: boolean;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export class SubscriptionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({ description: 'Only subscriptions ending within N days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiringWithinDays?: number;
}

export class CreateSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  schoolId!: string;

  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({ enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Defaults to one billing cycle after the start date' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'], default: 'YEARLY' })
  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle?: 'MONTHLY' | 'YEARLY';

  @ApiPropertyOptional({ description: 'Overrides the price taken from the plan' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  autoRenew?: boolean;

  @ApiPropertyOptional({
    description: 'Per-school limit overrides, e.g. { "maxStudents": 3000 }',
    example: { maxStudents: 3000 },
  })
  @IsOptional()
  @IsObject()
  limitOverrides?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  notes?: string;

  @ApiPropertyOptional({
    description: "Also switch the school's modules to the ones the new plan includes",
    default: true,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  syncModules?: boolean;
}

export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'] })
  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle?: 'MONTHLY' | 'YEARLY';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  autoRenew?: boolean;

  @ApiPropertyOptional({ example: { maxStudents: 3000, storageMb: 51200 } })
  @IsOptional()
  @IsObject()
  limitOverrides?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  notes?: string;
}

export class ChangePlanDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({
    description: 'Realign the school module switches with the new plan',
    default: true,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  syncModules?: boolean;

  @ApiPropertyOptional({ description: 'Extend the end date to a full cycle from today' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  renew?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  reason?: string;
}

export class RenewSubscriptionDto {
  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'] })
  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle?: 'MONTHLY' | 'YEARLY';

  @ApiPropertyOptional({ description: 'Explicit new end date; overrides the billing cycle' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Cancel immediately rather than at the end of the paid period',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  immediate?: boolean;
}

export class SetLimitsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxStudents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200_000)
  maxStaff?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(64)
  @Max(10_485_760)
  storageMb?: number;

  @ApiPropertyOptional({ description: 'Clears every override and falls back to the plan' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  reset?: boolean;
}

// ---------------------------------------------------------------------------
// Schools (platform view)
// ---------------------------------------------------------------------------

export class PlatformSchoolQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SchoolStatus })
  @IsOptional()
  @IsEnum(SchoolStatus)
  status?: SchoolStatus;

  @ApiPropertyOptional({ enum: SubscriptionPlanTier })
  @IsOptional()
  @IsEnum(SubscriptionPlanTier)
  tier?: SubscriptionPlanTier;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  state?: string;

  @ApiPropertyOptional({ description: 'Only schools whose subscription ends within N days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiringWithinDays?: number;
}

export class SetSchoolStatusDto {
  @ApiProperty({ enum: SchoolStatus })
  @IsEnum(SchoolStatus)
  status!: SchoolStatus;

  @ApiPropertyOptional({ description: 'Recorded in the audit trail and sent to the school' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  reason?: string;
}

export class SetSchoolModulesDto {
  @ApiProperty({
    description: 'Module key to on/off. Only the keys sent are changed.',
    example: { library: true, transport: false },
  })
  @IsObject()
  modules!: Record<string, boolean>;

  @ApiPropertyOptional({
    description: 'Allow modules the plan does not include (super admin override)',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  ignorePlan?: boolean;
}

export class UpgradeRequestDto {
  @ApiPropertyOptional({ description: 'The plan the school is interested in' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  message?: string;
}
