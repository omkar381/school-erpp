import { PrismaClient } from '@prisma/client';
import { Random, addDays, dateOnly } from './helpers';
import type { SchoolSeedResult } from './school.seed';

const CATEGORIES = [
  { name: 'Stationery', code: 'STAT' },
  { name: 'Laboratory', code: 'LAB' },
  { name: 'Sports Equipment', code: 'SPORT' },
  { name: 'Housekeeping', code: 'HOUSE' },
  { name: 'Furniture', code: 'FURN' },
  { name: 'IT Equipment', code: 'IT' },
];

const SUPPLIERS = [
  {
    name: 'Sharma Stationers',
    code: 'SUP-001',
    contactPerson: 'Rakesh Sharma',
    phone: '9845010001',
    gstNumber: '29AABCS1429B1ZQ',
  },
  {
    name: 'Bengaluru Lab Supplies',
    code: 'SUP-002',
    contactPerson: 'Divya Rao',
    phone: '9845010002',
    gstNumber: '29AACCB2311C1ZK',
  },
  {
    name: 'Karnataka Sports House',
    code: 'SUP-003',
    contactPerson: 'Imran Khan',
    phone: '9845010003',
    gstNumber: '29AAECK7712D1ZM',
  },
  {
    name: 'CleanPro Facility Services',
    code: 'SUP-004',
    contactPerson: 'Latha Menon',
    phone: '9845010004',
    gstNumber: '29AAFCC5590E1ZP',
  },
];

/**
 * A realistic school store. Several items sit at or below their reorder level
 * on purpose, so the low-stock report and its alerts have something to show.
 */
const ITEMS = [
  { name: 'A4 Copier Paper 75gsm', code: 'STAT-A4-75', category: 'STAT', unit: 'REAM', quantity: 120, reorderLevel: 40, unitCost: 285, location: 'Store Room A' },
  { name: 'Whiteboard Marker (Black)', code: 'STAT-WBM-BK', category: 'STAT', unit: 'PCS', quantity: 26, reorderLevel: 60, unitCost: 32, location: 'Store Room A' },
  { name: 'Chalk Box (Dustless)', code: 'STAT-CHK-DL', category: 'STAT', unit: 'BOX', quantity: 88, reorderLevel: 25, unitCost: 45, location: 'Store Room A' },
  { name: 'Register 200 Pages', code: 'STAT-REG-200', category: 'STAT', unit: 'PCS', quantity: 210, reorderLevel: 50, unitCost: 68, location: 'Store Room A' },
  { name: 'Glass Beaker 250ml', code: 'LAB-BKR-250', category: 'LAB', unit: 'PCS', quantity: 64, reorderLevel: 20, unitCost: 140, location: 'Chemistry Lab' },
  { name: 'Test Tube Borosilicate', code: 'LAB-TT-BORO', category: 'LAB', unit: 'PCS', quantity: 18, reorderLevel: 50, unitCost: 22, location: 'Chemistry Lab' },
  { name: 'Litmus Paper Booklet', code: 'LAB-LIT-BK', category: 'LAB', unit: 'PKT', quantity: 42, reorderLevel: 15, unitCost: 95, location: 'Chemistry Lab' },
  { name: 'Cricket Ball (Leather)', code: 'SPORT-CB-LTH', category: 'SPORT', unit: 'PCS', quantity: 24, reorderLevel: 12, unitCost: 420, location: 'Sports Room' },
  { name: 'Football Size 5', code: 'SPORT-FB-5', category: 'SPORT', unit: 'PCS', quantity: 9, reorderLevel: 10, unitCost: 780, location: 'Sports Room' },
  { name: 'Badminton Shuttlecock', code: 'SPORT-SHT', category: 'SPORT', unit: 'BOX', quantity: 15, reorderLevel: 8, unitCost: 550, location: 'Sports Room' },
  { name: 'Phenyl Floor Cleaner', code: 'HOUSE-PHN-5L', category: 'HOUSE', unit: 'LITRE', quantity: 75, reorderLevel: 30, unitCost: 88, location: 'Housekeeping Store' },
  { name: 'Hand Wash Refill', code: 'HOUSE-HW-RF', category: 'HOUSE', unit: 'LITRE', quantity: 22, reorderLevel: 40, unitCost: 165, location: 'Housekeeping Store' },
  { name: 'Garbage Bag (Large)', code: 'HOUSE-GB-L', category: 'HOUSE', unit: 'PKT', quantity: 130, reorderLevel: 50, unitCost: 120, location: 'Housekeeping Store' },
  { name: 'Student Desk (Twin)', code: 'FURN-DSK-TW', category: 'FURN', unit: 'PCS', quantity: 40, reorderLevel: 10, unitCost: 4200, location: 'Furniture Godown' },
  { name: 'Plastic Chair', code: 'FURN-CHR-PL', category: 'FURN', unit: 'PCS', quantity: 180, reorderLevel: 40, unitCost: 650, location: 'Furniture Godown' },
  { name: 'HDMI Cable 3m', code: 'IT-HDMI-3M', category: 'IT', unit: 'PCS', quantity: 12, reorderLevel: 15, unitCost: 340, location: 'IT Room' },
  { name: 'Projector Lamp', code: 'IT-PRJ-LMP', category: 'IT', unit: 'PCS', quantity: 4, reorderLevel: 5, unitCost: 6800, location: 'IT Room' },
  { name: 'Toner Cartridge (Mono)', code: 'IT-TNR-MN', category: 'IT', unit: 'PCS', quantity: 7, reorderLevel: 6, unitCost: 2900, location: 'IT Room' },
];

