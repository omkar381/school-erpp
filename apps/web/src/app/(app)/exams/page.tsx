'use client';

import { BookOpen, Lock } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
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

export default function ExamsPage() {
  const list = useListQuery<ExamRow>('exams', '/exams', {
    initialSortBy: 'startDate',
    initialSortOrder: 'desc',
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

  return (
    <>
      <PageHeader
        title="Examinations"
        description="Exam schedule, marks entry status and result publication."
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
          />
        }
      />
    </>
  );
}
