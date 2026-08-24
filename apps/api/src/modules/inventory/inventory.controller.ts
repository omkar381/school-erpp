import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { BadRequestError, ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { InventoryService } from './inventory.service';
import {
  CancelPurchaseDto,
  CreateInventoryCategoryDto,
  CreateInventoryItemDto,
  CreatePurchaseDto,
  CreateSupplierDto,
  ItemQueryDto,
  PurchaseQueryDto,
  StockAdjustmentDto,
  StockLedgerQueryDto,
  StockMovementDto,
  UpdateInventoryItemDto,
  UpdateSupplierDto,
} from './dto/inventory.dto';

@ApiTags('Inventory')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.INVENTORY)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Stock value, low-stock count and spend this month' })
  statistics(@CurrentSchool() schoolId: string | null) {
    return this.inventory.statistics(this.school(schoolId));
  }

  // --- Categories -----------------------------------------------------------

  @Get('categories')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'List stock categories' })
  listCategories(@CurrentSchool() schoolId: string | null) {
    return this.inventory.listCategories(this.school(schoolId));
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Category created')
  @ApiOperation({ summary: 'Create a stock category' })
  createCategory(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateInventoryCategoryDto,
  ) {
    return this.inventory.createCategory(this.school(schoolId), dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Category deleted')
  @ApiOperation({ summary: 'Delete an empty category' })
  deleteCategory(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventory.deleteCategory(this.school(schoolId), id);
  }

  // --- Suppliers ------------------------------------------------------------

  @Get('suppliers')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'List suppliers' })
  listSuppliers(
    @CurrentSchool() schoolId: string | null,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.inventory.listSuppliers(this.school(schoolId), includeInactive === 'true');
  }

  @Post('suppliers')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Supplier added')
  @ApiOperation({ summary: 'Add a supplier' })
  createSupplier(@CurrentSchool() schoolId: string | null, @Body() dto: CreateSupplierDto) {
    return this.inventory.createSupplier(this.school(schoolId), dto);
  }

  @Patch('suppliers/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Supplier updated')
  @ApiOperation({ summary: 'Update or deactivate a supplier' })
  updateSupplier(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.inventory.updateSupplier(this.school(schoolId), id, dto);
  }

  // --- Items ----------------------------------------------------------------

  @Get('items')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'List stock items with valuation and low-stock flags' })
  listItems(@CurrentSchool() schoolId: string | null, @Query() query: ItemQueryDto) {
    return this.inventory.listItems(this.school(schoolId), query);
  }

  @Get('items/low-stock')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Items at or below their reorder level, worst first' })
  lowStock(@CurrentSchool() schoolId: string | null) {
    return this.inventory.lowStock(this.school(schoolId));
  }

  @Get('items/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Item detail with its recent stock movements' })
  getItem(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getItem(this.school(schoolId), id);
  }

  @Post('items')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Item created')
  @ApiOperation({ summary: 'Create a stock item with optional opening stock' })
  createItem(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateInventoryItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.createItem(this.school(schoolId), dto, user.id);
  }

  @Patch('items/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Item updated')
  @ApiOperation({ summary: 'Update an item; quantity only moves through the ledger' })
  updateItem(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return this.inventory.updateItem(this.school(schoolId), id, dto);
  }

  // --- Stock movement -------------------------------------------------------

  @Post('items/:id/stock-in')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Stock received')
  @ApiOperation({ summary: 'Take stock in' })
  stockIn(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.stockIn(this.school(schoolId), id, dto, user.id);
  }

  @Post('items/:id/stock-out')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Stock issued')
  @ApiOperation({ summary: 'Issue stock out, refusing to go negative' })
  stockOut(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.stockOut(this.school(schoolId), id, dto, user.id);
  }

  @Post('items/:id/write-off')
  @RequirePermissions(PERMISSIONS.INVENTORY_STOCK_ADJUST)
  @ResponseMessage('Stock written off')
  @ApiOperation({ summary: 'Write damaged or expired stock off' })
  writeOff(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.writeOff(this.school(schoolId), id, dto, user.id);
  }

  @Post('items/:id/adjust')
  @RequirePermissions(PERMISSIONS.INVENTORY_STOCK_ADJUST)
  @ResponseMessage('Stock adjusted')
  @ApiOperation({ summary: 'Reconcile the books to a physical count' })
  adjust(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.adjust(this.school(schoolId), id, dto, user.id);
  }

  @Get('ledger')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Stock movement ledger' })
  ledger(@CurrentSchool() schoolId: string | null, @Query() query: StockLedgerQueryDto) {
    return this.inventory.ledger(this.school(schoolId), query);
  }

  @Get('reports/consumption')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Consumption per item over a date range, costliest first' })
  consumption(
    @CurrentSchool() schoolId: string | null,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to) {
      throw new BadRequestError('Both from and to dates are required');
    }
    return this.inventory.consumptionReport(this.school(schoolId), from, to);
  }

  // --- Purchases ------------------------------------------------------------

  @Get('purchases')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'List purchases' })
  listPurchases(@CurrentSchool() schoolId: string | null, @Query() query: PurchaseQueryDto) {
    return this.inventory.listPurchases(this.school(schoolId), query);
  }

  @Get('purchases/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Purchase detail with its lines' })
  getPurchase(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getPurchase(this.school(schoolId), id);
  }

  @Post('purchases')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Purchase raised')
  @ApiOperation({ summary: 'Raise a purchase order; stock moves only on receipt' })
  createPurchase(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreatePurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.createPurchase(this.school(schoolId), dto, user.id);
  }

  @Post('purchases/:id/receive')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Purchase received into stock')
  @ApiOperation({ summary: 'Receive every line of a purchase into stock' })
  receivePurchase(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.receivePurchase(this.school(schoolId), id, user.id);
  }

  @Post('purchases/:id/cancel')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ResponseMessage('Purchase cancelled')
  @ApiOperation({ summary: 'Cancel a purchase that has not been received' })
  cancelPurchase(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPurchaseDto,
  ) {
    return this.inventory.cancelPurchase(this.school(schoolId), id, dto);
  }

  // --------------------------------------------------------------------------

  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError(
        'Select a school first. Super administrators must pass the X-School-Id header.',
      );
    }
    return schoolId;
  }
}
