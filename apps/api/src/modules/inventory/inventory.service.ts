import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  NotificationType,
  Prisma,
  StockTransactionType,
  UserStatus,
} from '@prisma/client';
import { PrismaService, type TransactionClient } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { PERMISSIONS } from '../../common/constants/permissions';
import { parseDateOnly } from '../../common/utils/date.util';
import { SequenceService } from '../../common/services/sequence.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
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

/** Movement types that add to stock; everything else subtracts. */
const INBOUND: StockTransactionType[] = [
  StockTransactionType.STOCK_IN,
  StockTransactionType.RETURN,
];

interface MovementContext {
  type: StockTransactionType;
  userId: string;
}

@Injectable()
export class InventoryService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('InventoryService');
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  async listCategories(schoolId: string) {
    const categories = await this.prisma.inventoryCategory.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true } } },
    });

    return categories.map(({ _count, ...category }) => ({
      ...category,
      itemCount: _count.items,
    }));
  }

  async createCategory(schoolId: string, dto: CreateInventoryCategoryDto) {
    const existing = await this.prisma.inventoryCategory.count({
      where: { schoolId, code: dto.code },
    });
    if (existing > 0) {
      throw new ConflictError(`A category with code ${dto.code} already exists`);
    }

    return this.prisma.inventoryCategory.create({
      data: { schoolId, name: dto.name, code: dto.code },
    });
  }

  async deleteCategory(schoolId: string, id: string) {
    const category = await this.prisma.inventoryCategory.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, _count: { select: { items: true } } },
    });
    if (!category) throw new NotFoundError('Category');

    if (category._count.items > 0) {
      throw new ConflictError(
        `${category._count.items} item(s) still sit in "${category.name}". Move them first.`,
      );
    }

    await this.prisma.inventoryCategory.delete({ where: { id } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Suppliers
  // -------------------------------------------------------------------------

  async listSuppliers(schoolId: string, includeInactive = false) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { schoolId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
      include: { _count: { select: { purchases: true } } },
    });

    return suppliers.map(({ _count, ...supplier }) => ({
      ...supplier,
      purchaseCount: _count.purchases,
    }));
  }

  async createSupplier(schoolId: string, dto: CreateSupplierDto) {
    const existing = await this.prisma.supplier.count({
      where: { schoolId, code: dto.code },
    });
    if (existing > 0) {
      throw new ConflictError(`A supplier with code ${dto.code} already exists`);
    }

    const supplier = await this.prisma.supplier.create({
      data: {
        schoolId,
        name: dto.name,
        code: dto.code,
        contactPerson: dto.contactPerson ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        gstNumber: dto.gstNumber ?? null,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'inventory',
      entity: 'Supplier',
      entityId: supplier.id,
      description: `Added supplier "${supplier.name}"`,
      schoolId,
    });

    return supplier;
  }

  async updateSupplier(schoolId: string, id: string, dto: UpdateSupplierDto) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, schoolId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundError('Supplier');

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.contactPerson !== undefined ? { contactPerson: dto.contactPerson } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.gstNumber !== undefined ? { gstNumber: dto.gstNumber } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  async listItems(schoolId: string, query: ItemQueryDto) {
    const where: Prisma.InventoryItemWhereInput = {
      schoolId,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { location: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      // `reorderLevel` is a column, so the comparison has to be raw.
      ...(query.lowStockOnly
        ? { quantity: { lte: this.prisma.inventoryItem.fields.reorderLevel } }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(['name', 'code', 'quantity', 'createdAt'] as const, 'name'),
        include: { category: { select: { id: true, name: true, code: true } } },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map((item) => ({
        ...item,
        stockValue: Number(item.quantity) * Number(item.unitCost),
        isLowStock: Number(item.quantity) <= Number(item.reorderLevel),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async getItem(schoolId: string, id: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, schoolId },
      include: {
        category: { select: { id: true, name: true } },
        transactions: {
          orderBy: { occurredAt: 'desc' },
          take: 20,
          select: {
            id: true,
            type: true,
            quantity: true,
            balanceAfter: true,
            reference: true,
            notes: true,
            occurredAt: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundError('Inventory item');

    return {
      ...item,
      stockValue: Number(item.quantity) * Number(item.unitCost),
      isLowStock: Number(item.quantity) <= Number(item.reorderLevel),
    };
  }

  async createItem(schoolId: string, dto: CreateInventoryItemDto, userId: string) {
    const existing = await this.prisma.inventoryItem.count({
      where: { schoolId, code: dto.code },
    });
    if (existing > 0) {
      throw new ConflictError(`An item with code ${dto.code} already exists`);
    }

    if (dto.categoryId) await this.assertCategory(schoolId, dto.categoryId);

    const opening = dto.openingQuantity ?? 0;

    const item = await this.prisma.transaction(async (tx) => {
      const created = await tx.inventoryItem.create({
        data: {
          schoolId,
          categoryId: dto.categoryId ?? null,
          name: dto.name,
          code: dto.code,
          description: dto.description ?? null,
          unit: dto.unit ?? 'PCS',
          quantity: opening,
          reorderLevel: dto.reorderLevel ?? 0,
          unitCost: dto.unitCost ?? 0,
          location: dto.location ?? null,
        },
      });

      // Opening stock is a real movement, so the ledger reconciles from zero.
      if (opening > 0) {
        await tx.stockTransaction.create({
          data: {
            schoolId,
            itemId: created.id,
            type: StockTransactionType.STOCK_IN,
            quantity: opening,
            balanceAfter: opening,
            unitCost: dto.unitCost ?? 0,
            reference: 'OPENING',
            notes: 'Opening stock',
            createdById: userId,
          },
        });
      }

      return created;
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: item.id,
      description: `Created item "${item.name}" (${item.code}) with opening stock ${opening}`,
      schoolId,
    });

    return item;
  }

  async updateItem(schoolId: string, id: string, dto: UpdateInventoryItemDto) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true },
    });
    if (!item) throw new NotFoundError('Inventory item');

    if (dto.categoryId) await this.assertCategory(schoolId, dto.categoryId);

    const updated = await this.prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
        ...(dto.reorderLevel !== undefined ? { reorderLevel: dto.reorderLevel } : {}),
        ...(dto.unitCost !== undefined ? { unitCost: dto.unitCost } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: id,
      description: `Updated item "${updated.name}"`,
      schoolId,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Stock movement
  // -------------------------------------------------------------------------

  /** Receives stock — a purchase, a donation or a return from a department. */
  async stockIn(schoolId: string, itemId: string, dto: StockMovementDto, userId: string) {
    return this.move(schoolId, itemId, dto, { type: StockTransactionType.STOCK_IN, userId });
  }

  /** Issues stock out to a person, class or department. */
  async stockOut(schoolId: string, itemId: string, dto: StockMovementDto, userId: string) {
    return this.move(schoolId, itemId, dto, { type: StockTransactionType.STOCK_OUT, userId });
  }

  /** Writes off damaged or expired stock. */
  async writeOff(schoolId: string, itemId: string, dto: StockMovementDto, userId: string) {
    return this.move(schoolId, itemId, dto, { type: StockTransactionType.DAMAGE, userId });
  }

  /**
   * Reconciles the books to a physical count.
   *
   * The difference — either direction — is recorded as a single ADJUSTMENT so
   * the ledger still sums to the stored quantity.
   */
  async adjust(schoolId: string, itemId: string, dto: StockAdjustmentDto, userId: string) {
    const result = await this.prisma.transaction(async (tx) => {
      const item = await this.lockItem(tx, schoolId, itemId);
      const delta = dto.countedQuantity - Number(item.quantity);

      if (delta === 0) {
        return { item, delta, transaction: null };
      }

      const updated = await tx.inventoryItem.update({
        where: { id: itemId },
        data: { quantity: dto.countedQuantity },
        select: { id: true, name: true, quantity: true, reorderLevel: true, unit: true },
      });

      const transaction = await tx.stockTransaction.create({
        data: {
          schoolId,
          itemId,
          type: StockTransactionType.ADJUSTMENT,
          // Stored signed so the ledger reconciles: negative writes stock down.
          quantity: delta,
          balanceAfter: dto.countedQuantity,
          unitCost: item.unitCost,
          reference: 'STOCK-COUNT',
          notes: dto.reason,
          createdById: userId,
        },
      });

      return { item: updated, delta, transaction };
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: itemId,
      description:
        result.delta === 0
          ? `Stock count of "${result.item.name}" matched the books`
          : `Adjusted "${result.item.name}" by ${result.delta > 0 ? '+' : ''}${result.delta}: ${dto.reason}`,
      schoolId,
    });

    if (result.delta !== 0) {
      await this.alertIfLow(schoolId, result.item);
    }

    return {
      itemId,
      delta: result.delta,
      quantity: Number(result.item.quantity),
      transactionId: result.transaction?.id ?? null,
    };
  }

  /**
   * Applies one movement atomically.
   *
   * The item row is locked for the whole transaction, so two clerks issuing the
   * last box cannot both succeed and drive the quantity negative.
   */
  private async move(
    schoolId: string,
    itemId: string,
    dto: StockMovementDto,
    context: MovementContext,
  ) {
    const inbound = INBOUND.includes(context.type);

    const result = await this.prisma.transaction(async (tx) => {
      const item = await this.lockItem(tx, schoolId, itemId);

      if (!item.isActive && inbound) {
        throw new BadRequestError(`"${item.name}" is retired and cannot take new stock`);
      }

      const current = Number(item.quantity);
      const balanceAfter = inbound ? current + dto.quantity : current - dto.quantity;

      if (balanceAfter < 0) {
        throw new ConflictError(
          `Only ${current} ${item.unit} of "${item.name}" remain in stock`,
          ErrorCode.INSUFFICIENT_STOCK,
        );
      }

      const updated = await tx.inventoryItem.update({
        where: { id: itemId },
        data: {
          quantity: balanceAfter,
          // A receipt at a new price moves the item's costing forward.
          ...(inbound && dto.unitCost !== undefined ? { unitCost: dto.unitCost } : {}),
        },
        select: { id: true, name: true, quantity: true, reorderLevel: true, unit: true },
      });

      const transaction = await tx.stockTransaction.create({
        data: {
          schoolId,
          itemId,
          type: context.type,
          quantity: dto.quantity,
          balanceAfter,
          unitCost: dto.unitCost ?? item.unitCost,
          reference: dto.reference ?? null,
          issuedToType: dto.issuedToType ?? null,
          issuedToId: dto.issuedToId ?? null,
          notes: dto.notes ?? null,
          createdById: context.userId,
        },
      });

      return { item: updated, transaction, balanceAfter };
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'inventory',
      entity: 'StockTransaction',
      entityId: result.transaction.id,
      description:
        `${context.type} ${dto.quantity} ${result.item.unit} of "${result.item.name}"` +
        ` — balance ${result.balanceAfter}`,
      schoolId,
    });

    if (!inbound) await this.alertIfLow(schoolId, result.item);

    return {
      transactionId: result.transaction.id,
      itemId,
      type: context.type,
      quantity: dto.quantity,
      balanceAfter: result.balanceAfter,
    };
  }

  async ledger(schoolId: string, query: StockLedgerQueryDto) {
    const where: Prisma.StockTransactionWhereInput = {
      schoolId,
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              // `to` is inclusive, so run to the end of that day.
              ...(query.to
                ? { lt: new Date(parseDateOnly(query.to).getTime() + 86_400_000) }
                : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockTransaction.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { occurredAt: 'desc' },
        include: {
          item: { select: { id: true, name: true, code: true, unit: true } },
        },
      }),
      this.prisma.stockTransaction.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  async lowStock(schoolId: string) {
    const items = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        code: string;
        unit: string;
        quantity: string;
        reorderLevel: string;
        location: string | null;
      }>
    >`
      SELECT id, name, code, unit, quantity, "reorderLevel", location
      FROM inventory_items
      WHERE "schoolId" = ${schoolId}::uuid
        AND "isActive" = true
        AND quantity <= "reorderLevel"
      ORDER BY (quantity - "reorderLevel") ASC, name ASC
      LIMIT 200
    `;

    return items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      reorderLevel: Number(item.reorderLevel),
      shortfall: Number(item.reorderLevel) - Number(item.quantity),
    }));
  }

  // -------------------------------------------------------------------------
  // Purchases
  // -------------------------------------------------------------------------

  async listPurchases(schoolId: string, query: PurchaseQueryDto) {
    const where: Prisma.PurchaseWhereInput = {
      schoolId,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { purchaseNumber: { contains: query.search, mode: 'insensitive' } },
              { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            purchaseDate: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchase.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { purchaseDate: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ _count, ...purchase }) => ({ ...purchase, lineCount: _count.items })),
      total,
      query.page,
      query.limit,
    );
  }

  async getPurchase(schoolId: string, id: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, schoolId },
      include: {
        supplier: true,
        items: {
          include: { item: { select: { id: true, name: true, code: true, unit: true } } },
        },
      },
    });
    if (!purchase) throw new NotFoundError('Purchase');
    return purchase;
  }

  /**
   * Records a purchase order. Stock does not move until it is received, so a
   * draft or an order in transit never inflates the shelf count.
   */
  async createPurchase(schoolId: string, dto: CreatePurchaseDto, userId: string) {
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.count({
        where: { id: dto.supplierId, schoolId },
      });
      if (supplier === 0) throw new NotFoundError('Supplier');
    }

    const itemIds = [...new Set(dto.items.map((line) => line.itemId))];
    const known = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, schoolId },
      select: { id: true },
    });
    if (known.length !== itemIds.length) {
      throw new BadRequestError('One or more items do not belong to this school');
    }

    const lines = dto.items.map((line) => {
      const net = line.quantity * line.unitCost;
      const tax = net * ((line.taxPercent ?? 0) / 100);
      return {
        itemId: line.itemId,
        quantity: line.quantity,
        unitCost: line.unitCost,
        taxPercent: line.taxPercent ?? 0,
        amount: Number((net + tax).toFixed(2)),
        net,
        tax,
      };
    });

    const subtotal = Number(lines.reduce((sum, line) => sum + line.net, 0).toFixed(2));
    const taxAmount = Number(lines.reduce((sum, line) => sum + line.tax, 0).toFixed(2));

    const purchase = await this.prisma.transaction(async (tx) => {
      const purchaseNumber = await this.sequences.next(schoolId, 'PURCHASE', {}, tx);

      return tx.purchase.create({
        data: {
          schoolId,
          supplierId: dto.supplierId ?? null,
          purchaseNumber,
          invoiceNumber: dto.invoiceNumber ?? null,
          purchaseDate: parseDateOnly(dto.purchaseDate),
          subtotal,
          taxAmount,
          total: Number((subtotal + taxAmount).toFixed(2)),
          status: dto.status ?? 'DRAFT',
          notes: dto.notes ?? null,
          createdById: userId,
          items: {
            create: lines.map(({ net: _net, tax: _tax, ...line }) => line),
          },
        },
        include: { items: true },
      });
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'inventory',
      entity: 'Purchase',
      entityId: purchase.id,
      description: `Raised purchase ${purchase.purchaseNumber} for ${purchase.total}`,
      schoolId,
    });

    return purchase;
  }

  /**
   * Marks a purchase received and moves every line into stock in one
   * transaction, so a partial failure cannot leave half the delivery booked.
   */
  async receivePurchase(schoolId: string, id: string, userId: string) {
    const result = await this.prisma.transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id, schoolId },
        include: { items: true },
      });
      if (!purchase) throw new NotFoundError('Purchase');

      if (purchase.status === 'RECEIVED') {
        throw new ConflictError('This purchase has already been received');
      }
      if (purchase.status === 'CANCELLED') {
        throw new BadRequestError('A cancelled purchase cannot be received');
      }

      const received: Array<{ itemId: string; name: string; balanceAfter: number }> = [];

      for (const line of purchase.items) {
        const item = await this.lockItem(tx, schoolId, line.itemId);
        const quantity = Number(line.quantity);
        const balanceAfter = Number(item.quantity) + quantity;

        const updated = await tx.inventoryItem.update({
          where: { id: line.itemId },
          data: { quantity: balanceAfter, unitCost: line.unitCost },
          select: { id: true, name: true, quantity: true, reorderLevel: true, unit: true },
        });

        await tx.stockTransaction.create({
          data: {
            schoolId,
            itemId: line.itemId,
            type: StockTransactionType.STOCK_IN,
            quantity,
            balanceAfter,
            unitCost: line.unitCost,
            reference: purchase.purchaseNumber,
            notes: `Received against ${purchase.purchaseNumber}`,
            createdById: userId,
          },
        });

        received.push({ itemId: updated.id, name: updated.name, balanceAfter });
      }

      await tx.purchase.update({
        where: { id },
        data: { status: 'RECEIVED' },
      });

      return { purchase, received };
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'inventory',
      entity: 'Purchase',
      entityId: id,
      description:
        `Received purchase ${result.purchase.purchaseNumber}: ` +
        `${result.received.length} line(s) taken into stock`,
      schoolId,
    });

    this.log.info('Purchase received', {
      schoolId,
      purchaseId: id,
      lines: result.received.length,
    });

    return {
      purchaseNumber: result.purchase.purchaseNumber,
      status: 'RECEIVED',
      linesReceived: result.received.length,
      items: result.received,
    };
  }

  /**
   * Cancels a purchase that has not been received.
   *
   * A received purchase is never cancelled — the stock is already on the shelf,
   * so it has to be reversed with a write-off that leaves a ledger trail.
   */
  async cancelPurchase(schoolId: string, id: string, dto: CancelPurchaseDto) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, schoolId },
      select: { id: true, status: true, purchaseNumber: true, notes: true },
    });
    if (!purchase) throw new NotFoundError('Purchase');

    if (purchase.status === 'RECEIVED') {
      throw new ConflictError(
        'This purchase is already in stock. Write the items off instead so the ledger stays intact.',
      );
    }
    if (purchase.status === 'CANCELLED') {
      throw new BadRequestError('This purchase is already cancelled');
    }

    const updated = await this.prisma.purchase.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: [purchase.notes, `Cancelled: ${dto.reason}`].filter(Boolean).join('\n'),
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'inventory',
      entity: 'Purchase',
      entityId: id,
      description: `Cancelled purchase ${purchase.purchaseNumber}: ${dto.reason}`,
      schoolId,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  async statistics(schoolId: string) {
    const [items, valuation, lowStock, pendingPurchases, monthSpend] = await Promise.all([
      this.prisma.inventoryItem.count({ where: { schoolId, isActive: true } }),
      this.prisma.$queryRaw<Array<{ value: string | null }>>`
        SELECT SUM(quantity * "unitCost") AS value
        FROM inventory_items
        WHERE "schoolId" = ${schoolId}::uuid AND "isActive" = true
      `,
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM inventory_items
        WHERE "schoolId" = ${schoolId}::uuid
          AND "isActive" = true
          AND quantity <= "reorderLevel"
      `,
      this.prisma.purchase.count({
        where: { schoolId, status: { in: ['DRAFT', 'ORDERED'] } },
      }),
      this.prisma.purchase.aggregate({
        where: {
          schoolId,
          status: 'RECEIVED',
          purchaseDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
        _sum: { total: true },
      }),
    ]);

    return {
      activeItems: items,
      stockValue: Number(valuation[0]?.value ?? 0),
      lowStockItems: Number(lowStock[0]?.count ?? 0),
      pendingPurchases,
      spendThisMonth: Number(monthSpend._sum.total ?? 0),
    };
  }

  /** Consumption per item over a window, for the store keeper's monthly review. */
  async consumptionReport(schoolId: string, from: string, to: string) {
    const start = parseDateOnly(from);
    const end = new Date(parseDateOnly(to).getTime() + 86_400_000);

    const rows = await this.prisma.stockTransaction.groupBy({
      by: ['itemId', 'type'],
      where: { schoolId, occurredAt: { gte: start, lt: end } },
      _sum: { quantity: true },
    });

    const itemIds = [...new Set(rows.map((row) => row.itemId))];
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, code: true, unit: true, quantity: true, unitCost: true },
    });
    const byId = new Map(items.map((item) => [item.id, item]));

    return itemIds
      .map((itemId) => {
        const item = byId.get(itemId);
        const forItem = rows.filter((row) => row.itemId === itemId);
        const sum = (type: StockTransactionType) =>
          Number(forItem.find((row) => row.type === type)?._sum.quantity ?? 0);

        const issued = sum(StockTransactionType.STOCK_OUT);
        const damaged = sum(StockTransactionType.DAMAGE);

        return {
          itemId,
          name: item?.name ?? 'Unknown',
          code: item?.code ?? '',
          unit: item?.unit ?? '',
          received: sum(StockTransactionType.STOCK_IN),
          issued,
          damaged,
          returned: sum(StockTransactionType.RETURN),
          adjusted: sum(StockTransactionType.ADJUSTMENT),
          consumed: issued + damaged,
          consumedValue: Number(((issued + damaged) * Number(item?.unitCost ?? 0)).toFixed(2)),
          currentStock: Number(item?.quantity ?? 0),
        };
      })
      .sort((a, b) => b.consumedValue - a.consumedValue);
  }

  // -------------------------------------------------------------------------

  /**
   * Reads the item with a row-level lock held to the end of the transaction.
   * Prisma has no `FOR UPDATE`, so the lock is taken with raw SQL and the
   * typed read follows it.
   */
  private async lockItem(tx: TransactionClient, schoolId: string, itemId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM inventory_items
      WHERE id = ${itemId}::uuid AND "schoolId" = ${schoolId}::uuid
      FOR UPDATE
    `;
    if (locked.length === 0) throw new NotFoundError('Inventory item');

    return tx.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        id: true,
        name: true,
        unit: true,
        quantity: true,
        reorderLevel: true,
        unitCost: true,
        isActive: true,
      },
    });
  }

  private async assertCategory(schoolId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.inventoryCategory.count({
      where: { id: categoryId, schoolId },
    });
    if (category === 0) throw new NotFoundError('Category');
  }

  /** Tells the store keepers once an issue takes an item to its reorder level. */
  private async alertIfLow(
    schoolId: string,
    item: { id: string; name: string; quantity: Prisma.Decimal; reorderLevel: Prisma.Decimal; unit: string },
  ): Promise<void> {
    const quantity = Number(item.quantity);
    const reorderLevel = Number(item.reorderLevel);

    if (reorderLevel <= 0 || quantity > reorderLevel) return;

    const recipients = await this.usersWithInventoryAccess(schoolId);
    if (recipients.length === 0) return;

    await this.notifications
      .dispatch({
        schoolId,
        userIds: recipients,
        type: NotificationType.SYSTEM,
        title: 'Low stock',
        body: `"${item.name}" is down to ${quantity} ${item.unit} (reorder level ${reorderLevel}).`,
        data: { itemId: item.id },
        actionUrl: `/inventory/items/${item.id}`,
      })
      .catch((error: unknown) => {
        this.log.warn('Low-stock alert could not be delivered', {
          schoolId,
          itemId: item.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private async usersWithInventoryAccess(schoolId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        schoolId,
        status: UserStatus.ACTIVE,
        OR: [
          {
            roles: {
              some: {
                role: {
                  permissions: {
                    some: { permission: { key: PERMISSIONS.INVENTORY_MANAGE } },
                  },
                },
              },
            },
          },
          {
            permissions: {
              some: {
                effect: true,
                permission: { key: PERMISSIONS.INVENTORY_MANAGE },
              },
            },
          },
        ],
      },
      select: { id: true },
      take: 50,
    });

    return users.map((user) => user.id);
  }
}
