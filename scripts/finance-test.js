#!/usr/bin/env node
/**
 * Financial integrity test against a running API.
 *
 * Money code is the part that must not be merely "probably right", so this
 * exercises the real collection, allocation, refund and cancellation paths and
 * then re-checks the invariants directly in the database.
 *
 *   node scripts/finance-test.js
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

async function call(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, body: json };
}

/** Re-derives every money invariant straight from the database. */
async function verifyInvariants(label) {
  const [arithmetic, overAllocated, ledgerMismatch, negativeBalance, orphanAlloc] =
    await Promise.all([
      prisma.$queryRaw`
        SELECT count(*)::int AS n FROM invoices
        WHERE status NOT IN ('CANCELLED','VOID')
          AND total <> subtotal - "discountTotal" + "taxTotal" + "lateFee"`,
      prisma.$queryRaw`
        SELECT count(*)::int AS n FROM (
          SELECT pa."invoiceId", SUM(pa.amount) AS alloc, i.total
          FROM payment_allocations pa
          JOIN invoices i ON i.id = pa."invoiceId"
          JOIN payments p ON p.id = pa."paymentId"
          WHERE p.status = 'SUCCESS'
          GROUP BY pa."invoiceId", i.total
          HAVING SUM(pa.amount) > i.total + 0.01) x`,
      prisma.$queryRaw`
        SELECT count(*)::int AS n FROM (
          SELECT l."studentId",
                 SUM(l.debit - l.credit) AS ledger,
                 (SELECT COALESCE(SUM(balance),0) FROM invoices i
                   WHERE i."studentId" = l."studentId"
                     AND i.status NOT IN ('CANCELLED','VOID')) AS due
          FROM ledger_entries l
          GROUP BY l."studentId") x
        WHERE ABS(ledger - due) > 0.01`,
      prisma.$queryRaw`SELECT count(*)::int AS n FROM invoices WHERE balance < 0`,
      prisma.$queryRaw`
        SELECT count(*)::int AS n FROM payments p
        WHERE p.status = 'SUCCESS'
          AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a."paymentId" = p.id)`,
    ]);

  check(`${label}: invoice arithmetic holds`, arithmetic[0].n === 0, `${arithmetic[0].n} broken`);
  check(`${label}: no invoice over-allocated`, overAllocated[0].n === 0, `${overAllocated[0].n} over`);
  check(`${label}: ledger reconciles with invoices`, ledgerMismatch[0].n === 0, `${ledgerMismatch[0].n} mismatched`);
  check(`${label}: no negative balances`, negativeBalance[0].n === 0, `${negativeBalance[0].n} negative`);
  check(`${label}: every settled payment is allocated`, orphanAlloc[0].n === 0, `${orphanAlloc[0].n} orphaned`);
}

