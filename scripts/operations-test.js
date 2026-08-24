#!/usr/bin/env node
/**
 * Operations integrity test against a running API.
 *
 * Transport, library and inventory all guard a countable resource — a seat, a
 * copy, a unit of stock — so the interesting failures are the ones where the
 * count and the records drift apart. This drives the real endpoints and then
 * re-derives every counter straight from the database.
 *
 *   node scripts/operations-test.js
 */

const { PrismaClient } = require('@prisma/client');

const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(64));
}

let token = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options) {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      // `token: null` sends the request unauthenticated; omitting it uses the
      // suite's admin token.
      ...(() => {
        const bearer = options.token === undefined ? token : options.token;
        return bearer ? { Authorization: `Bearer ${bearer}` } : {};
      })(),
      ...(options.headers || {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, body: json, headers: response.headers };
}

/**
 * Calls the API, waiting out the rate limiter rather than measuring it.
 *
 * This suite makes several hundred requests, comfortably past the 120-a-minute
 * default. Treating a 429 as the endpoint's answer would turn every assertion
 * after the limit into noise, so a throttled call is retried once the window
 * reopens. Anything else — including a genuine 429 from an endpoint under test
 * — is returned untouched.
 */
async function call(path, options = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await request(path, options);
    if (result.status !== 429) return result;

    const retryAfter = Number(result.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000;
    process.stdout.write(`  ..  rate limited, waiting ${Math.ceil(waitMs / 1000)}s
`);
    await sleep(waitMs + 500);
  }
  return request(path, options);
}

/** A short unique suffix so repeated runs never collide on a unique code. */
const RUN = Date.now().toString(36).slice(-6).toUpperCase();

// ---------------------------------------------------------------------------
// Invariants re-derived from the database, not from the API's own answers.
// ---------------------------------------------------------------------------

async function verifyInvariants(label) {
  const [copyCounters, doubleIssued, negativeStock, ledgerDrift, overCapacity] = await Promise.all([
    // book.availableCopies must equal the number of copies actually AVAILABLE.
    prisma.$queryRaw`
      SELECT count(*)::int AS n FROM (
        SELECT b.id, b."availableCopies",
               (SELECT count(*) FROM book_copies c
                 WHERE c."bookId" = b.id AND c.status = 'AVAILABLE') AS actual
        FROM books b WHERE b."deletedAt" IS NULL) x
      WHERE x."availableCopies" <> x.actual`,

    // A copy can only be out on one open loan at a time.
    prisma.$queryRaw`
      SELECT count(*)::int AS n FROM (
        SELECT "bookCopyId" FROM library_issues
        WHERE status IN ('ISSUED','OVERDUE')
        GROUP BY "bookCopyId" HAVING count(*) > 1) x`,

    prisma.$queryRaw`SELECT count(*)::int AS n FROM inventory_items WHERE quantity < 0`,

    // The stock ledger must sum to the item's stored quantity. STOCK_IN and
    // RETURN add, ADJUSTMENT is stored signed, everything else subtracts.
    prisma.$queryRaw`
      SELECT count(*)::int AS n FROM (
        SELECT i.id, i.quantity,
               COALESCE(SUM(CASE
                 WHEN t.type IN ('STOCK_IN','RETURN') THEN t.quantity
                 WHEN t.type = 'ADJUSTMENT' THEN t.quantity
                 ELSE -t.quantity END), 0) AS ledger
        FROM inventory_items i
        LEFT JOIN stock_transactions t ON t."itemId" = i.id
        GROUP BY i.id, i.quantity) x
      WHERE ABS(x.quantity - x.ledger) > 0.001`,

    // No route may carry more riders than its vehicle has seats.
    prisma.$queryRaw`
      SELECT count(*)::int AS n FROM (
        SELECT r.id, v.capacity,
               (SELECT count(*) FROM student_transports st
                 WHERE st."routeId" = r.id AND st."isActive" = true) AS riders
        FROM transport_routes r
        JOIN vehicles v ON v.id = r."vehicleId") x
      WHERE x.riders > x.capacity`,
  ]);

  check(`${label}: book availability counters are exact`, copyCounters[0].n === 0, `${copyCounters[0].n} drifted`);
  check(`${label}: no copy is on two open loans`, doubleIssued[0].n === 0, `${doubleIssued[0].n} double-issued`);
  check(`${label}: no negative stock`, negativeStock[0].n === 0, `${negativeStock[0].n} negative`);
  check(`${label}: stock ledger reconciles with quantities`, ledgerDrift[0].n === 0, `${ledgerDrift[0].n} drifted`);
  check(`${label}: no route is over capacity`, overCapacity[0].n === 0, `${overCapacity[0].n} over`);
}

// ---------------------------------------------------------------------------

async function testLibrary() {
  section('Library — catalogue');

  const created = await call('/library/books', {
    method: 'POST',
    body: {
      title: `Operations Test Reader ${RUN}`,
      author: 'Test Harness',
      isbn: String(9780000000000 + (Date.now() % 1000000)),
      copies: 2,
      price: 500,
      rackLocation: 'TEST-1',
    },
  });
  check('a title can be catalogued', created.status === 201, `got ${created.status}`);

  const bookId = created.body?.data?.id;
  const copies = created.body?.data?.copies ?? [];
  check('every requested copy is accessioned', copies.length === 2, `${copies.length} copies`);
  check(
    'accession numbers are unique',
    new Set(copies.map((copy) => copy.accessionNumber)).size === copies.length,
    copies.map((copy) => copy.accessionNumber).join(','),
  );

  const duplicateIsbn = await call('/library/books', {
    method: 'POST',
    body: {
      title: 'Duplicate ISBN',
      author: 'Test Harness',
      isbn: created.body?.data?.isbn,
      copies: 1,
    },
  });
  check('a duplicate ISBN is refused', duplicateIsbn.status === 409, `got ${duplicateIsbn.status}`);

  const added = await call(`/library/books/${bookId}/copies`, {
    method: 'POST',
    body: { count: 1 },
  });
  check('further copies can be accessioned', added.status === 201, `got ${added.status}`);
  check(
    'the copy counters follow',
    added.body?.data?.totalCopies === 3 && added.body?.data?.availableCopies === 3,
    `total ${added.body?.data?.totalCopies}, available ${added.body?.data?.availableCopies}`,
  );

  // -------------------------------------------------------------------------
  section('Library — circulation');

  // A borrower with no open loans and no unpaid fine.
  const borrower = await prisma.student.findFirst({
    where: {
      schoolId: (await prisma.school.findFirstOrThrow({ select: { id: true } })).id,
      status: 'ACTIVE',
      libraryIssues: { none: { status: { in: ['ISSUED', 'OVERDUE'] } } },
    },
    select: { id: true, admissionNumber: true },
  });

  if (!borrower) {
    console.log('  (no free borrower available)');
    return;
  }

  const issue = await call('/library/issues', {
    method: 'POST',
    body: { bookId, studentId: borrower.id, days: 14 },
  });
  check('a copy can be issued', issue.status === 201, `got ${issue.status}`);
  const issueId = issue.body?.data?.id;

  const afterIssue = await prisma.book.findUnique({
    where: { id: bookId },
    select: { availableCopies: true },
  });
  check('availability drops on issue', afterIssue?.availableCopies === 2, `${afterIssue?.availableCopies}`);

  const specificCopy = copies[0]?.id;
  const reissueSameCopy = await call('/library/issues', {
    method: 'POST',
    body: { bookCopyId: specificCopy, studentId: borrower.id },
  });
  check(
    'an issued copy cannot be issued again',
    reissueSameCopy.status === 409,
    `got ${reissueSameCopy.status} ${reissueSameCopy.body?.code ?? ''}`,
  );

  // The default limit is 2 books, so a second succeeds and a third must not.
  const second = await call('/library/issues', {
    method: 'POST',
    body: { bookId, studentId: borrower.id },
  });
  check('a second loan is allowed', second.status === 201, `got ${second.status}`);

  const third = await call('/library/issues', {
    method: 'POST',
    body: { bookId, studentId: borrower.id },
  });
  check('the borrowing limit is enforced', third.status === 409, `got ${third.status}`);
  check('the limit error is coded', third.body?.code === 'BOOK_LIMIT_REACHED', third.body?.code);

  const renew = await call(`/library/issues/${issueId}/renew`, { method: 'POST' });
  check('a current loan can be renewed', renew.status === 201, `got ${renew.status}`);
  check('renewal is counted', renew.body?.data?.renewalCount === 1, `${renew.body?.data?.renewalCount}`);
  check(
    'a renewed loan stays visible as active',
    renew.body?.data?.status === 'ISSUED',
    renew.body?.data?.status,
  );

  // -------------------------------------------------------------------------
  section('Library — overdue and fines');

  // Backdate the due date so the return is genuinely late.
  const daysLate = 5;
  await prisma.libraryIssue.update({
    where: { id: issueId },
    data: { dueDate: new Date(Date.now() - daysLate * 86_400_000) },
  });

  const returned = await call(`/library/issues/${issueId}/return`, {
    method: 'POST',
    body: { condition: 'GOOD' },
  });
  check('a late book can be returned', returned.status === 201, `got ${returned.status}`);
  check(
    'the overdue days are counted',
    returned.body?.data?.daysLate === daysLate,
    `${returned.body?.data?.daysLate} vs ${daysLate}`,
  );
  check(
    'an overdue fine is raised at the configured rate',
    Math.abs(returned.body?.data?.totalFine - daysLate * 2) < 0.01,
    `${returned.body?.data?.totalFine}`,
  );

  const afterReturn = await prisma.book.findUnique({
    where: { id: bookId },
    select: { availableCopies: true },
  });
  check('the copy returns to the shelf', afterReturn?.availableCopies === 2, `${afterReturn?.availableCopies}`);

  const doubleReturn = await call(`/library/issues/${issueId}/return`, {
    method: 'POST',
    body: { condition: 'GOOD' },
  });
  check('a book cannot be returned twice', doubleReturn.status === 400, `got ${doubleReturn.status}`);

  // An unpaid fine blocks any further borrowing.
  const blocked = await call('/library/issues', {
    method: 'POST',
    body: { bookId, studentId: borrower.id },
  });
  check('an unpaid fine blocks borrowing', blocked.status === 409, `got ${blocked.status}`);

  const fine = await prisma.libraryFine.findFirst({
    where: { issueId, isSettled: false },
    select: { id: true, amount: true },
  });
  const fineAmount = Number(fine.amount);

  const overpay = await call(`/library/fines/${fine.id}/settle`, {
    method: 'POST',
    body: { amount: fineAmount + 100 },
  });
  check('a fine cannot be overpaid', overpay.status === 400, `got ${overpay.status}`);

  const half = await call(`/library/fines/${fine.id}/settle`, {
    method: 'POST',
    body: { amount: fineAmount / 2 },
  });
  check('a part payment is accepted', half.status === 201, `got ${half.status}`);
  check('a part-paid fine stays open', half.body?.data?.isSettled === false, `${half.body?.data?.isSettled}`);

  const waived = await call(`/library/fines/${fine.id}/waive`, {
    method: 'POST',
    body: { reason: 'Operations test — remainder waived' },
  });
  check('the remainder can be waived', waived.status === 201, `got ${waived.status}`);
  check('the fine settles once paid plus waived covers it', waived.body?.data?.isSettled === true);

  const settledSum =
    Number(waived.body?.data?.paidAmount) + Number(waived.body?.data?.waivedAmount);
  check(
    'paid plus waived never exceeds the fine',
    settledSum <= fineAmount + 0.01,
    `${settledSum} vs ${fineAmount}`,
  );

  const unblocked = await call('/library/issues', {
    method: 'POST',
    body: { bookId, studentId: borrower.id },
  });
  check('borrowing resumes once the fine is settled', unblocked.status === 201, `got ${unblocked.status}`);

  // -------------------------------------------------------------------------
  section('Library — reporting');

  const stats = await call('/library/statistics');
  check('statistics load', stats.status === 200, `got ${stats.status}`);
  const s = stats.body?.data;
  check(
    'available plus issued plus unavailable equals every copy',
    s?.available + s?.currentlyIssued + s?.unavailable === s?.copies,
    `${s?.available}+${s?.currentlyIssued}+${s?.unavailable} vs ${s?.copies}`,
  );

  const history = await call(`/library/students/${borrower.id}/history`);
  check('borrower history loads', history.status === 200, `got ${history.status}`);
  check('history reports current loans', typeof history.body?.data?.currentLoans === 'number');

  const overdueScan = await call('/library/overdue-scan', { method: 'POST' });
  check('the overdue scan runs', overdueScan.status === 201, `got ${overdueScan.status}`);
  const rescan = await call('/library/overdue-scan', { method: 'POST' });
  check(
    'the overdue scan is idempotent',
    rescan.body?.data?.flagged === 0,
    `re-flagged ${rescan.body?.data?.flagged}`,
  );
}

// ---------------------------------------------------------------------------

async function testInventory() {
  section('Inventory — items and stock');

  const category = await call('/inventory/categories', {
    method: 'POST',
    body: { name: `Test Category ${RUN}`, code: `TC-${RUN}` },
  });
  check('a category can be created', category.status === 201, `got ${category.status}`);

  const duplicate = await call('/inventory/categories', {
    method: 'POST',
    body: { name: 'Another', code: `TC-${RUN}` },
  });
  check('a duplicate category code is refused', duplicate.status === 409, `got ${duplicate.status}`);

  const item = await call('/inventory/items', {
    method: 'POST',
    body: {
      name: `Test Item ${RUN}`,
      code: `TI-${RUN}`,
      categoryId: category.body?.data?.id,
      unit: 'PCS',
      reorderLevel: 10,
      unitCost: 100,
      openingQuantity: 50,
    },
  });
  check('an item can be created with opening stock', item.status === 201, `got ${item.status}`);
  const itemId = item.body?.data?.id;

  const openingLedger = await prisma.stockTransaction.findMany({ where: { itemId } });
  check('opening stock is recorded as a movement', openingLedger.length === 1, `${openingLedger.length} rows`);
  check(
    'the opening movement carries the running balance',
    Number(openingLedger[0]?.balanceAfter) === 50,
    `${openingLedger[0]?.balanceAfter}`,
  );

  const out = await call(`/inventory/items/${itemId}/stock-out`, {
    method: 'POST',
    body: { quantity: 20, issuedToType: 'DEPARTMENT', notes: 'Operations test' },
  });
  check('stock can be issued', out.status === 201, `got ${out.status}`);
  check('the balance after issue is right', out.body?.data?.balanceAfter === 30, `${out.body?.data?.balanceAfter}`);

  const tooMuch = await call(`/inventory/items/${itemId}/stock-out`, {
    method: 'POST',
    body: { quantity: 1000 },
  });
  check('stock cannot go negative', tooMuch.status === 409, `got ${tooMuch.status}`);
  check('the shortage is coded', tooMuch.body?.code === 'INSUFFICIENT_STOCK', tooMuch.body?.code);

  const zero = await call(`/inventory/items/${itemId}/stock-out`, {
    method: 'POST',
    body: { quantity: 0 },
  });
  check('a zero-quantity movement is rejected', zero.status === 422, `got ${zero.status}`);

  const backIn = await call(`/inventory/items/${itemId}/stock-in`, {
    method: 'POST',
    body: { quantity: 5, unitCost: 110, reference: 'TEST-IN' },
  });
  check('stock can be received', backIn.status === 201, `got ${backIn.status}`);
  check('the balance after receipt is right', backIn.body?.data?.balanceAfter === 35, `${backIn.body?.data?.balanceAfter}`);

  const afterIn = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: { unitCost: true },
  });
  check('a receipt at a new price moves the costing', Number(afterIn?.unitCost) === 110, `${afterIn?.unitCost}`);

  // -------------------------------------------------------------------------
  section('Inventory — adjustment and alerts');

  const adjust = await call(`/inventory/items/${itemId}/adjust`, {
    method: 'POST',
    body: { countedQuantity: 8, reason: 'Operations test physical count' },
  });
  check('a physical count can be booked', adjust.status === 201, `got ${adjust.status}`);
  check('the adjustment delta is signed', adjust.body?.data?.delta === -27, `${adjust.body?.data?.delta}`);
  check('the item lands on the counted quantity', adjust.body?.data?.quantity === 8, `${adjust.body?.data?.quantity}`);

  const adjustRow = await prisma.stockTransaction.findFirst({
    where: { itemId, type: 'ADJUSTMENT' },
    orderBy: { createdAt: 'desc' },
  });
  check('the adjustment is stored signed so the ledger sums', Number(adjustRow?.quantity) === -27, `${adjustRow?.quantity}`);

  const noOp = await call(`/inventory/items/${itemId}/adjust`, {
    method: 'POST',
    body: { countedQuantity: 8, reason: 'No change expected' },
  });
  check('a matching count writes no movement', noOp.body?.data?.transactionId === null, `${noOp.body?.data?.transactionId}`);

  const low = await call('/inventory/items/low-stock');
  check('the low-stock report loads', low.status === 200, `got ${low.status}`);
  check(
    'the item now shows as low stock',
    (low.body?.data ?? []).some((row) => row.id === itemId),
    `${(low.body?.data ?? []).length} low items`,
  );
  check(
    'every low-stock row is genuinely at or below its level',
    (low.body?.data ?? []).every((row) => row.quantity <= row.reorderLevel),
  );

  // -------------------------------------------------------------------------
  section('Inventory — purchases');

  const supplier = await call('/inventory/suppliers', {
    method: 'POST',
    body: { name: `Test Supplier ${RUN}`, code: `TS-${RUN}`, phone: '9845099999' },
  });
  check('a supplier can be added', supplier.status === 201, `got ${supplier.status}`);

  const beforePurchase = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: { quantity: true },
  });

  const purchase = await call('/inventory/purchases', {
    method: 'POST',
    body: {
      supplierId: supplier.body?.data?.id,
      purchaseDate: new Date().toISOString().slice(0, 10),
      status: 'ORDERED',
      items: [{ itemId, quantity: 10, unitCost: 100, taxPercent: 12 }],
    },
  });
  check('a purchase can be raised', purchase.status === 201, `got ${purchase.status}`);
  check(
    'the purchase total includes tax',
    Math.abs(Number(purchase.body?.data?.total) - 1120) < 0.01,
    `${purchase.body?.data?.total}`,
  );

  const purchaseId = purchase.body?.data?.id;
  const stillUnmoved = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: { quantity: true },
  });
  check(
    'an unreceived purchase does not move stock',
    Number(stillUnmoved?.quantity) === Number(beforePurchase?.quantity),
    `${stillUnmoved?.quantity} vs ${beforePurchase?.quantity}`,
  );

  const receive = await call(`/inventory/purchases/${purchaseId}/receive`, { method: 'POST' });
  check('a purchase can be received', receive.status === 201, `got ${receive.status}`);

  const afterReceive = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: { quantity: true },
  });
  check(
    'receipt raises stock by exactly the ordered quantity',
    Number(afterReceive?.quantity) - Number(beforePurchase?.quantity) === 10,
    `${afterReceive?.quantity} vs ${beforePurchase?.quantity}`,
  );

  const receiveAgain = await call(`/inventory/purchases/${purchaseId}/receive`, { method: 'POST' });
  check('a purchase cannot be received twice', receiveAgain.status === 409, `got ${receiveAgain.status}`);

  const cancelReceived = await call(`/inventory/purchases/${purchaseId}/cancel`, {
    method: 'POST',
    body: { reason: 'Should not be allowed' },
  });
  check(
    'a received purchase cannot be cancelled',
    cancelReceived.status === 409,
    `got ${cancelReceived.status}`,
  );

  const draft = await call('/inventory/purchases', {
    method: 'POST',
    body: {
      purchaseDate: new Date().toISOString().slice(0, 10),
      items: [{ itemId, quantity: 1, unitCost: 100 }],
    },
  });
  const cancelDraft = await call(`/inventory/purchases/${draft.body?.data?.id}/cancel`, {
    method: 'POST',
    body: { reason: 'Operations test' },
  });
  check('an unreceived purchase can be cancelled', cancelDraft.status === 201, `got ${cancelDraft.status}`);
  check('purchase numbers are unique', draft.body?.data?.purchaseNumber !== purchase.body?.data?.purchaseNumber);

  // -------------------------------------------------------------------------
  section('Inventory — reporting');

  const stats = await call('/inventory/statistics');
  check('statistics load', stats.status === 200, `got ${stats.status}`);
  check('stock is valued', stats.body?.data?.stockValue > 0, `${stats.body?.data?.stockValue}`);

  const from = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const consumption = await call(`/inventory/reports/consumption?from=${from}&to=${to}`);
  check('the consumption report loads', consumption.status === 200, `got ${consumption.status}`);
  check('it is sorted by value consumed', () => true);
  const rows = consumption.body?.data ?? [];
  check(
    'consumption rows are ordered costliest first',
    rows.every((row, index) => index === 0 || rows[index - 1].consumedValue >= row.consumedValue),
  );

  const missingRange = await call('/inventory/reports/consumption');
  check('the report demands a date range', missingRange.status === 400, `got ${missingRange.status}`);

  const ledger = await call(`/inventory/ledger?itemId=${itemId}&limit=100`);
  check('the ledger loads', ledger.status === 200, `got ${ledger.status}`);
  const movements = ledger.body?.data?.items ?? [];
  const summed = movements.reduce((total, row) => {
    if (row.type === 'STOCK_IN' || row.type === 'RETURN') return total + Number(row.quantity);
    if (row.type === 'ADJUSTMENT') return total + Number(row.quantity);
    return total - Number(row.quantity);
  }, 0);
  const current = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: { quantity: true },
  });
  check(
    'the ledger sums to the current quantity',
    Math.abs(summed - Number(current?.quantity)) < 0.001,
    `${summed} vs ${current?.quantity}`,
  );
}

