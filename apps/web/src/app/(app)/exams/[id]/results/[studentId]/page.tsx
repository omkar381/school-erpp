'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { formatPercent, initials } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface StudentResult {
  exam: {
    id: string;
    name: string;
    type: string;
    status: string;
    showRank: boolean;
    startDate: string;
    endDate: string;
    resultDate: string | null;
  };
  student: {
    id: string;
    admissionNumber: string;
    fullName: string;
    photoUrl: string | null;
    enrollment: { rollNumber: string | null; class: { name: string }; section: { name: string } } | null;
  };
  subjects: Array<{
    subject: { id: string; name: string; code: string; isGradedOnly: boolean };
    maxMarks: number;
    passMarks: number;
    marksObtained: number | null;
    practicalMarks: number | null;
    totalMarks: number | null;
    grade: string | null;
    gradePoint: number | null;
    isAbsent: boolean;
    isExempted: boolean;
    isPass: boolean;
    remarks: string | null;
  }>;
  summary: {
    totalMaxMarks: number;
    totalObtained: number;
    percentage: number | null;
    result: 'PASS' | 'FAIL' | 'PENDING';
    subjectsAppeared: number;
    subjectsPassed: number;
    subjectsFailed: number;
    absentIn: number;
  };
  rank: { position: number; outOf: number } | null;
}

export default function StudentResultPage() {
  const params = useParams<{ id: string; studentId: string }>();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['student-result', params.id, params.studentId],
    queryFn: () =>
      api.get<StudentResult>(`/exams/${params.id}/results/${params.studentId}`),
    enabled: Boolean(params.id && params.studentId),
  });

  if (isLoading) return <LoadingState label="Loading result" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="Result not found" />;

  const { exam, student, subjects, summary, rank } = data;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-xs font-semibold"
              aria-hidden
            >
              {student.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={student.photoUrl} alt="" className="size-9 object-cover" />
              ) : (
                initials(student.fullName)
              )}
            </span>
            <span>{student.fullName}</span>
          </span>
        }
        description={
          <>
            {exam.name} · {humanise(exam.type)}
            {student.enrollment
              ? ` · ${student.enrollment.class.name} ${student.enrollment.section.name}`
              : ''}
            {student.enrollment?.rollNumber ? ` · Roll ${student.enrollment.rollNumber}` : ''}
          </>
        }
        actions={
          <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
            <Link href={`/exams/${exam.id}`}>Back to exam</Link>
          </Button>
        }
      />

      <StatGrid columns={4} className="mb-4">
        <StatCard
          label="Total"
          value={`${summary.totalObtained}/${summary.totalMaxMarks}`}
          hint={`${summary.subjectsAppeared} subjects`}
        />
        <StatCard label="Percentage" value={formatPercent(summary.percentage)} />
        <StatCard
          label="Result"
          value={humanise(summary.result)}
          hint={
            summary.subjectsFailed > 0
              ? `${summary.subjectsFailed} below pass`
              : summary.absentIn > 0
                ? `absent in ${summary.absentIn}`
                : 'all subjects cleared'
          }
        />
        <StatCard
          label="Rank"
          value={rank ? `${rank.position} / ${rank.outOf}` : exam.showRank ? '—' : 'Not ranked'}
        />
      </StatGrid>

      <Card>
        <CardHeader
          title="Subject-wise marks"
          description={
            exam.resultDate ? `Result declared ${formatDate(exam.resultDate)}` : undefined
          }
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-sunken)] text-2xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Subject</th>
                  <th className="px-3 py-2 text-right">Theory</th>
                  <th className="px-3 py-2 text-right">Practical</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Max</th>
                  <th className="px-3 py-2 text-left">Grade</th>
                  <th className="px-3 py-2 text-left">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {subjects.map((row) => (
                  <tr key={row.subject.id}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{row.subject.name}</span>
                      <span className="ml-1.5 text-2xs text-[var(--color-ink-muted)]">
                        {row.subject.code}
                      </span>
                      {row.subject.isGradedOnly ? (
                        <span className="ml-1.5 text-2xs text-[var(--color-ink-faint)]">
                          (co-scholastic)
                        </span>
                      ) : null}
                      {row.remarks ? (
                        <span className="block text-2xs text-[var(--color-ink-muted)]">
                          {row.remarks}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right numeric">
                      {row.isAbsent
                        ? 'AB'
                        : row.isExempted
                          ? 'EX'
                          : row.marksObtained ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right numeric">
                      {row.practicalMarks ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right numeric font-medium">
                      {row.isExempted ? '—' : row.totalMarks ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right numeric text-[var(--color-ink-muted)]">
                      {row.maxMarks}
                    </td>
                    <td className="px-3 py-2">{row.grade ? <Badge>{row.grade}</Badge> : '—'}</td>
                    <td className="px-3 py-2">
                      {row.isExempted ? (
                        <Badge>Exempt</Badge>
                      ) : row.isAbsent ? (
                        <Badge tone="danger">Absent</Badge>
                      ) : row.isPass ? (
                        <StatusBadge status="PASS" />
                      ) : (
                        <StatusBadge status="FAIL" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--color-border-strong)] font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right numeric">{summary.totalObtained}</td>
                  <td className="px-3 py-2 text-right numeric">{summary.totalMaxMarks}</td>
                  <td className="px-3 py-2">{formatPercent(summary.percentage)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={summary.result} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