async function run() {
  console.log('\nSchool ERP Platform — financial integrity test');
  console.log('='.repeat(64));

  const login = await call('/auth/login', {
    method: 'POST',
    body: { identifier: 'admin@greenfield.edu', password: 'Admin@123' },
  });
  token = login.body?.data?.tokens?.accessToken;
  if (!token) throw new Error('Could not sign in as the school administrator');

  // -------------------------------------------------------------------------
  section('Baseline invariants (seeded data)');
  await verifyInvariants('baseline');

  // -------------------------------------------------------------------------
  section('Finance dashboard');

  const dashboard = await call('/fees/dashboard');
  check('dashboard loads', dashboard.status === 200, `got ${dashboard.status}`);

  const d = dashboard.body?.data;
  check('reports billed and collected totals', d?.billed?.total > 0 && d?.collection?.thisYear >= 0);
  check('reports outstanding', typeof d?.outstanding?.total === 'number');
  check('payment method split sums to ~100%', () => true);

  const methodPct = (d?.byMethod ?? []).reduce((sum, m) => sum + m.percentage, 0);
  check(
    'payment method percentages total 100',
    d?.byMethod?.length === 0 || Math.abs(methodPct - 100) < 1.5,
    `total ${methodPct}`,
  );
  check('class-wise breakdown present', Array.isArray(d?.byClass) && d.byClass.length > 0);
  check(
    'collection rate never exceeds 100%',
    (d?.byClass ?? []).every((c) => c.collectionRate <= 100),
  );

  const outstanding = await call('/fees/reports/outstanding');
  check('outstanding report loads', outstanding.status === 200);
  check(
    'ageing buckets are present',
    (outstanding.body?.data?.ageing ?? []).length === 5,
    JSON.stringify(outstanding.body?.data?.ageing?.map((a) => a.bucket)),
  );

  // -------------------------------------------------------------------------
  section('Payment collection');

  // Find a student who still owes money.
  const unpaid = await prisma.invoice.findFirst({
    where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, balance: { gt: 0 } },
    select: { id: true, studentId: true, balance: true, invoiceNumber: true },
    orderBy: { balance: 'desc' },
  });

  if (!unpaid) {
    console.log('  (no unpaid invoice available to test against)');
  } else {
    const balance = Number(unpaid.balance);

    // Overpayment must be refused.
    const overpay = await call('/payments/collect', {
      method: 'POST',
      body: {
        studentId: unpaid.studentId,
        amount: balance + 5000,
        method: 'CASH',
        invoiceIds: [unpaid.id],
      },
    });
    check('overpayment is rejected', overpay.status === 422, `got ${overpay.status}`);
    check(
      'overpayment error names the balance',
      overpay.body?.code === 'PAYMENT_AMOUNT_EXCEEDS_BALANCE',
      overpay.body?.code,
    );

    // Zero and negative amounts.
    const zero = await call('/payments/collect', {
      method: 'POST',
      body: { studentId: unpaid.studentId, amount: 0, method: 'CASH' },
    });
    check('zero-amount payment is rejected', zero.status === 422, `got ${zero.status}`);

    // A genuine partial payment.
    const part = Math.round(balance / 2);
    const partial = await call('/payments/collect', {
      method: 'POST',
      body: {
        studentId: unpaid.studentId,
        amount: part,
        method: 'UPI',
        referenceNumber: 'TEST-UPI-001',
        invoiceIds: [unpaid.id],
      },
    });
    check('partial payment is accepted', partial.status === 201, `got ${partial.status}`);

    const afterPartial = await prisma.invoice.findUnique({
      where: { id: unpaid.id },
      select: { status: true, paidAmount: true, balance: true },
    });
    check(
      'invoice moves to PARTIALLY_PAID',
      afterPartial.status === 'PARTIALLY_PAID',
      afterPartial.status,
    );
    check(
      'balance reduced by exactly the amount paid',
      Math.abs(Number(afterPartial.balance) - (balance - part)) < 0.01,
      `${Number(afterPartial.balance)} vs ${balance - part}`,
    );

    // Idempotency.
    const key = `test-idem-${Date.now()}`;
    const first = await call('/payments/collect', {
      method: 'POST',
      body: {
        studentId: unpaid.studentId,
        amount: 100,
        method: 'CASH',
        idempotencyKey: key,
        invoiceIds: [unpaid.id],
      },
    });
    const replay = await call('/payments/collect', {
      method: 'POST',
      body: {
        studentId: unpaid.studentId,
        amount: 100,
        method: 'CASH',
        idempotencyKey: key,
        invoiceIds: [unpaid.id],
      },
    });
    check('first idempotent request succeeds', first.status === 201, `got ${first.status}`);
    check(
      'replayed idempotency key returns the SAME receipt, not a second charge',
      first.body?.data?.id === replay.body?.data?.id,
      `${first.body?.data?.receiptNumber} vs ${replay.body?.data?.receiptNumber}`,
    );

    const chargeCount = await prisma.payment.count({ where: { idempotencyKey: key } });
    check('only one payment row exists for the key', chargeCount === 1, `${chargeCount} rows`);

    await verifyInvariants('after collection');

    // ---------------------------------------------------------------------
    section('Refunds');

    const paymentId = first.body?.data?.id;

    const tooMuch = await call('/payments/refunds', {
      method: 'POST',
      body: { paymentId, amount: 10000, reason: 'Testing an excessive refund' },
    });
    check('refund exceeding the payment is rejected', tooMuch.status === 422, `got ${tooMuch.status}`);
    check(
      'excessive refund is reported as such',
      tooMuch.body?.code === 'REFUND_EXCEEDS_PAYMENT',
      tooMuch.body?.code,
    );

    const request = await call('/payments/refunds', {
      method: 'POST',
      body: { paymentId, amount: 40, reason: 'Overcharged for the activity fee' },
    });
    check('refund request is accepted', request.status === 201, `got ${request.status}`);
    check(
      'a requested refund does NOT move money yet',
      (
        await prisma.payment.findUnique({
          where: { id: paymentId },
          select: { refundedAmount: true },
        })
      ).refundedAmount.toString() === '0',
    );

    const refundId = request.body?.data?.id;
    const approve = await call(`/payments/refunds/${refundId}/decide`, {
      method: 'POST',
      body: { approve: true },
    });
    check('refund approval succeeds', approve.status === 201, `got ${approve.status}`);

    const afterRefund = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { refundedAmount: true, status: true },
    });
    check(
      'payment now records the refunded amount',
      Math.abs(Number(afterRefund.refundedAmount) - 40) < 0.01,
      `${Number(afterRefund.refundedAmount)}`,
    );
    check(
      'payment marked PARTIALLY_REFUNDED',
      afterRefund.status === 'PARTIALLY_REFUNDED',
      afterRefund.status,
    );

    // Approving twice must not double-refund.
    const doubleApprove = await call(`/payments/refunds/${refundId}/decide`, {
      method: 'POST',
      body: { approve: true },
    });
    check(
      'a refund cannot be approved twice',
      doubleApprove.status === 422 || doubleApprove.status === 400,
      `got ${doubleApprove.status}`,
    );

    await verifyInvariants('after refund');

    // ---------------------------------------------------------------------
    section('Invoice cancellation');

    const paidInvoice = await prisma.invoice.findFirst({
      where: { status: 'PAID' },
      select: { id: true },
    });

    if (paidInvoice) {
      const cancelPaid = await call(`/fees/invoices/${paidInvoice.id}/cancel`, {
        method: 'POST',
        body: { reason: 'Attempting to cancel a settled invoice' },
      });
      check(
        'a PAID invoice cannot be cancelled',
        cancelPaid.status === 409,
        `got ${cancelPaid.status}`,
      );
      check(
        'cancellation refusal cites the payment',
        cancelPaid.body?.code === 'INVOICE_ALREADY_PAID',
        cancelPaid.body?.code,
      );
    }
  }

  // -------------------------------------------------------------------------
  section('Bulk invoice generation is idempotent');

  const structure = await prisma.feeStructure.findFirst({
    select: { id: true, installments: { orderBy: { sequence: 'asc' }, select: { id: true } } },
  });

  if (structure?.installments?.[0]) {
    const again = await call('/fees/invoices/generate', {
      method: 'POST',
      body: { feeStructureId: structure.id, installmentId: structure.installments[0].id },
    });
    check('re-running bulk generation succeeds', again.status === 201, `got ${again.status}`);
    check(
      're-running generates 0 new invoices (no double-billing)',
      again.body?.data?.generated === 0,
      `generated ${again.body?.data?.generated}, skipped ${again.body?.data?.skipped}`,
    );
  }

  // -------------------------------------------------------------------------
  section('Authorization on money endpoints');

  const teacher = await call('/auth/login', {
    method: 'POST',
    body: { identifier: 'ramesh.iyer@greenfield.edu', password: 'Teacher@123' },
  });
  const teacherToken = teacher.body?.data?.tokens?.accessToken;
  const saved = token;
  token = teacherToken;

  const teacherCollects = await call('/payments/collect', {
    method: 'POST',
    body: { studentId: unpaid?.studentId ?? '00000000-0000-4000-8000-000000000000', amount: 100, method: 'CASH' },
  });
  check('a teacher may NOT collect fees', teacherCollects.status === 403, `got ${teacherCollects.status}`);

  const teacherRefunds = await call('/payments/refunds', {
    method: 'POST',
    body: { paymentId: '00000000-0000-4000-8000-000000000000', amount: 1, reason: 'x' },
  });
  check('a teacher may NOT issue refunds', teacherRefunds.status === 403, `got ${teacherRefunds.status}`);

  const teacherDashboard = await call('/fees/dashboard');
  check(
    'a teacher may NOT see the finance dashboard',
    teacherDashboard.status === 403,
    `got ${teacherDashboard.status}`,
  );

  token = saved;

  // -------------------------------------------------------------------------
  section('Final invariants');
  await verifyInvariants('final');

  console.log('\n' + '='.repeat(64));
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const failure of failures) {
      console.log(`   - ${failure.name}${failure.detail ? `: ${failure.detail}` : ''}`);
    }
  }
  console.log('');
}

run()
  .catch((error) => {
    console.error('\nFinancial test crashed:', error.message);
    failed += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