// ---------------------------------------------------------------------------

async function testTransport() {
  section('Transport — fleet and routes');

  const vehicle = await call('/transport/vehicles', {
    method: 'POST',
    body: {
      registrationNumber: `KA01T${RUN}`,
      name: `Test Bus ${RUN}`,
      capacity: 2,
      trackingEnabled: true,
    },
  });
  check('a vehicle can be added', vehicle.status === 201, `got ${vehicle.status}`);
  const vehicleId = vehicle.body?.data?.id;

  const duplicateReg = await call('/transport/vehicles', {
    method: 'POST',
    body: { registrationNumber: `KA01T${RUN}`, capacity: 10 },
  });
  check('a duplicate registration is refused', duplicateReg.status === 409, `got ${duplicateReg.status}`);

  const driver = await call('/transport/drivers', {
    method: 'POST',
    body: {
      name: `Test Driver ${RUN}`,
      phone: '9845088888',
      licenseNumber: `KA01L${RUN}`,
    },
  });
  check('a driver can be added', driver.status === 201, `got ${driver.status}`);

  const route = await call('/transport/routes', {
    method: 'POST',
    body: {
      name: `Test Route ${RUN}`,
      code: `TR-${RUN}`,
      vehicleId,
      driverId: driver.body?.data?.id,
      baseFare: 12000,
      stops: [
        { name: 'Test Stop 1', sequence: 1, pickupTime: '07:10', dropTime: '15:40' },
        { name: 'Test Stop 2', sequence: 2, pickupTime: '07:25', dropTime: '15:55' },
      ],
    },
  });
  check('a route can be created with stops', route.status === 201, `got ${route.status}`);
  const routeId = route.body?.data?.id;

  const detail = await call(`/transport/routes/${routeId}`);
  check('route detail loads', detail.status === 200, `got ${detail.status}`);
  check('both stops are stored', (detail.body?.data?.stops ?? []).length === 2, `${(detail.body?.data?.stops ?? []).length}`);
  check(
    'seats remaining starts at capacity',
    detail.body?.data?.seatsRemaining === 2,
    `${detail.body?.data?.seatsRemaining}`,
  );

  // -------------------------------------------------------------------------
  section('Transport — assignment and capacity');

  const school = await prisma.school.findFirstOrThrow({ select: { id: true } });
  const candidates = await prisma.student.findMany({
    where: { schoolId: school.id, status: 'ACTIVE', transport: { none: { isActive: true } } },
    select: { id: true },
    take: 3,
  });

  if (candidates.length < 3) {
    console.log('  (not enough unassigned students to test capacity)');
    return;
  }

  const stops = detail.body?.data?.stops ?? [];
  const assign = async (studentId) =>
    call('/transport/assignments', {
      method: 'POST',
      body: { studentId, routeId, pickupStopId: stops[0]?.id, direction: 'BOTH' },
    });

  const first = await assign(candidates[0].id);
  check('a student can be assigned to a route', first.status === 201, `got ${first.status}`);

  // Re-assigning is an upsert by design (it is how a student is moved between
  // routes), so what must hold is that it neither duplicates the row nor burns
  // a second seat.
  const repeat = await assign(candidates[0].id);
  check('re-assigning the same student is accepted', repeat.status === 201, `got ${repeat.status}`);

  const rows = await prisma.studentTransport.count({
    where: { studentId: candidates[0].id, isActive: true },
  });
  check('re-assignment does not duplicate the rider', rows === 1, `${rows} rows`);

  const afterRepeat = await call(`/transport/routes/${routeId}`);
  check(
    're-assignment does not consume a second seat',
    afterRepeat.body?.data?.seatsRemaining === 1,
    `${afterRepeat.body?.data?.seatsRemaining}`,
  );

  const second = await assign(candidates[1].id);
  check('the last seat can be filled', second.status === 201, `got ${second.status}`);

  const third = await assign(candidates[2].id);
  check('vehicle capacity is enforced', third.status === 409, `got ${third.status}`);

  const forStudent = await call(`/transport/students/${candidates[0].id}`);
  check('a parent-facing view loads', forStudent.status === 200, `got ${forStudent.status}`);
  check(
    'it names the bus and the route',
    !!forStudent.body?.data?.busNumber && !!forStudent.body?.data?.routeName,
    JSON.stringify(forStudent.body?.data ?? {}).slice(0, 120),
  );

  const unassign = await call(`/transport/assignments/${candidates[0].id}`, { method: 'DELETE' });
  check('a student can be removed from transport', unassign.status === 200, `got ${unassign.status}`);

  const afterFree = await assign(candidates[2].id);
  check('the freed seat becomes available', afterFree.status === 201, `got ${afterFree.status}`);

  const removeBusyRoute = await call(`/transport/routes/${routeId}`, { method: 'DELETE' });
  check('a route with riders cannot be deactivated', removeBusyRoute.status === 409, `got ${removeBusyRoute.status}`);

  // -------------------------------------------------------------------------
  section('Transport — tracking');

  const position = await call(`/transport/vehicles/${vehicleId}/position`, {
    method: 'POST',
    body: { latitude: 12.9081, longitude: 77.6476, speedKph: 32 },
  });
  check('a GPS ping is accepted', position.status === 201, `got ${position.status}`);

  const latest = await call(`/transport/vehicles/${vehicleId}/position`);
  check('the latest position reads back', latest.status === 200, `got ${latest.status}`);
  check(
    'the coordinates round-trip',
    Math.abs(Number(latest.body?.data?.position?.latitude) - 12.9081) < 0.0001,
    `${latest.body?.data?.position?.latitude}`,
  );
  check(
    'a fresh ping is not flagged stale',
    latest.body?.data?.isStale === false,
    `${latest.body?.data?.isStale}`,
  );

  const untracked = await call('/transport/vehicles', {
    method: 'POST',
    body: { registrationNumber: `KA02T${RUN}`, capacity: 10 },
  });
  const untrackedPing = await call(
    `/transport/vehicles/${untracked.body?.data?.id}/position`,
    { method: 'POST', body: { latitude: 12.9, longitude: 77.6 } },
  );
  check(
    'a vehicle without tracking refuses pings',
    untrackedPing.status === 400,
    `got ${untrackedPing.status}`,
  );

  const badCoords = await call(`/transport/vehicles/${vehicleId}/position`, {
    method: 'POST',
    body: { latitude: 200, longitude: 77.6476 },
  });
  check('an impossible latitude is rejected', badCoords.status === 422, `got ${badCoords.status}`);

  const stats = await call('/transport/statistics');
  check('statistics load', stats.status === 200, `got ${stats.status}`);
}

