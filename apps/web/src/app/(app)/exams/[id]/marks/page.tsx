'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Lock, Save } from 'lucide-react';
import { api, ApiClientError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { initials } from '@/lib/utils';

interface EntryRow {
  student: {
    id: string;
    admissionNumber: string;
    fullName: string;
    photoUrl: string | null;
  };
  rollNumber: string | null;
  section: { id: string; name: string } | null;
  mark: {
    id: string;
    marksObtained: number | null;
    practicalMarks: number | null;
    totalMarks: number | null;
    grade: string | null;
    isAbsent: boolean;
    isExempted: boolean;
    remarks: string | null;
    status: string;
  } | null;
}

interface EntrySheet {
  examSubject: {
    id: string;
    subject: { id: string; name: string; code: string; hasPractical: boolean };
    maxMarks: number;
    passMarks: number;
    maxMarksPractical: number | null;
    passMarksPractical: number | null;
  };
  exam: { id: string; name: string; status: string; marksLocked: boolean };
  isEditable: boolean;
  totalStudents: number;
  entered: number;
  rows: EntryRow[];
}

interface ExamSubjectLite {
  id: string;
  classId: string;
  subject: { id: string; name: string; code: string };
}

interface ExamLite {
  id: string;
  name: string;
  status: string;
  examClasses: Array<{ classId: string; class: { id: string; name: string; level: number } }>;
  examSubjects: ExamSubjectLite[];
}

type RowState = {
  marksObtained: string;
  practicalMarks: string;
  isAbsent: boolean;
  isExempted: boolean;
  remarks: string;
};

export default function MarksEntryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const examId = params.id;
  const examSubjectId = searchParams.get('subject') ?? '';

  const canEnterMarks = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('exams.enter_marks'),
  );

  const exam = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => api.get<ExamLite>(`/exams/${examId}`),
    enabled: Boolean(examId),
  });

  if (!canEnterMarks) {
    return (
      <>
        <PageHeader title="Marks entry" />
        <EmptyState
          title="You cannot enter marks"
          description="This requires the examinations mark-entry permission."
        />
      </>
    );
  }

  if (exam.isLoading) return <LoadingState label="Loading examination" />;
  if (exam.error) return <ErrorState error={exam.error} onRetry={() => exam.refetch()} />;
  if (!exam.data) return <EmptyState title="Examination not found" />;

  const subjectsByClass = new Map<string, ExamSubjectLite[]>();
  for (const subject of exam.data.examSubjects) {
    const bucket = subjectsByClass.get(subject.classId) ?? [];
    bucket.push(subject);
    subjectsByClass.set(subject.classId, bucket);
  }

  return (
    <>
      <PageHeader
        title="Marks entry"
        description={exam.data.name}
        actions={
          <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
            <Link href={`/exams/${examId}`}>Back to exam</Link>
          </Button>
        }
      />

      {exam.data.examSubjects.length === 0 ? (
        <EmptyState
          title="No subjects to mark"
          description="Add classes to this exam first."
          action={
            <Button size="sm" asChild>
              <Link href={`/exams/${examId}`}>Set up the exam</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <nav className="space-y-3">
            {[...subjectsByClass.entries()]
              .map(([classId, subjects]) => ({
                classId,
                subjects,
                cls: exam.data!.examClasses.find((c) => c.classId === classId)?.class,
              }))
              .sort((a, b) => (a.cls?.level ?? 0) - (b.cls?.level ?? 0))
              .map(({ classId, subjects, cls }) => (
                <div key={classId}>
                  <p className="mb-1 px-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    {cls?.name ?? 'Class'}
                  </p>
                  <ul className="space-y-0.5">
                    {subjects
                      .slice()
                      .sort((a, b) => a.subject.name.localeCompare(b.subject.name))
                      .map((subject) => (
                        <li key={subject.id}>
                          <button
                            type="button"
                            onClick={() =>
                              router.replace(`/exams/${examId}/marks?subject=${subject.id}`)
                            }
                            className={`w-full rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm transition-colors ${
                              subject.id === examSubjectId
                                ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                                : 'hover:bg-[var(--color-surface-sunken)]'
                            }`}
                          >
                            {subject.subject.name}
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
          </nav>

          <div>
            {examSubjectId ? (
              <EntryGrid key={examSubjectId} examId={examId} examSubjectId={examSubjectId} />
            ) : (
              <EmptyState
                title="Select a subject"
                description="Pick a subject from the list to load its marks-entry grid."
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function EntryGrid({
  examId,
  examSubjectId,
}: {
  examId: string;
  examSubjectId: string;
}) {
  const [sectionId, setSectionId] = React.useState('');
  const [rowState, setRowState] = React.useState<Record<string, RowState>>({});
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['entry-sheet', examSubjectId, sectionId],
    queryFn: () =>
      api.get<EntrySheet>(
        `/exams/subjects/${examSubjectId}/entry-sheet`,
        sectionId ? { sectionId } : undefined,
      ),
  });

  // Seed the editable grid from each freshly-loaded sheet. Done during render
  // (React's documented "adjust state when data changes" pattern) rather than
  // in an effect, so there is no extra paint with stale rows.
  const [seededFrom, setSeededFrom] = React.useState<EntrySheet | null>(null);
  if (data && data !== seededFrom) {
    setSeededFrom(data);
    const next: Record<string, RowState> = {};
    for (const row of data.rows) {
      next[row.student.id] = {
        marksObtained:
          row.mark?.marksObtained !== null && row.mark?.marksObtained !== undefined
            ? String(row.mark.marksObtained)
            : '',
        practicalMarks:
          row.mark?.practicalMarks !== null && row.mark?.practicalMarks !== undefined
            ? String(row.mark.practicalMarks)
            : '',
        isAbsent: row.mark?.isAbsent ?? false,
        isExempted: row.mark?.isExempted ?? false,
        remarks: row.mark?.remarks ?? '',
      };
    }
    setRowState(next);
    setServerErrors({});
    setDirty(false);
  }

  const save = useAction<
    { marks: unknown[] },
    { created: number; updated: number; total: number }
  >({
    mutationFn: (body) => api.post('/exams/marks', { examSubjectId, marks: body.marks }),
    successMessage: (result) =>
      `Saved ${result.total} mark${result.total === 1 ? '' : 's'} (${result.created} new, ${result.updated} updated)`,
    invalidates: [['entry-sheet', examSubjectId], ['exam', examId]],
    onSuccess: () => {
      setServerErrors({});
      setDirty(false);
      void refetch();
    },
    onError: (err: ApiClientError) => {
      // The API validates the whole batch and rejects it atomically; surface
      // its message and, when present, the per-student detail.
      if (err.byField && Object.keys(err.byField).length > 0) {
        setServerErrors(err.byField);
      }
    },
  });

  if (isLoading) return <LoadingState label="Loading students" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="Nothing to show" />;

  const { examSubject, exam, isEditable, rows } = data;
  const hasPractical =
    examSubject.subject.hasPractical || Boolean(examSubject.maxMarksPractical);
  const max = examSubject.maxMarks;
  const maxPractical = examSubject.maxMarksPractical ?? 0;

  function update(studentId: string, patch: Partial<RowState>) {
    setRowState((current) => ({
      ...current,
      [studentId]: { ...current[studentId], ...patch },
    }));
    setDirty(true);
  }

  function rowError(studentId: string): string | undefined {
    if (serverErrors[studentId]) return serverErrors[studentId];
    const state = rowState[studentId];
    if (!state) return undefined;
    if (state.isAbsent || state.isExempted) return undefined;
    if (state.marksObtained === '') return undefined; // empty is allowed as "not entered"
    const value = Number(state.marksObtained);
    if (!Number.isFinite(value)) return 'Enter a number';
    if (value < 0) return 'Cannot be negative';
    if (value > max) return `Max is ${max}`;
    if (state.practicalMarks !== '') {
      const practical = Number(state.practicalMarks);
      if (!Number.isFinite(practical) || practical < 0) return 'Practical must be a positive number';
      if (practical > maxPractical) return `Practical max is ${maxPractical}`;
    }
    return undefined;
  }

  const editableRows = rows.filter((row) => {
    const state = rowState[row.student.id];
    if (!state) return false;
    return state.isAbsent || state.isExempted || state.marksObtained !== '';
  });

  const anyError = rows.some((row) => rowError(row.student.id));
  const enteredCount = editableRows.length;

  function buildPayload() {
    return editableRows.map((row) => {
      const state = rowState[row.student.id];
      return {
        studentId: row.student.id,
        ...(state.isAbsent || state.isExempted
          ? {}
          : {
              marksObtained: Number(state.marksObtained),
              ...(state.practicalMarks !== ''
                ? { practicalMarks: Number(state.practicalMarks) }
                : {}),
            }),
        isAbsent: state.isAbsent,
        isExempted: state.isExempted,
        ...(state.remarks.trim() ? { remarks: state.remarks.trim() } : {}),
      };
    });
  }

  function markRestAbsent() {
    setRowState((current) => {
      const next = { ...current };
      for (const row of rows) {
        const state = next[row.student.id];
        if (state && !state.isAbsent && !state.isExempted && state.marksObtained === '') {
          next[row.student.id] = { ...state, isAbsent: true };
        }
      }
      return next;
    });
    setDirty(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            {examSubject.subject.name}
            <span className="ml-1.5 text-2xs font-normal text-[var(--color-ink-muted)]">
              {examSubject.subject.code}
            </span>
          </h2>
          <p className="text-2xs text-[var(--color-ink-muted)]">
            Max {max} · Pass {examSubject.passMarks}
            {hasPractical ? ` · Practical max ${maxPractical}` : ''} · {exam.name}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Select
            aria-label="Section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="w-auto"
          >
            <option value="">All sections</option>
            {[...new Map(rows.filter((r) => r.section).map((r) => [r.section!.id, r.section!])).values()].map(
              (section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ),
            )}
          </Select>
          {isEditable ? (
            <Button size="sm" variant="ghost" onClick={markRestAbsent}>
              Mark rest absent
            </Button>
          ) : null}
        </div>
      </div>

      {!isEditable ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-warning-border)] bg-[var(--color-warning-soft)] px-3 py-2 text-xs text-[var(--color-warning)]">
          <Lock className="size-3.5" aria-hidden />
          {exam.marksLocked
            ? 'Marks for this exam are locked. An authorised correction is required to change them.'
            : `Marks cannot be entered while the exam is ${exam.status}.`}
        </div>
      ) : null}

      {save.error instanceof ApiClientError && !save.error.isValidation ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {save.error.message}
        </div>
      ) : null}

      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-sunken)] text-2xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Roll</th>
                  <th className="px-3 py-2 text-left">Student</th>
                  <th className="px-3 py-2 text-right">Marks / {max}</th>
                  {hasPractical ? (
                    <th className="px-3 py-2 text-right">Practical / {maxPractical}</th>
                  ) : null}
                  <th className="px-3 py-2 text-center">Absent</th>
                  <th className="px-3 py-2 text-center">Exempt</th>
                  <th className="px-3 py-2 text-left">Remarks</th>
                  <th className="px-3 py-2 text-right">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.map((row) => {
                  const state = rowState[row.student.id];
                  if (!state) return null;
                  const err = rowError(row.student.id);
                  const disabled = !isEditable || state.isAbsent || state.isExempted;
                  return (
                    <tr key={row.student.id} className={err ? 'bg-[var(--color-danger-soft)]' : ''}>
                      <td className="px-3 py-1.5 numeric">{row.rollNumber ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-2">
                          <span
                            className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold"
                            aria-hidden
                          >
                            {row.student.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={row.student.photoUrl} alt="" className="size-6 object-cover" />
                            ) : (
                              initials(row.student.fullName)
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{row.student.fullName}</span>
                            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                              {row.student.admissionNumber}
                              {row.section ? ` · ${row.section.name}` : ''}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={max}
                          step="0.01"
                          value={state.marksObtained}
                          disabled={disabled}
                          invalid={Boolean(err)}
                          onChange={(e) => update(row.student.id, { marksObtained: e.target.value })}
                          className="ml-auto h-7 w-20 text-right"
                          aria-label={`Marks for ${row.student.fullName}`}
                        />
                        {err ? (
                          <span className="block text-2xs text-[var(--color-danger)]">{err}</span>
                        ) : null}
                      </td>
                      {hasPractical ? (
                        <td className="px-3 py-1.5 text-right">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={maxPractical}
                            step="0.01"
                            value={state.practicalMarks}
                            disabled={disabled}
                            onChange={(e) =>
                              update(row.student.id, { practicalMarks: e.target.value })
                            }
                            className="ml-auto h-7 w-20 text-right"
                            aria-label={`Practical marks for ${row.student.fullName}`}
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={state.isAbsent}
                          disabled={!isEditable}
                          onChange={(e) =>
                            update(row.student.id, {
                              isAbsent: e.target.checked,
                              isExempted: e.target.checked ? false : state.isExempted,
                            })
                          }
                          className="size-3.5 accent-[var(--color-accent)]"
                          aria-label={`Mark ${row.student.fullName} absent`}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={state.isExempted}
                          disabled={!isEditable}
                          onChange={(e) =>
                            update(row.student.id, {
                              isExempted: e.target.checked,
                              isAbsent: e.target.checked ? false : state.isAbsent,
                            })
                          }
                          className="size-3.5 accent-[var(--color-accent)]"
                          aria-label={`Mark ${row.student.fullName} exempt`}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          value={state.remarks}
                          disabled={!isEditable}
                          onChange={(e) => update(row.student.id, { remarks: e.target.value })}
                          className="h-7"
                          aria-label={`Remarks for ${row.student.fullName}`}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {row.mark?.grade ? (
                          <Badge>{row.mark.grade}</Badge>
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {isEditable ? (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-sm)]">
          <p className="text-xs text-[var(--color-ink-muted)]">
            {enteredCount} of {rows.length} rows filled
            {anyError ? (
              <span className="ml-2 text-[var(--color-danger)]">— fix the highlighted rows</span>
            ) : dirty ? (
              <span className="ml-2 text-[var(--color-warning)]">— unsaved changes</span>
            ) : (
              <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-success)]">
                <Check className="size-3" aria-hidden />
                saved
              </span>
            )}
          </p>
          <Button
            size="sm"
            variant="primary"
            icon={<Save />}
            loading={save.isPending}
            disabled={anyError || enteredCount === 0 || !dirty}
            onClick={() => save.mutate({ marks: buildPayload() })}
          >
            Save marks
          </Button>
        </div>
      ) : null}
    </div>
  );
}
