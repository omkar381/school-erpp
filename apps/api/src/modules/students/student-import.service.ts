import { Injectable } from '@nestjs/common';
import { EnrollmentStatus, Gender, RoleType, StudentStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { BadRequestError, NotFoundError } from '../../common/exceptions/app.exception';
import { SequenceService } from '../../common/services/sequence.service';
import { parseDateOnly } from '../../common/utils/date.util';
import { UsersService } from '../users/users.service';
import { AcademicYearService } from '../academics/services/academic-year.service';
import type { BulkImportOptionsDto } from './dto/student.dto';

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
  value?: string;
}

export interface ImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: ImportRowError[];
  /** Populated on a dry run so the caller can preview what would be created. */
  preview?: Array<Record<string, unknown>>;
}

interface ParsedRow {
  rowNumber: number;
  admissionNumber?: string;
  rollNumber?: string;
  firstName: string;
  middleName?: string;
  lastName?: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup?: string;
  category?: string;
  religion?: string;
  admissionDate?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  guardianName?: string;
  guardianRelation?: string;
  guardianPhone?: string;
  guardianEmail?: string;
  guardianOccupation?: string;
  previousSchool?: string;
}

/** Column headers accepted in the upload, mapped to internal field names. */
const COLUMN_ALIASES: Record<string, keyof ParsedRow> = {
  'admission number': 'admissionNumber',
  'admission no': 'admissionNumber',
  admissionnumber: 'admissionNumber',
  'roll number': 'rollNumber',
  'roll no': 'rollNumber',
  rollnumber: 'rollNumber',
  'first name': 'firstName',
  firstname: 'firstName',
  name: 'firstName',
  'middle name': 'middleName',
  middlename: 'middleName',
  'last name': 'lastName',
  lastname: 'lastName',
  surname: 'lastName',
  'date of birth': 'dateOfBirth',
  dob: 'dateOfBirth',
  dateofbirth: 'dateOfBirth',
  gender: 'gender',
  sex: 'gender',
  'blood group': 'bloodGroup',
  bloodgroup: 'bloodGroup',
  category: 'category',
  religion: 'religion',
  'admission date': 'admissionDate',
  admissiondate: 'admissionDate',
  email: 'email',
  phone: 'phone',
  mobile: 'phone',
  'contact number': 'phone',
  address: 'address',
  city: 'city',
  state: 'state',
  'postal code': 'postalCode',
  pincode: 'postalCode',
  'guardian name': 'guardianName',
  'parent name': 'guardianName',
  'father name': 'guardianName',
  guardianname: 'guardianName',
  'guardian relation': 'guardianRelation',
  relation: 'guardianRelation',
  'guardian phone': 'guardianPhone',
  'parent phone': 'guardianPhone',
  'parent mobile': 'guardianPhone',
  guardianphone: 'guardianPhone',
  'guardian email': 'guardianEmail',
  'parent email': 'guardianEmail',
  'guardian occupation': 'guardianOccupation',
  occupation: 'guardianOccupation',
  'previous school': 'previousSchool',
};

const GENDER_ALIASES: Record<string, Gender> = {
  m: Gender.MALE,
  male: Gender.MALE,
  boy: Gender.MALE,
  f: Gender.FEMALE,
  female: Gender.FEMALE,
  girl: Gender.FEMALE,
  o: Gender.OTHER,
  other: Gender.OTHER,
};

const RELATION_ALIASES: Record<string, string> = {
  father: 'FATHER',
  mother: 'MOTHER',
  guardian: 'GUARDIAN',
  uncle: 'UNCLE',
  aunt: 'AUNT',
  grandfather: 'GRANDFATHER',
  grandmother: 'GRANDMOTHER',
  brother: 'SIBLING',
  sister: 'SIBLING',
};

/** Rows are committed in chunks so one bad row does not roll back the whole file. */
const CHUNK_SIZE = 25;

