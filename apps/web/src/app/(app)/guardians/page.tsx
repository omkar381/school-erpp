'use client';

import Link from 'next/link';
import { KeyRound, Phone, Users } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { useListQuery } from '@/hooks/use-list-query';
import { initials } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { EmptyState } from '@/components/ui/states';

interface GuardianRow {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string | null;
  relation: string;
  email: string | null;
  phone: string | null;
  occupation: string | null;
  city: string | null;
  hasLogin: boolean;
  user: { id: string; status: string; lastLoginAt: string | null } | null;
  children: Array<{
    id: string;
    isPrimary: boolean;
    firstName?: string;
    lastName?: string | null;
    admissionNumber?: string;
    student?: { id: string; firstName: string; lastName: string | null; admissionNumber: string };
  }>;
}

const RELATIONS = ['FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER'];

export default function GuardiansPage() {
  const list = useListQuery<GuardianRow>('guardians', '/guardians', {
    initialSortBy: 'firstName',
    initialSortOrder: 'asc',
  });

  const columns: Column<GuardianRow>[] = [
    {
      key: 'fullName',
      header: 'Parent',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold text-[var(--color-ink-secondary)]"
            aria-hidden
          >
            {initials(row.fullName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.fullName}</span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {humanise(row.relation)}
              {row.occupation ? ` · ${row.occupation}` : ''}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'children',
      header: 'Children',
      cell: (row) => {
        // The API nests the student under `student` in some projections and
        // flattens it in others; handle both rather than showing blanks.
        const kids = row.children.map((child) => child.student ?? child);
        if (kids.length === 0) return <span className="text-[var(--color-ink-faint)]">—</span>;

        return (
          <span className="flex flex-wrap gap-1">
            {kids.slice(0, 3).map((child, index) => (
              <Link
                key={child.id ?? index}
                href={`/students/${child.id}`}
                onClick={(event) => event.stopPropagation()}
                className="rounded-[var(--radius-xs)] bg-[var(--color-surface-sunken)] px-1.5 py-0.5 text-2xs hover:text-[var(--color-accent)]"
              >
                {child.firstName} {child.lastName ?? ''}
              </Link>
            ))}
            {kids.length > 3 ? (
              <span className="text-2xs text-[var(--color-ink-muted)]">+{kids.length - 3}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'phone',
      header: 'Phone',
      cell: (row) =>
        row.phone ? (
          <a
            href={`tel:${row.phone}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 tabular hover:text-[var(--color-accent)]"
          >
            <Phone className="size-3" aria-hidden />
            {row.phone}
          </a>
        ) : (
          <span className="text-[var(--color-ink-faint)]">—</span>
        ),
    },
    {
      key: 'email',
      header: 'Email',
      hideOnMobile: true,
      cell: (row) => row.email ?? '—',
    },
    { key: 'city', header: 'City', hideOnMobile: true, cell: (row) => row.city ?? '—' },
    {
      key: 'hasLogin',
      header: 'Portal',
      cell: (row) =>
        row.hasLogin ? (
          <Badge tone="success">
            <KeyRound className="size-2.5" aria-hidden />
            Has login
          </Badge>
        ) : (
          <Badge>No login</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Parents"
        description="Every guardian on record, their children and whether they can reach the portal."
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by name, phone or email"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Relation"
          value={list.state.filters.relation}
          onChange={(value) => list.setFilter('relation', value)}
          options={RELATIONS.map((relation) => ({ value: relation, label: humanise(relation) }))}
        />
        <FilterSelect
          label="Portal access"
          value={list.state.filters.hasLogin}
          onChange={(value) => list.setFilter('hasLogin', value)}
          allLabel="Any access"
          options={[
            { value: 'true', label: 'Has login' },
            { value: 'false', label: 'No login' },
          ]}
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
            icon={<Users />}
            title="No parents match these filters"
            description="Guardians are created alongside students."
          />
        }
      />
    </>
  );
}
