'use client';

import * as React from 'react';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { PRIORITIES, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { useClasses, useSections, useSubjects } from '@/hooks/use-lookups';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/states';

interface HomeworkRow {
  id: string;
  title: string;
  description: string;
  assignedDate: string;
  dueDate: string;
  priority: string;
  status: string;
  submissionCount?: number;
  totalStudents?: number;
  subject: { id: string; name: string } | null;
  class: { id: string; name: string } | null;
  section: { id: string; name: string } | null;
  staff: { id: string; firstName: string; lastName: string | null } | null;
  maxMarks?: number | null;
  allowLate?: boolean;
}

const HOMEWORK_QUERIES = [['homework']];

export default function HomeworkPage() {
  // Homework belongs to a teacher: the API refuses anyone without a staff
  // record, so an administrator who merely holds the permission must not be
  // offered a button that would 403.
  const canManage = useAuthStore(
    (state) =>
      Boolean(state.user?.staffId) &&
      (state.user?.isSuperAdmin || state.user?.permissions.includes('homework.create')),
  );
  const canDelete = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('homework.delete'),
  );

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<HomeworkRow | null>(null);
  const [deleting, setDeleting] = React.useState<HomeworkRow | null>(null);

  const list = useListQuery<HomeworkRow>('homework', '/homework', {
    initialSortBy: 'dueDate',
    initialSortOrder: 'desc',
  });

  const removeHomework = useAction({
    mutationFn: (row: HomeworkRow) => api.delete(`/homework/${row.id}`),
    successMessage: 'Homework deleted',
    invalidates: HOMEWORK_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  const { data: classes } = useClasses();
  const { data: sections } = useSections(list.state.filters.classId);
  const { data: subjects } = useSubjects();

  const columns: Column<HomeworkRow>[] = [
    {
      key: 'title',
      header: 'Homework',
      sortable: true,
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.title}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.subject?.name ?? ''}
            {row.staff ? ` · ${row.staff.firstName} ${row.staff.lastName ?? ''}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'class',
      header: 'Class',
      cell: (row) => `${row.class?.name ?? '—'} ${row.section?.name ?? ''}`.trim(),
    },
    {
      key: 'assignedDate',
      header: 'Assigned',
      hideOnMobile: true,
      cell: (row) => formatDate(row.assignedDate),
    },
    {
      key: 'dueDate',
      header: 'Due',
      sortable: true,
      cell: (row) => {
        // Past due and still open is the state a teacher needs to spot.
        const overdue = new Date(row.dueDate) < new Date() && row.status !== 'COMPLETED';
        return (
          <span className={overdue ? 'text-[var(--color-warning)]' : undefined}>
            {formatDate(row.dueDate)}
          </span>
        );
      },
    },
    {
      key: 'submissions',
      header: 'Submitted',
      numeric: true,
      cell: (row) =>
        row.totalStudents
          ? `${row.submissionCount ?? 0} / ${row.totalStudents}`
          : (row.submissionCount ?? 0),
    },
    {
      key: 'priority',
      header: 'Priority',
      hideOnMobile: true,
      cell: (row) =>
        row.priority === 'NORMAL' ? (
          <span className="text-[var(--color-ink-faint)]">—</span>
        ) : (
          <StatusBadge status={row.priority} />
        ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  if (canManage || canDelete) {
    columns.push({
      key: 'actions',
      header: '',
      width: '1%',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {canManage ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<Pencil />}
              aria-label={`Edit ${row.title}`}
              onClick={() => setEditing(row)}
            />
          ) : null}
          {canDelete ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 />}
              aria-label={`Delete ${row.title}`}
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
        title="Homework"
        description="What has been set, when it is due and how much has come back."
        actions={
          canManage ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Set homework
            </Button>
          ) : null
        }
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search homework"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Class"
          value={list.state.filters.classId}
          onChange={(value) => {
            list.setFilter('classId', value);
            list.setFilter('sectionId', undefined);
          }}
          options={(classes ?? []).map((klass) => ({ value: klass.id, label: klass.name }))}
        />
        {list.state.filters.classId ? (
          <FilterSelect
            label="Section"
            value={list.state.filters.sectionId}
            onChange={(value) => list.setFilter('sectionId', value)}
            options={(sections ?? []).map((section) => ({
              value: section.id,
              label: `Section ${section.name}`,
            }))}
          />
        ) : null}
        <FilterSelect
          label="Subject"
          value={list.state.filters.subjectId}
          onChange={(value) => list.setFilter('subjectId', value)}
          options={(subjects ?? []).map((subject) => ({ value: subject.id, label: subject.name }))}
        />
        <FilterSelect
          label="Priority"
          value={list.state.filters.priority}
          onChange={(value) => list.setFilter('priority', value)}
          options={PRIORITIES.map((priority) => ({ value: priority, label: humanise(priority) }))}
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
        empty={
          <EmptyState
            icon={<FileText />}
            title="No homework matches these filters"
            description="Homework set by teachers appears here."
            action={
              canManage && list.activeFilterCount === 0 ? (
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                  Set homework
                </Button>
              ) : null
            }
          />
        }
      />

      {creating ? <HomeworkFormDialog onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <HomeworkFormDialog homework={editing} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this homework?"
        description={
          deleting
            ? `"${deleting.title}" will be removed, along with any submissions against it.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={removeHomework.isPending}
        onConfirm={() => deleting && removeHomework.mutate(deleting)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Set and edit
// ---------------------------------------------------------------------------

function HomeworkFormDialog({
  homework,
  onClose,
}: {
  homework?: HomeworkRow;
  onClose: () => void;
}) {
  const isEdit = Boolean(homework);
  const today = new Date().toISOString().slice(0, 10);

  const [classId, setClassId] = React.useState(homework?.class?.id ?? '');
  const [sectionId, setSectionId] = React.useState(homework?.section?.id ?? '');
  const [subjectId, setSubjectId] = React.useState(homework?.subject?.id ?? '');
  const [title, setTitle] = React.useState(homework?.title ?? '');
  const [description, setDescription] = React.useState(homework?.description ?? '');
  const [assignedDate, setAssignedDate] = React.useState(
    homework?.assignedDate?.slice(0, 10) ?? today,
  );
  const [dueDate, setDueDate] = React.useState(homework?.dueDate?.slice(0, 10) ?? '');
  const [priority, setPriority] = React.useState(homework?.priority ?? 'NORMAL');
  const [maxMarks, setMaxMarks] = React.useState(
    homework?.maxMarks != null ? String(homework.maxMarks) : '',
  );
  const [allowLate, setAllowLate] = React.useState(homework?.allowLate ?? true);
  const [notifyParents, setNotifyParents] = React.useState(true);
  const [publish, setPublish] = React.useState(true);

  const { data: classes } = useClasses();
  const { data: sections } = useSections(classId || undefined);
  const { data: subjects } = useSubjects();

  // Homework due before it was set cannot be met, so the form refuses it.
  const datesOk = Boolean(dueDate) && dueDate >= assignedDate;

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={isEdit ? 'Edit homework' : 'Set homework'}
      description={
        isEdit
          ? 'Students already assigned this keep it; the details update for them.'
          : 'Pick the section and subject; every student enrolled in it is assigned.'
      }
      submitLabel={isEdit ? 'Save changes' : 'Set homework'}
      values={{
        classId,
        sectionId,
        subjectId,
        title,
        description,
        assignedDate,
        dueDate,
        priority,
        maxMarks,
        allowLate,
        notifyParents,
        publish,
      }}
      isValid={
        title.trim().length > 0 &&
        description.trim().length > 0 &&
        datesOk &&
        (isEdit || (Boolean(sectionId) && Boolean(subjectId)))
      }
      successMessage={isEdit ? 'Homework updated' : 'Homework set'}
      invalidates={HOMEWORK_QUERIES}
      submit={(values) => {
        const common = {
          title: values.title.trim(),
          description: values.description.trim(),
          dueDate: values.dueDate,
          priority: values.priority,
          ...(values.maxMarks ? { maxMarks: Number(values.maxMarks) } : {}),
          allowLate: values.allowLate,
        };

        return isEdit
          ? api.patch(`/homework/${homework!.id}`, common)
          : api.post('/homework', {
              ...common,
              sectionId: values.sectionId,
              subjectId: values.subjectId,
              assignedDate: values.assignedDate,
              notifyParents: values.notifyParents,
              publish: values.publish,
            });
      }}
    >
      {(errors) => (
        <>
          {!isEdit ? (
            <FieldRow columns={3}>
              <Field label="Class" required error={errors.classId}>
                <Select
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setSectionId('');
                  }}
                  autoFocus
                >
                  <option value="">Choose a class</option>
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
                  onChange={(e) => setSectionId(e.target.value)}
                  disabled={!classId}
                >
                  <option value="">Choose a section</option>
                  {(sections ?? []).map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.class.name} {section.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Subject" required error={errors.subjectId}>
                <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">Choose a subject</option>
                  {(subjects ?? []).map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
          ) : null}

          <Field label="Title" required error={errors.title}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Exercise 4.2 — Linear Equations"
              autoFocus={isEdit}
            />
          </Field>

          <Field label="Instructions" required error={errors.description}>
            <Textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <FieldRow columns={4}>
            {!isEdit ? (
              <Field label="Assigned on" error={errors.assignedDate}>
                <Input
                  type="date"
                  value={assignedDate}
                  onChange={(e) => setAssignedDate(e.target.value)}
                />
              </Field>
            ) : null}
            <Field
              label="Due on"
              required
              error={errors.dueDate}
              help={dueDate && !datesOk ? 'Must be on or after the assigned date' : undefined}
            >
              <Input
                type="date"
                value={dueDate}
                min={assignedDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
            <Field label="Priority" error={errors.priority}>
              <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Maximum marks" error={errors.maxMarks} help="Leave blank if ungraded">
              <Input
                type="number"
                min={0}
                value={maxMarks}
                onChange={(e) => setMaxMarks(e.target.value)}
              />
            </Field>
          </FieldRow>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowLate}
                onChange={(e) => setAllowLate(e.target.checked)}
              />
              Accept late submissions
            </label>
            {!isEdit ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={notifyParents}
                    onChange={(e) => setNotifyParents(e.target.checked)}
                  />
                  Notify parents
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={publish}
                    onChange={(e) => setPublish(e.target.checked)}
                  />
                  Publish now
                </label>
              </>
            ) : null}
          </div>
        </>
      )}
    </FormModal>
  );
}
