import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface GradeBandLike {
  grade: string;
  minValue: number;
  maxValue: number;
  gradePoint: number | null;
  remark: string | null;
  isPassing: boolean;
}

export interface MarkLike {
  totalMarks: Prisma.Decimal | number | null;
  isAbsent: boolean;
  isExempted: boolean;
  subject: { isGradedOnly: boolean };
  examSubject: {
    maxMarks: Prisma.Decimal | number;
    passMarks: Prisma.Decimal | number;
    maxMarksPractical?: Prisma.Decimal | number | null;
  };
}

export interface ResultSummary {
  totalMaxMarks: number;
  totalObtained: number;
  percentage: number | null;
  grade: string | null;
  gradePoint: number | null;
  result: 'PASS' | 'FAIL' | 'PENDING';
  subjectsAppeared: number;
  subjectsPassed: number;
  subjectsFailed: number;
  absentIn: number;
}

/**
 * Grade computation and result aggregation.
 *
 * Kept separate from marks entry so the same rules apply identically to a live
 * entry sheet, a published result and a generated report card.
 */
@Injectable()
export class GradingService {
  private readonly cache = new Map<string, { bands: GradeBandLike[]; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async loadBands(gradeScaleId: string): Promise<GradeBandLike[]> {
    const cached = this.cache.get(gradeScaleId);
    if (cached && cached.expiresAt > Date.now()) return cached.bands;

    const rows = await this.prisma.gradeBand.findMany({
      where: { gradeScaleId },
      orderBy: { sortOrder: 'asc' },
      select: {
        grade: true,
        minValue: true,
        maxValue: true,
        gradePoint: true,
        remark: true,
        isPassing: true,
      },
    });

    const bands: GradeBandLike[] = rows.map((row) => ({
      grade: row.grade,
      minValue: Number(row.minValue),
      maxValue: Number(row.maxValue),
      gradePoint: row.gradePoint ? Number(row.gradePoint) : null,
      remark: row.remark,
      isPassing: row.isPassing,
    }));

    this.cache.set(gradeScaleId, {
      bands,
      expiresAt: Date.now() + GradingService.CACHE_TTL_MS,
    });
    return bands;
  }

  invalidate(gradeScaleId: string): void {
    this.cache.delete(gradeScaleId);
  }

  /**
   * Maps a mark to its grade band. Bands are defined on percentage, so an
   * absolute mark is converted first.
   */
  gradeFor(
    obtained: number,
    maxMarks: number,
    bands: GradeBandLike[],
  ): { grade: string; gradePoint: number | null; remark: string | null; isPassing: boolean } | null {
    if (bands.length === 0 || maxMarks <= 0) return null;

    const percentage = (obtained / maxMarks) * 100;
    const band = bands.find(
      (entry) => percentage >= entry.minValue && percentage <= entry.maxValue,
    );

    // A percentage that falls in no band (misconfigured scale) is reported as
    // the lowest band rather than silently producing a null grade.
    const resolved = band ?? bands[bands.length - 1];

    return {
      grade: resolved.grade,
      gradePoint: resolved.gradePoint,
      remark: resolved.remark,
      isPassing: resolved.isPassing,
    };
  }

  /**
   * Aggregates a student's marks into a result.
   *
   * Co-scholastic subjects (`isGradedOnly`) are excluded from the total and the
   * percentage — they are reported as a grade only, which is how CBSE-style
   * report cards work.
   */
  summarise(marks: MarkLike[]): ResultSummary {
    const scholastic = marks.filter((mark) => !mark.subject.isGradedOnly);

    let totalMax = 0;
    let totalObtained = 0;
    let passed = 0;
    let failed = 0;
    let absent = 0;
    let appeared = 0;
    let pending = false;

    for (const mark of scholastic) {
      if (mark.isExempted) continue;

      const maxMarks =
        Number(mark.examSubject.maxMarks) + Number(mark.examSubject.maxMarksPractical ?? 0);
      const passMarks = Number(mark.examSubject.passMarks);

      totalMax += maxMarks;

      if (mark.isAbsent) {
        absent += 1;
        failed += 1;
        continue;
      }

      if (mark.totalMarks === null || mark.totalMarks === undefined) {
        pending = true;
        continue;
      }

      const obtained = Number(mark.totalMarks);
      totalObtained += obtained;
      appeared += 1;

      if (obtained >= passMarks) passed += 1;
      else failed += 1;
    }

    const percentage =
      totalMax > 0 && !pending ? Number(((totalObtained / totalMax) * 100).toFixed(2)) : null;

    return {
      totalMaxMarks: totalMax,
      totalObtained: Number(totalObtained.toFixed(2)),
      percentage,
      grade: null,
      gradePoint: null,
      result: pending ? 'PENDING' : failed > 0 ? 'FAIL' : 'PASS',
      subjectsAppeared: appeared,
      subjectsPassed: passed,
      subjectsFailed: failed,
      absentIn: absent,
    };
  }

  /** Same as `summarise`, but also resolves an overall grade from a scale. */
  summariseWithGrade(marks: MarkLike[], bands: GradeBandLike[]): ResultSummary {
    const summary = this.summarise(marks);
    if (summary.percentage === null || bands.length === 0) return summary;

    const band = this.gradeFor(summary.totalObtained, summary.totalMaxMarks, bands);
    return { ...summary, grade: band?.grade ?? null, gradePoint: band?.gradePoint ?? null };
  }

  /**
   * A student's rank within their class for one exam.
   *
   * Ranking is computed on the fly rather than stored, so it stays correct after
   * an authorised mark correction.
   */
  async rankFor(
    examId: string,
    studentId: string,
  ): Promise<{ position: number; outOf: number } | null> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, status: 'ACTIVE' },
      select: { classId: true },
    });
    if (!enrollment) return null;

    const classmates = await this.prisma.enrollment.findMany({
      where: { classId: enrollment.classId, status: 'ACTIVE' },
      select: { studentId: true },
    });

    const marks = await this.prisma.mark.findMany({
      where: {
        examId,
        studentId: { in: classmates.map((entry) => entry.studentId) },
      },
      select: {
        studentId: true,
        totalMarks: true,
        isAbsent: true,
        isExempted: true,
        subject: { select: { isGradedOnly: true } },
        examSubject: { select: { maxMarks: true, passMarks: true, maxMarksPractical: true } },
      },
    });

    const byStudent = new Map<string, typeof marks>();
    for (const mark of marks) {
      const bucket = byStudent.get(mark.studentId) ?? [];
      bucket.push(mark);
      byStudent.set(mark.studentId, bucket);
    }

    const scored = [...byStudent.entries()]
      .map(([id, studentMarks]) => ({
        studentId: id,
        percentage: this.summarise(studentMarks).percentage,
      }))
      .filter((entry): entry is { studentId: string; percentage: number } =>
        entry.percentage !== null,
      )
      .sort((a, b) => b.percentage - a.percentage);

    const index = scored.findIndex((entry) => entry.studentId === studentId);
    if (index === -1) return null;

    // Ties share the higher position: 90, 90, 85 ranks as 1, 1, 3.
    const percentage = scored[index].percentage;
    const position = scored.findIndex((entry) => entry.percentage === percentage) + 1;

    return { position, outOf: scored.length };
  }
}
