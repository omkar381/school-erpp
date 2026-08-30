import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** The document counters a school may configure. Mirrors SequenceKind. */
export const SEQUENCE_KINDS = [
  'INVOICE',
  'RECEIPT',
  'REFUND',
  'ADMISSION',
  'ENQUIRY',
  'CERTIFICATE',
  'TICKET',
  'ID_CARD',
  'PURCHASE',
  'ACCESSION',
  'LIBRARY_CARD',
  'EMPLOYEE',
] as const;

export type SequenceKindName = (typeof SEQUENCE_KINDS)[number];

export class SequenceSettingDto {
  @ApiProperty({ enum: SEQUENCE_KINDS })
  @IsIn(SEQUENCE_KINDS as unknown as string[])
  kind!: string;

  @ApiPropertyOptional({
    description: 'Leading text, e.g. "INV". Letters, digits and dashes only.',
    example: 'INV',
  })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Matches(/^[A-Za-z0-9-]*$/, {
    message: 'prefix may only contain letters, digits and dashes',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  prefix?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, description: 'Digits the number is padded to' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  padding?: number;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'The next number to allocate. Can only be moved forwards.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  nextValue?: number;
}

export class UpdateSequencesDto {
  @ApiProperty({ type: [SequenceSettingDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SequenceSettingDto)
  sequences!: SequenceSettingDto[];
}
