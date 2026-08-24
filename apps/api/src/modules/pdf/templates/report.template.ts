import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  HAIRLINE,
  INK,
  MUTED,
  type SchoolBrand,
  baseStyles,
  dataTable,
  footer,
  letterhead,
  safeColor,
} from './branding';

export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string | number;
}

export interface TabularReportDocument {
  title: string;
  subtitle?: string;
  generatedOn: string;
  generatedBy?: string;
  /** Filters the report was run with, printed so a saved PDF stays meaningful. */
  filters: Array<[string, string]>;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  /** Headline figures printed above the table. */
  summary?: Array<{ label: string; value: string }>;
  /** Totals row appended to the table, keyed by column. */
  totals?: Record<string, string | number>;
  /** Set when the row set was capped, so nobody mistakes it for the whole set. */
  truncatedAt?: number;
  landscape?: boolean;
}

/**
 * The one table layout every report renders through.
 *
 * Reports differ in their query, not their appearance, so the engine hands
 * this template columns and rows and gets a document that matches every other
 * report in the product.
 */
export function tabularReportTemplate(
  brand: SchoolBrand,
  report: TabularReportDocument,
): TDocumentDefinitions {
  const accent = safeColor(brand.primaryColor, INK);
  const content: Content[] = [...letterhead(brand, report.title)];

  if (report.subtitle) {
    content.push({ text: report.subtitle, style: 'value', margin: [0, -4, 0, 8] });
  }

  const meta: Array<[string, string]> = [
    ['Generated', report.generatedOn],
    ...(report.generatedBy ? ([['By', report.generatedBy]] as Array<[string, string]>) : []),
    ...report.filters,
  ];

  content.push({
    columns: meta.map(([label, value]) => ({
      width: 'auto',
      stack: [
        { text: label.toUpperCase(), style: 'label' },
        { text: value || '—', style: 'value' },
      ],
    })),
    columnGap: 18,
    margin: [0, 0, 0, 10],
  });

  if (report.summary && report.summary.length > 0) {
    content.push({
      columns: report.summary.map((tile) => ({
        width: '*',
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  { text: tile.label.toUpperCase(), fontSize: 6.5, color: MUTED },
                  { text: tile.value, fontSize: 12, bold: true, color: accent, margin: [0, 2, 0, 0] },
                ],
                margin: [7, 6, 7, 6],
              },
            ],
          ],
        },
        layout: {
          fillColor: () => '#F8FAFC',
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => HAIRLINE,
          vLineColor: () => HAIRLINE,
        },
      })),
      columnGap: 6,
      margin: [0, 0, 0, 12],
    });
  }

  const rows = report.rows.map((row) =>
    report.columns.map((column) => {
      const value = row[column.key];
      return value === null || value === undefined ? '—' : value;
    }),
  );

  if (report.totals) {
    rows.push(
      report.columns.map((column, index) => {
        const total = report.totals?.[column.key];
        if (total !== undefined) return total;
        return index === 0 ? 'TOTAL' : '';
      }),
    );
  }

  content.push(
    dataTable({
      headers: report.columns.map((column) => column.label),
      widths: report.columns.map((column) => column.width ?? '*'),
      align: report.columns.map((column) => column.align ?? 'left'),
      headerColor: accent,
      rows,
      emptyText: 'No rows matched these filters',
    }),
  );

  content.push({
    text: `${report.rows.length} row(s)`,
    style: 'note',
    alignment: 'right',
    margin: [0, 6, 0, 0],
  });

  if (report.truncatedAt) {
    content.push({
      text:
        `Showing the first ${report.truncatedAt} rows. Export to Excel or CSV for the ` +
        'complete data set.',
      style: 'note',
      color: '#B45309',
      margin: [0, 4, 0, 0],
    });
  }

  return {
    pageSize: 'A4',
    pageOrientation: report.landscape ? 'landscape' : 'portrait',
    pageMargins: [30, 34, 30, 44],
    info: { title: report.title, author: brand.name },
    content,
    footer: footer(brand, `${brand.name} — ${report.title}`),
    styles: baseStyles(brand),
  };
}
