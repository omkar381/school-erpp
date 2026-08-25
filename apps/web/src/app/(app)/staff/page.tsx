'use client';

import { useQuery } from '@tanstack/react-query';
import { GraduationCap, UserCog, Users } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/use-list-query';
import { useDepartments } from '@/hooks/use-lookups';
import { initials } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';

interface StaffRow {
  id: string;
  employeeId: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  email: string | null;
  phone: string;
  joiningDate: string;
  employmentStatus: string;
  employmentType: string;
  isTeacher: boolean;
  qualification: string | null;
  department: { id: string; name: string; code: string } | null;
  designation: { id: string; name: string } | null;
}

interface StaffStats {
  totalActive: number;
  teachers: number;
  nonTeaching: number;
  newThisYear: number;
  byStatus: Record<string, number>;
  byDepartment: Array<{ departmentId: string; name: string; count: number }>;
}

const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED', 'RETIRED'];

export default function StaffPage() {
  const list = useListQuery<StaffRow>('staff', '/staff', {
    initialSortBy: 'employeeId',
    initialSortOrder: 'asc',
    initialFilters: { employmentStatus: 'ACTIVE' },
  });

  const { data: departments } = useDepartments();

  const { data: stats } = useQuery({
    queryKey: ['staff', 'statistics'],
    queryFn: () => api.get<StaffStats>('/staff/statistics'),
    staleTime: 5 * 60_000,
  });

  const columns: Column<StaffRow>[] = [
    {
      key: 'name',
      header: 'Staff member',
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
              initials(`${row.firstName} ${row.lastName ?? ''}`)
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {[row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ')}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.employeeId}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'designation',
      header: 'Designation',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate">{row.designation?.name ?? '—'}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.department?.name ?? ''}
          </span>
        </span>
      ),
    },
    {
      key: 'isTeacher',
      header: 'Role',
      cell: (row) =>
        row.isTeacher ? (
          <Badge tone="info">
            <GraduationCap className="size-2.5" aria-hidden />
            Teaching
          </Badge>
        ) : (
          <Badge>{humanise(row.employmentType)}</Badge>
        ),
    },
    { key: 'phone', header: 'Phone', hideOnMobile: true, cell: (row) => row.phone },
    {
      key: 'qualification',
      header: 'Qualification',
      hideOnMobile: true,
      cell: (row) => row.qualification ?? '—',
    },
    {
      key: 'joiningDate',
      header: 'Joined',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => formatDate(row.joiningDate),
    },
    {
      key: 'employmentStatus',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.employmentStatus} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Staff"
        description="Teaching and non-teaching staff, their departments and employment status."
      />

      {stats ? (
        <StatGrid columns={4} className="mb-4">
          <StatCard label="Active staff" value={stats.totalActive} icon={<UserCog />} />
          <StatCard label="Teaching" value={stats.teachers} icon={<GraduationCap />} />
          <StatCard label="Non-teaching" value={stats.nonTeaching} icon={<Users />} />
          <StatCard label="Joined this year" value={stats.newThisYear} />
        </StatGrid>
      ) : null}

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by name, employee ID or phone"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Department"
          value={list.state.filters.departmentId}
          onChange={(value) => list.setFilter('departmentId', value)}
          options={(departments ?? []).map((department) => ({
            value: department.id,
            label: department.name,
          }))}
        />
        <FilterSelect
          label="Type"
          value={list.state.filters.isTeacher}
          onChange={(value) => list.setFilter('isTeacher', value)}
          allLabel="All staff"
          options={[
            { value: 'true', label: 'Teaching only' },
            { value: 'false', label: 'Non-teaching only' },
          ]}
        />
        <FilterSelect
          label="Status"
          value={list.state.filters.employmentStatus}
          onChange={(value) => list.setFilter('employmentStatus', value)}
          options={EMPLOYMENT_STATUSES.map((status) => ({
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
            icon={<UserCog />}
            title="No staff match these filters"
            description="Try clearing a filter or widening the search."
          />
        }
      />
    </>
  );
}
