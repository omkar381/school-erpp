import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AppLogger } from '../../common/logger/app-logger.service';

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

export interface ExportColumn {
  key: string;
  label: string;
  /** Drives Excel cell formatting; text is the safe default. */
  type?: 'text' | 'number' | 'currency' | 'percent' | 'date';
  width?: number;
}

export interface ExportSheet {
  name: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  /** Printed above the table as a title block. */
  title?: string;
  subtitle?: string;
  meta?: Array<[string, string]>;
  totals?: Record<string, string | number>;
}

export interface ExportedFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const MIME: Record<Exclude<ExportFormat, 'pdf'>, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

const NUMBER_FORMATS: Record<string, string> = {
  currency: '#,##0.00',
  number: '#,##0.###',
  percent: '0.00"%"',
  date: 'dd-mmm-yyyy',
};

/**
 * Turns report rows into a spreadsheet or a CSV.
 *
 * Excel gets a formatted, frozen-header sheet with an auto-filter; CSV stays
 * deliberately plain so it imports cleanly anywhere.
 */
@Injectable()
export class ExportService {
  private readonly log: AppLogger;

  constructor(logger: AppLogger) {
    this.log = logger.child('ExportService');
  }

  async toExcel(sheets: ExportSheet[], fileName: string): Promise<ExportedFile> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'School ERP Platform';
    workbook.created = new Date();

    for (const sheet of sheets) {
      this.writeSheet(workbook, sheet);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const name = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;

    this.log.debug('Workbook written', {
      fileName: name,
      sheets: sheets.length,
      rows: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
      sizeBytes: buffer.length,
    });

    return { buffer, fileName: name, mimeType: MIME.xlsx, sizeBytes: buffer.length };
  }

  private writeSheet(workbook: ExcelJS.Workbook, sheet: ExportSheet): void {
    // Excel rejects these characters in a sheet name and caps it at 31 chars.
    const worksheet = workbook.addWorksheet(sheet.name.replace(/[\\/*?:[\]]/g, '-').slice(0, 31), {
      views: [{ state: 'frozen', ySplit: 0 }],
    });

    let cursor = 1;

    if (sheet.title) {
      const cell = worksheet.getCell(cursor, 1);
      cell.value = sheet.title;
      cell.font = { size: 14, bold: true };
      worksheet.mergeCells(cursor, 1, cursor, Math.max(1, sheet.columns.length));
      cursor += 1;
    }

    if (sheet.subtitle) {
      const cell = worksheet.getCell(cursor, 1);
      cell.value = sheet.subtitle;
      cell.font = { size: 10, color: { argb: 'FF64748B' } };
      worksheet.mergeCells(cursor, 1, cursor, Math.max(1, sheet.columns.length));
      cursor += 1;
    }

    for (const [label, value] of sheet.meta ?? []) {
      worksheet.getCell(cursor, 1).value = label;
      worksheet.getCell(cursor, 1).font = { size: 9, color: { argb: 'FF64748B' } };
      worksheet.getCell(cursor, 2).value = value;
      worksheet.getCell(cursor, 2).font = { size: 9, bold: true };
      cursor += 1;
    }

    if (cursor > 1) cursor += 1;

    const headerRowNumber = cursor;
    const headerRow = worksheet.getRow(headerRowNumber);
    sheet.columns.forEach((column, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = column.label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    });
    headerRow.height = 20;
    headerRow.commit();
    cursor += 1;

    for (const row of sheet.rows) {
      const worksheetRow = worksheet.getRow(cursor);
      sheet.columns.forEach((column, index) => {
        const cell = worksheetRow.getCell(index + 1);
        cell.value = this.cellValue(row[column.key], column.type);
        const format = column.type ? NUMBER_FORMATS[column.type] : undefined;
        if (format) cell.numFmt = format;
        if (column.type === 'currency' || column.type === 'number' || column.type === 'percent') {
          cell.alignment = { horizontal: 'right' };
        }
      });
      worksheetRow.commit();
      cursor += 1;
    }

    if (sheet.totals) {
      const totalsRow = worksheet.getRow(cursor);
      sheet.columns.forEach((column, index) => {
        const cell = totalsRow.getCell(index + 1);
        const total = sheet.totals?.[column.key];
        cell.value = total ?? (index === 0 ? 'TOTAL' : null);
        cell.font = { bold: true };
        cell.border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } } };
        const format = column.type ? NUMBER_FORMATS[column.type] : undefined;
        if (format) cell.numFmt = format;
      });
      totalsRow.commit();
    }

    sheet.columns.forEach((column, index) => {
      const widest = sheet.rows.reduce(
        (max, row) => Math.max(max, String(row[column.key] ?? '').length),
        column.label.length,
      );
      worksheet.getColumn(index + 1).width = column.width ?? Math.min(46, Math.max(10, widest + 3));
    });

    // Freeze everything above the first data row so headers stay put, and let
    // the reader filter the columns.
    worksheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
    if (sheet.rows.length > 0) {
      worksheet.autoFilter = {
        from: { row: headerRowNumber, column: 1 },
        to: { row: headerRowNumber + sheet.rows.length, column: sheet.columns.length },
      };
    }
  }

  private cellValue(value: unknown, type?: ExportColumn['type']): ExcelJS.CellValue {
    if (value === null || value === undefined) return null;

    if (type === 'number' || type === 'currency' || type === 'percent') {
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    if (type === 'date') {
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : date;
    }

    if (value instanceof Date) return value;
    if (typeof value === 'object') return JSON.stringify(value);
    return value as ExcelJS.CellValue;
  }

  /**
   * Renders one sheet as CSV.
   *
   * The BOM is deliberate: without it Excel on Windows reads UTF-8 names as
   * mojibake, and Indian school rolls are full of non-ASCII names.
   */
  toCsv(sheet: ExportSheet, fileName: string): ExportedFile {
    const lines: string[] = [
      sheet.columns.map((column) => this.escape(column.label)).join(','),
      ...sheet.rows.map((row) =>
        sheet.columns.map((column) => this.escape(this.plain(row[column.key]))).join(','),
      ),
    ];

    if (sheet.totals) {
      lines.push(
        sheet.columns
          .map((column, index) =>
            this.escape(
              sheet.totals?.[column.key] !== undefined
                ? String(sheet.totals[column.key])
                : index === 0
                  ? 'TOTAL'
                  : '',
            ),
          )
          .join(','),
      );
    }

    const buffer = Buffer.concat([
      Buffer.from('﻿', 'utf8'),
      Buffer.from(lines.join('\r\n'), 'utf8'),
    ]);
    const name = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;

    return { buffer, fileName: name, mimeType: MIME.csv, sizeBytes: buffer.length };
  }

  private plain(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * Quotes a CSV field.
   *
   * A leading `=`, `+`, `-` or `@` is prefixed with a quote so a spreadsheet
   * treats it as text: a name or note starting with one of those would
   * otherwise be evaluated as a formula when the file is opened.
   */
  private escape(value: string): string {
    const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  }
}
