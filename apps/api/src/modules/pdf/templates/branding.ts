import type { Content, ContentTable, TableCell } from 'pdfmake/interfaces';

/** Everything a template needs to look like it came from this school. */
export interface SchoolBrand {
  name: string;
  code: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string;
  email: string;
  website: string | null;
  board: string | null;
  affiliationNumber: string | null;
  currency: string;
  timezone: string;
  primaryColor: string;
  secondaryColor: string;
  /** Data URI of the logo, resolved by the caller; templates never fetch. */
  logoDataUri: string | null;
}

export const INK = '#0F172A';
export const MUTED = '#64748B';
export const HAIRLINE = '#E2E8F0';
export const ZEBRA = '#F8FAFC';

/** pdfmake accepts `#RGB` and `#RRGGBB` only; anything else would throw. */
export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : fallback;
}

export function formatAddress(brand: SchoolBrand): string {
  return [
    brand.addressLine1,
    brand.addressLine2,
    [brand.city, brand.state].filter(Boolean).join(', '),
    brand.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The letterhead every document opens with: logo, school identity, contact
 * line, and a rule in the school's primary colour.
 */
export function letterhead(brand: SchoolBrand, documentTitle: string): Content[] {
  const primary = safeColor(brand.primaryColor, INK);

  const identity: Content = {
    stack: [
      { text: brand.name.toUpperCase(), style: 'schoolName', color: primary },
      ...(brand.board || brand.affiliationNumber
        ? [
            {
              text: [brand.board, brand.affiliationNumber && `Affiliation No. ${brand.affiliationNumber}`]
                .filter(Boolean)
                .join('  •  '),
              style: 'schoolMeta',
            },
          ]
        : []),
      { text: formatAddress(brand), style: 'schoolMeta' },
      {
        text: [brand.phone, brand.email, brand.website].filter(Boolean).join('  •  '),
        style: 'schoolMeta',
      },
    ],
  };

  return [
    {
      columns: brand.logoDataUri
        ? [{ image: brand.logoDataUri, fit: [46, 46], width: 56 }, identity]
        : [identity],
      columnGap: 10,
    },
    { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1.4, lineColor: primary }] },
    { text: documentTitle.toUpperCase(), style: 'documentTitle', margin: [0, 10, 0, 10] },
  ];
}

/** Page footer with the generation stamp and page numbers. */
export function footer(brand: SchoolBrand, note?: string) {
  return (currentPage: number, pageCount: number): Content => ({
    margin: [40, 8, 40, 0],
    columns: [
      { text: note ?? `${brand.name} — computer generated document`, style: 'footer' },
      { text: `Page ${currentPage} of ${pageCount}`, style: 'footer', alignment: 'right' },
    ],
  });
}

/** Two-column label/value block, the workhorse of every header panel. */
export function detailPanel(rows: Array<[string, string]>, columns = 2): ContentTable {
  const cells: TableCell[] = rows.flatMap(([label, value]) => [
    { text: label, style: 'label' },
    { text: value || '—', style: 'value' },
  ]);

  const perRow = columns * 2;
  const body: TableCell[][] = [];
  for (let index = 0; index < cells.length; index += perRow) {
    const row = cells.slice(index, index + perRow);
    while (row.length < perRow) row.push({ text: '' });
    body.push(row);
  }

  return {
    table: {
      widths: Array.from({ length: columns }, () => ['auto', '*']).flat(),
      body: body.length > 0 ? body : [[{ text: '' }, { text: '' }]],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 10],
  };
}

/**
 * A data table with a tinted header, hairline rules and zebra striping.
 * `align` maps one entry per column.
 */
export function dataTable(options: {
  headers: string[];
  rows: Array<Array<string | number>>;
  widths?: Array<string | number>;
  align?: Array<'left' | 'right' | 'center'>;
  headerColor?: string;
  emptyText?: string;
}): ContentTable {
  const { headers, rows, align = [], headerColor = INK } = options;

  const headerRow: TableCell[] = headers.map((header, index) => ({
    text: header,
    style: 'tableHeader',
    alignment: align[index] ?? 'left',
  }));

  const bodyRows: TableCell[][] =
    rows.length > 0
      ? rows.map((row) =>
          row.map((cell, index) => ({
            text: String(cell ?? ''),
            style: 'tableCell',
            alignment: align[index] ?? 'left',
          })),
        )
      : [
          [
            {
              text: options.emptyText ?? 'No records',
              style: 'tableCell',
              alignment: 'center',
              colSpan: headers.length,
              color: MUTED,
            },
            ...Array.from({ length: headers.length - 1 }, () => ({ text: '' })),
          ],
        ];

  return {
    table: {
      headerRows: 1,
      widths: options.widths ?? headers.map(() => '*'),
      body: [headerRow, ...bodyRows],
    },
    layout: {
      fillColor: (rowIndex: number) =>
        rowIndex === 0 ? safeColor(headerColor, INK) : rowIndex % 2 === 0 ? ZEBRA : null,
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => HAIRLINE,
      paddingTop: () => 5,
      paddingBottom: () => 5,
      paddingLeft: () => 6,
      paddingRight: () => 6,
    },
  };
}

/** Signature lines, printed at the foot of report cards and certificates. */
export function signatureRow(labels: string[]): Content {
  return {
    columns: labels.map((label) => ({
      stack: [
        { text: ' ', margin: [0, 18, 0, 0] },
        {
          canvas: [{ type: 'line', x1: 0, y1: 0, x2: 120, y2: 0, lineWidth: 0.6, lineColor: MUTED }],
        },
        { text: label, style: 'signature', margin: [0, 3, 0, 0] },
      ],
    })),
    columnGap: 18,
    margin: [0, 24, 0, 0],
  };
}

/** The shared style sheet. Templates only add what is specific to them. */
export function baseStyles(brand: SchoolBrand): Record<string, Record<string, unknown>> {
  const primary = safeColor(brand.primaryColor, INK);

  return {
    schoolName: { fontSize: 16, bold: true, letterSpacing: 0.4 },
    schoolMeta: { fontSize: 7.5, color: MUTED, margin: [0, 1, 0, 0] },
    documentTitle: { fontSize: 11, bold: true, color: primary, letterSpacing: 1.2 },
    sectionTitle: { fontSize: 9.5, bold: true, color: primary, margin: [0, 12, 0, 6] },
    label: { fontSize: 8, color: MUTED, margin: [0, 2, 6, 2] },
    value: { fontSize: 8.5, bold: true, margin: [0, 2, 12, 2] },
    tableHeader: { fontSize: 8, bold: true, color: '#FFFFFF' },
    tableCell: { fontSize: 8.5 },
    total: { fontSize: 10, bold: true },
    footer: { fontSize: 7, color: MUTED },
    signature: { fontSize: 7.5, color: MUTED },
    badge: { fontSize: 8, bold: true, color: '#FFFFFF' },
    note: { fontSize: 7.5, color: MUTED, italics: true },
  };
}
