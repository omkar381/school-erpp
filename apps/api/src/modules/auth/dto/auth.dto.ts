import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DevicePlatform } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class DeviceInfoDto {
  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @ApiPropertyOptional({ example: 'Pixel 8' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @ApiPropertyOptional({ example: 'Pixel 8 Pro' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceModel?: string;

  @ApiPropertyOptional({ example: 'Android 15' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  osVersion?: string;

  @ApiPropertyOptional({ example: '1.4.0' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  appVersion?: string;

  @ApiPropertyOptional({ description: 'Firebase Cloud Messaging registration token' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fcmToken?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'admin@school.edu', description: 'Email address or mobile number' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(lower)
  identifier!: string;

  @ApiProperty({ example: 'SecurePass@123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    description: 'Required only when the same identifier exists in multiple schools',
  })
  @IsOptional()
  @IsUUID('4')
  schoolId?: string;

  @ApiPropertyOptional({ type: DeviceInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device?: DeviceInfoDto;
}

export class RequestOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be a valid mobile number' })
  @Transform(trim)
  phone!: string;

  @ApiPropertyOptional({ enum: ['LOGIN', 'VERIFY_PHONE', 'RESET_PASSWORD'], default: 'LOGIN' })
  @IsOptional()
  @IsString()
  purpose?: 'LOGIN' | 'VERIFY_PHONE' | 'RESET_PASSWORD';
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  @Transform(trim)
  phone!: string;

  @ApiProperty({ example: '482913' })
  @IsString()
  @Length(4, 8)
  code!: string;

  @ApiPropertyOptional({ default: 'LOGIN' })
  @IsOptional()
  @IsString()
  purpose?: 'LOGIN' | 'VERIFY_PHONE' | 'RESET_PASSWORD';

  @ApiPropertyOptional({ type: DeviceInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device?: DeviceInfoDto;
}

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description: 'Omit when the refresh token is supplied via the httpOnly cookie',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(lower)
  identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ minLength: 8, example: 'NewSecure@123' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;

  @ApiPropertyOptional({
    description: 'Sign out every other device after the password changes',
    default: true,
  })
  @IsOptional()
  revokeOtherSessions?: boolean;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty()
  @IsEmail()
  @Transform(lower)
  email!: string;
}

export class RegisterDeviceDto extends DeviceInfoDto {}

export class RevokeSessionDto {
  @ApiProperty()
  @IsUUID('4')
  sessionId!: string;
}
