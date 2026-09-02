'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer, Send } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { formatDate } from '@/lib/dates';
import { formatPercent, saveBlob } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface SnapshotSubject {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  isGradedOnly: boolean;
  exams: Array<{
    examId: string;
    examName: string;
    maxMarks: number;
    obtained: number | null;
    grade: string | null;
    isAbsent: boolean;
  }>;
  totalMax: number;
  totalObtained: number | null;
  percentage: number | null;
  grade: string | null;
  isPass: boolean | null;
}

interface ReportCard {
  id: string;
  term: string;
  totalMarks: string | null;
  obtainedMarks: string | null;
  percentage: string | null;
  grade: string | null;
  gradePoint: string | null;
  rank: number | null;
  rankOutOf: number | null;
  result: string | null;
  attendedDays: number | null;
  totalDays: number | null;
  attendancePercent: string | null;
  classTeacherRemarks: string | null;
  principalRemarks: string | null;
  generatedAt: string;
  publishedAt: string | null;
  snapshot: {
    subjects?: SnapshotSubject[];
    exams?: Array<{ id: string; name: string; weightage: number | null }>;
    attendance?: { attendedDays: number; totalDays: number; percent: number | null };
  };
  student: {
    id: string;
    admissionNumber: string;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
    photoUrl: string | null;
    dateOfBirth: string | null;
    guardians: Array<{ guardian: { firstName: string; lastName: string | null } }>;
  };
  class: { id: string; name: string } | null;
  section: {
    id: string;
    name: string;
    classTeacher: { firstName: string; lastName: string | null } | null;
  } | null;
  academicYear: { id: string; name: string };
  exams: Array<{ exam: { id: string; name: string; type: string } }>;
  school: {
    name: string;
    logoUrl: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    phone: string | null;
    email: string | null;
    reportCardHeader: string | null;
    principalName: string | null;
  };
}

