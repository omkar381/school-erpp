import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmploymentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { COMPONENT_CALCS, COMPONENT_TYPES } from '../payroll.types';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export class SalaryComponentDto {
  @ApiProperty({ example: 'House Rent Allowance' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(trim)
  name!: string;

  @ApiProperty({ enum: COMPONENT_TYPES })
  @IsIn(COMPONENT_TYPES as unknown as string[])
  type!: 'EARNING' | 'DEDUCTION';

  @ApiProperty({ enum: COMPONENT_CALCS })
  @IsIn(COMPONENT_CALCS as unknown as string[])
  calc!: 'FIXED' | 'PERCENT_OF_BASIC';

  @ApiProperty({
    description: 'A rupee amount when calc is FIXED, otherwise a percentage of basic',
    example: 40,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  // A single component above a crore, or a percentage above 100, is a typo
  // rather than a salary — and one that would otherwise be paid out.
  @Max(10_000_000)
  value!: number;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export class SalaryStructureQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only structures for this staff member' })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ enum: EmploymentStatus })
  @IsOptional()
  @IsEnum(EmploymentStatus)
  employmentStatus?: EmploymentStatus;

  @ApiPropertyOptional({
    default: true,
    description: 'Only each staff member\'s currently effective structure',
  })
  @IsOptional()
  @Transform(({ value }) => value !== false && value !== 'false')
  currentOnly?: boolean = true;
}

export class PayrollRegisterQueryDto {
  @ApiPropertyOptional({ description: 'Calendar month, 1-12. Defaults to the current month.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({ description: 'Four-digit year. Defaults to the current year.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export class CreateSalaryStructureDto {
  @ApiProperty()
  @IsUUID()
  staffId!: string;

  @ApiProperty({ description: 'The date this structure starts paying', example: '2026-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ example: 45000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  basicSalary!: number;

  @ApiPropertyOptional({ type: [SalaryComponentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];

  @ApiPropertyOptional({ default: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  notes?: string;
}

/**
 * A revision of an existing structure.
 *
 * `staffId` and `effectiveFrom` are deliberately absent: moving a structure to
 * another employee or another start date would silently rewrite payroll
 * history, so a change of either is a new structure instead.
 */
export class UpdateSalaryStructureDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  basicSalary?: number;

  @ApiPropertyOptional({ type: [SalaryComponentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  notes?: string;
}

/** Asks what a basic and a set of components would pay, without storing it. */
export class PreviewSalaryDto {
  @ApiProperty({ example: 45000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  basicSalary!: number;

  @ApiPropertyOptional({ type: [SalaryComponentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];
}
