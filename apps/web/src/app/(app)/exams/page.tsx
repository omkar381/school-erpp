'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Lock, LockOpen, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/states';

interface ExamRow {
  id: string;
  name: string;
  code: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  weightage: string | null;
  resultDate: string | null;
  publishedAt: string | null;
  marksLocked: boolean;
  showRank: boolean;
  subjectCount?: number;
  classCount?: number;
  description?: string | null;
  instructions?: string | null;
}

const EXAM_TYPES = [
  'UNIT_TEST',
  'FORMATIVE',
  'SUMMATIVE',
  'MID_TERM',
  'FINAL',
  'PRE_BOARD',
  'CUSTOM',
];

const EXAM_STATUSES = ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'PUBLISHED', 'CANCELLED'];

const EXAM_QUERIES = [['exams']];

export default function ExamsPage() {
  const router = useRouter();
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('exams.update'),
  );
  const canCreate = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('exams.create'),
  );
  const canDelete = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('exams.delete'),
  );
  const canPublish = useAuthStore(
    (state) =>
      state.user?.isSuperAdmin || state.user?.permissions.includes('exams.publish_results'),
  );

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<ExamRow | null>(null);
  const [publishing, setPublishing] = React.useState<ExamRow | null>(null);
  const [deleting, setDeleting] = React.useState<ExamRow | null>(null);

  const list = useListQuery<ExamRow>('exams', '/exams', {
    initialSortBy: 'startDate',
    initialSortOrder: 'desc',
  });

  const toggleLock = useAction({
    mutationFn: (row: ExamRow) => api.patch(`/exams/${row.id}/lock`, { locked: !row.marksLocked }),
    successMessage: 'Marks lock updated',
    invalidates: EXAM_QUERIES,
  });

  const removeExam = useAction({
    mutationFn: (row: ExamRow) => api.delete(`/exams/${row.id}`),
    successMessage: 'Examination deleted',
    invalidates: EXAM_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  const columns: Column<ExamRow>[] = [
    {
      key: 'name',
      header: 'Examination',
      sortable: true,
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.name}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.code} · {humanise(row.type)}
          </span>
        </span>
      ),
    },
    {
      key: 'startDate',
      header: 'Dates',
      sortable: true,
      cell: (row) => (
        <span>
          {formatDate(row.startDate)} – {formatDate(row.endDate)}
        </span>
      ),
    },
    {
      key: 'weightage',
      header: 'Weightage',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (row.weightage ? `${Number(row.weightage)}%` : '—'),
    },
    {
      key: 'marks',
      header: 'Marks',
      cell: (row) =>
        // Locked means marks are final; the correction workflow is the only
        // way back in, which is worth flagging in the list.
        row.marksLocked ? (
          <Badge tone="warning">
            <Lock className="size-2.5" aria-hidden />
            Locked
          </Badge>
        ) : (
          <Badge>Open</Badge>
        ),
    },
    {
      key: 'results',
      header: 'Results',
      cell: (row) =>
        row.publishedAt ? (
          <Badge tone="success">Published</Badge>
        ) : row.resultDate ? (
          <Badge tone="info">Due {formatDate(row.resultDate)}</Badge>
        ) : (
          <span className="text-[var(--color-ink-faint)]">—</span>
        ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  if (canManage || canDelete || canPublish) {
    columns.push({
      key: 'actions',
      header: '',
      width: '1%',
      cell: (row) => (
        <div
          className="flex items-center justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {canPublish && !row.publishedAt ? (
            <Button
              size="xs"
              variant="ghost"
              icon={<Send />}
              onClick={() => setPublishing(row)}
            >
              Publish
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                icon={row.marksLocked ? <LockOpen /> : <Lock />}
                aria-label={row.marksLocked ? `Unlock marks for ${row.name}` : `Lock marks for ${row.name}`}
                loading={toggleLock.isPending}
                onClick={() => toggleLock.mutate(row)}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                icon={<Pencil />}
                aria-label={`Edit ${row.name}`}
                onClick={() => setEditing(row)}
              />
            </>
          ) : null}
          {canDelete ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 />}
              aria-label={`Delete ${row.name}`}
              onClick={() => setDeleting(row)}
            />
          ) : null}
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Examinations"
        description="Exam schedule, marks entry status and result publication."
        actions={
          canCreate ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Schedule exam
            </Button>
          ) : null
        }
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search examinations"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Type"
          value={list.state.filters.type}
          onChange={(value) => list.setFilter('type', value)}
          options={EXAM_TYPES.map((type) => ({ value: type, label: humanise(type) }))}
        />
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={EXAM_STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        onRowClick={(row) => router.push(`/exams/${row.id}`)}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        meta={list.meta}
        onPageChange={list.setPage}
        sortBy={list.state.sortBy}
        sortOrder={list.state.sortOrder}
        onSortChange={list.setSort}
        empty={
          <EmptyState
            icon={<BookOpen />}
            title="No examinations match these filters"
            description="Scheduled exams appear here with their marks and result status."
            action={
              canCreate && list.activeFilterCount === 0 ? (
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                  Schedule exam
                </Button>
              ) : null
            }
          />
        }
      />

      {creating ? (
        <ExamFormDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/exams/${id}`)}
        />
      ) : null}
      {editing ? <ExamFormDialog exam={editing} onClose={() => setEditing(null)} /> : null}
      {publishing ? (
        <PublishResultsDialog exam={publishing} onClose={() => setPublishing(null)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this examination?"
        description={
          deleting
            ? `"${deleting.name}" will be removed, along with its schedule and any marks entered against it.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={removeExam.isPending}
        onConfirm={() => deleting && removeExam.mutate(deleting)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Schedule and edit
// ---------------------------------------------------------------------------

function ExamFormDialog({
  exam,
  onClose,
  onCreated,
}: {
  exam?: ExamRow;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const isEdit = Boolean(exam);

  const [name, setName] = React.useState(exam?.name ?? '');
  const [code, setCode] = React.useState(exam?.code ?? '');
  const [type, setType] = React.useState(exam?.type ?? 'UNIT_TEST');
  const [description, setDescription] = React.useState(exam?.description ?? '');
  const [startDate, setStartDate] = React.useState(exam?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = React.useState(exam?.endDate?.slice(0, 10) ?? '');
  const [weightage, setWeightage] = React.useState(
    exam?.weightage != null ? String(Number(exam.weightage)) : '',
  );
  const [showRank, setShowRank] = React.useState(exam?.showRank ?? true);
  const [instructions, setInstructions] = React.useState(exam?.instructions ?? '');

  const datesOk = Boolean(startDate) && Boolean(endDate) && endDate >= startDate;

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={isEdit ? 'Edit examination' : 'Schedule an examination'}
      description="Add the per-subject timetable and classes once the exam exists."
      submitLabel={isEdit ? 'Save changes' : 'Schedule exam'}
      values={{
        name,
        code,
        type,
        description,
        startDate,
        endDate,
        weightage,
        showRank,
        instructions,
      }}
      isValid={name.trim().length > 0 && (isEdit || code.trim().length > 0) && datesOk}
      successMessage={isEdit ? 'Examination updated' : 'Examination scheduled'}
      invalidates={EXAM_QUERIES}
      onSaved={(result: { id?: string }) => {
        if (!isEdit && result?.id && onCreated) onCreated(result.id);
      }}
      submit={(values) => {
        const common = {
          name: values.name.trim(),
          type: values.type,
          ...(values.description.trim() ? { description: values.description.trim() } : {}),
          startDate: values.startDate,
          endDate: values.endDate,
          ...(values.weightage ? { weightage: Number(values.weightage) } : {}),
          showRank: values.showRank,
          ...(values.instructions.trim() ? { instructions: values.instructions.trim() } : {}),
        };

        return isEdit
          ? api.patch(`/exams/${exam!.id}`, common)
          : api.post('/exams', { ...common, code: values.code.trim() });
      }}
    >
      {(errors) => (
        <>
          <FieldRow columns={3}>
            <Field label="Name" required error={errors.name}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mid Term Examination"
                autoFocus
              />
            </Field>
            {!isEdit ? (
              <Field label="Code" required error={errors.code} help="Short, unique per year">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="MID"
                />
              </Field>
            ) : null}
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
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!endDate) setEndDate(e.target.value);
                }}
              />
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
            <Field
              label="Weightage"
              error={errors.weightage}
              help="Percentage of the term aggregate"
            >
              <Input
                type="number"
                min={0}
                max={100}
                value={weightage}
                onChange={(e) => setWeightage(e.target.value)}
              />
            </Field>
          </FieldRow>

          <Field label="Description" error={errors.description}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <Field label="Instructions" error={errors.instructions} help="Printed on the hall ticket">
            <Textarea
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </Field>

          <label className="flex items-center gap-2 pt-1 text-sm">
            <input
              type="checkbox"
              checked={showRank}
              onChange={(e) => setShowRank(e.target.checked)}
            />
            Show class rank on the report card
          </label>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Publishing results
// ---------------------------------------------------------------------------

function PublishResultsDialog({ exam, onClose }: { exam: ExamRow; onClose: () => void }) {
  const [resultDate, setResultDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [publishIncomplete, setPublishIncomplete] = React.useState(false);
  const [notify, setNotify] = React.useState(true);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Publish results"
      description={`${exam.name} — once published, students and parents can see their marks.`}
      submitLabel="Publish results"
      values={{ resultDate, publishIncomplete, notify }}
      successMessage="Results published"
      invalidates={EXAM_QUERIES}
      submit={(values) =>
        api.post(`/exams/${exam.id}/publish`, {
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
            />
            Notify students and parents
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
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
