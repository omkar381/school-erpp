'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LifeBuoy } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { useListQuery } from '@/hooks/use-list-query';
import { formatAgo, formatDate } from '@/lib/dates';
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  fullName,
  type TicketRow,
} from '@/lib/platform';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { EmptyState } from '@/components/ui/states';

export function priorityTone(priority: string): 'neutral' | 'info' | 'warning' | 'danger' {
  if (priority === 'CRITICAL') return 'danger';
  if (priority === 'HIGH') return 'warning';
  if (priority === 'LOW') return 'neutral';
  return 'info';
}

/**
 * The ticket queue.
 *
 * Shared by the school portal and the platform desk; `showSchool` is the only
 * difference, because a school user has no use for a column that always says
 * their own name.
 */
export function TicketList({
  queryKey,
  path,
  basePath,
  showSchool,
  categories,
  queueFilter,
  emptyAction,
  initialFilters,
}: {
  queryKey: string;
  path: string;
  /** Where a row navigates to; the ticket id is appended. */
  basePath: string;
  showSchool?: boolean;
  categories?: Array<{ value: string; label: string }>;
  /** Adds the triage queue filter (unassigned / still open). */
  queueFilter?: boolean;
  emptyAction?: React.ReactNode;
  initialFilters?: Record<string, string | undefined>;
}) {
  const router = useRouter();

  const list = useListQuery<TicketRow>(queryKey, path, {
    initialSortBy: 'createdAt',
    initialSortOrder: 'desc',
    initialFilters,
  });

  const columns: Column<TicketRow>[] = [
    {
      key: 'subject',
      header: 'Ticket',
      sortable: true,
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.subject}</span>
          <span className="block truncate text-2xs tabular text-[var(--color-ink-muted)]">
            {row.ticketNumber} · {humanise(row.category)}
            {row.messageCount > 0 ? ` · ${row.messageCount} replies` : ''}
          </span>
        </span>
      ),
    },
    ...(showSchool
      ? [
          {
            key: 'school',
            header: 'School',
            hideOnMobile: true,
            cell: (row: TicketRow) => row.school?.name ?? 'Platform',
          } satisfies Column<TicketRow>,
        ]
      : []),
    {
      key: 'requester',
      header: 'Raised by',
      hideOnMobile: true,
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate">{fullName(row.requester)}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.requester?.email ?? ''}
          </span>
        </span>
      ),
    },
    {
      key: 'assignee',
      header: 'Assigned',
      hideOnMobile: true,
      cell: (row) =>
        row.assignee ? (
          fullName(row.assignee)
        ) : (
          <span className="text-[var(--color-ink-faint)]">Unassigned</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Opened',
      sortable: true,
      cell: (row) => <span title={formatDate(row.createdAt)}>{formatAgo(row.createdAt)}</span>,
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      cell: (row) => (
        <Badge tone={priorityTone(row.priority)}>
          {TICKET_PRIORITY_LABELS[row.priority] ?? humanise(row.priority)}
        </Badge>
      ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <>
      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by subject, number or description"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={TICKET_STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
        />
        <FilterSelect
          label="Priority"
          value={list.state.filters.priority}
          onChange={(value) => list.setFilter('priority', value)}
          options={TICKET_PRIORITIES.map((priority) => ({
            value: priority,
            label: TICKET_PRIORITY_LABELS[priority],
          }))}
        />
        {categories && categories.length > 0 ? (
          <FilterSelect
            label="Category"
            value={list.state.filters.category}
            onChange={(value) => list.setFilter('category', value)}
            options={categories}
          />
        ) : null}
        {queueFilter ? (
          <FilterSelect
            label="Queue"
            value={
              list.state.filters.unassigned
                ? 'unassigned'
                : list.state.filters.openOnly
                  ? 'open'
                  : undefined
            }
            onChange={(value) => {
              // The two are alternatives, so selecting one clears the other
              // rather than quietly intersecting them.
              list.setFilter('unassigned', value === 'unassigned' ? 'true' : undefined);
              list.setFilter('openOnly', value === 'open' ? 'true' : undefined);
            }}
            allLabel="All tickets"
            options={[
              { value: 'unassigned', label: 'Unassigned' },
              { value: 'open', label: 'Still open' },
            ]}
          />
        ) : null}
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
        onRowClick={(row) => router.push(`${basePath}/${row.id}`)}
        empty={
          <EmptyState
            icon={<LifeBuoy />}
            title="No tickets here"
            description="Nothing matches the current filters."
            action={emptyAction}
          />
        }
      />
    </>
  );
}
