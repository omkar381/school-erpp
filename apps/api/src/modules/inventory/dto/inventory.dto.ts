import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockTransactionType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
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

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const code = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '-') : value;

/** Units the school can keep stock in. Anything else is a data-entry slip. */
export const STOCK_UNITS = [
  'PCS',
  'BOX',
  'PKT',
  'SET',
  'PAIR',
  'KG',
  'GRAM',
  'LITRE',
  'METRE',
  'REAM',
  'DOZEN',
] as const;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export class CreateInventoryCategoryDto {
  @ApiProperty({ example: 'Stationery' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(trim)
  name!: string;

  @ApiProperty({ example: 'STAT' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Transform(code)
  code!: string;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export class CreateSupplierDto {
  @ApiProperty({ example: 'Sharma Stationers' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(trim)
  name!: string;

  @ApiProperty({ example: 'SUP-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Transform(code)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  contactPerson?: string;

  @ApiPropertyOptional({ example: '9845012345' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: '29ABCDE1234F1Z5' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(code)
  gstNumber?: string;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(trim)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  contactPerson?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(code)
  gstNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export class CreateInventoryItemDto {
  @ApiProperty({ example: 'A4 Copier Paper 75gsm' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(trim)
  name!: string;

  @ApiProperty({ example: 'STAT-A4-75' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Transform(code)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: STOCK_UNITS, default: 'PCS' })
  @IsOptional()
  @IsIn(STOCK_UNITS as unknown as string[])
  unit?: string;

  @ApiPropertyOptional({ example: 20, description: 'Raises a low-stock alert at or below this' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  reorderLevel?: number;

  @ApiPropertyOptional({ example: 280 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  unitCost?: number;

  @ApiPropertyOptional({ example: 'Store room B' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  location?: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Opening stock, recorded as the first STOCK_IN',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  openingQuantity?: number;
}

export class UpdateInventoryItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(trim)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: STOCK_UNITS })
  @IsOptional()
  @IsIn(STOCK_UNITS as unknown as string[])
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  reorderLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  unitCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}

export class ItemQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Only items at or below their reorder level' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  lowStockOnly?: boolean;

  @ApiPropertyOptional({ description: 'Include retired items' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

// ---------------------------------------------------------------------------
// Stock movement
// ---------------------------------------------------------------------------

export class StockMovementDto {
  @ApiProperty({ example: 50, description: 'Always positive; the type sets the direction' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;

  @ApiPropertyOptional({ example: 280, description: 'Overrides the item cost for this receipt' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  unitCost?: number;

  @ApiPropertyOptional({ example: 'PO/00021' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  reference?: string;

  @ApiPropertyOptional({ enum: ['STAFF', 'STUDENT', 'CLASS', 'DEPARTMENT'] })
  @IsOptional()
  @IsIn(['STAFF', 'STUDENT', 'CLASS', 'DEPARTMENT'])
  issuedToType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  issuedToId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class StockAdjustmentDto {
  @ApiProperty({ example: 48, description: 'The counted quantity the books should show' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  countedQuantity!: number;

  @ApiProperty({ example: 'Physical stock count, 2 reams water damaged' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class StockLedgerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ enum: StockTransactionType })
  @IsOptional()
  @IsEnum(StockTransactionType)
  type?: StockTransactionType;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export class PurchaseLineDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;

  @ApiProperty({ example: 280 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  unitCost!: number;

  @ApiPropertyOptional({ example: 12, description: 'GST percentage on this line' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxPercent?: number;
}

export class CreatePurchaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'INV-4471' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  invoiceNumber?: string;

  @ApiProperty({ example: '2026-04-12' })
  @IsDateString()
  purchaseDate!: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'ORDERED'], default: 'DRAFT' })
  @IsOptional()
  @IsIn(['DRAFT', 'ORDERED'])
  status?: 'DRAFT' | 'ORDERED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [PurchaseLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items!: PurchaseLineDto[];
}

export class PurchaseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'])
  status?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class CancelPurchaseDto {
  @ApiProperty({ example: 'Supplier could not deliver' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}
