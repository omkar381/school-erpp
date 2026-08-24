import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  HAIRLINE,
  INK,
  MUTED,
  type SchoolBrand,
  baseStyles,
  dataTable,
  detailPanel,
  footer,
  letterhead,
  safeColor,
} from './branding';

export interface Money {
  currency: string;
  amount: number;
}

export interface InvoiceDocument {
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  academicYear: string;
  currency: string;
  student: {
    name: string;
    admissionNumber: string;
    rollNumber: string | null;
    className: string;
    sectionName: string;
    guardianName: string | null;
    guardianPhone: string | null;
  };
  items: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    discountAmount: number;
    taxAmount: number;
    amount: number;
  }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  lateFee: number;
  total: number;
  paidAmount: number;
  balance: number;
  notes: string | null;
  payments: Array<{ receiptNumber: string; paidAt: string; method: string; amount: number }>;
}

export interface ReceiptDocument {
  receiptNumber: string;
  paidAt: string;
  method: string;
  status: string;
  currency: string;
  amount: number;
  referenceNumber: string | null;
  bankName: string | null;
  chequeNumber: string | null;
  collectedBy: string | null;
  student: {
    name: string;
    admissionNumber: string;
    className: string;
    sectionName: string;
  };
  allocations: Array<{ invoiceNumber: string; dueDate: string; amount: number }>;
  outstandingAfter: number;
}

