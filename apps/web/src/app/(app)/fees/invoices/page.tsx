'use client';

import * as React from 'react';
import Link from 'next/link';
import { Download, FileText, Receipt } from 'lucide-react';
import { INVOICE_STATUSES, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useListQuery } from '@/hooks/use-list-query';
import { useClasses } from '@/hooks/use-lookups';
import { formatMoney, saveBlob } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { EmptyState } from '@/components/ui/states';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  total: string;
  paidAmount: string;
  balance: string;
  currency: string;
  student?: {
    id: string;
    admissionNumber: string;
    firstName: string;
    lastName: string | null;
  } | null;
}

export default function InvoicesPage() {
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const list = useListQuery<InvoiceRow>('fees-invoices', '/fees/invoices', {
    initialSortBy: 'issueDate',
    initialSortOrder: 'desc',
  });

  const { data: classes } = useClasses();
  const [downloading, setDownloading] = React.useState<string | null>(null);

  async function downloadInvoice(id: string, invoiceNumber: string) {
    setDownloading(id);
    try {
      const file = await api.download(`/documents/invoices/${id}`);
      saveBlob(file.blob, file.fileName || `${invoiceNumber}.pdf`);
    } finally {
      setDownloading(null);
    }
  }

  const columns: Column<InvoiceRow>[] = [
    {
      key: 'invoiceNumber',
      header: 'Invoice',
      sortable: true,
      cell: (row) => <span className="font-medium tabular">{row.invoiceNumber}</span>,
    },
    {
      key: 'student',
      header: 'Student',
      cell: (row) =>
        row.student ? (
          <Link
            href={`/students/${row.student.id}`}
            onClick={(event) => event.stopPropagation()}
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
      key: 'issueDate',
      header: 'Issued',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => formatDate(row.issueDate),
    },
    {
      key: 'dueDate',
      header: 'Due',
      sortable: true,
      cell: (row) => {
        const overdue =
          Number(row.balance) > 0 && new Date(row.dueDate) < new Date();
        return (
          <span className={overdue ? 'font-medium text-[var(--color-danger)]' : undefined}>
            {formatDate(row.dueDate)}
          </span>
        );
      },
    },
    {
      key: 'total',
      header: 'Total',
      numeric: true,
      sortable: true,
      cell: (row) => formatMoney(row.total, row.currency ?? currency),
    },
    {
      key: 'paidAmount',
      header: 'Paid',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => formatMoney(row.paidAmount, row.currency ?? currency),
    },
    {
      key: 'balance',
      header: 'Balance',
      numeric: true,
      cell: (row) =>
        Number(row.balance) > 0 ? (
          <span className="font-medium text-[var(--color-danger)]">
            {formatMoney(row.balance, row.currency ?? currency)}
          </span>
        ) : (
          <span className="text-[var(--color-success)]">Settled</span>
        ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      width: '2.5rem',
      cell: (row) => (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Download ${row.invoiceNumber}`}
          loading={downloading === row.id}
          onClick={(event) => {
            event.stopPropagation();
            void downloadInvoice(row.id, row.invoiceNumber);
          }}
        >
          <Download />
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every fee invoice raised, with what has been paid against it."
        actions={
          <Button size="sm" asChild icon={<Receipt />}>
            <Link href="/fees/payments">Payments</Link>
          </Button>
        }
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by invoice number or student"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={INVOICE_STATUSES.map((status) => ({
            value: status,
            label: humanise(status),
          }))}
        />
        <FilterSelect
          label="Class"
          value={list.state.filters.classId}
          onChange={(value) => list.setFilter('classId', value)}
          options={(classes ?? []).map((klass) => ({ value: klass.id, label: klass.name }))}
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
            title="No invoices match these filters"
            description="Invoices appear here once a fee structure has been billed."
          />
        }
      />
    </>
  );
}
