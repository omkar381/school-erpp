import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

/** The categories the ticket form offers. Free text would make triage useless. */
export const TICKET_CATEGORIES = [
  'GENERAL',
  'TECHNICAL',
  'BILLING',
  'ACCOUNT',
  'ATTENDANCE',
  'FEES',
  'EXAMS',
  'TRANSPORT',
  'LIBRARY',
  'FEATURE_REQUEST',
  'BUG',
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  GENERAL: 'General enquiry',
  TECHNICAL: 'Technical problem',
  BILLING: 'Billing and subscription',
  ACCOUNT: 'Account and access',
  ATTENDANCE: 'Attendance',
  FEES: 'Fees and payments',
  EXAMS: 'Examinations and results',
  TRANSPORT: 'Transport',
  LIBRARY: 'Library',
  FEATURE_REQUEST: 'Feature request',
  BUG: 'Bug report',
};

export class TicketQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ enum: TICKET_CATEGORIES })
  @IsOptional()
  @IsIn(TICKET_CATEGORIES)
  category?: TicketCategory;

  @ApiPropertyOptional({ description: 'Only tickets assigned to this agent' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ description: 'Only tickets raised by this user' })
  @IsOptional()
  @IsUUID()
  requesterId?: string;

  @ApiPropertyOptional({ description: 'Platform view only: narrow to one school' })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({ description: 'Only tickets nobody has picked up' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unassigned?: boolean;

  @ApiPropertyOptional({ description: 'Exclude resolved and closed tickets' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  openOnly?: boolean;

  @ApiPropertyOptional({ description: 'Restrict to tickets the caller raised' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;
}

export class CreateTicketDto {
  @ApiProperty({ example: 'Cannot download the Class 8 attendance report' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(200)
  @Transform(trim)
  subject!: string;

  @ApiProperty({ enum: TICKET_CATEGORIES, default: 'GENERAL' })
  @IsOptional()
  @IsIn(TICKET_CATEGORIES)
  category?: TicketCategory;

  @ApiPropertyOptional({ enum: TicketPriority, default: TicketPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiProperty({ example: 'The export button spins and nothing downloads. Chrome, since Tuesday.' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  @Transform(trim)
  description!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Ids of files already uploaded through /support/tickets/attachments',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}

export class ReplyTicketDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5000)
  @Transform(trim)
  body!: string;

  @ApiPropertyOptional({
    description: 'Support staff only — an internal note the requester never sees',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isInternal?: boolean;

  @ApiPropertyOptional({ enum: TicketStatus, description: 'Move the ticket as you reply' })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}

export class AssignTicketDto {
  @ApiPropertyOptional({ description: 'Omit to unassign' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  note?: string;
}

export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ enum: TICKET_CATEGORIES })
  @IsOptional()
  @IsIn(TICKET_CATEGORIES)
  category?: TicketCategory;

  @ApiPropertyOptional({ description: 'Reason, recorded on the ticket history' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  note?: string;
}

export class CloseTicketDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  comment?: string;
}

export class TicketStatsQueryDto {
  @ApiPropertyOptional({ description: 'Platform view only: narrow to one school' })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({ description: 'Window for the resolution figures, in days', default: 30 })
  @IsOptional()
  @Type(() => Number)
  days?: number;
}
