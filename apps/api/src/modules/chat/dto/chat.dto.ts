import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateConversationDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Other participants' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  memberIds!: string[];

  @ApiPropertyOptional({ description: 'Required for a group conversation' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ enum: MessageType, default: MessageType.TEXT })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional({ description: 'Required for a text message' })
  @ValidateIf((dto: SendMessageDto) => !dto.type || dto.type === MessageType.TEXT)
  @IsString()
  @IsNotEmpty({ message: 'A message cannot be empty' })
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({
    description: 'Client-generated id used to de-duplicate a retried send',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientRef?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  replyToId?: string;
}

export class ReportMessageDto {
  @ApiProperty({ example: 'Inappropriate language' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class LockConversationDto {
  @ApiProperty()
  @IsBoolean()
  locked!: boolean;
}

export class MessageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Load messages older than this timestamp' })
  @IsOptional()
  @IsDateString()
  before?: string;
}
