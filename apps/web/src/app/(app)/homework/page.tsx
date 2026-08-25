'use client';

import { FileText } from 'lucide-react';
import { PRIORITIES, humanise } from '@erp/shared-types';
import { useListQuery } from '@/hooks/use-list-query';
import { useClasses, useSections, useSubjects } from '@/hooks/use-lookups';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
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
}

export default function HomeworkPage() {
  const list = useListQuery<HomeworkRow>('homework', '/homework', {
    initialSortBy: 'dueDate',
    initialSortOrder: 'desc',
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

  return (
    <>
      <PageHeader
        title="Homework"
        description="What has been set, when it is due and how much has come back."
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
          />
        }
      />
    </>
  );
}
