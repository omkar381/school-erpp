import { Injectable } from '@nestjs/common';
import { PrismaService, type TransactionClient } from '../../database/prisma.service';

export type SequenceKind =
  | 'INVOICE'
  | 'RECEIPT'
  | 'REFUND'
  | 'ADMISSION'
  | 'ENQUIRY'
  | 'CERTIFICATE'
  | 'TICKET'
  | 'ID_CARD'
  | 'PURCHASE'
  | 'LIBRARY_CARD'
  | 'EMPLOYEE';

export interface SequenceOptions {
  /** Scopes the counter, typically an academic or financial year. */
  period?: string;
  prefix?: string;
  padding?: number;
}

const DEFAULT_PREFIXES: Record<SequenceKind, string> = {
  INVOICE: 'INV',
  RECEIPT: 'RCP',
  REFUND: 'REF',
  ADMISSION: 'ADM',
  ENQUIRY: 'ENQ',
  CERTIFICATE: 'CRT',
  TICKET: 'TKT',
  ID_CARD: 'IDC',
  PURCHASE: 'PO',
  LIBRARY_CARD: 'LIB',
  EMPLOYEE: 'EMP',
};

/**
 * Allocates gap-free, per-school document numbers.
 *
 * The counter row is locked with an atomic `update ... returning`, so two
 * concurrent invoices can never receive the same number. Callers that are
 * already inside a transaction must pass their client so the allocation shares
 * the transaction's fate — a rolled-back invoice must not burn a number.
 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(
    schoolId: string,
    kind: SequenceKind,
    options: SequenceOptions = {},
    tx?: TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const period = options.period ?? '';
    const prefix = options.prefix ?? DEFAULT_PREFIXES[kind];
    const padding = options.padding ?? 5;

    const sequence = await client.numberSequence.upsert({
      where: { schoolId_kind_period: { schoolId, kind, period } },
      create: { schoolId, kind, period, prefix, padding, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true, prefix: true, padding: true },
    });

    // `upsert` returns the post-increment value on update and our seeded 2 on
    // create, so the number actually allocated is one less in both cases.
    const value = sequence.nextValue - 1;
    const parts = [sequence.prefix || prefix];
    if (period) parts.push(period);
    parts.push(String(value).padStart(sequence.padding ?? padding, '0'));

    return parts.filter(Boolean).join('/');
  }

  /** Allocates a contiguous block, for bulk generation. */
  async nextBatch(
    schoolId: string,
    kind: SequenceKind,
    count: number,
    options: SequenceOptions = {},
    tx?: TransactionClient,
  ): Promise<string[]> {
    if (count <= 0) return [];

    const client = tx ?? this.prisma;
    const period = options.period ?? '';
    const prefix = options.prefix ?? DEFAULT_PREFIXES[kind];
    const padding = options.padding ?? 5;

    const sequence = await client.numberSequence.upsert({
      where: { schoolId_kind_period: { schoolId, kind, period } },
      create: { schoolId, kind, period, prefix, padding, nextValue: count + 1 },
      update: { nextValue: { increment: count } },
      select: { nextValue: true, prefix: true, padding: true },
    });

    const end = sequence.nextValue - 1;
    const start = end - count + 1;

    return Array.from({ length: count }, (_, index) => {
      const parts = [sequence.prefix || prefix];
      if (period) parts.push(period);
      parts.push(String(start + index).padStart(sequence.padding ?? padding, '0'));
      return parts.filter(Boolean).join('/');
    });
  }

  /** Converts an academic year name such as "2026-27" into a sequence period. */
  static periodFromAcademicYear(name: string): string {
    return name.replace(/[^\dA-Za-z-]/g, '');
  }
}