const PURCHASES = [
  { number: 'PO/00001', status: 'RECEIVED', daysAgo: 40, lines: 3 },
  { number: 'PO/00002', status: 'RECEIVED', daysAgo: 18, lines: 2 },
  { number: 'PO/00003', status: 'ORDERED', daysAgo: 4, lines: 2 },
];

export async function seedInventory(
  prisma: PrismaClient,
  school: SchoolSeedResult,
  random: Random,
): Promise<void> {
  const { schoolId } = school;
  const today = dateOnly(new Date());

  const categoryIds: Record<string, string> = {};
  for (const category of CATEGORIES) {
    const record = await prisma.inventoryCategory.create({
      data: { schoolId, ...category },
      select: { id: true },
    });
    categoryIds[category.code] = record.id;
  }

  const supplierIds: string[] = [];
  for (const supplier of SUPPLIERS) {
    const record = await prisma.supplier.create({
      data: {
        schoolId,
        ...supplier,
        email: `${supplier.code.toLowerCase()}@suppliers.example.in`,
        isActive: true,
      },
      select: { id: true },
    });
    supplierIds.push(record.id);
  }

  const items: Array<{ id: string; quantity: number; unitCost: number }> = [];
  for (const item of ITEMS) {
    const record = await prisma.inventoryItem.create({
      data: {
        schoolId,
        categoryId: categoryIds[item.category],
        name: item.name,
        code: item.code,
        unit: item.unit,
        quantity: item.quantity,
        reorderLevel: item.reorderLevel,
        unitCost: item.unitCost,
        location: item.location,
        isActive: true,
      },
      select: { id: true },
    });
    items.push({ id: record.id, quantity: item.quantity, unitCost: item.unitCost });
  }

  // Build a ledger that reconciles to each item's stored quantity: one opening
  // receipt, then a few issues, with the opening sized so the running balance
  // lands exactly on the seeded stock.
  for (const item of items) {
    const issues: number[] = [];
    const issueCount = random.int(1, 4);
    for (let index = 0; index < issueCount; index += 1) {
      issues.push(random.int(1, Math.max(1, Math.floor(item.quantity / 6))));
    }

    const issuedTotal = issues.reduce((sum, quantity) => sum + quantity, 0);
    const opening = item.quantity + issuedTotal;
    let balance = opening;

    await prisma.stockTransaction.create({
      data: {
        schoolId,
        itemId: item.id,
        type: 'STOCK_IN',
        quantity: opening,
        balanceAfter: balance,
        unitCost: item.unitCost,
        reference: 'OPENING',
        notes: 'Opening stock',
        occurredAt: addDays(today, -120),
      },
    });

    for (const [index, quantity] of issues.entries()) {
      balance -= quantity;
      await prisma.stockTransaction.create({
        data: {
          schoolId,
          itemId: item.id,
          type: 'STOCK_OUT',
          quantity,
          balanceAfter: balance,
          unitCost: item.unitCost,
          issuedToType: 'DEPARTMENT',
          notes: 'Issued to department',
          occurredAt: addDays(today, -90 + index * 20),
        },
      });
    }
  }

  for (const definition of PURCHASES) {
    const lines = items.slice(0, definition.lines).map((item) => {
      const quantity = random.int(5, 25);
      const net = quantity * item.unitCost;
      const tax = net * 0.12;
      return {
        itemId: item.id,
        quantity,
        unitCost: item.unitCost,
        taxPercent: 12,
        amount: Number((net + tax).toFixed(2)),
        net,
        tax,
      };
    });

    const subtotal = Number(lines.reduce((sum, line) => sum + line.net, 0).toFixed(2));
    const taxAmount = Number(lines.reduce((sum, line) => sum + line.tax, 0).toFixed(2));

    await prisma.purchase.create({
      data: {
        schoolId,
        supplierId: random.pick(supplierIds),
        purchaseNumber: definition.number,
        invoiceNumber: `INV-${random.int(1000, 9999)}`,
        purchaseDate: addDays(today, -definition.daysAgo),
        subtotal,
        taxAmount,
        total: Number((subtotal + taxAmount).toFixed(2)),
        status: definition.status,
        items: {
          create: lines.map(({ net: _net, tax: _tax, ...line }) => line),
        },
      },
    });
  }

  // Park the counter past the numbers used above so the first purchase raised
  // through the API does not collide with a seeded one.
  await prisma.numberSequence.create({
    data: {
      schoolId,
      kind: 'PURCHASE',
      period: '',
      prefix: 'PO',
      padding: 5,
      nextValue: PURCHASES.length + 1,
    },
  });
}
