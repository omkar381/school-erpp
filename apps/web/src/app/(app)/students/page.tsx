'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, GraduationCap, Plus, Upload } from 'lucide-react';
import { STUDENT_STATUSES, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useListQuery } from '@/hooks/use-list-query';
import { useClasses, useSections } from '@/hooks/use-lookups';
import { formatMoney, initials, saveBlob } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';

interface StudentRow {
  id: string;
  admissionNumber: string;
  rollNumber: string | null;
  fullName: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  photoUrl: string | null;
  status: string;
  outstandingAmount: number;
  enrollment: {
    rollNumber: string | null;
    class: { id: string; name: string; level: number } | null;
    section: { id: string; name: string } | null;
  } | null;
  primaryGuardian: {
    id: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
    relation: string;
  } | null;
}

interface StudentStatistics {
  totalActive: number;
  newThisMonth: number;
  byStatus: Record<string, number>;
  byGender: Record<string, number>;
  byClass: Array<{ classId: string; className: string; level: number; count: number }>;
}

export default function StudentsPage() {
  const router = useRouter();
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const canCreate = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('students.create'),
  );
  const canExport = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('students.export'),
  );

  const list = useListQuery<StudentRow>('students', '/students', {
    initialSortBy: 'admissionNumber',
    initialSortOrder: 'asc',
    initialFilters: { status: 'ACTIVE' },
  });

  const { data: classes } = useClasses();
  const { data: sections } = useSections(list.state.filters.classId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [exporting, setExporting] = React.useState(false);

  const { data: stats } = useQuery({
    queryKey: ['students', 'statistics'],
    queryFn: () => api.get<StudentStatistics>('/students/statistics'),
    staleTime: 5 * 60_000,
  });

  async function handleExport() {
    setExporting(true);
    try {
      const file = await api.download('/students/export', {
        query: { ...list.params, page: undefined, limit: undefined },
      });
      saveBlob(file.blob, file.fileName);
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<StudentRow>[] = [
    {
      key: 'fullName',
      header: 'Student',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold text-[var(--color-ink-secondary)]"
            aria-hidden
          >
            {row.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.photoUrl} alt="" className="size-7 object-cover" />
            ) : (
              initials(row.fullName)
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-[var(--color-ink)]">
              {row.fullName}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.admissionNumber}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'class',
      header: 'Class',
      cell: (row) =>
        row.enrollment?.class ? (
          <span>
            {row.enrollment.class.name}
            <span className="ml-1 text-[var(--color-ink-muted)]">
              {row.enrollment.section?.name}
            </span>
          </span>
        ) : (
          <span className="text-[var(--color-ink-faint)]">Not enrolled</span>
        ),
    },
    {
      key: 'rollNumber',
      header: 'Roll',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => row.enrollment?.rollNumber ?? row.rollNumber ?? '—',
    },
    {
      key: 'guardian',
      header: 'Guardian',
      hideOnMobile: true,
      cell: (row) =>
        row.primaryGuardian ? (
          <span className="min-w-0">
            <span className="block truncate">
              {row.primaryGuardian.firstName} {row.primaryGuardian.lastName ?? ''}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.primaryGuardian.phone ?? humanise(row.primaryGuardian.relation)}
            </span>
          </span>
        ) : (
          <span className="text-[var(--color-ink-faint)]">—</span>
        ),
    },
    {
      key: 'outstandingAmount',
      header: 'Dues',
      numeric: true,
      cell: (row) =>
        row.outstandingAmount > 0 ? (
          <span className="font-medium text-[var(--color-danger)]">
            {formatMoney(row.outstandingAmount, currency)}
          </span>
        ) : (
          <span className="text-[var(--color-ink-faint)]">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Students"
        description="Every student on the roll, with class, guardian and outstanding fees."
        actions={
          <>
            {canExport ? (
              <Button size="sm" onClick={handleExport} loading={exporting} icon={<Download />}>
                Export
              </Button>
            ) : null}
            {canCreate ? (
              <>
                <Button size="sm" asChild icon={<Upload />}>
                  <Link href="/students/import">Import</Link>
                </Button>
                <Button size="sm" variant="primary" asChild icon={<Plus />}>
                  <Link href="/students/new">Add student</Link>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {stats ? (
        <StatGrid columns={4} className="mb-4">
          <StatCard label="Active students" value={stats.totalActive.toLocaleString('en-IN')} />
          <StatCard label="Boys" value={(stats.byGender.MALE ?? 0).toLocaleString('en-IN')} />
          <StatCard label="Girls" value={(stats.byGender.FEMALE ?? 0).toLocaleString('en-IN')} />
          <StatCard
            label="Admitted this month"
            value={stats.newThisMonth.toLocaleString('en-IN')}
          />
        </StatGrid>
      ) : null}

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by name, admission number or phone"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Class"
          value={list.state.filters.classId}
          onChange={(value) => {
            list.setFilter('classId', value);
            // The old section belongs to the old class, so it would filter
            // everything out; clear it whenever the class changes.
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
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={STUDENT_STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
        />

        <FilterSelect
          label="Dues"
          value={list.state.filters.hasDues}
          onChange={(value) => list.setFilter('hasDues', value)}
          allLabel="Any dues"
          options={[
            { value: 'true', label: 'Has dues' },
            { value: 'false', label: 'No dues' },
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
        onRowClick={(row) => router.push(`/students/${row.id}`)}
        selectable
        selectedIds={selected}
        onSelectionChange={setSelected}
        bulkActions={() => (
          <Button size="xs" variant="secondary" asChild>
            <Link href="/students/promote">Promote selected</Link>
          </Button>
        )}
        empty={
          <EmptyState
            icon={<GraduationCap />}
            title="No students match these filters"
            description={
              list.activeFilterCount > 0
                ? 'Try clearing a filter or widening the search.'
                : 'Add your first student to get started.'
            }
            action={
              canCreate && list.activeFilterCount === 0 ? (
                <Button size="sm" variant="primary" asChild icon={<Plus />}>
                  <Link href="/students/new">Add student</Link>
                </Button>
              ) : null
            }
          />
        }
      />
    </>
  );
}
