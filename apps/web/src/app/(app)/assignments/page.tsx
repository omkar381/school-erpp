'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus, Send } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useClasses, useSections, useSubjects } from '@/hooks/use-lookups';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate, formatDateTime } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, Drawer } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

const STATUSES = ['DRAFT', 'ASSIGNED', 'CLOSED'];

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  ASSIGNED: 'info',
  CLOSED: 'success',
};

interface AssignmentRow {
  id: string;
  title: string;
  maxMarks: string;
  weightage: string | null;
  startDate: string;
  dueDate: string;
  status: string;
  allowLate: boolean;
  latePenaltyPercent: string | null;
  submissionCount: number;
  attachmentCount: number;
  isOpen: boolean;
  subject: { id: string; name: string; code: string; colorHex: string | null } | null;
  class: { id: string; name: string } | null;
  section: { id: string; name: string } | null;
  staff: { id: string; firstName: string; lastName: string | null } | null;
}

interface Submission {
  id: string;
  status: string;
  isLate: boolean;
  submittedAt: string | null;
  content: string | null;
  marksAwarded: string | null;
  grade: string | null;
  feedback: string | null;
  student: {
    id: string;
    firstName: string;
    lastName: string | null;
    admissionNumber: string;
  } | null;
}

interface AssignmentDetail extends AssignmentRow {
  description: string;
  instructions: string | null;
  submissions: Submission[];
  stats: {
    submitted: number;
    graded: number;
    late: number;
    averageMarks: number | null;
    highestMarks: number | null;
    lowestMarks: number | null;
  };
}