@Injectable()
export class StudentImportService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly academicYears: AcademicYearService,
    private readonly sequences: SequenceService,
    logger: AppLogger,
  ) {
    this.log = logger.child('StudentImportService');
  }

  async import(
    schoolId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    options: BulkImportOptionsDto,
  ): Promise<ImportResult> {
    const academicYearId = await this.academicYears.resolveId(schoolId, options.academicYearId);

    const section = await this.prisma.section.findFirst({
      where: { id: options.sectionId, schoolId },
      select: {
        id: true,
        name: true,
        capacity: true,
        classId: true,
        class: { select: { id: true, name: true } },
        _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
      },
    });
    if (!section) throw new NotFoundError('Section');

    const rows = this.isCsv(file)
      ? this.parseCsvFile(file.buffer)
      : await this.parseExcelFile(file.buffer);

    if (rows.length === 0) {
      throw new BadRequestError('The file contains no data rows');
    }
    if (rows.length > 1000) {
      throw new BadRequestError('Please import at most 1000 students per file');
    }

    const availableSeats = section.capacity - section._count.enrollments;
    if (rows.length > availableSeats) {
      throw new BadRequestError(
        `${section.class.name} ${section.name} has ${availableSeats} seat(s) available but the ` +
          `file contains ${rows.length} student(s).`,
      );
    }

    const result: ImportResult = {
      totalRows: rows.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    // Validate everything before writing anything, so a dry run is meaningful
    // and a real run fails fast on a malformed file.
    const validRows: ParsedRow[] = [];
    const seenAdmissionNumbers = new Set<string>();

    for (const row of rows) {
      const errors = this.validateRow(row);

      if (row.admissionNumber) {
        if (seenAdmissionNumbers.has(row.admissionNumber)) {
          errors.push({
            row: row.rowNumber,
            field: 'admissionNumber',
            message: 'Duplicate admission number within this file',
            value: row.admissionNumber,
          });
        }
        seenAdmissionNumbers.add(row.admissionNumber);
      }

      if (errors.length > 0) {
        result.errors.push(...errors);
        result.failed += 1;
      } else {
        validRows.push(row);
      }
    }

    const existing = await this.prisma.student.findMany({
      where: {
        schoolId,
        admissionNumber: { in: [...seenAdmissionNumbers] },
      },
      select: { admissionNumber: true },
    });
    const alreadyPresent = new Set(existing.map((student) => student.admissionNumber));

    const importable = validRows.filter((row) => {
      if (row.admissionNumber && alreadyPresent.has(row.admissionNumber)) {
        result.errors.push({
          row: row.rowNumber,
          field: 'admissionNumber',
          message: 'A student with this admission number already exists',
          value: row.admissionNumber,
        });
        result.skipped += 1;
        return false;
      }
      return true;
    });

    if (options.dryRun) {
      return {
        ...result,
        preview: importable.slice(0, 20).map((row) => ({
          row: row.rowNumber,
          name: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' '),
          admissionNumber: row.admissionNumber ?? '(auto)',
          dateOfBirth: row.dateOfBirth,
          gender: this.normalizeGender(row.gender),
          guardian: row.guardianName ?? null,
          guardianPhone: row.guardianPhone ?? null,
        })),
      };
    }

    for (let index = 0; index < importable.length; index += CHUNK_SIZE) {
      const chunk = importable.slice(index, index + CHUNK_SIZE);

      try {
        await this.prisma.transaction(
          async (tx) => {
            for (const row of chunk) {
              const admissionNumber =
                row.admissionNumber ??
                (await this.sequences.next(schoolId, 'ADMISSION', { padding: 5 }, tx));

              const student = await tx.student.create({
                data: {
                  schoolId,
                  admissionNumber,
                  rollNumber: row.rollNumber ?? null,
                  firstName: row.firstName,
                  middleName: row.middleName ?? null,
                  lastName: row.lastName ?? null,
                  dateOfBirth: parseDateOnly(this.normalizeDate(row.dateOfBirth)),
                  gender: this.normalizeGender(row.gender)!,
                  category: row.category ?? null,
                  religion: row.religion ?? null,
                  email: row.email ?? null,
                  phone: row.phone ?? null,
                  addressLine1: row.address ?? null,
                  city: row.city ?? null,
                  state: row.state ?? null,
                  postalCode: row.postalCode ?? null,
                  previousSchool: row.previousSchool ?? null,
                  admissionDate: parseDateOnly(
                    row.admissionDate ? this.normalizeDate(row.admissionDate) : new Date().toISOString().slice(0, 10),
                  ),
                  status: StudentStatus.ACTIVE,
                },
                select: { id: true },
              });

              await tx.enrollment.create({
                data: {
                  schoolId,
                  studentId: student.id,
                  academicYearId,
                  classId: section.classId,
                  sectionId: section.id,
                  rollNumber: row.rollNumber ?? null,
                  status: EnrollmentStatus.ACTIVE,
                  enrolledOn: new Date(),
                },
              });

              if (row.guardianName && row.guardianPhone) {
                await this.attachGuardian(tx, schoolId, student.id, row, options);
              }

              result.imported += 1;
            }
          },
          { timeout: 60_000 },
        );
      } catch (error) {
        // The whole chunk failed; report each of its rows rather than losing them.
        const message = error instanceof Error ? error.message : 'Unknown error';
        for (const row of chunk) {
          result.errors.push({ row: row.rowNumber, message: this.friendlyError(message) });
          result.failed += 1;
        }
        this.log.error('Student import chunk failed', error, {
          schoolId,
          rows: chunk.map((row) => row.rowNumber),
        });
      }
    }

    this.log.info('Student import completed', {
      schoolId,
      sectionId: section.id,
      ...result,
      errors: result.errors.length,
    });

    return result;
  }

  /** Downloadable template with the expected columns and one example row. */
  async buildTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'School ERP Platform';
    const sheet = workbook.addWorksheet('Students');

    const columns = [
      { header: 'Admission Number', key: 'admissionNumber', width: 20 },
      { header: 'Roll Number', key: 'rollNumber', width: 14 },
      { header: 'First Name', key: 'firstName', width: 18 },
      { header: 'Middle Name', key: 'middleName', width: 18 },
      { header: 'Last Name', key: 'lastName', width: 18 },
      { header: 'Date of Birth', key: 'dateOfBirth', width: 16 },
      { header: 'Gender', key: 'gender', width: 12 },
      { header: 'Blood Group', key: 'bloodGroup', width: 14 },
      { header: 'Category', key: 'category', width: 14 },
      { header: 'Religion', key: 'religion', width: 14 },
      { header: 'Admission Date', key: 'admissionDate', width: 16 },
      { header: 'Email', key: 'email', width: 26 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Address', key: 'address', width: 30 },
      { header: 'City', key: 'city', width: 16 },
      { header: 'State', key: 'state', width: 16 },
      { header: 'Postal Code', key: 'postalCode', width: 14 },
      { header: 'Guardian Name', key: 'guardianName', width: 22 },
      { header: 'Guardian Relation', key: 'guardianRelation', width: 18 },
      { header: 'Guardian Phone', key: 'guardianPhone', width: 16 },
      { header: 'Guardian Email', key: 'guardianEmail', width: 26 },
      { header: 'Guardian Occupation', key: 'guardianOccupation', width: 20 },
      { header: 'Previous School', key: 'previousSchool', width: 26 },
    ];

    sheet.columns = columns;

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    header.height = 22;
    header.alignment = { vertical: 'middle' };

    sheet.addRow({
      admissionNumber: 'ADM/00101',
      rollNumber: '01',
      firstName: 'Aarav',
      middleName: '',
      lastName: 'Sharma',
      dateOfBirth: '2014-06-15',
      gender: 'Male',
      bloodGroup: 'B+',
      category: 'GENERAL',
      religion: 'Hindu',
      admissionDate: '2026-04-01',
      email: '',
      phone: '',
      address: '12 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      guardianName: 'Rakesh Sharma',
      guardianRelation: 'Father',
      guardianPhone: '+919876543210',
      guardianEmail: 'rakesh.sharma@example.com',
      guardianOccupation: 'Engineer',
      previousSchool: '',
    });

    const notes = workbook.addWorksheet('Instructions');
    notes.columns = [{ width: 100 }];
    [
      'STUDENT IMPORT — INSTRUCTIONS',
      '',
      'Required columns: First Name, Date of Birth, Gender.',
      'Leave Admission Number blank to have the system generate one.',
      'Dates may be written as YYYY-MM-DD or DD/MM/YYYY.',
      'Gender accepts Male / Female / Other (M, F and O also work).',
      'Guardian Name and Guardian Phone must be supplied together to create a parent record.',
      'A guardian already registered with the same phone number is reused, so siblings share one parent login.',
      'Delete the example row before uploading.',
      'A maximum of 1000 students can be imported per file.',
      '',
      'Run the import with "Validate only" first to see any problems without changing data.',
    ].forEach((line) => notes.addRow([line]));
    notes.getRow(1).font = { bold: true, size: 13 };

    return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
  }

  // -------------------------------------------------------------------------
  // Parsing
  // -------------------------------------------------------------------------

  private isCsv(file: { originalname: string; mimetype: string }): boolean {
    return (
      file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')
    );
  }

  private parseCsvFile(buffer: Buffer): ParsedRow[] {
    const records = parseCsv(buffer.toString('utf8'), {
      columns: (header: string[]) => header.map((column) => this.normalizeHeader(column)),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Array<Record<string, string>>;

    return records
      .map((record, index) => this.toParsedRow(record, index + 2))
      .filter((row): row is ParsedRow => row !== null);
  }

  private async parseExcelFile(buffer: Buffer): Promise<ParsedRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestError('The workbook contains no sheets');

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = this.normalizeHeader(String(cell.value ?? ''));
    });

    const rows: ParsedRow[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const record: Record<string, string> = {};
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const key = headers[colNumber];
        if (!key) return;
        record[key] = this.cellToString(cell.value);
      });

      const parsed = this.toParsedRow(record, rowNumber);
      if (parsed) rows.push(parsed);
    });

    return rows;
  }

  private toParsedRow(record: Record<string, string>, rowNumber: number): ParsedRow | null {
    const mapped: Record<string, string> = {};

    for (const [rawKey, value] of Object.entries(record)) {
      const field = COLUMN_ALIASES[rawKey];
      if (field && value !== undefined && value !== null && String(value).trim() !== '') {
        mapped[field] = String(value).trim();
      }
    }

    // Skip entirely blank rows rather than reporting them as errors.
    if (Object.keys(mapped).length === 0) return null;

    return { rowNumber, ...mapped } as unknown as ParsedRow;
  }

  private normalizeHeader(header: string): string {
    return header.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  }

  private cellToString(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'object') {
      const rich = value as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
      if (rich.richText) return rich.richText.map((part) => part.text).join('');
      if (rich.text !== undefined) return String(rich.text);
      if (rich.result !== undefined) return String(rich.result);
      return '';
    }
    return String(value).trim();
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private validateRow(row: ParsedRow): ImportRowError[] {
    const errors: ImportRowError[] = [];

    if (!row.firstName) {
      errors.push({ row: row.rowNumber, field: 'firstName', message: 'First name is required' });
    }

    if (!row.dateOfBirth) {
      errors.push({
        row: row.rowNumber,
        field: 'dateOfBirth',
        message: 'Date of birth is required',
      });
    } else {
      const normalized = this.normalizeDate(row.dateOfBirth);
      const date = new Date(normalized);
      if (Number.isNaN(date.getTime())) {
        errors.push({
          row: row.rowNumber,
          field: 'dateOfBirth',
          message: 'Date of birth is not a valid date (use YYYY-MM-DD)',
          value: row.dateOfBirth,
        });
      } else if (date > new Date()) {
        errors.push({
          row: row.rowNumber,
          field: 'dateOfBirth',
          message: 'Date of birth cannot be in the future',
          value: row.dateOfBirth,
        });
      }
    }

    if (!row.gender) {
      errors.push({ row: row.rowNumber, field: 'gender', message: 'Gender is required' });
    } else if (!this.normalizeGender(row.gender)) {
      errors.push({
        row: row.rowNumber,
        field: 'gender',
        message: 'Gender must be Male, Female or Other',
        value: row.gender,
      });
    }

    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.email)) {
      errors.push({
        row: row.rowNumber,
        field: 'email',
        message: 'Email address is not valid',
        value: row.email,
      });
    }

    if (row.guardianPhone && !/^\+?[0-9]{10,15}$/.test(row.guardianPhone.replace(/[\s-]/g, ''))) {
      errors.push({
        row: row.rowNumber,
        field: 'guardianPhone',
        message: 'Guardian phone number is not valid',
        value: row.guardianPhone,
      });
    }

    if (row.guardianName && !row.guardianPhone) {
      errors.push({
        row: row.rowNumber,
        field: 'guardianPhone',
        message: 'A guardian phone number is required when a guardian name is supplied',
      });
    }

    return errors;
  }

  private normalizeGender(value?: string): Gender | null {
    if (!value) return null;
    return GENDER_ALIASES[value.trim().toLowerCase()] ?? null;
  }

  /** Accepts YYYY-MM-DD, DD/MM/YYYY and DD-MM-YYYY. */
  private normalizeDate(value: string): string {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);

    const match = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(trimmed);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return trimmed;
  }

  private async attachGuardian(
    tx: Parameters<Parameters<PrismaService['transaction']>[0]>[0],
    schoolId: string,
    studentId: string,
    row: ParsedRow,
    options: BulkImportOptionsDto,
  ): Promise<void> {
    const phone = this.normalizePhone(row.guardianPhone!);
    const [firstName, ...restName] = row.guardianName!.trim().split(/\s+/);

    // Reuse an existing guardian so siblings share one parent account.
    let guardian = await tx.guardian.findFirst({
      where: { schoolId, phone, deletedAt: null },
      select: { id: true },
    });

    if (!guardian) {
      guardian = await tx.guardian.create({
        data: {
          schoolId,
          firstName,
          lastName: restName.join(' ') || null,
          relation:
            (RELATION_ALIASES[row.guardianRelation?.toLowerCase() ?? ''] as never) ?? 'GUARDIAN',
          phone,
          email: row.guardianEmail ?? null,
          occupation: row.guardianOccupation ?? null,
        },
        select: { id: true },
      });

      if (options.createGuardianLogins !== false) {
        const account = await this.users.createLinkedAccount(tx, {
          schoolId,
          email: row.guardianEmail,
          phone,
          firstName,
          lastName: restName.join(' ') || null,
          roleType: RoleType.PARENT,
        });
        await tx.guardian.update({ where: { id: guardian.id }, data: { userId: account.userId } });
      }
    }

    await tx.studentGuardian.create({
      data: { studentId, guardianId: guardian.id, isPrimary: true, isPayer: true, canPickup: true },
    });
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) return digits;
    if (digits.length === 10) return `+91${digits}`;
    return `+${digits.replace(/^0+/, '')}`;
  }

  /** Turns a database constraint message into something a school clerk can act on. */
  private friendlyError(message: string): string {
    if (message.includes('users_schoolId_email_key')) {
      return 'A user with this email address already exists';
    }
    if (message.includes('users_schoolId_phone_key')) {
      return 'A user with this phone number already exists';
    }
    if (message.includes('students_schoolId_admissionNumber_key')) {
      return 'A student with this admission number already exists';
    }
    return 'This row could not be imported. Please check the values and try again.';
  }
}
