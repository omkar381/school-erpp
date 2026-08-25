'use client';

import { ShieldCheck } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDateTime } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { EmptyState } from '@/components/ui/states';

interface AuditRow {
  id: string;
  action: string;
  module: string;
  entity: string;
  entityId: string | null;
  description: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string | null; email: string | null } | null;
}

const ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'PAYMENT',
  'REFUND',
  'MARKS_UPDATE',
  'ATTENDANCE_UPDATE',
  'PERMISSION_CHANGE',
];

/** Actions that change money or access, and so deserve to stand out. */
const SENSITIVE = new Set(['DELETE', 'REFUND', 'PERMISSION_CHANGE', 'PAYMENT']);

export default function AuditPage() {
  const list = useListQuery<AuditRow>('audit-logs', '/audit-logs', {
    initialSortBy: 'createdAt',
    initialSortOrder: 'desc',
    initialLimit: 50,
  });

  const columns: Column<AuditRow>[] = [
    {
      key: 'createdAt',
      header: 'When',
      sortable: true,
      width: '11rem',
      cell: (row) => <span className="tabular">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'user',
      header: 'Who',
      cell: (row) =>
        row.user ? (
          <span className="min-w-0">
            <span className="block truncate">
              {row.user.firstName} {row.user.lastName ?? ''}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.user.email}
            </span>
          </span>
        ) : (
          <span className="text-[var(--color-ink-faint)]">System</span>
        ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => (
        <Badge tone={SENSITIVE.has(row.action) ? 'warning' : 'neutral'}>
          {humanise(row.action)}
        </Badge>
      ),
    },
    { key: 'module', header: 'Module', hideOnMobile: true, cell: (row) => humanise(row.module) },
    {
      key: 'description',
      header: 'Detail',
      cell: (row) => (
        <span className="line-clamp-2">{row.description ?? `${row.entity} ${row.entityId ?? ''}`}</span>
      ),
    },
    {
      key: 'ipAddress',
      header: 'Origin',
      hideOnMobile: true,
      cell: (row) => (
        <span className="tabular text-2xs text-[var(--color-ink-muted)]">
          {row.ipAddress ?? '—'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sensitive action, who performed it and from where."
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search the log"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Action"
          value={list.state.filters.action}
          onChange={(value) => list.setFilter('action', value)}
          options={ACTIONS.map((action) => ({ value: action, label: humanise(action) }))}
        />
        <FilterSelect
          label="Module"
          value={list.state.filters.module}
          onChange={(value) => list.setFilter('module', value)}
          options={[
            'auth',
            'students',
            'fees',
            'payments',
            'attendance',
            'exams',
            'library',
            'inventory',
            'transport',
            'roles',
          ].map((module) => ({ value: module, label: humanise(module) }))}
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
            icon={<ShieldCheck />}
            title="No entries match these filters"
            description="The audit log records every create, update, delete and sign-in."
          />
        }
      />
    </>
  );
}