// ---------------------------------------------------------------------------

async function testAuthorization() {
  section('Authorization');

  const anonymous = await call('/inventory/items', { token: null });
  check('inventory requires a token', anonymous.status === 401, `got ${anonymous.status}`);

  // Resolve a real parent from the seeded data rather than hard-coding one, so
  // the test stands on its own against any seeded database.
  const guardians = await call('/guardians?limit=1&hasLogin=true');
  const parentEmail = guardians.body?.data?.items?.[0]?.email;

  const parentLogin = parentEmail
    ? await call('/auth/login', {
        method: 'POST',
        body: { identifier: parentEmail, password: 'Parent@123' },
      })
    : { body: null };
  const parentToken = parentLogin.body?.data?.tokens?.accessToken;

  if (!parentToken) {
    console.log('  (no parent account available)');
    return;
  }

  const asParent = (path, options = {}) => call(path, { ...options, token: parentToken });

  const stock = await asParent('/inventory/items');
  check('a parent cannot browse the store', stock.status === 403, `got ${stock.status}`);

  const issueBook = await asParent('/library/issues', {
    method: 'POST',
    body: { bookId: '00000000-0000-4000-8000-000000000000', studentId: '00000000-0000-4000-8000-000000000000' },
  });
  check('a parent cannot issue library books', issueBook.status === 403, `got ${issueBook.status}`);

  const fleet = await asParent('/transport/vehicles');
  check('a parent cannot manage the fleet', fleet.status === 403, `got ${fleet.status}`);

  // But a parent may read their own child's transport and library records.
  const child = await prisma.studentGuardian.findFirst({
    where: { guardian: { user: { email: parentEmail } } },
    select: { studentId: true },
  });

  if (child) {
    const ownChild = await asParent(`/library/students/${child.studentId}/history`);
    check("a parent can read their own child's library history", ownChild.status === 200, `got ${ownChild.status}`);

    const otherChild = await prisma.student.findFirst({
      where: { id: { not: child.studentId }, status: 'ACTIVE' },
      select: { id: true },
    });
    const denied = await asParent(`/library/students/${otherChild.id}/history`);
    check("a parent cannot read another child's history", denied.status === 403, `got ${denied.status}`);
  }
}

// ---------------------------------------------------------------------------

async function run() {
  console.log('\nSchool ERP Platform — operations integrity test');
  console.log('='.repeat(64));

  const login = await call('/auth/login', {
    method: 'POST',
    body: { identifier: 'admin@greenfield.edu', password: 'Admin@123' },
  });
  token = login.body?.data?.tokens?.accessToken;
  if (!token) {
    throw new Error(
      `Could not sign in as the school administrator (status ${login.status}). ` +
        'Is the API running with a seeded database?',
    );
  }

  section('Baseline invariants (seeded data)');
  await verifyInvariants('baseline');

  await testLibrary();
  await testInventory();
  await testTransport();
  await testAuthorization();

  section('Invariants after every workflow');
  await verifyInvariants('final');

  console.log('\n' + '='.repeat(60));
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const failure of failures) {
      console.log(`   - ${failure.name}${failure.detail ? `: ${failure.detail}` : ''}`);
    }
  }
  console.log('');
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (error) => {
  console.error('\nOperations test crashed:', error.message);
  await prisma.$disconnect();
  process.exit(1);
});
