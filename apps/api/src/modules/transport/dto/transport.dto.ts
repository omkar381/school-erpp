import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BloodGroup, TransportDirection, VehicleStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateVehicleDto {
  @ApiProperty({ example: 'KA01AB1234' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  registrationNumber!: string;

  @ApiPropertyOptional({ example: 'Bus 1' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ enum: ['BUS', 'VAN', 'CAR', 'OTHER'], default: 'BUS' })
  @IsOptional()
  @IsIn(['BUS', 'VAN', 'CAR', 'OTHER'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  make?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string;

  @ApiProperty({ example: 45 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  capacity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  insuranceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  insuranceExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fitnessExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  permitExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pollutionExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  gpsDeviceId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  trackingEnabled?: boolean;
}

export class CreateDriverDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '+919845100001' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  alternatePhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @ApiProperty({ example: 'KA0120150001234' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  licenseNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  licenseExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ enum: BloodGroup })
  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup;

  @ApiPropertyOptional({ enum: ['DRIVER', 'ATTENDANT'], default: 'DRIVER' })
  @IsOptional()
  @IsIn(['DRIVER', 'ATTENDANT'])
  role?: string;
}

export class RouteStopDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Omit to create a new stop' })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty({ example: 'Sarjapur Signal' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  sequence!: number;

  @ApiPropertyOptional({ example: '07:15' })
  @IsOptional()
  @Matches(TIME, { message: 'pickupTime must be HH:mm' })
  pickupTime?: string;

  @ApiPropertyOptional({ example: '15:45' })
  @IsOptional()
  @Matches(TIME, { message: 'dropTime must be HH:mm' })
  dropTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @ApiPropertyOptional({ default: 0, description: 'Surcharge on top of the route base fare' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fare?: number;
}

export class CreateRouteDto {
  @ApiProperty({ example: 'Route A — Sarjapur' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'RT-A' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  vehicleId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  driverId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  attendantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  distanceKm?: number;

  @ApiPropertyOptional({ example: '07:00' })
  @IsOptional()
  @Matches(TIME)
  startTime?: string;

  @ApiPropertyOptional({ example: '08:15' })
  @IsOptional()
  @Matches(TIME)
  endTime?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseFare?: number;

  @ApiPropertyOptional({ type: [RouteStopDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => RouteStopDto)
  stops?: RouteStopDto[];
}

export class UpdateRouteStopsDto {
  @ApiProperty({ type: [RouteStopDto], description: 'The complete stop list for the route' })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => RouteStopDto)
  stops!: RouteStopDto[];
}

export class AssignTransportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  studentId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  routeId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  pickupStopId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  dropStopId?: string;

  @ApiPropertyOptional({ enum: TransportDirection, default: TransportDirection.BOTH })
  @IsOptional()
  @IsEnum(TransportDirection)
  direction?: TransportDirection;

  @ApiPropertyOptional({ description: 'Overrides the computed route and stop fare' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fareAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;
}

export class VehiclePositionDto {
  @ApiProperty({ example: 12.9081 })
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 77.6476 })
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(200)
  speedKph?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}

export class VehicleQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: VehicleStatus })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;
}
