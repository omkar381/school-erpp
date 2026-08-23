import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ enum: RoleType })
  @IsEnum(RoleType)
  type!: RoleType;

  @ApiProperty({ example: 'Senior Accountant' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ type: [String], example: ['students.view', 'fees.collect'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(400)
  permissions?: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class SetRolePermissionsDto {
  @ApiProperty({
    type: [String],
    description: 'The complete permission set for this role; anything omitted is revoked',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(400)
  permissions!: string[];
}

export class AssignRolesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  roleIds!: string[];
}

export class PermissionOverrideDto {
  @ApiProperty({ example: 'fees.refund' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ description: 'true grants the permission, false explicitly denies it' })
  @IsBoolean()
  effect!: boolean;
}

export class SetUserPermissionsDto {
  @ApiProperty({ type: [PermissionOverrideDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideDto)
  overrides!: PermissionOverrideDto[];
}
