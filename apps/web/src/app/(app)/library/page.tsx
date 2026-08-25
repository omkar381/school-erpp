'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, BookX, Library } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useListQuery } from '@/hooks/use-list-query';
import { formatMoney } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface BookRow {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  publisher: string | null;
  rackLocation: string | null;
  totalCopies: number;
  availableCopies: number;
  isAvailable: boolean;
  category: { id: string; name: string } | null;
}

interface IssueRow {
  id: string;
  issueDate: string;
  dueDate: string;
  returnDate: string | null;
  status: string;
  daysOverdue: number;
  outstandingFine: number;
  bookCopy: { accessionNumber: string; book: { id: string; title: string; author: string } };
  student: {
    id: string;
    admissionNumber: string;
    firstName: string;
    lastName: string | null;
  } | null;
}

interface LibraryStats {
  titles: number;
  copies: number;
  currentlyIssued: number;
  overdue: number;
  available: number;
  unavailable: number;
  outstandingFines: number;
}

export default function LibraryPage() {
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';

  const { data: stats } = useQuery({
    queryKey: ['library', 'statistics'],
    queryFn: () => api.get<LibraryStats>('/library/statistics'),
    staleTime: 60_000,
  });

  const books = useListQuery<BookRow>('library-books', '/library/books', {
    initialSortBy: 'title',
    initialSortOrder: 'asc',
  });

  const issues = useListQuery<IssueRow>('library-issues', '/library/issues', {
    initialFilters: { status: 'ISSUED' },
  });

  const bookColumns: Column<BookRow>[] = [
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.title}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.author}
          </span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      cell: (row) => row.category?.name ?? '—',
    },
    { key: 'isbn', header: 'ISBN', hideOnMobile: true, cell: (row) => row.isbn ?? '—' },
    {
      key: 'rackLocation',
      header: 'Rack',
      hideOnMobile: true,
      cell: (row) => row.rackLocation ?? '—',
    },
    {
      key: 'availableCopies',
      header: 'Available',
      numeric: true,
      cell: (row) => (
        <span
          className={
            row.availableCopies === 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]'
          }
        >
          {row.availableCopies} / {row.totalCopies}
        </span>
      ),
    },
    {
      key: 'status',
      header: '',
      cell: (row) =>
        row.availableCopies > 0 ? (
          <Badge tone="success">On shelf</Badge>
        ) : (
          <Badge tone="danger">All out</Badge>
        ),
    },
  ];

  const issueColumns: Column<IssueRow>[] = [
    {
      key: 'book',
      header: 'Book',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.bookCopy.book.title}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.bookCopy.accessionNumber}
          </span>
        </span>
      ),
    },
    {
      key: 'borrower',
      header: 'Borrower',
      cell: (row) =>
        row.student ? (
          <span className="min-w-0">
            <span className="block truncate">
              {row.student.firstName} {row.student.lastName ?? ''}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.student.admissionNumber}
            </span>
          </span>
        ) : (
          'Staff'
        ),
    },
    { key: 'issueDate', header: 'Issued', hideOnMobile: true, cell: (row) => formatDate(row.issueDate) },
    {
      key: 'dueDate',
      header: 'Due',
      cell: (row) => (
        <span
          className={row.daysOverdue > 0 ? 'font-medium text-[var(--color-danger)]' : undefined}
        >
          {formatDate(row.dueDate)}
          {row.daysOverdue > 0 ? (
            <span className="block text-2xs">{row.daysOverdue} days late</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'outstandingFine',
      header: 'Fine',
      numeric: true,
      cell: (row) =>
        row.outstandingFine > 0 ? (
          <span className="font-medium text-[var(--color-danger)]">
            {formatMoney(row.outstandingFine, currency)}
          </span>
        ) : (
          <span className="text-[var(--color-ink-faint)]">—</span>
        ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <>
      <PageHeader title="Library" description="Catalogue, circulation and outstanding fines." />

      {stats ? (
        <StatGrid columns={5} className="mb-4">
          <StatCard label="Titles" value={stats.titles} icon={<Library />} />
          <StatCard label="Copies" value={stats.copies} />
          <StatCard label="On loan" value={stats.currentlyIssued} />
          <StatCard label="Overdue" value={stats.overdue} icon={<BookX />} invertTrend />
          <StatCard
            label="Fines outstanding"
            value={formatMoney(stats.outstandingFines, currency)}
          />
        </StatGrid>
      ) : null}

      <Tabs defaultValue="catalogue">
        <TabsList>
          <TabsTrigger value="catalogue">Catalogue</TabsTrigger>
          <TabsTrigger value="circulation">Circulation</TabsTrigger>
        </TabsList>

        <TabsContent value="catalogue">
          <FilterBar
            search={books.state.search}
            onSearchChange={books.setSearch}
            searchPlaceholder="Search by title, author, ISBN or publisher"
            activeFilterCount={books.activeFilterCount}
            onReset={books.resetFilters}
          >
            <FilterSelect
              label="Availability"
              value={books.state.filters.availableOnly}
              onChange={(value) => books.setFilter('availableOnly', value)}
              allLabel="All titles"
              options={[{ value: 'true', label: 'On shelf only' }]}
            />
          </FilterBar>

          <DataTable
            columns={bookColumns}
            rows={books.items}
            rowKey={(row) => row.id}
            isLoading={books.isLoading}
            error={books.error}
            onRetry={() => books.refetch()}
            meta={books.meta}
            onPageChange={books.setPage}
            sortBy={books.state.sortBy}
            sortOrder={books.state.sortOrder}
            onSortChange={books.setSort}
            empty={
              <EmptyState
                icon={<BookOpen />}
                title="No books match this search"
                description="Catalogue a title to get started."
              />
            }
          />
        </TabsContent>

        <TabsContent value="circulation">
          <FilterBar
            search={issues.state.search}
            onSearchChange={issues.setSearch}
            searchPlaceholder="Search circulation"
            activeFilterCount={issues.activeFilterCount}
            onReset={issues.resetFilters}
          >
            <FilterSelect
              label="Status"
              value={issues.state.filters.status}
              onChange={(value) => issues.setFilter('status', value)}
              options={[
                { value: 'ISSUED', label: 'On loan' },
                { value: 'OVERDUE', label: 'Overdue' },
                { value: 'RETURNED', label: 'Returned' },
                { value: 'LOST', label: 'Lost' },
              ]}
            />
            <FilterSelect
              label="Overdue"
              value={issues.state.filters.overdueOnly}
              onChange={(value) => issues.setFilter('overdueOnly', value)}
              allLabel="All loans"
              options={[{ value: 'true', label: 'Overdue only' }]}
            />
          </FilterBar>

          <DataTable
            columns={issueColumns}
            rows={issues.items}
            rowKey={(row) => row.id}
            isLoading={issues.isLoading}
            error={issues.error}
            onRetry={() => issues.refetch()}
            meta={issues.meta}
            onPageChange={issues.setPage}
            empty={
              <EmptyState
                icon={<BookOpen />}
                title="No loans match these filters"
                description="Issued books appear here with their due dates."
              />
            }
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
