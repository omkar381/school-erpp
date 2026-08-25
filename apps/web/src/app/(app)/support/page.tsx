'use client';

import { LifeBuoy } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { useListQuery } from '@/hooks/use-list-query';
import { formatAgo, formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { EmptyState } from '@/components/ui/states';

interface TicketRow {
  id: string;
  ticketNumber: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  raisedBy?: { firstName: string; lastName: string | null; email: string | null } | null;
  assignedTo?: { firstName: string; lastName: string | null } | null;
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['LOW', 'NORMAL', 'IMPORTANT', 'URGENT'];

export default function SupportPage() {
  const list = useListQuery<TicketRow>('support-tickets', '/support/tickets', {
    initialSortBy: 'createdAt',
    initialSortOrder: 'desc',
  });

  const columns: Column<TicketRow>[] = [
    {
      key: 'ticketNumber',
      header: 'Ticket',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.subject}</span>
          <span className="block truncate text-2xs tabular text-[var(--color-ink-muted)]">
            {row.ticketNumber} · {humanise(row.category)}
          </span>
        </span>
      ),
    },
    {
      key: 'raisedBy',
      header: 'Raised by',
      hideOnMobile: true,
      cell: (row) =>
        row.raisedBy ? `${row.raisedBy.firstName} ${row.raisedBy.lastName ?? ''}` : '—',
    },
    {
      key: 'assignedTo',
      header: 'Assigned to',
      hideOnMobile: true,
      cell: (row) =>
        row.assignedTo ? (
          `${row.assignedTo.firstName} ${row.assignedTo.lastName ?? ''}`
        ) : (
          <span className="text-[var(--color-ink-faint)]">Unassigned</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Opened',
      sortable: true,
      cell: (row) => (
        <span title={formatDate(row.createdAt)}>{formatAgo(row.createdAt)}</span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
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
        title="Support"
        description="Tickets raised by parents, teachers and staff."
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search tickets"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
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
            icon={<LifeBuoy />}
            title="No tickets match these filters"
            description="Support requests raised from the portal appear here."
          />
        }
      />
    </>
  );
}
