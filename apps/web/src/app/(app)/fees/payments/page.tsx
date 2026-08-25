'use client';

import * as React from 'react';
import Link from 'next/link';
import { Download, Plus, Receipt } from 'lucide-react';
import { PAYMENT_METHODS, PAYMENT_STATUSES, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useListQuery } from '@/hooks/use-list-query';
import { formatMoney, saveBlob } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { EmptyState } from '@/components/ui/states';

interface PaymentRow {
  id: string;
  receiptNumber: string;
  method: string;
  status: string;
  amount: string;
  currency: string;
  paidAt: string | null;
  referenceNumber: string | null;
  student?: {
    id: string;
    admissionNumber: string;
    firstName: string;
    lastName: string | null;
  } | null;
}

export default function PaymentsPage() {
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const canCollect = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('fees.collect'),
  );

  const list = useListQuery<PaymentRow>('payments', '/payments', {
    initialSortBy: 'paidAt',
    initialSortOrder: 'desc',
  });

  const [downloading, setDownloading] = React.useState<string | null>(null);

  async function downloadReceipt(id: string, receiptNumber: string) {
    setDownloading(id);
    try {
      const file = await api.download(`/documents/receipts/${id}`);
      saveBlob(file.blob, file.fileName || `${receiptNumber}.pdf`);
    } finally {
      setDownloading(null);
    }
  }

  const columns: Column<PaymentRow>[] = [
    {
      key: 'receiptNumber',
      header: 'Receipt',
      sortable: true,
      cell: (row) => <span className="font-medium tabular">{row.receiptNumber}</span>,
    },
    {
      key: 'student',
      header: 'Student',
      cell: (row) =>
        row.student ? (
          <Link
            href={`/students/${row.student.id}`}
            className="min-w-0 hover:text-[var(--color-accent)]"
          >
            <span className="block truncate">
              {row.student.firstName} {row.student.lastName ?? ''}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.student.admissionNumber}
            </span>
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'paidAt',
      header: 'Date',
      sortable: true,
      cell: (row) => formatDate(row.paidAt),
    },
    {
      key: 'method',
      header: 'Method',
      cell: (row) => (
        <span>
          {humanise(row.method)}
          {row.referenceNumber ? (
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.referenceNumber}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      sortable: true,
      cell: (row) => (
        <span className="font-medium">{formatMoney(row.amount, row.currency ?? currency)}</span>
      ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      width: '2.5rem',
      cell: (row) =>
        // Only a settled payment has a receipt worth printing.
        row.status === 'SUCCESS' ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Download receipt ${row.receiptNumber}`}
            loading={downloading === row.id}
            onClick={(event) => {
              event.stopPropagation();
              void downloadReceipt(row.id, row.receiptNumber);
            }}
          >
            <Download />
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment received, with its receipt."
        actions={
          canCollect ? (
            <Button size="sm" variant="primary" asChild icon={<Plus />}>
              <Link href="/fees/collect">Collect payment</Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by receipt number or reference"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Method"
          value={list.state.filters.method}
          onChange={(value) => list.setFilter('method', value)}
          options={PAYMENT_METHODS.map((method) => ({
            value: method,
            label: humanise(method),
          }))}
        />
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={PAYMENT_STATUSES.map((status) => ({
            value: status,
            label: humanise(status),
          }))}
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
            icon={<Receipt />}
            title="No payments match these filters"
            description="Collected payments appear here with a downloadable receipt."
          />
        }
      />
    </>
  );
}