export interface FeeStatementDocument {
  academicYear: string;
  currency: string;
  generatedOn: string;
  student: {
    name: string;
    admissionNumber: string;
    className: string;
    sectionName: string;
    guardianName: string | null;
  };
  entries: Array<{
    date: string;
    particulars: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  billed: number;
  paid: number;
  refunded: number;
  outstanding: number;
}

/** Indian digit grouping, which is what an Indian school's parents expect. */
export function money(amount: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  const value = Math.abs(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-${symbol}${value}` : `${symbol}${value}`;
}

const STATUS_COLORS: Record<string, string> = {
  PAID: '#15803D',
  PARTIALLY_PAID: '#B45309',
  ISSUED: '#1D4ED8',
  OVERDUE: '#B91C1C',
  CANCELLED: '#64748B',
  VOID: '#64748B',
  SUCCESS: '#15803D',
  PENDING: '#B45309',
  FAILED: '#B91C1C',
  REFUNDED: '#7C3AED',
};

function statusBadge(status: string): Content {
  return {
    table: {
      body: [[{ text: status.replace(/_/g, ' '), style: 'badge', margin: [6, 3, 6, 3] }]],
    },
    layout: {
      fillColor: () => STATUS_COLORS[status] ?? MUTED,
      hLineWidth: () => 0,
      vLineWidth: () => 0,
    },
  };
}

/** Right-aligned totals stack shared by the invoice and the statement. */
function totalsBlock(
  rows: Array<[string, number, boolean?]>,
  currency: string,
  accent: string,
): Content {
  return {
    columns: [
      { text: '', width: '*' },
      {
        width: 230,
        table: {
          widths: ['*', 'auto'],
          body: rows.map(([label, value, emphasise]) => [
            {
              text: label,
              style: emphasise ? 'total' : 'label',
              alignment: 'right',
              margin: [0, 3, 6, 3],
              ...(emphasise ? { color: accent } : {}),
            },
            {
              text: money(value, currency),
              style: emphasise ? 'total' : 'value',
              alignment: 'right',
              margin: [0, 3, 0, 3],
              ...(emphasise ? { color: accent } : {}),
            },
          ]),
        },
        layout: {
          hLineWidth: (index: number, node: { table: { body: unknown[] } }) =>
            index === node.table.body.length - 1 || index === node.table.body.length ? 0.8 : 0,
          vLineWidth: () => 0,
          hLineColor: () => HAIRLINE,
        },
      },
    ],
    margin: [0, 8, 0, 0],
  };
}

export function invoiceTemplate(
  brand: SchoolBrand,
  invoice: InvoiceDocument,
): TDocumentDefinitions {
  const accent = safeColor(brand.primaryColor, INK);
  const { student } = invoice;

  const content: Content[] = [
    ...letterhead(brand, 'Fee Invoice'),
    {
      columns: [
        {
          width: '*',
          ...detailPanel(
            [
              ['Invoice No.', invoice.invoiceNumber],
              ['Issue Date', invoice.issueDate],
              ['Due Date', invoice.dueDate],
              ['Academic Year', invoice.academicYear],
            ],
            1,
          ),
        },
        {
          width: '*',
          ...detailPanel(
            [
              ['Student', student.name],
              ['Admission No.', student.admissionNumber],
              ['Class', `${student.className} — ${student.sectionName}`],
              ['Guardian', student.guardianName ?? '—'],
            ],
            1,
          ),
        },
        { width: 'auto', stack: [statusBadge(invoice.status)] },
      ],
      columnGap: 14,
    },
    dataTable({
      headers: ['#', 'Particulars', 'Qty', 'Rate', 'Discount', 'Tax', 'Amount'],
      widths: [16, '*', 28, 62, 62, 52, 68],
      align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'],
      headerColor: accent,
      rows: invoice.items.map((item, index) => [
        index + 1,
        item.description,
        item.quantity,
        money(item.unitAmount, invoice.currency),
        item.discountAmount > 0 ? money(item.discountAmount, invoice.currency) : '—',
        item.taxAmount > 0 ? money(item.taxAmount, invoice.currency) : '—',
        money(item.amount, invoice.currency),
      ]),
      emptyText: 'This invoice has no line items',
    }),
    totalsBlock(
      [
        ['Subtotal', invoice.subtotal],
        ...(invoice.discountTotal > 0
          ? ([['Discount', -invoice.discountTotal]] as Array<[string, number]>)
          : []),
        ...(invoice.taxTotal > 0 ? ([['Tax', invoice.taxTotal]] as Array<[string, number]>) : []),
        ...(invoice.lateFee > 0 ? ([['Late fee', invoice.lateFee]] as Array<[string, number]>) : []),
        ['Total', invoice.total, true],
        ['Paid', invoice.paidAmount],
        ['Balance due', invoice.balance, true],
      ],
      invoice.currency,
      accent,
    ),
  ];

  if (invoice.payments.length > 0) {
    content.push(
      { text: 'Payments received', style: 'sectionTitle' },
      dataTable({
        headers: ['Receipt No.', 'Date', 'Method', 'Amount'],
        widths: ['*', 90, 90, 80],
        align: ['left', 'left', 'left', 'right'],
        headerColor: accent,
        rows: invoice.payments.map((payment) => [
          payment.receiptNumber,
          payment.paidAt,
          payment.method.replace(/_/g, ' '),
          money(payment.amount, invoice.currency),
        ]),
      }),
    );
  }

  if (invoice.notes) {
    content.push({ text: 'Notes', style: 'sectionTitle' }, { text: invoice.notes, style: 'note' });
  }

  content.push({
    text:
      invoice.balance > 0
        ? `Please settle ${money(invoice.balance, invoice.currency)} on or before ${invoice.dueDate}.`
        : 'This invoice is fully settled. Thank you.',
    style: 'note',
    margin: [0, 14, 0, 0],
  });

  return {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 46],
    info: { title: `Invoice ${invoice.invoiceNumber}`, author: brand.name },
    content,
    footer: footer(brand),
    styles: baseStyles(brand),
  };
}

export function receiptTemplate(
  brand: SchoolBrand,
  receipt: ReceiptDocument,
): TDocumentDefinitions {
  const accent = safeColor(brand.primaryColor, INK);

  const instrument: Array<[string, string]> = [
    ['Method', receipt.method.replace(/_/g, ' ')],
    ...(receipt.referenceNumber
      ? ([['Reference', receipt.referenceNumber]] as Array<[string, string]>)
      : []),
    ...(receipt.bankName ? ([['Bank', receipt.bankName]] as Array<[string, string]>) : []),
    ...(receipt.chequeNumber
      ? ([['Cheque No.', receipt.chequeNumber]] as Array<[string, string]>)
      : []),
  ];

  return {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 46],
    info: { title: `Receipt ${receipt.receiptNumber}`, author: brand.name },
    content: [
      ...letterhead(brand, 'Fee Receipt'),
      {
        columns: [
          {
            width: '*',
            ...detailPanel(
              [
                ['Receipt No.', receipt.receiptNumber],
                ['Date', receipt.paidAt],
                ...instrument,
              ],
              1,
            ),
          },
          {
            width: '*',
            ...detailPanel(
              [
                ['Student', receipt.student.name],
                ['Admission No.', receipt.student.admissionNumber],
                ['Class', `${receipt.student.className} — ${receipt.student.sectionName}`],
                ['Collected by', receipt.collectedBy ?? '—'],
              ],
              1,
            ),
          },
          { width: 'auto', stack: [statusBadge(receipt.status)] },
        ],
        columnGap: 14,
      },
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  { text: 'Amount received', style: 'label', alignment: 'center' },
                  {
                    text: money(receipt.amount, receipt.currency),
                    fontSize: 22,
                    bold: true,
                    color: accent,
                    alignment: 'center',
                    margin: [0, 2, 0, 0],
                  },
                ],
                margin: [0, 10, 0, 10],
              },
            ],
          ],
        },
        layout: {
          fillColor: () => '#F8FAFC',
          hLineWidth: () => 0.6,
          vLineWidth: () => 0.6,
          hLineColor: () => HAIRLINE,
          vLineColor: () => HAIRLINE,
        },
        margin: [0, 4, 0, 4],
      },
      { text: 'Applied to', style: 'sectionTitle' },
      dataTable({
        headers: ['Invoice No.', 'Due Date', 'Amount applied'],
        widths: ['*', 110, 110],
        align: ['left', 'left', 'right'],
        headerColor: accent,
        rows: receipt.allocations.map((allocation) => [
          allocation.invoiceNumber,
          allocation.dueDate,
          money(allocation.amount, receipt.currency),
        ]),
        emptyText: 'Held as an unapplied credit',
      }),
      totalsBlock(
        [
          ['Amount received', receipt.amount, true],
          ['Outstanding after this payment', receipt.outstandingAfter],
        ],
        receipt.currency,
        accent,
      ),
      {
        text: 'This is a computer generated receipt and does not require a signature.',
        style: 'note',
        margin: [0, 18, 0, 0],
      },
    ],
    footer: footer(brand),
    styles: baseStyles(brand),
  };
}

export function feeStatementTemplate(
  brand: SchoolBrand,
  statement: FeeStatementDocument,
): TDocumentDefinitions {
  const accent = safeColor(brand.primaryColor, INK);

  return {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 46],
    info: { title: `Fee statement — ${statement.student.admissionNumber}`, author: brand.name },
    content: [
      ...letterhead(brand, 'Fee Statement'),
      detailPanel([
        ['Student', statement.student.name],
        ['Admission No.', statement.student.admissionNumber],
        ['Class', `${statement.student.className} — ${statement.student.sectionName}`],
        ['Guardian', statement.student.guardianName ?? '—'],
        ['Academic Year', statement.academicYear],
        ['Generated On', statement.generatedOn],
      ]),
      dataTable({
        headers: ['Date', 'Particulars', 'Reference', 'Debit', 'Credit', 'Balance'],
        widths: [60, '*', 90, 62, 62, 68],
        align: ['left', 'left', 'left', 'right', 'right', 'right'],
        headerColor: accent,
        rows: statement.entries.map((entry) => [
          entry.date,
          entry.particulars,
          entry.reference,
          entry.debit > 0 ? money(entry.debit, statement.currency) : '—',
          entry.credit > 0 ? money(entry.credit, statement.currency) : '—',
          money(entry.balance, statement.currency),
        ]),
        emptyText: 'No transactions in this academic year',
      }),
      totalsBlock(
        [
          ['Total billed', statement.billed],
          ['Total paid', statement.paid],
          ...(statement.refunded > 0
            ? ([['Refunded', statement.refunded]] as Array<[string, number]>)
            : []),
          ['Outstanding', statement.outstanding, true],
        ],
        statement.currency,
        accent,
      ),
    ],
    footer: footer(brand),
    styles: baseStyles(brand),
  };
}