export default function AssignmentsPage() {
  const user = useAuthStore((state) => state.user);
  // The server only lets teaching staff set work, so an administrator who
  // holds the permission but has no staff record is not offered the button —
  // otherwise it would open a form that can only end in a 403.
  const canCreate = Boolean(user?.permissions.includes('assignments.create') && user?.staffId);
  const canGrade = Boolean(user?.permissions.includes('assignments.grade') && user?.staffId);
  const isStudent = Boolean(user?.studentId);

  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const list = useListQuery<AssignmentRow>('assignments', '/assignments', {
    initialSortOrder: 'desc',
  });

  const { data: classes } = useClasses();
  const { data: sections } = useSections(list.state.filters.classId);
  const { data: subjects } = useSubjects();

  const columns: Column<AssignmentRow>[] = [
    {
      key: 'title',
      header: 'Assignment',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: row.subject?.colorHex ?? 'var(--color-ink-faint)' }}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.title}</span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.subject?.name ?? '—'}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'class',
      header: 'Class',
      hideOnMobile: true,
      cell: (row) =>
        row.class ? `${row.class.name}${row.section ? ` ${row.section.name}` : ''}` : '—',
    },
    {
      key: 'dueDate',
      header: 'Due',
      sortable: true,
      cell: (row) => (
        <span
          className={
            row.isOpen && new Date(row.dueDate) < new Date()
              ? 'text-[var(--color-danger)]'
              : undefined
          }
        >
          {formatDate(row.dueDate)}
        </span>
      ),
    },
    {
      key: 'maxMarks',
      header: 'Marks',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => row.maxMarks,
    },
    {
      key: 'submissionCount',
      header: 'Submitted',
      numeric: true,
      cell: (row) => row.submissionCount,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <span className="flex items-center gap-1">
          <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{humanise(row.status)}</Badge>
          {row.allowLate ? <Badge>Late ok</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Assignments"
        description={
          isStudent
            ? 'Work set for your class, and what you have handed in.'
            : 'Set work, track what has come in and grade it.'
        }
        actions={
          canCreate ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              New assignment
            </Button>
          ) : null
        }
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by title"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Class"
          value={list.state.filters.classId}
          onChange={(value) => list.setFilter('classId', value)}
          options={(classes ?? []).map((klass) => ({ value: klass.id, label: klass.name }))}
        />
        <FilterSelect
          label="Section"
          value={list.state.filters.sectionId}
          onChange={(value) => list.setFilter('sectionId', value)}
          options={(sections ?? []).map((section) => ({
            value: section.id,
            // Sections are only named "A", "B" and so on, so without a class
            // chosen the list would be a column of indistinguishable letters.
            label: list.state.filters.classId
              ? section.name
              : `${section.class.name} ${section.name}`,
          }))}
        />
        <FilterSelect
          label="Subject"
          value={list.state.filters.subjectId}
          onChange={(value) => list.setFilter('subjectId', value)}
          options={(subjects ?? []).map((subject) => ({
            value: subject.id,
            label: subject.name,
          }))}
        />
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        meta={list.meta}
        onPageChange={list.setPage}
        sortBy={list.state.sortBy}
        sortOrder={list.state.sortOrder}
        onSortChange={list.setSort}
        onRowClick={(row) => setOpenId(row.id)}
        empty={
          <EmptyState
            icon={<ClipboardList />}
            title={
              list.activeFilterCount > 0 ? 'No assignments match these filters' : 'No assignments yet'
            }
            description={
              isStudent
                ? 'Work set by your teachers will appear here.'
                : 'Set the first piece of work for a section.'
            }
            action={
              canCreate && list.activeFilterCount === 0 ? (
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                  New assignment
                </Button>
              ) : null
            }
          />
        }
      />

      {creating ? <CreateAssignmentDialog onClose={() => setCreating(false)} /> : null}
      {openId ? (
        <AssignmentDrawer
          id={openId}
          canGrade={canGrade}
          isStudent={isStudent}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreateAssignmentDialog({ onClose }: { onClose: () => void }) {
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [subjectId, setSubjectId] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [instructions, setInstructions] = React.useState('');
  const [maxMarks, setMaxMarks] = React.useState('100');
  const [weightage, setWeightage] = React.useState('');
  const [startDate, setStartDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = React.useState('');
  const [allowLate, setAllowLate] = React.useState(false);
  const [latePenaltyPercent, setLatePenaltyPercent] = React.useState('10');
  const [publish, setPublish] = React.useState(true);

  const { data: classes } = useClasses();
  const { data: sections } = useSections(classId || undefined);
  const { data: subjects } = useSubjects();

  const datesValid = Boolean(dueDate && (!startDate || startDate <= dueDate));

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="New assignment"
      description="Published work is visible to the section immediately."
      submitLabel={publish ? 'Publish assignment' : 'Save as draft'}
      values={{
        sectionId,
        subjectId,
        title,
        description,
        instructions,
        maxMarks,
        weightage,
        startDate,
        dueDate,
        allowLate,
        latePenaltyPercent,
        publish,
      }}
      isValid={
        sectionId !== '' &&
        subjectId !== '' &&
        title.trim().length > 0 &&
        description.trim().length > 0 &&
        datesValid
      }
      successMessage={publish ? 'Assignment published' : 'Draft saved'}
      invalidates={[['assignments']]}
      submit={(values) =>
        api.post('/assignments', {
          sectionId: values.sectionId,
          subjectId: values.subjectId,
          title: values.title.trim(),
          description: values.description.trim(),
          ...(values.instructions.trim() ? { instructions: values.instructions.trim() } : {}),
          ...(values.maxMarks ? { maxMarks: Number(values.maxMarks) } : {}),
          ...(values.weightage ? { weightage: Number(values.weightage) } : {}),
          ...(values.startDate ? { startDate: values.startDate } : {}),
          dueDate: values.dueDate,
          allowLate: values.allowLate,
          ...(values.allowLate && values.latePenaltyPercent
            ? { latePenaltyPercent: Number(values.latePenaltyPercent) }
            : {}),
          publish: values.publish,
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={3}>
            <Field label="Class" required>
              <Select
                value={classId}
                onChange={(event) => {
                  setClassId(event.target.value);
                  setSectionId('');
                }}
              >
                <option value="">Select</option>
                {(classes ?? []).map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Section" required error={errors.sectionId}>
              <Select
                value={sectionId}
                onChange={(event) => setSectionId(event.target.value)}
                disabled={!classId}
              >
                <option value="">{classId ? 'Select' : 'Choose a class first'}</option>
                {(sections ?? []).map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subject" required error={errors.subjectId}>
              <Select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                <option value="">Select</option>
                {(subjects ?? []).map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <Field label="Title" required error={errors.title}>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Chapter 4 problem set"
            />
          </Field>

          <Field label="Description" required error={errors.description}>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What the students have to do"
            />
          </Field>

          <Field label="Instructions" error={errors.instructions} help="Optional, shown below the description">
            <Textarea
              rows={2}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </Field>

          <FieldRow columns={4}>
            <Field label="Max marks" error={errors.maxMarks}>
              <Input
                type="number"
                min="1"
                step="0.5"
                inputMode="decimal"
                value={maxMarks}
                onChange={(event) => setMaxMarks(event.target.value)}
                className="text-right tabular"
              />
            </Field>
            <Field label="Weightage %" error={errors.weightage} help="Toward the term grade">
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                inputMode="decimal"
                value={weightage}
                onChange={(event) => setWeightage(event.target.value)}
                placeholder="Optional"
                className="text-right tabular"
              />
            </Field>
            <Field label="Starts" error={errors.startDate}>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field
              label="Due"
              required
              error={
                errors.dueDate ??
                (startDate && dueDate && startDate > dueDate
                  ? 'Due date must fall on or after the start'
                  : undefined)
              }
            >
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>
          </FieldRow>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={allowLate}
                onChange={(event) => setAllowLate(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Accept submissions after the due date
            </label>

            {allowLate ? (
              <Field label="Late penalty %" help="Deducted from the marks awarded">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  inputMode="numeric"
                  value={latePenaltyPercent}
                  onChange={(event) => setLatePenaltyPercent(event.target.value)}
                  className="w-24 text-right tabular"
                />
              </Field>
            ) : null}

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={publish}
                onChange={(event) => setPublish(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Publish now — students see it immediately
            </label>
          </div>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Detail, submission and grading
// ---------------------------------------------------------------------------

function AssignmentDrawer({
  id,
  canGrade,
  isStudent,
  onClose,
}: {
  id: string;
  canGrade: boolean;
  isStudent: boolean;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ['assignments', 'detail', id],
    queryFn: () => api.get<AssignmentDetail>(`/assignments/${id}`),
  });

  const assignment = detail.data;

  const publish = useAction({
    mutationFn: () => api.patch(`/assignments/${id}`, { publish: true }),
    successMessage: 'Assignment published',
    invalidates: [['assignments']],
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Drawer
        width="lg"
        title={assignment ? assignment.title : 'Assignment'}
        description={
          assignment
            ? `${assignment.subject?.name ?? ''} · ${assignment.class?.name ?? ''} ${assignment.section?.name ?? ''} · due ${formatDate(assignment.dueDate)}`
            : undefined
        }
        footer={
          assignment && canGrade && assignment.status === 'DRAFT' ? (
            <Button
              size="sm"
              variant="primary"
              loading={publish.isPending}
              onClick={() => publish.mutate(undefined)}
            >
              Publish to students
            </Button>
          ) : null
        }
      >
        {detail.isLoading ? (
          <LoadingState label="Loading assignment" />
        ) : detail.error ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        ) : assignment ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[assignment.status] ?? 'neutral'}>
                {humanise(assignment.status)}
              </Badge>
              <span className="text-2xs text-[var(--color-ink-muted)]">
                {assignment.maxMarks} marks
                {assignment.weightage ? ` · ${assignment.weightage}% weightage` : ''}
              </span>
              {assignment.allowLate ? (
                <Badge>
                  Late accepted
                  {assignment.latePenaltyPercent ? ` (−${assignment.latePenaltyPercent}%)` : ''}
                </Badge>
              ) : null}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium">Brief</p>
              <p className="whitespace-pre-wrap text-xs text-[var(--color-ink-secondary)]">
                {assignment.description}
              </p>
              {assignment.instructions ? (
                <p className="mt-2 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2 text-2xs text-[var(--color-ink-secondary)]">
                  {assignment.instructions}
                </p>
              ) : null}
            </div>

            {assignment.stats ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {[
                  ['Submitted', assignment.stats.submitted],
                  ['Graded', assignment.stats.graded],
                  ['Late', assignment.stats.late],
                  ['Average', assignment.stats.averageMarks ?? '—'],
                  ['Highest', assignment.stats.highestMarks ?? '—'],
                  ['Lowest', assignment.stats.lowestMarks ?? '—'],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 py-1.5"
                  >
                    <p className="text-2xs text-[var(--color-ink-muted)]">{String(label)}</p>
                    <p className="text-sm font-semibold tabular">{String(value)}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {isStudent ? (
              <SubmitPanel assignmentId={assignment.id} submissions={assignment.submissions} />
            ) : null}

            <div>
              <p className="mb-1.5 text-xs font-medium">
                Submissions ({assignment.submissions.length})
              </p>
              {assignment.submissions.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-3 text-2xs text-[var(--color-ink-muted)]">
                  Nothing handed in yet.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-sm)] border border-[var(--color-border)]">
                  {assignment.submissions.map((submission) => (
                    <SubmissionRow
                      key={submission.id}
                      submission={submission}
                      maxMarks={assignment.maxMarks}
                      canGrade={canGrade}
                      assignmentId={assignment.id}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </Dialog>
  );
}

function SubmitPanel({
  assignmentId,
  submissions,
}: {
  assignmentId: string;
  submissions: Submission[];
}) {
  const studentId = useAuthStore((state) => state.user?.studentId);
  const mine = submissions.find((submission) => submission.student?.id === studentId);

  const [content, setContent] = React.useState('');

  const submit = useAction({
    mutationFn: () => api.post(`/assignments/${assignmentId}/submit`, { content: content.trim() }),
    successMessage: 'Submitted',
    invalidates: [['assignments']],
    onSuccess: () => setContent(''),
  });

  if (mine) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-success-border)] bg-[var(--color-success-soft)] px-3 py-2">
        <p className="text-xs font-medium text-[var(--color-success)]">
          Handed in{mine.submittedAt ? ` on ${formatDateTime(mine.submittedAt)}` : ''}
          {mine.isLate ? ' (late)' : ''}
        </p>
        {mine.marksAwarded !== null ? (
          <p className="mt-0.5 text-2xs text-[var(--color-ink-secondary)]">
            Marked {mine.marksAwarded}
            {mine.grade ? ` · grade ${mine.grade}` : ''}
            {mine.feedback ? ` — ${mine.feedback}` : ''}
          </p>
        ) : (
          <p className="mt-0.5 text-2xs text-[var(--color-ink-secondary)]">Not marked yet.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
      <p className="text-xs font-medium">Your submission</p>
      <Textarea
        rows={4}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Type your answer, or describe the work you are handing in."
      />
      <Button
        size="sm"
        variant="primary"
        icon={<Send />}
        loading={submit.isPending}
        disabled={content.trim().length === 0}
        onClick={() => submit.mutate(undefined)}
      >
        Hand in
      </Button>
    </div>
  );
}

function SubmissionRow({
  submission,
  maxMarks,
  canGrade,
  assignmentId,
}: {
  submission: Submission;
  maxMarks: string;
  canGrade: boolean;
  assignmentId: string;
}) {
  const [grading, setGrading] = React.useState(false);
  const [marks, setMarks] = React.useState(submission.marksAwarded ?? '');
  const [grade, setGrade] = React.useState(submission.grade ?? '');
  const [feedback, setFeedback] = React.useState(submission.feedback ?? '');

  const name = submission.student
    ? [submission.student.firstName, submission.student.lastName].filter(Boolean).join(' ')
    : 'Unknown student';

  const save = useAction({
    mutationFn: () =>
      api.patch(`/assignments/submissions/${submission.id}/grade`, {
        marksAwarded: Number(marks),
        ...(grade.trim() ? { grade: grade.trim() } : {}),
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
      }),
    successMessage: 'Graded',
    invalidates: [['assignments', 'detail', assignmentId], ['assignments']],
    onSuccess: () => setGrading(false),
  });

  const marksValue = Number(marks);
  const marksValid =
    marks !== '' && Number.isFinite(marksValue) && marksValue >= 0 && marksValue <= Number(maxMarks);

  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{name}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {submission.student?.admissionNumber}
            {submission.submittedAt ? ` · ${formatDateTime(submission.submittedAt)}` : ''}
          </span>
        </span>
        {submission.isLate ? <Badge tone="warning">Late</Badge> : null}
        {submission.marksAwarded !== null ? (
          <Badge tone="success">
            {submission.marksAwarded}/{maxMarks}
          </Badge>
        ) : (
          <Badge>{humanise(submission.status)}</Badge>
        )}
        {canGrade ? (
          <Button size="sm" variant="ghost" onClick={() => setGrading((value) => !value)}>
            {grading ? 'Cancel' : submission.marksAwarded !== null ? 'Regrade' : 'Grade'}
          </Button>
        ) : null}
      </div>

      {submission.content ? (
        <p className="mt-1.5 whitespace-pre-wrap rounded-[var(--radius-xs)] bg-[var(--color-surface-sunken)] px-2 py-1.5 text-2xs text-[var(--color-ink-secondary)]">
          {submission.content}
        </p>
      ) : null}

      {grading ? (
        <div className="mt-2 space-y-2">
          <FieldRow columns={3}>
            <Field
              label={`Marks (of ${maxMarks})`}
              required
              error={
                marks !== '' && !marksValid ? `Enter a number between 0 and ${maxMarks}` : undefined
              }
            >
              <Input
                type="number"
                min="0"
                max={maxMarks}
                step="0.5"
                inputMode="decimal"
                value={marks}
                onChange={(event) => setMarks(event.target.value)}
                className="text-right tabular"
              />
            </Field>
            <Field label="Grade">
              <Input
                value={grade}
                onChange={(event) => setGrade(event.target.value)}
                placeholder="A"
                maxLength={5}
              />
            </Field>
          </FieldRow>
          <Field label="Feedback">
            <Textarea
              rows={2}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </Field>
          <Button
            size="sm"
            variant="primary"
            loading={save.isPending}
            disabled={!marksValid}
            onClick={() => save.mutate(undefined)}
          >
            Save grade
          </Button>
        </div>
      ) : null}
    </li>
  );
}
