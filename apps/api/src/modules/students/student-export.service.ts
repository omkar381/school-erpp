import { Injectable } from '@nestjs/common';
import { EnrollmentStatus, InvoiceStatus, Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../database/prisma.service';
import { formatDate } from '../../common/utils/date.util';
import { AcademicYearService } from '../academics/services/academic-year.service';
import type { StudentQueryDto } from './dto/student.dto';

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/** Rows are streamed in pages so a large school does not exhaust memory. */
const PAGE_SIZE = 500;
const MAX_ROWS = 20_000;

const COLUMNS = [
  { header: 'Admission No', key: 'admissionNumber', width: 18 },
  { header: 'Roll No', key: 'rollNumber', width: 10 },
  { header: 'Name', key: 'fullName', width: 28 },
  { header: 'Class', key: 'className', width: 12 },
  { header: 'Section', key: 'sectionName', width: 10 },
  { header: 'Gender', key: 'gender', width: 10 },
  { header: 'Date of Birth', key: 'dateOfBirth', width: 14 },
  { header: 'Blood Group', key: 'bloodGroup', width: 12 },
  { header: 'Category', key: 'category', width: 12 },
  { header: 'Guardian', key: 'guardianName', width: 24 },
  { header: 'Relation', key: 'guardianRelation', width: 12 },
  { header: 'Guardian Phone', key: 'guardianPhone', width: 16 },
  { header: 'Student Phone', key: 'phone', width: 16 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'City', key: 'city', width: 16 },
  { header: 'Admission Date', key: 'admissionDate', width: 14 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Outstanding', key: 'outstanding', width: 14 },
];

@Injectable()
export class StudentExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicYears: AcademicYearService,
  ) {}

  async export(
    schoolId: string,
    query: StudentQueryDto,
    format: 'xlsx' | 'csv',
  ): Promise<ExportResult> {
    const rows = await this.collectRows(schoolId, query);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      return {
        buffer: Buffer.from(this.toCsv(rows), 'utf8'),
        filename: `students-${stamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    }

    return {
      buffer: await this.toXlsx(rows, schoolId),
      filename: `students-${stamp}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private async collectRows(
    schoolId: string,
    query: StudentQueryDto,
  ): Promise<Array<Record<string, string | number>>> {
    const academicYearId = await this.academicYears.resolveId(schoolId, query.academicYearId);

    const where: Prisma.StudentWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.gender ? { gender: query.gender } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.classId || query.sectionId
        ? {
            enrollments: {
              some: {
                academicYearId,
                status: EnrollmentStatus.ACTIVE,
                ...(query.classId ? { classId: query.classId } : {}),
                ...(query.sectionId ? { sectionId: query.sectionId } : {}),
              },
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { admissionNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows: Array<Record<string, string | number>> = [];
    let cursor: string | undefined;

    while (rows.length < MAX_ROWS) {
      const page = await this.prisma.student.findMany({
        where,
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          admissionNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          gender: true,
          dateOfBirth: true,
          bloodGroup: true,
          category: true,
          phone: true,
          email: true,
          city: true,
          admissionDate: true,
          status: true,
          enrollments: {
            where: { academicYearId },
            take: 1,
            select: {
              rollNumber: true,
              class: { select: { name: true } },
              section: { select: { name: true } },
            },
          },
          guardians: {
            where: { isPrimary: true },
            take: 1,
            select: {
              guardian: {
                select: { firstName: true, lastName: true, phone: true, relation: true },
              },
            },
          },
          invoices: {
            where: {
              status: {
                in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
              },
            },
            select: { balance: true },
          },
        },
      });

      if (page.length === 0) break;

      for (const student of page) {
        const enrollment = student.enrollments[0];
        const guardian = student.guardians[0]?.guardian;

        rows.push({
          admissionNumber: student.admissionNumber,
          rollNumber: enrollment?.rollNumber ?? '',
          fullName: [student.firstName, student.middleName, student.lastName]
            .filter(Boolean)
            .join(' '),
          className: enrollment?.class.name ?? '',
          sectionName: enrollment?.section.name ?? '',
          gender: student.gender,
          dateOfBirth: formatDate(student.dateOfBirth, 'dd/MM/yyyy'),
          bloodGroup: student.bloodGroup === 'UNKNOWN' ? '' : this.formatBloodGroup(student.bloodGroup),
          category: student.category ?? '',
          guardianName: guardian
            ? [guardian.firstName, guardian.lastName].filter(Boolean).join(' ')
            : '',
          guardianRelation: guardian?.relation ?? '',
          guardianPhone: guardian?.phone ?? '',
          phone: student.phone ?? '',
          email: student.email ?? '',
          city: student.city ?? '',
          admissionDate: formatDate(student.admissionDate, 'dd/MM/yyyy'),
          status: student.status,
          outstanding: student.invoices.reduce(
            (sum, invoice) => sum + Number(invoice.balance),
            0,
          ),
        });
      }

      cursor = page[page.length - 1].id;
      if (page.length < PAGE_SIZE) break;
    }

    return rows;
  }

  private async toXlsx(
    rows: Array<Record<string, string | number>>,
    schoolId: string,
  ): Promise<Buffer> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, currency: true },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = school?.name ?? 'School ERP Platform';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Students', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = COLUMNS;

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    header.height = 22;
    header.alignment = { vertical: 'middle' };

    for (const row of rows) sheet.addRow(row);

    sheet.getColumn('outstanding').numFmt = '#,##0.00';
    sheet.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };

    // Zebra striping keeps a long printed list readable.
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (rowNumber % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      row.alignment = { vertical: 'middle' };
    });

    return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
  }

  private toCsv(rows: Array<Record<string, string | number>>): string {
    const escape = (value: unknown): string => {
      const text = String(value ?? '');
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = [COLUMNS.map((column) => escape(column.header)).join(',')];
    for (const row of rows) {
      lines.push(COLUMNS.map((column) => escape(row[column.key])).join(','));
    }

    // BOM so Excel opens UTF-8 correctly on Windows.
    return `﻿${lines.join('\r\n')}`;
  }

  private formatBloodGroup(value: string): string {
    return value.replace('_POSITIVE', '+').replace('_NEGATIVE', '-');
  }
}
