import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LibraryIssueStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export class BookQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Only titles with a copy on the shelf' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  availableOnly?: boolean;
}

export class CreateBookDto {
  @ApiProperty({ example: 'A Brief History of Time' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  @Transform(trim)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(250)
  @Transform(trim)
  subtitle?: string;

  @ApiProperty({ example: 'Stephen Hawking' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(trim)
  author!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(150, { each: true })
  coAuthors?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(trim)
  publisher?: string;

  @ApiPropertyOptional({ example: '9780553380163', description: 'ISBN-10 or ISBN-13' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : value,
  )
  @Matches(/^(\d{9}[\dX]|\d{13})$/, {
    message: 'isbn must be a valid 10 or 13 digit ISBN',
  })
  isbn?: string;

  @ApiPropertyOptional({ example: '3rd' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  edition?: string;

  @ApiPropertyOptional({ default: 'English' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;

  @ApiPropertyOptional({ example: 1998 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1400)
  @Max(new Date().getFullYear() + 1)
  publishYear?: number;

  @ApiPropertyOptional({ example: 212 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20_000)
  pages?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverImageUrl?: string;

  @ApiPropertyOptional({ example: 'R3-S2' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  rackLocation?: string;

  @ApiPropertyOptional({ example: 499 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ example: 3, description: 'Physical copies to accession' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  copies!: number;
}

export class AddCopiesDto {
  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  count!: number;
}

// ---------------------------------------------------------------------------
// Circulation
// ---------------------------------------------------------------------------

export class IssueBookDto {
  @ApiPropertyOptional({ description: 'Any free copy of this title is chosen' })
  @IsOptional()
  @IsUUID()
  bookId?: string;

  @ApiPropertyOptional({ description: 'Issue this exact copy' })
  @IsOptional()
  @IsUUID()
  bookCopyId?: string;

  @ApiPropertyOptional({ description: 'Borrowing student — one of studentId or staffId' })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ description: 'Borrowing staff member' })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional({ description: 'Loan length; defaults to the library setting' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class ReturnBookDto {
  @ApiPropertyOptional({ enum: ['GOOD', 'FAIR', 'DAMAGED', 'LOST'], default: 'GOOD' })
  @IsOptional()
  @IsIn(['GOOD', 'FAIR', 'DAMAGED', 'LOST'])
  condition?: 'GOOD' | 'FAIR' | 'DAMAGED' | 'LOST';

  @ApiPropertyOptional({
    description: 'Overrides the book price when charging for a lost or damaged copy',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  replacementCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class IssueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LibraryIssueStatus })
  @IsOptional()
  @IsEnum(LibraryIssueStatus)
  status?: LibraryIssueStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ description: 'Only loans past their due date' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdueOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Fines
// ---------------------------------------------------------------------------

export class SettleFineDto {
  @ApiProperty({ example: 20 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  amount!: number;
}

export class WaiveFineDto {
  @ApiPropertyOptional({ description: 'Partial waiver; the whole balance if omitted' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  amount?: number;

  @ApiProperty({ example: 'Book returned late due to a medical absence' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}