export default function ReportCardPage() {
  const params = useParams<{ id: string }>();
  const canGenerate = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('report_cards.generate'),
  );
  const canPublish = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('report_cards.publish'),
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report-card', params.id],
    queryFn: () => api.get<ReportCard>(`/exams/report-cards/${params.id}`),
    enabled: Boolean(params.id),
  });

  const [editingRemarks, setEditingRemarks] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);

  const publish = useAction({
    mutationFn: () =>
      api.post('/exams/report-cards/publish', { reportCardIds: [params.id] }),
    successMessage: 'Report card published',
    invalidates: [['report-card', params.id], ['report-cards']],
  });

  async function download() {
    setDownloading(true);
    try {
      const file = await api.download(`/documents/report-cards/${params.id}`);
      saveBlob(file.blob, file.fileName);
    } finally {
      setDownloading(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading report card" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="Report card not found" />;

  const subjects = data.snapshot.subjects ?? [];
  const scholastic = subjects.filter((s) => !s.isGradedOnly);
  const coScholastic = subjects.filter((s) => s.isGradedOnly);
  const examColumns = data.snapshot.exams ?? data.exams.map((e) => ({ id: e.exam.id, name: e.exam.name, weightage: null }));
  const studentName = [data.student.firstName, data.student.middleName, data.student.lastName]
    .filter(Boolean)
    .join(' ');
  const guardianName = data.student.guardians[0]
    ? [data.student.guardians[0].guardian.firstName, data.student.guardians[0].guardian.lastName]
        .filter(Boolean)
        .join(' ')
    : null;
  const classTeacher = data.section?.classTeacher
    ? [data.section.classTeacher.firstName, data.section.classTeacher.lastName]
        .filter(Boolean)
        .join(' ')
    : null;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Report card"
          description={`${studentName} · ${data.term} · ${data.academicYear.name}`}
          actions={
            <>
              <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
                <Link href="/exams">Back</Link>
              </Button>
              {canGenerate ? (
                <Button size="sm" onClick={() => setEditingRemarks(true)}>
                  Edit remarks
                </Button>
              ) : null}
              {canPublish && !data.publishedAt ? (
                <Button
                  size="sm"
                  icon={<Send />}
                  loading={publish.isPending}
                  onClick={() => publish.mutate()}
                >
                  Publish
                </Button>
              ) : null}
              <Button size="sm" icon={<Printer />} onClick={() => window.print()}>
                Print
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Download />}
                loading={downloading}
                onClick={download}
              >
                Download PDF
              </Button>
            </>
          }
        />
        {data.publishedAt ? (
          <p className="mb-3 text-xs text-[var(--color-success)]">
            Published {formatDate(data.publishedAt)} — visible to the student and guardians.
          </p>
        ) : (
          <p className="mb-3 text-xs text-[var(--color-warning)]">
            Draft — not yet visible to families.
          </p>
        )}
      </div>

      {/* The printable card */}
      <div className="mx-auto max-w-3xl rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-6 text-[13px] text-black shadow-[var(--shadow-xs)] print:border-0 print:shadow-none">
        <header className="flex items-center gap-4 border-b-2 border-black pb-3">
          {data.school.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.school.logoUrl} alt="" className="size-14 object-contain" />
          ) : null}
          <div className="min-w-0 flex-1 text-center">
            <h1 className="text-lg font-bold uppercase tracking-wide">{data.school.name}</h1>
            {[data.school.addressLine1, data.school.city, data.school.state]
              .filter(Boolean)
              .join(', ') ? (
              <p className="text-[11px]">
                {[data.school.addressLine1, data.school.city, data.school.state]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            ) : null}
            {(data.school.phone || data.school.email) && (
              <p className="text-[11px]">
                {[data.school.phone, data.school.email].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className="mt-1 text-sm font-semibold">
              {data.school.reportCardHeader ?? 'Report Card'} — {data.term}
            </p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-black py-3 text-[12px] sm:grid-cols-3">
          <Detail label="Student" value={studentName} />
          <Detail label="Admission no." value={data.student.admissionNumber} />
          <Detail
            label="Class"
            value={`${data.class?.name ?? ''} ${data.section?.name ?? ''}`.trim()}
          />
          <Detail label="Academic year" value={data.academicYear.name} />
          <Detail
            label="Date of birth"
            value={data.student.dateOfBirth ? formatDate(data.student.dateOfBirth) : '—'}
          />
          <Detail label="Guardian" value={guardianName ?? '—'} />
        </section>

        <section className="py-3">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-1 pr-2">Subject</th>
                {examColumns.map((exam) => (
                  <th key={exam.id} className="py-1 px-1 text-right">
                    {exam.name}
                    {exam.weightage ? ` (${exam.weightage}%)` : ''}
                  </th>
                ))}
                <th className="py-1 px-1 text-right">Total</th>
                <th className="py-1 px-1 text-right">Max</th>
                <th className="py-1 px-1 text-right">%</th>
                <th className="py-1 pl-1 text-center">Grade</th>
              </tr>
            </thead>
            <tbody>
              {scholastic.map((subject) => {
                const byExam = new Map(subject.exams.map((e) => [e.examId, e]));
                return (
                  <tr key={subject.subjectId} className="border-b border-gray-300">
                    <td className="py-1 pr-2">{subject.subjectName}</td>
                    {examColumns.map((exam) => {
                      const cell = byExam.get(exam.id);
                      return (
                        <td key={exam.id} className="py-1 px-1 text-right">
                          {!cell ? '—' : cell.isAbsent ? 'AB' : cell.obtained ?? '—'}
                        </td>
                      );
                    })}
                    <td className="py-1 px-1 text-right font-medium">
                      {subject.totalObtained ?? '—'}
                    </td>
                    <td className="py-1 px-1 text-right">{subject.totalMax}</td>
                    <td className="py-1 px-1 text-right">{formatPercent(subject.percentage)}</td>
                    <td className="py-1 pl-1 text-center">{subject.grade ?? '—'}</td>
                  </tr>
                );
              })}
              <tr className="border-b-2 border-black font-bold">
                <td className="py-1 pr-2">Grand total</td>
                {examColumns.map((exam) => (
                  <td key={exam.id} className="py-1 px-1" />
                ))}
                <td className="py-1 px-1 text-right">{Number(data.obtainedMarks ?? 0)}</td>
                <td className="py-1 px-1 text-right">{Number(data.totalMarks ?? 0)}</td>
                <td className="py-1 px-1 text-right">
                  {formatPercent(data.percentage ? Number(data.percentage) : null)}
                </td>
                <td className="py-1 pl-1 text-center">{data.grade ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {coScholastic.length > 0 ? (
          <section className="border-t border-black py-3">
            <p className="mb-1 text-[11px] font-semibold uppercase">Co-scholastic areas</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-3">
              {coScholastic.map((subject) => (
                <Detail key={subject.subjectId} label={subject.subjectName} value={subject.grade ?? '—'} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-black py-3 text-[12px] sm:grid-cols-4">
          <Detail
            label="Result"
            value={data.result ? humanise(data.result) : '—'}
          />
          <Detail
            label="Rank"
            value={data.rank ? `${data.rank} of ${data.rankOutOf}` : '—'}
          />
          <Detail
            label="Attendance"
            value={
              data.attendedDays !== null && data.totalDays
                ? `${data.attendedDays}/${data.totalDays} (${formatPercent(
                    data.attendancePercent ? Number(data.attendancePercent) : null,
                  )})`
                : '—'
            }
          />
          <Detail label="Grade point" value={data.gradePoint ? Number(data.gradePoint) : '—'} />
        </section>

        {(data.classTeacherRemarks || data.principalRemarks) && (
          <section className="space-y-1 border-t border-black py-3 text-[12px]">
            {data.classTeacherRemarks ? (
              <p>
                <span className="font-semibold">Class teacher: </span>
                {data.classTeacherRemarks}
              </p>
            ) : null}
            {data.principalRemarks ? (
              <p>
                <span className="font-semibold">Principal: </span>
                {data.principalRemarks}
              </p>
            ) : null}
          </section>
        )}

        <footer className="mt-8 flex items-end justify-between text-[11px]">
          <Signature label="Class teacher" name={classTeacher} />
          <Signature label="Principal" name={data.school.principalName} />
          <Signature label="Parent / Guardian" name={guardianName} />
        </footer>

        <p className="mt-4 text-center text-[10px] text-gray-500">
          Generated {formatDate(data.generatedAt)}
          {data.student.photoUrl ? '' : ''}
        </p>
      </div>

      {editingRemarks ? (
        <RemarksDialog
          id={data.id}
          classTeacherRemarks={data.classTeacherRemarks ?? ''}
          principalRemarks={data.principalRemarks ?? ''}
          onClose={() => setEditingRemarks(false)}
        />
      ) : null}
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p>
      <span className="text-gray-500">{label}: </span>
      <span className="font-medium">{value || '—'}</span>
    </p>
  );
}

function Signature({ label, name }: { label: string; name: string | null }) {
  return (
    <div className="text-center">
      <div className="mb-1 h-8 w-32 border-b border-black" />
      <p className="font-medium">{name ?? ''}</p>
      <p className="text-gray-500">{label}</p>
    </div>
  );
}

function RemarksDialog({
  id,
  classTeacherRemarks,
  principalRemarks,
  onClose,
}: {
  id: string;
  classTeacherRemarks: string;
  principalRemarks: string;
  onClose: () => void;
}) {
  const [teacher, setTeacher] = React.useState(classTeacherRemarks);
  const [principal, setPrincipal] = React.useState(principalRemarks);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Report card remarks"
      submitLabel="Save remarks"
      values={{ teacher, principal }}
      successMessage="Remarks saved"
      invalidates={[['report-card', id]]}
      submit={(values) =>
        api.patch(`/exams/report-cards/${id}/remarks`, {
          classTeacherRemarks: values.teacher.trim() || undefined,
          principalRemarks: values.principal.trim() || undefined,
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Class teacher's remarks" error={errors.classTeacherRemarks}>
            <Textarea rows={3} value={teacher} onChange={(e) => setTeacher(e.target.value)} />
          </Field>
          <Field label="Principal's remarks" error={errors.principalRemarks}>
            <Textarea rows={3} value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
