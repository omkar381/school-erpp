'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  FileSpreadsheet,
  GraduationCap,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useClasses, useSections, useTeachers } from '@/hooks/use-lookups';
import { formatClock, formatDate } from '@/lib/dates';
import { formatPercent } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { DetailList, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

// ---------------------------------------------------------------------------
// Types mirroring the exams API responses
// ---------------------------------------------------------------------------

interface GradeBand {
  grade: string;
  minValue: string;
  maxValue: string;
  gradePoint: string | null;
  remark: string | null;
  isPassing: boolean;
}

interface ExamSchedule {
  id: string;
  sectionId: string | null;
  roomId: string | null;
  invigilatorId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  instructions: string | null;
  room: { id: string; name: string } | null;
  invigilator: { id: string; firstName: string; lastName: string | null } | null;
}

interface ExamSubject {
  id: string;
  classId: string;
  subjectId: string;
  maxMarks: string;
  passMarks: string;
  maxMarksPractical: string | null;
  passMarksPractical: string | null;
  subject: { id: string; name: string; code: string; colorHex: string | null };
  schedules: ExamSchedule[];
  marksEntered: number;
  marksExpected: number;
  isComplete: boolean;
}

interface ExamClass {
  id: string;
  classId: string;
  sectionId: string | null;
  class: { id: string; name: string; level: number };
  section: { id: string; name: string } | null;
}

interface ExamDetail {
  id: string;
  name: string;
  code: string;
  type: string;
  description: string | null;
  startDate: string;
  endDate: string;
  status: string;
  weightage: string | null;
  resultDate: string | null;
  publishedAt: string | null;
  marksLocked: boolean;
  showRank: boolean;
  instructions: string | null;
  academicYear: { id: string; name: string };
  gradeScale: { id: string; name: string; bands: GradeBand[] } | null;
  examClasses: ExamClass[];
  examSubjects: ExamSubject[];
}

const EXAM_QUERIES = [['exams'], ['exam']];

/** Next statuses reachable from each state, matching the API's state machine. */
const NEXT_STATUSES: Record<string, string[]> = {
  DRAFT: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['ONGOING', 'DRAFT', 'CANCELLED'],
  ONGOING: ['MARKS_ENTRY', 'CANCELLED'],
  MARKS_ENTRY: ['COMPLETED', 'ONGOING'],
  COMPLETED: ['MARKS_ENTRY'],
  PUBLISHED: [],
  CANCELLED: ['DRAFT'],
};

export default function ExamDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const canManage = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('exams.update'),
  );
  const canSchedule = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('exams.schedule'),
  );
  const canDelete = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('exams.delete'),
  );
  const canEnterMarks = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('exams.enter_marks'),
  );
  const canPublish = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('exams.publish_results'),
  );
  const canReportCards = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('report_cards.view'),
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['exam', id],
    queryFn: () => api.get<ExamDetail>(`/exams/${id}`),
    enabled: Boolean(id),
  });

  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);

  const setStatus = useAction({
    mutationFn: (status: string) => api.patch(`/exams/${id}/status`, { status }),
    successMessage: 'Exam status updated',
    invalidates: EXAM_QUERIES,
  });

  const toggleLock = useAction({
    mutationFn: (locked: boolean) => api.patch(`/exams/${id}/lock`, { locked }),
    successMessage: 'Marks lock updated',
    invalidates: EXAM_QUERIES,
  });

  const removeExam = useAction({
    mutationFn: () => api.delete(`/exams/${id}`),
    successMessage: 'Examination deleted',
    invalidates: [['exams']],
    onSuccess: () => router.push('/exams'),
  });

  if (isLoading) return <LoadingState label="Loading examination" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="Examination not found" />;

  const totalPapers = data.examSubjects.reduce((sum, s) => sum + s.schedules.length, 0);
  const marksEntered = data.examSubjects.reduce((sum, s) => sum + s.marksEntered, 0);
  const marksExpected = data.examSubjects.reduce((sum, s) => sum + s.marksExpected, 0);
  const marksProgress =
    marksExpected > 0 ? Math.round((marksEntered / marksExpected) * 100) : 0;
  const nextStatuses = NEXT_STATUSES[data.status] ?? [];
  const isPublished = data.status === 'PUBLISHED';

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {data.name}
            <StatusBadge status={data.status} className="align-middle" />
            {data.marksLocked ? (
              <Badge tone="warning">
                <Lock className="size-2.5" aria-hidden />
                Marks locked
              </Badge>
            ) : null}
          </span>
        }
        description={
          <>
            {data.code} · {humanise(data.type)} · {data.academicYear.name} ·{' '}
            {formatDate(data.startDate)} – {formatDate(data.endDate)}
            {data.weightage ? ` · Weightage ${Number(data.weightage)}%` : ''}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
              <Link href="/exams">All exams</Link>
            </Button>
            {canManage && !isPublished ? (
              <Button size="sm" icon={<Pencil />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {canManage && nextStatuses.length > 0 ? (
              <Select
                aria-label="Move exam to status"
                value=""
                onChange={(e) => e.target.value && setStatus.mutate(e.target.value)}
                className="w-auto"
              >
                <option value="">Move to…</option>
                {nextStatuses.map((status) => (
                  <option key={status} value={status}>
                    {humanise(status)}
                  </option>
                ))}
              </Select>
            ) : null}
            {canPublish && data.marksLocked !== undefined && !isPublished ? (
              <Button
                size="sm"
                variant={data.marksLocked ? 'ghost' : 'secondary'}
                icon={data.marksLocked ? <LockOpen /> : <Lock />}
                loading={toggleLock.isPending}
                onClick={() => toggleLock.mutate(!data.marksLocked)}
              >
                {data.marksLocked ? 'Unlock marks' : 'Lock marks'}
              </Button>
            ) : null}
            {canPublish && !isPublished ? (
              <Button
                size="sm"
                variant="primary"
                icon={<Send />}
                onClick={() => setPublishing(true)}
              >
                Publish results
              </Button>
            ) : null}
            {canDelete && !isPublished ? (
              <Button
                size="sm"
                variant="danger-outline"
                icon={<Trash2 />}
                onClick={() => setDeleting(true)}
              >
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      <StatGrid columns={4} className="mb-4">
        <StatCard
          label="Classes"
          value={data.examClasses.length}
          icon={<GraduationCap />}
          hint={`${data.examSubjects.length} subject rows`}
        />
        <StatCard label="Papers scheduled" value={totalPapers} icon={<CalendarClock />} />
        <StatCard
          label="Marks entered"
          value={`${marksProgress}%`}
          icon={<FileSpreadsheet />}
          hint={`${marksEntered}/${marksExpected} across all subjects`}
        />
        <StatCard
          label="Results"
          value={isPublished ? 'Published' : humanise(data.status)}
          icon={<ClipboardList />}
          hint={data.resultDate ? `Result date ${formatDate(data.resultDate)}` : undefined}
        />
      </StatGrid>

      <Tabs defaultValue="setup">
        <TabsList>
          <TabsTrigger value="setup">Classes &amp; subjects</TabsTrigger>
          <TabsTrigger value="datesheet">Datesheet</TabsTrigger>
          <TabsTrigger value="marks">Marks entry</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          {canReportCards ? <TabsTrigger value="reports">Report cards</TabsTrigger> : null}
          <TabsTrigger value="config">Configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="setup">
          <SetupTab exam={data} canManage={canManage} canEnterMarks={canEnterMarks} />
        </TabsContent>

        <TabsContent value="datesheet">
          <DatesheetTab exam={data} canSchedule={canSchedule} />
        </TabsContent>

        <TabsContent value="marks">
          <MarksTab exam={data} canEnterMarks={canEnterMarks} />
        </TabsContent>

        <TabsContent value="results">
          <ResultsTab exam={data} />
        </TabsContent>

        {canReportCards ? (
          <TabsContent value="reports">
            <ReportCardsTab exam={data} />
          </TabsContent>
        ) : null}

        <TabsContent value="config">
          <ConfigTab exam={data} />
        </TabsContent>
      </Tabs>

      {editing ? <ExamEditDialog exam={data} onClose={() => setEditing(false)} /> : null}
      {publishing ? (
        <PublishDialog examId={data.id} examName={data.name} onClose={() => setPublishing(false)} />
      ) : null}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this examination?"
        description={`"${data.name}" will be removed, along with its schedule. Exams with marks cannot be deleted.`}
        confirmLabel="Delete"
        destructive
        loading={removeExam.isPending}
        onConfirm={() => removeExam.mutate()}
      />
    </>
  );
}

// ===========================================================================
// Setup tab — classes and per-subject marks
// ===========================================================================

function SetupTab({
  exam,
  canManage,
  canEnterMarks,
}: {
  exam: ExamDetail;
  canManage: boolean;
  canEnterMarks: boolean;
}) {
  const classes = useClasses();
  const [picking, setPicking] = React.useState(false);
  const [editingSubject, setEditingSubject] = React.useState<ExamSubject | null>(null);

  const selectedClassIds = new Set(exam.examClasses.map((c) => c.classId));

  // Group subject rows by class for display.
  const byClass = new Map<string, ExamSubject[]>();
  for (const subject of exam.examSubjects) {
    const bucket = byClass.get(subject.classId) ?? [];
    bucket.push(subject);
    byClass.set(subject.classId, bucket);
  }

  const classNameFor = (classId: string) =>
    exam.examClasses.find((c) => c.classId === classId)?.class.name ??
    classes.data?.find((c) => c.id === classId)?.name ??
    'Class';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Classes sitting this exam"
          description="Selecting classes creates a subject row per class from its curriculum."
          actions={
            canManage && !exam.publishedAt ? (
              <Button size="sm" icon={<Pencil />} onClick={() => setPicking(true)}>
                {exam.examClasses.length === 0 ? 'Select classes' : 'Edit classes'}
              </Button>
            ) : null
          }
        />
        <CardBody>
          {exam.examClasses.length === 0 ? (
            <EmptyState
              icon={<GraduationCap />}
              title="No classes selected yet"
              description="Add the classes that will sit this examination to start building subject rows and the datesheet."
              action={
                canManage && !exam.publishedAt ? (
                  <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setPicking(true)}>
                    Select classes
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {exam.examClasses
                .slice()
                .sort((a, b) => a.class.level - b.class.level)
                .map((entry) => (
                  <Badge key={entry.id} tone="accent">
                    {entry.class.name}
                    {entry.section ? ` ${entry.section.name}` : ''}
                  </Badge>
                ))}
            </div>
          )}
        </CardBody>
      </Card>

      {[...byClass.entries()]
        .sort((a, b) => classNameFor(a[0]).localeCompare(classNameFor(b[0]), undefined, { numeric: true }))
        .map(([classId, subjects]) => (
          <Card key={classId}>
            <CardHeader title={classNameFor(classId)} description={`${subjects.length} subjects`} />
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-surface-sunken)] text-2xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left">Subject</th>
                      <th className="px-3 py-2 text-right">Max</th>
                      <th className="px-3 py-2 text-right">Pass</th>
                      <th className="px-3 py-2 text-right">Practical max</th>
                      <th className="px-3 py-2 text-left">Marks entry</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {subjects
                      .slice()
                      .sort((a, b) => a.subject.name.localeCompare(b.subject.name))
                      .map((subject) => (
                        <tr key={subject.id}>
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: subject.subject.colorHex ?? 'var(--color-ink-faint)' }}
                                aria-hidden
                              />
                              <span className="font-medium">{subject.subject.name}</span>
                              <span className="text-2xs text-[var(--color-ink-muted)]">
                                {subject.subject.code}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right numeric">{Number(subject.maxMarks)}</td>
                          <td className="px-3 py-2 text-right numeric">{Number(subject.passMarks)}</td>
                          <td className="px-3 py-2 text-right numeric">
                            {subject.maxMarksPractical ? Number(subject.maxMarksPractical) : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {subject.isComplete ? (
                              <Badge tone="success">Complete</Badge>
                            ) : subject.marksEntered > 0 ? (
                              <Badge tone="info">
                                {subject.marksEntered}/{subject.marksExpected}
                              </Badge>
                            ) : (
                              <Badge>Not started</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              {canEnterMarks ? (
                                <Button size="xs" variant="ghost" asChild icon={<FileSpreadsheet />}>
                                  <Link href={`/exams/${exam.id}/marks?subject=${subject.id}`}>
                                    Enter marks
                                  </Link>
                                </Button>
                              ) : null}
                              {canManage && !exam.marksLocked ? (
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  icon={<Pencil />}
                                  aria-label={`Edit marks ceiling for ${subject.subject.name}`}
                                  onClick={() => setEditingSubject(subject)}
                                />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        ))}

      {picking ? (
        <ClassPickerDialog
          examId={exam.id}
          initial={[...selectedClassIds]}
          onClose={() => setPicking(false)}
        />
      ) : null}
      {editingSubject ? (
        <SubjectMarksDialog subject={editingSubject} onClose={() => setEditingSubject(null)} />
      ) : null}
    </div>
  );
}

function ClassPickerDialog({
  examId,
  initial,
  onClose,
}: {
  examId: string;
  initial: string[];
  onClose: () => void;
}) {
  const classes = useClasses();
  const [selected, setSelected] = React.useState<string[]>(initial);
  const [defaultMaxMarks, setDefaultMaxMarks] = React.useState('');
  const [defaultPassMarks, setDefaultPassMarks] = React.useState('');

  function toggle(classId: string) {
    setSelected((current) =>
      current.includes(classId)
        ? current.filter((entry) => entry !== classId)
        : [...current, classId],
    );
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Classes sitting this exam"
      description="Removing a class that already has marks is blocked — delete those marks first."
      submitLabel="Save classes"
      values={{ selected, defaultMaxMarks, defaultPassMarks }}
      isValid={selected.length > 0}
      successMessage="Exam classes updated"
      invalidates={EXAM_QUERIES}
      submit={(values) =>
        api.patch(`/exams/${examId}/classes`, {
          classIds: values.selected,
          ...(values.defaultMaxMarks ? { defaultMaxMarks: Number(values.defaultMaxMarks) } : {}),
          ...(values.defaultPassMarks ? { defaultPassMarks: Number(values.defaultPassMarks) } : {}),
        })
      }
    >
      {() => (
        <>
          {classes.isLoading ? (
            <LoadingState label="Loading classes" />
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {(classes.data ?? []).map((cls) => (
                <label
                  key={cls.id}
                  className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 py-2 text-sm hover:bg-[var(--color-surface-sunken)]"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(cls.id)}
                    onChange={() => toggle(cls.id)}
                    className="size-3.5 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 truncate">
                    {cls.name}
                    <span className="block text-2xs text-[var(--color-ink-muted)]">
                      {cls.studentCount} students
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <FieldRow columns={2}>
            <Field label="Default max marks" help="Overrides each subject's curriculum default">
              <Input
                type="number"
                min={1}
                max={1000}
                value={defaultMaxMarks}
                onChange={(e) => setDefaultMaxMarks(e.target.value)}
                placeholder="e.g. 100"
              />
            </Field>
            <Field label="Default pass marks">
              <Input
                type="number"
                min={0}
                max={1000}
                value={defaultPassMarks}
                onChange={(e) => setDefaultPassMarks(e.target.value)}
                placeholder="e.g. 33"
              />
            </Field>
          </FieldRow>
        </>
      )}
    </FormModal>
  );
}

function SubjectMarksDialog({ subject, onClose }: { subject: ExamSubject; onClose: () => void }) {
  const [maxMarks, setMaxMarks] = React.useState(String(Number(subject.maxMarks)));
  const [passMarks, setPassMarks] = React.useState(String(Number(subject.passMarks)));
  const [maxMarksPractical, setMaxMarksPractical] = React.useState(
    subject.maxMarksPractical ? String(Number(subject.maxMarksPractical)) : '',
  );
  const [passMarksPractical, setPassMarksPractical] = React.useState(
    subject.passMarksPractical ? String(Number(subject.passMarksPractical)) : '',
  );

  const maxNum = Number(maxMarks);
  const passNum = Number(passMarks);
  const valid = maxNum >= 1 && passNum >= 0 && passNum <= maxNum;

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${subject.subject.name} — marks ceiling`}
      description="Lowering the maximum below a mark already awarded is rejected."
      submitLabel="Save"
      values={{ maxMarks, passMarks, maxMarksPractical, passMarksPractical }}
      isValid={valid}
      successMessage="Subject updated"
      invalidates={EXAM_QUERIES}
      submit={(values) =>
        api.patch(`/exams/subjects/${subject.id}`, {
          maxMarks: Number(values.maxMarks),
          passMarks: Number(values.passMarks),
          ...(values.maxMarksPractical
            ? { maxMarksPractical: Number(values.maxMarksPractical) }
            : {}),
          ...(values.passMarksPractical
            ? { passMarksPractical: Number(values.passMarksPractical) }
            : {}),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={2}>
            <Field label="Maximum marks" required error={errors.maxMarks}>
              <Input
                type="number"
                min={1}
                max={1000}
                value={maxMarks}
                onChange={(e) => setMaxMarks(e.target.value)}
                autoFocus
              />
            </Field>
            <Field
              label="Pass marks"
              required
              error={errors.passMarks}
              help={passNum > maxNum ? 'Cannot exceed the maximum' : undefined}
            >
              <Input
                type="number"
                min={0}
                max={1000}
                value={passMarks}
                onChange={(e) => setPassMarks(e.target.value)}
              />
            </Field>
          </FieldRow>
          <FieldRow columns={2}>
            <Field label="Practical maximum" error={errors.maxMarksPractical} help="Leave blank if none">
              <Input
                type="number"
                min={0}
                max={1000}
                value={maxMarksPractical}
                onChange={(e) => setMaxMarksPractical(e.target.value)}
              />
            </Field>
            <Field label="Practical pass" error={errors.passMarksPractical}>
              <Input
                type="number"
                min={0}
                max={1000}
                value={passMarksPractical}
                onChange={(e) => setPassMarksPractical(e.target.value)}
              />
            </Field>
          </FieldRow>
        </>
      )}
    </FormModal>
  );
}

// ===========================================================================
// Datesheet tab
// ===========================================================================

interface DatesheetDay {
  date: string;
  papers: Array<{
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    instructions: string | null;
    room: { id: string; name: string } | null;
    invigilator: { id: string; firstName: string; lastName: string | null } | null;
    examSubject: {
      id: string;
      maxMarks: string;
      passMarks: string;
      classId: string;
      subject: { id: string; name: string; code: string; colorHex: string | null };
    };
  }>;
}

function DatesheetTab({ exam, canSchedule }: { exam: ExamDetail; canSchedule: boolean }) {
  const [classFilter, setClassFilter] = React.useState('');
  const [scheduling, setScheduling] = React.useState(false);
  const [editing, setEditing] = React.useState<{
    scheduleId: string;
    examSubjectId: string;
    date: string;
    startTime: string;
    endTime: string;
    roomId: string | null;
    invigilatorId: string | null;
    instructions: string | null;
  } | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['exam-datesheet', exam.id, classFilter],
    queryFn: () =>
      api.get<{ totalPapers: number; days: DatesheetDay[] }>(
        `/exams/${exam.id}/datesheet`,
        classFilter ? { classId: classFilter } : undefined,
      ),
  });

  const removeSchedule = useAction({
    mutationFn: (scheduleId: string) => api.delete(`/exams/schedules/${scheduleId}`),
    successMessage: 'Paper removed from the datesheet',
    invalidates: [['exam-datesheet', exam.id], ['exam', exam.id]],
    onSuccess: () => setRemoving(null),
  });

  const classOptions = exam.examClasses
    .slice()
    .sort((a, b) => a.class.level - b.class.level)
    .map((c) => ({ value: c.classId, label: c.class.name }));

  if (exam.examSubjects.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock />}
        title="Select classes first"
        description="The datesheet is built from the exam's subjects. Add classes on the Classes & subjects tab."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {classOptions.length > 1 ? (
          <Select
            aria-label="Filter datesheet by class"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="w-auto"
          >
            <option value="">All classes</option>
            {classOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : null}
        {canSchedule && !exam.publishedAt ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus />}
            className="ml-auto"
            onClick={() => setScheduling(true)}
          >
            Schedule a paper
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <LoadingState label="Loading datesheet" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.days.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="No papers scheduled yet"
          description="Schedule each subject paper with its date, time and room. Clashes are rejected automatically."
          action={
            canSchedule && !exam.publishedAt ? (
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setScheduling(true)}>
                Schedule a paper
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {data.days.map((day) => (
            <Card key={day.date}>
              <CardHeader title={formatDate(day.date)} description={`${day.papers.length} papers`} />
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--color-border)]">
                  {day.papers.map((paper) => {
                    const className = exam.examClasses.find(
                      (c) => c.classId === paper.examSubject.classId,
                    )?.class.name;
                    return (
                      <li key={paper.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            background: paper.examSubject.subject.colorHex ?? 'var(--color-ink-faint)',
                          }}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {paper.examSubject.subject.name}
                            {className ? (
                              <span className="ml-1.5 text-2xs text-[var(--color-ink-muted)]">
                                {className}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-2xs text-[var(--color-ink-muted)]">
                            {formatClock(paper.startTime)} – {formatClock(paper.endTime)} ·{' '}
                            {paper.durationMinutes} min
                            {paper.room ? ` · ${paper.room.name}` : ''}
                            {paper.invigilator
                              ? ` · ${paper.invigilator.firstName} ${paper.invigilator.lastName ?? ''}`
                              : ''}
                          </p>
                        </div>
                        {canSchedule && !exam.publishedAt ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              icon={<Pencil />}
                              aria-label={`Reschedule ${paper.examSubject.subject.name}`}
                              onClick={() =>
                                setEditing({
                                  scheduleId: paper.id,
                                  examSubjectId: paper.examSubject.id,
                                  date: paper.date.slice(0, 10),
                                  startTime: paper.startTime,
                                  endTime: paper.endTime,
                                  roomId: paper.room?.id ?? null,
                                  invigilatorId: paper.invigilator?.id ?? null,
                                  instructions: paper.instructions,
                                })
                              }
                            />
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              icon={<Trash2 />}
                              aria-label={`Remove ${paper.examSubject.subject.name} from the datesheet`}
                              onClick={() => setRemoving(paper.id)}
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {scheduling ? (
        <ScheduleDialog exam={exam} onClose={() => setScheduling(false)} />
      ) : null}
      {editing ? (
        <ScheduleDialog exam={exam} existing={editing} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this paper from the datesheet?"
        description="The subject stays on the exam; only its scheduled slot is removed."
        confirmLabel="Remove"
        destructive
        loading={removeSchedule.isPending}
        onConfirm={() => removing && removeSchedule.mutate(removing)}
      />
    </div>
  );
}

function ScheduleDialog({
  exam,
  existing,
  onClose,
}: {
  exam: ExamDetail;
  existing?: {
    scheduleId: string;
    examSubjectId: string;
    date: string;
    startTime: string;
    endTime: string;
    roomId: string | null;
    invigilatorId: string | null;
    instructions: string | null;
  };
  onClose: () => void;
}) {
  const rooms = useQuery({
    queryKey: ['lookup', 'rooms'],
    queryFn: () => api.get<Array<{ id: string; name: string; code: string }>>('/academics/rooms'),
    staleTime: 10 * 60_000,
  });
  const teachers = useTeachers();

  const [examSubjectId, setExamSubjectId] = React.useState(existing?.examSubjectId ?? '');
  const [date, setDate] = React.useState(existing?.date ?? exam.startDate.slice(0, 10));
  const [startTime, setStartTime] = React.useState(existing?.startTime ?? '09:00');
  const [endTime, setEndTime] = React.useState(existing?.endTime ?? '12:00');
  const [roomId, setRoomId] = React.useState(existing?.roomId ?? '');
  const [invigilatorId, setInvigilatorId] = React.useState(existing?.invigilatorId ?? '');
  const [instructions, setInstructions] = React.useState(existing?.instructions ?? '');

  const timeOk = startTime < endTime;
  const dateOk = date >= exam.startDate.slice(0, 10) && date <= exam.endDate.slice(0, 10);

  // One option per class+subject, since ExamSubject is per class.
  const subjectOptions = exam.examSubjects
    .slice()
    .sort((a, b) => a.subject.name.localeCompare(b.subject.name))
    .map((s) => {
      const className = exam.examClasses.find((c) => c.classId === s.classId)?.class.name ?? '';
      return { value: s.id, label: `${s.subject.name} · ${className}` };
    });

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={existing ? 'Reschedule paper' : 'Schedule a paper'}
      description={`Papers must fall between ${formatDate(exam.startDate)} and ${formatDate(exam.endDate)}.`}
      submitLabel={existing ? 'Save schedule' : 'Schedule paper'}
      values={{ examSubjectId, date, startTime, endTime, roomId, invigilatorId, instructions }}
      isValid={Boolean(examSubjectId) && timeOk && dateOk}
      successMessage="Paper scheduled"
      invalidates={[['exam-datesheet', exam.id], ['exam', exam.id]]}
      submit={(values) =>
        api.post('/exams/schedules', {
          examSubjectId: values.examSubjectId,
          ...(existing ? { scheduleId: existing.scheduleId } : {}),
          date: values.date,
          startTime: values.startTime,
          endTime: values.endTime,
          ...(values.roomId ? { roomId: values.roomId } : {}),
          ...(values.invigilatorId ? { invigilatorId: values.invigilatorId } : {}),
          ...(values.instructions.trim() ? { instructions: values.instructions.trim() } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Subject &amp; class" required error={errors.examSubjectId}>
            <Select
              value={examSubjectId}
              onChange={(e) => setExamSubjectId(e.target.value)}
              disabled={Boolean(existing)}
            >
              <option value="">Select a subject</option>
              {subjectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <FieldRow columns={3}>
            <Field
              label="Date"
              required
              error={errors.date}
              help={!dateOk && date ? 'Outside the exam window' : undefined}
            >
              <Input
                type="date"
                value={date}
                min={exam.startDate.slice(0, 10)}
                max={exam.endDate.slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Start" required error={errors.startTime}>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field
              label="End"
              required
              error={errors.endTime}
              help={!timeOk ? 'Must be after the start' : undefined}
            >
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </FieldRow>

          <FieldRow columns={2}>
            <Field label="Room" error={errors.roomId} help="Optional; clashes are rejected">
              <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">No room</option>
                {(rooms.data ?? []).map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Invigilator" error={errors.invigilatorId} help="Optional">
              <Select value={invigilatorId} onChange={(e) => setInvigilatorId(e.target.value)}>
                <option value="">Unassigned</option>
                {(teachers.data ?? []).map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.firstName} {teacher.lastName ?? ''}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <Field label="Instructions" error={errors.instructions}>
            <Textarea
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Bring your own drawing instruments"
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

// ===========================================================================
// Marks tab — quick launcher into per-subject entry
// ===========================================================================

function MarksTab({ exam, canEnterMarks }: { exam: ExamDetail; canEnterMarks: boolean }) {
  if (!canEnterMarks) {
    return (
      <EmptyState
        icon={<FileSpreadsheet />}
        title="You cannot enter marks"
        description="Marks entry requires the examinations mark-entry permission."
      />
    );
  }
  if (exam.examSubjects.length === 0) {
    return (
      <EmptyState
        icon={<FileSpreadsheet />}
        title="No subjects to mark"
        description="Add classes on the Classes & subjects tab first."
      />
    );
  }

  const byClass = new Map<string, ExamSubject[]>();
  for (const subject of exam.examSubjects) {
    const bucket = byClass.get(subject.classId) ?? [];
    bucket.push(subject);
    byClass.set(subject.classId, bucket);
  }

  return (
    <div className="space-y-3">
      {[...byClass.entries()]
        .map(([classId, subjects]) => ({
          classId,
          subjects,
          className: exam.examClasses.find((c) => c.classId === classId)?.class.name ?? 'Class',
          level: exam.examClasses.find((c) => c.classId === classId)?.class.level ?? 0,
        }))
        .sort((a, b) => a.level - b.level)
        .map(({ classId, subjects, className }) => (
          <Card key={classId}>
            <CardHeader title={className} />
            <CardBody className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {subjects
                .slice()
                .sort((a, b) => a.subject.name.localeCompare(b.subject.name))
                .map((subject) => (
                  <Link
                    key={subject.id}
                    href={`/exams/${exam.id}/marks?subject=${subject.id}`}
                    className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-sunken)]"
                  >
                    <span className="min-w-0 truncate font-medium">{subject.subject.name}</span>
                    {subject.isComplete ? (
                      <Badge tone="success">Done</Badge>
                    ) : subject.marksEntered > 0 ? (
                      <Badge tone="info">
                        {subject.marksEntered}/{subject.marksExpected}
                      </Badge>
                    ) : (
                      <Badge>0/{subject.marksExpected}</Badge>
                    )}
                  </Link>
                ))}
            </CardBody>
          </Card>
        ))}
    </div>
  );
}

// ===========================================================================
// Results tab
// ===========================================================================

interface ClassResults {
  exam: { id: string; name: string; status: string; showRank: boolean };
  subjects: Array<{ id: string; name: string; code: string; isGradedOnly: boolean }>;
  totalStudents: number;
  statistics: {
    appeared: number;
    passed: number;
    failed: number;
    classAverage: number | null;
    highest: number | null;
    lowest: number | null;
  };
  rows: Array<{
    student: { id: string; admissionNumber: string; fullName: string };
    rollNumber: string | null;
    section: { id: string; name: string } | null;
    marks: Array<{ subjectId: string; subjectCode: string; total: number | null; grade: string | null; isAbsent: boolean }>;
    summary: {
      totalMaxMarks: number;
      totalObtained: number;
      percentage: number | null;
      result: 'PASS' | 'FAIL' | 'PENDING';
    };
    rank: number | null;
  }>;
}

function ResultsTab({ exam }: { exam: ExamDetail }) {
  const [classId, setClassId] = React.useState(exam.examClasses[0]?.classId ?? '');
  const [sectionId, setSectionId] = React.useState('');
  const sections = useSections(classId || undefined);

  const enabled = Boolean(classId) && (exam.status === 'PUBLISHED' || exam.status === 'COMPLETED' || exam.status === 'MARKS_ENTRY');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['exam-results', exam.id, classId, sectionId],
    queryFn: () =>
      api.get<ClassResults>(`/exams/${exam.id}/results`, {
        classId,
        ...(sectionId ? { sectionId } : {}),
      }),
    enabled,
  });

  if (exam.examClasses.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList />}
        title="No results yet"
        description="Add classes and enter marks before results can be compiled."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Class"
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setSectionId('');
          }}
          className="w-auto"
        >
          {exam.examClasses
            .slice()
            .sort((a, b) => a.class.level - b.class.level)
            .map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.class.name}
              </option>
            ))}
        </Select>
        <Select
          aria-label="Section"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          className="w-auto"
        >
          <option value="">All sections</option>
          {(sections.data ?? []).map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </Select>
      </div>

      {!enabled ? (
        <EmptyState
          icon={<ClipboardList />}
          title="Results not available yet"
          description="Result sheets appear once marks entry is under way. Publish the exam to release results to families."
        />
      ) : isLoading ? (
        <LoadingState label="Compiling results" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No students in this class" />
      ) : (
        <>
          <StatGrid columns={4}>
            <StatCard label="Appeared" value={data.statistics.appeared} hint={`of ${data.totalStudents}`} />
            <StatCard label="Passed" value={data.statistics.passed} />
            <StatCard label="Failed" value={data.statistics.failed} />
            <StatCard
              label="Class average"
              value={formatPercent(data.statistics.classAverage)}
              hint={
                data.statistics.highest !== null
                  ? `${formatPercent(data.statistics.lowest)} – ${formatPercent(data.statistics.highest)}`
                  : undefined
              }
            />
          </StatGrid>

          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-surface-sunken)] text-2xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left">Roll</th>
                      <th className="px-3 py-2 text-left">Student</th>
                      {data.subjects.map((subject) => (
                        <th key={subject.id} className="px-2 py-2 text-right" title={subject.name}>
                          {subject.code}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">%</th>
                      {data.exam.showRank ? <th className="px-3 py-2 text-right">Rank</th> : null}
                      <th className="px-3 py-2 text-left">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {data.rows.map((row) => {
                      const marksBySubject = new Map(row.marks.map((m) => [m.subjectId, m]));
                      return (
                        <tr key={row.student.id} className="hover:bg-[var(--color-surface-sunken)]">
                          <td className="px-3 py-2 numeric">{row.rollNumber ?? '—'}</td>
                          <td className="px-3 py-2">
                            <Link
                              href={`/exams/${exam.id}/results/${row.student.id}`}
                              className="font-medium hover:text-[var(--color-accent)]"
                            >
                              {row.student.fullName}
                            </Link>
                            <span className="block text-2xs text-[var(--color-ink-muted)]">
                              {row.student.admissionNumber}
                              {row.section ? ` · ${row.section.name}` : ''}
                            </span>
                          </td>
                          {data.subjects.map((subject) => {
                            const mark = marksBySubject.get(subject.id);
                            return (
                              <td key={subject.id} className="px-2 py-2 text-right numeric">
                                {!mark ? (
                                  '—'
                                ) : mark.isAbsent ? (
                                  <span className="text-[var(--color-danger)]">AB</span>
                                ) : mark.total === null ? (
                                  '—'
                                ) : (
                                  mark.total
                                )}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right numeric">
                            {row.summary.totalObtained}/{row.summary.totalMaxMarks}
                          </td>
                          <td className="px-3 py-2 text-right numeric">
                            {formatPercent(row.summary.percentage)}
                          </td>
                          {data.exam.showRank ? (
                            <td className="px-3 py-2 text-right numeric">{row.rank ?? '—'}</td>
                          ) : null}
                          <td className="px-3 py-2">
                            <StatusBadge status={row.summary.result} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Report cards tab
// ===========================================================================

interface ReportCardRow {
  id: string;
  term: string;
  percentage: string | null;
  grade: string | null;
  rank: number | null;
  rankOutOf: number | null;
  result: string | null;
  attendancePercent: string | null;
  generatedAt: string;
  publishedAt: string | null;
  pdfUrl: string | null;
  student: { id: string; admissionNumber: string; firstName: string; lastName: string | null };
  class: { id: string; name: string } | null;
  section: { id: string; name: string } | null;
}

function ReportCardsTab({ exam }: { exam: ExamDetail }) {
  const canGenerate = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('report_cards.generate'),
  );
  const canPublish = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('report_cards.publish'),
  );

  const [generating, setGenerating] = React.useState(false);
  const [term, setTerm] = React.useState('');

  const list = useQuery({
    queryKey: ['report-cards', { academicYearId: exam.academicYear.id, term }],
    queryFn: () =>
      api.get<{ items: ReportCardRow[]; meta: { total: number } }>(`/exams/report-cards`, {
        academicYearId: exam.academicYear.id,
        limit: 100,
        ...(term ? { term } : {}),
      }),
  });

  const publish = useAction({
    mutationFn: (reportCardIds: string[]) =>
      api.post('/exams/report-cards/publish', { reportCardIds }),
    successMessage: 'Report cards published',
    invalidates: [['report-cards']],
  });

  if (exam.status !== 'PUBLISHED') {
    return (
      <EmptyState
        icon={<ClipboardList />}
        title="Publish results first"
        description="Report cards aggregate published exams. Publish this exam's results, then generate cards for the term."
      />
    );
  }

  const rows = list.data?.items ?? [];
  const unpublished = rows.filter((r) => !r.publishedAt).map((r) => r.id);
  const terms = [...new Set(rows.map((r) => r.term))];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {terms.length > 1 ? (
          <Select
            aria-label="Filter by term"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="w-auto"
          >
            <option value="">All terms</option>
            {terms.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {canPublish && unpublished.length > 0 ? (
            <Button
              size="sm"
              icon={<Send />}
              loading={publish.isPending}
              onClick={() => publish.mutate(unpublished)}
            >
              Publish {unpublished.length}
            </Button>
          ) : null}
          {canGenerate ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setGenerating(true)}>
              Generate report cards
            </Button>
          ) : null}
        </div>
      </div>

      {list.isLoading ? (
        <LoadingState label="Loading report cards" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="No report cards generated"
          description="Generate term report cards by aggregating this and any other published exams for the year."
          action={
            canGenerate ? (
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setGenerating(true)}>
                Generate report cards
              </Button>
            ) : null
          }
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-surface-sunken)] text-2xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Student</th>
                    <th className="px-3 py-2 text-left">Class</th>
                    <th className="px-3 py-2 text-left">Term</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2 text-left">Grade</th>
                    <th className="px-3 py-2 text-right">Rank</th>
                    <th className="px-3 py-2 text-left">Result</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {rows.map((card) => (
                    <tr key={card.id} className="hover:bg-[var(--color-surface-sunken)]">
                      <td className="px-3 py-2">
                        <Link
                          href={`/exams/report-cards/${card.id}`}
                          className="font-medium hover:text-[var(--color-accent)]"
                        >
                          {card.student.firstName} {card.student.lastName ?? ''}
                        </Link>
                        <span className="block text-2xs text-[var(--color-ink-muted)]">
                          {card.student.admissionNumber}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {card.class?.name}
                        {card.section ? ` ${card.section.name}` : ''}
                      </td>
                      <td className="px-3 py-2">{card.term}</td>
                      <td className="px-3 py-2 text-right numeric">
                        {formatPercent(card.percentage ? Number(card.percentage) : null)}
                      </td>
                      <td className="px-3 py-2">{card.grade ?? '—'}</td>
                      <td className="px-3 py-2 text-right numeric">
                        {card.rank ? `${card.rank}/${card.rankOutOf}` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={card.result} />
                      </td>
                      <td className="px-3 py-2">
                        {card.publishedAt ? (
                          <Badge tone="success">Published</Badge>
                        ) : (
                          <Badge>Draft</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="xs" variant="ghost" asChild>
                          <Link href={`/exams/report-cards/${card.id}`}>Open</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {generating ? (
        <GenerateReportCardsDialog exam={exam} onClose={() => setGenerating(false)} />
      ) : null}
    </div>
  );
}

function GenerateReportCardsDialog({ exam, onClose }: { exam: ExamDetail; onClose: () => void }) {
  const publishedExams = useQuery({
    queryKey: ['exams', { status: 'PUBLISHED', academicYearId: exam.academicYear.id, forPicker: true }],
    queryFn: () =>
      api.get<{ items: Array<{ id: string; name: string; code: string }> }>(`/exams`, {
        status: 'PUBLISHED',
        academicYearId: exam.academicYear.id,
        limit: 50,
      }),
  });

  const [term, setTerm] = React.useState('');
  const [examIds, setExamIds] = React.useState<string[]>([exam.id]);
  const [scope, setScope] = React.useState<'all' | 'section'>('all');
  const [sectionId, setSectionId] = React.useState('');
  const [publish, setPublish] = React.useState(false);
  const [principalRemarks, setPrincipalRemarks] = React.useState('');

  const classId = exam.examClasses[0]?.classId;
  const sections = useSections(scope === 'section' ? classId : undefined);

  function toggleExam(id: string) {
    setExamIds((current) =>
      current.includes(id) ? current.filter((e) => e !== id) : [...current, id],
    );
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Generate report cards"
      description="Aggregates the selected published exams into one term result per student, ranked within the class."
      submitLabel="Generate"
      values={{ term, examIds, scope, sectionId, publish, principalRemarks }}
      isValid={term.trim().length > 0 && examIds.length > 0 && (scope === 'all' || Boolean(sectionId))}
      successMessage="Report cards generated"
      invalidates={[['report-cards']]}
      submit={(values) =>
        api.post('/exams/report-cards/generate', {
          examIds: values.examIds,
          term: values.term.trim(),
          ...(values.scope === 'section' && values.sectionId ? { sectionId: values.sectionId } : {}),
          publish: values.publish,
          ...(values.principalRemarks.trim()
            ? { principalRemarks: values.principalRemarks.trim() }
            : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Term name" required error={errors.term} help="e.g. Term 1, Half Yearly">
            <Input value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
          </Field>

          <Field label="Exams to aggregate" required error={errors.examIds}>
            <div className="space-y-1">
              {(publishedExams.data?.items ?? []).map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={examIds.includes(e.id)}
                    onChange={() => toggleExam(e.id)}
                    className="size-3.5 accent-[var(--color-accent)]"
                  />
                  {e.name} <span className="text-2xs text-[var(--color-ink-muted)]">{e.code}</span>
                </label>
              ))}
              {publishedExams.data && publishedExams.data.items.length === 0 ? (
                <p className="text-2xs text-[var(--color-ink-muted)]">
                  No published exams found for this year.
                </p>
              ) : null}
            </div>
          </Field>

          <FieldRow columns={2}>
            <Field label="Scope">
              <Select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'section')}>
                <option value="all">All classes in the exam</option>
                <option value="section">One section only</option>
              </Select>
            </Field>
            {scope === 'section' ? (
              <Field label="Section" required error={errors.sectionId}>
                <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                  <option value="">Select a section</option>
                  {(sections.data ?? []).map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.class.name} {section.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </FieldRow>

          <Field label="Principal's remarks" error={errors.principalRemarks} help="Applied to every card">
            <Textarea
              rows={2}
              value={principalRemarks}
              onChange={(e) => setPrincipalRemarks(e.target.value)}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            Publish immediately so parents can see them
          </label>
        </>
      )}
    </FormModal>
  );
}

// ===========================================================================
// Configuration tab
// ===========================================================================

function ConfigTab({ exam }: { exam: ExamDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Examination" />
        <CardBody>
          <DetailList
            columns={1}
            items={[
              { label: 'Name', value: exam.name },
              { label: 'Code', value: exam.code },
              { label: 'Type', value: humanise(exam.type) },
              { label: 'Academic year', value: exam.academicYear.name },
              { label: 'Starts', value: formatDate(exam.startDate) },
              { label: 'Ends', value: formatDate(exam.endDate) },
              { label: 'Weightage', value: exam.weightage ? `${Number(exam.weightage)}%` : null },
              { label: 'Show rank on report card', value: exam.showRank ? 'Yes' : 'No' },
              { label: 'Result date', value: exam.resultDate ? formatDate(exam.resultDate) : null },
              { label: 'Description', value: exam.description },
              { label: 'Instructions', value: exam.instructions },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Grading scale"
          description={exam.gradeScale?.name ?? 'No grading scale attached'}
        />
        <CardBody className="p-0">
          {exam.gradeScale && exam.gradeScale.bands.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-sunken)] text-2xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Grade</th>
                  <th className="px-3 py-2 text-right">Range %</th>
                  <th className="px-3 py-2 text-right">Points</th>
                  <th className="px-3 py-2 text-left">Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {exam.gradeScale.bands.map((band) => (
                  <tr key={band.grade}>
                    <td className="px-3 py-2 font-medium">
                      {band.grade}
                      {!band.isPassing ? (
                        <span className="ml-1.5 text-2xs text-[var(--color-danger)]">fail</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right numeric">
                      {Number(band.minValue)}–{Number(band.maxValue)}
                    </td>
                    <td className="px-3 py-2 text-right numeric">
                      {band.gradePoint ? Number(band.gradePoint) : '—'}
                    </td>
                    <td className="px-3 py-2">{band.remark ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <EmptyState
                title="No grading scale"
                description="Attach a grading scale from Settings so marks resolve to grades."
              />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ===========================================================================
// Edit + publish dialogs
// ===========================================================================

const EXAM_TYPES = [
  'UNIT_TEST',
  'FORMATIVE',
  'SUMMATIVE',
  'MID_TERM',
  'FINAL',
  'PRE_BOARD',
  'CUSTOM',
];

function ExamEditDialog({ exam, onClose }: { exam: ExamDetail; onClose: () => void }) {
  const [name, setName] = React.useState(exam.name);
  const [type, setType] = React.useState(exam.type);
  const [description, setDescription] = React.useState(exam.description ?? '');
  const [startDate, setStartDate] = React.useState(exam.startDate.slice(0, 10));
  const [endDate, setEndDate] = React.useState(exam.endDate.slice(0, 10));
  const [weightage, setWeightage] = React.useState(
    exam.weightage != null ? String(Number(exam.weightage)) : '',
  );
  const [resultDate, setResultDate] = React.useState(exam.resultDate?.slice(0, 10) ?? '');
  const [showRank, setShowRank] = React.useState(exam.showRank);
  const [instructions, setInstructions] = React.useState(exam.instructions ?? '');

  const datesOk = Boolean(startDate) && Boolean(endDate) && endDate >= startDate;

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Edit examination"
      submitLabel="Save changes"
      values={{ name, type, description, startDate, endDate, weightage, resultDate, showRank, instructions }}
      isValid={name.trim().length > 0 && datesOk}
      successMessage="Examination updated"
      invalidates={EXAM_QUERIES}
      submit={(values) =>
        api.patch(`/exams/${exam.id}`, {
          name: values.name.trim(),
          type: values.type,
          description: values.description.trim() || undefined,
          startDate: values.startDate,
          endDate: values.endDate,
          weightage: values.weightage ? Number(values.weightage) : undefined,
          resultDate: values.resultDate || undefined,
          showRank: values.showRank,
          instructions: values.instructions.trim() || undefined,
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={2}>
            <Field label="Name" required error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="Type" required error={errors.type}>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {EXAM_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow columns={3}>
            <Field label="Starts" required error={errors.startDate}>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field
              label="Ends"
              required
              error={errors.endDate}
              help={endDate && !datesOk ? 'Must be on or after the start' : undefined}
            >
              <Input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
            <Field label="Weightage" error={errors.weightage} help="% of the term aggregate">
              <Input
                type="number"
                min={0}
                max={100}
                value={weightage}
                onChange={(e) => setWeightage(e.target.value)}
              />
            </Field>
          </FieldRow>
          <FieldRow columns={2}>
            <Field label="Result date" error={errors.resultDate}>
              <Input
                type="date"
                value={resultDate}
                onChange={(e) => setResultDate(e.target.value)}
              />
            </Field>
          </FieldRow>
          <Field label="Description" error={errors.description}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Instructions" error={errors.instructions} help="Printed on the hall ticket">
            <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showRank}
              onChange={(e) => setShowRank(e.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            Show class rank on the report card
          </label>
        </>
      )}
    </FormModal>
  );
}

function PublishDialog({
  examId,
  examName,
  onClose,
}: {
  examId: string;
  examName: string;
  onClose: () => void;
}) {
  const [resultDate, setResultDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [publishIncomplete, setPublishIncomplete] = React.useState(false);
  const [notify, setNotify] = React.useState(true);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Publish results"
      description={`${examName} — once published, marks lock and families can see their results.`}
      submitLabel="Publish results"
      values={{ resultDate, publishIncomplete, notify }}
      successMessage="Results published"
      invalidates={EXAM_QUERIES}
      submit={(values) =>
        api.post(`/exams/${examId}/publish`, {
          resultDate: values.resultDate,
          publishIncomplete: values.publishIncomplete,
          notify: values.notify,
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Result date" error={errors.resultDate}>
            <Input
              type="date"
              value={resultDate}
              onChange={(e) => setResultDate(e.target.value)}
              autoFocus
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            Notify students and parents
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-3.5 accent-[var(--color-accent)]"
              checked={publishIncomplete}
              onChange={(e) => setPublishIncomplete(e.target.checked)}
            />
            <span>
              Publish even though some subjects have incomplete marks
              <span className="block text-2xs text-[var(--color-ink-muted)]">
                Students with missing marks will see a gap on their report card.
              </span>
            </span>
          </label>
        </>
      )}
    </FormModal>
  );
}
