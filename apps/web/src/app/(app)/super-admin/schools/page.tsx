'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/use-list-query';
import { useAction } from '@/hooks/use-action';
import { formatNumber } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import {
  PLAN_TIERS,
  SCHOOL_STATUSES,
  type PlanSummary,
  type SchoolRow,
} from '@/lib/platform';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, Modal } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { Input, Select } from '@/components/ui/input';
import { MiniMeter } from '@/components/ui/meter';
import { EmptyState } from '@/components/ui/states';

interface CreateSchoolForm {
  name: string;
  code: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  board: string;
  planCode: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
}

const EMPTY_FORM: CreateSchoolForm = {
  name: '',
  code: '',
  email: '',
  phone: '',
  city: '',
  state: '',
  board: 'CBSE',
  planCode: '',
  adminFirstName: '',
  adminLastName: '',
  adminEmail: '',
};

export default function PlatformSchoolsPage() {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<CreateSchoolForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const list = useListQuery<SchoolRow>('platform-schools', '/platform/schools', {
    initialSortBy: 'createdAt',
    initialSortOrder: 'desc',
  });

  const { data: plans } = useQuery({
    queryKey: ['platform', 'plans', 'sellable'],
    queryFn: () => api.get<{ items: PlanSummary[] }>('/platform/plans', { activeOnly: true, limit: 50 }),
    staleTime: 5 * 60_000,
  });

  const create = useAction({
    mutationFn: (payload: Record<string, unknown>) => api.post('/platform/schools', payload),
    successMessage: 'School provisioned',
    invalidates: [['platform-schools'], ['platform', 'overview']],
    onSuccess: () => {
      setCreating(false);
      setForm(EMPTY_FORM);
      setFieldErrors({});
    },
    onError: (error) => {
      setFieldErrors(
        Object.fromEntries(error.fieldErrors.map((issue) => [issue.field, issue.message])),
      );
    },
  });

  const set = (key: keyof CreateSchoolForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    create.mutate({
      name: form.name,
      code: form.code.toUpperCase(),
      email: form.email,
      phone: form.phone,
      ...(form.city ? { city: form.city } : {}),
      ...(form.state ? { state: form.state } : {}),
      ...(form.board ? { board: form.board } : {}),
      ...(form.planCode ? { planCode: form.planCode } : {}),
      ...(form.adminEmail
        ? {
            admin: {
              firstName: form.adminFirstName,
              lastName: form.adminLastName || undefined,
              email: form.adminEmail,
            },
          }
        : {}),
    });
  };

  const columns: Column<SchoolRow>[] = [
    {
      key: 'name',
      header: 'School',
      sortable: true,
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.name}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.code}
            {row.city ? ` · ${row.city}` : ''}
            {row.state ? `, ${row.state}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      hideOnMobile: true,
      cell: (row) =>
        row.subscription ? (
          <span className="min-w-0">
            <span className="block truncate">{row.subscription.plan.name}</span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {humanise(row.subscription.status)} · ends {formatDate(row.subscription.endDate)}
            </span>
          </span>
        ) : (
          <span className="text-[var(--color-ink-faint)]">No subscription</span>
        ),
    },
    {
      key: 'studentCount',
      header: 'Students',
      numeric: true,
      cell: (row) => (
        <span className="inline-flex flex-col items-end gap-0.5">
          <span className="tabular">{formatNumber(row.studentCount)}</span>
          <MiniMeter
            percent={row.studentUsagePercent}
            title={
              row.subscription
                ? `${row.studentCount} of ${row.subscription.plan.maxStudents} allowed`
                : undefined
            }
          />
        </span>
      ),
    },
    {
      key: 'staffCount',
      header: 'Staff',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => formatNumber(row.staffCount),
    },
    {
      key: 'createdAt',
      header: 'Registered',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => formatDate(row.createdAt),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Schools"
        description="Every tenant on the platform, with its subscription and headline usage."
        actions={
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            Add school
          </Button>
        }
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by name, code, email or city"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={SCHOOL_STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
        />
        <FilterSelect
          label="Tier"
          value={list.state.filters.tier}
          onChange={(value) => list.setFilter('tier', value)}
          options={PLAN_TIERS.map((tier) => ({ value: tier, label: humanise(tier) }))}
        />
        <FilterSelect
          label="Expiry"
          value={list.state.filters.expiringWithinDays}
          onChange={(value) => list.setFilter('expiringWithinDays', value)}
          allLabel="Any expiry"
          options={[
            { value: '7', label: 'Expiring in 7 days' },
            { value: '30', label: 'Expiring in 30 days' },
            { value: '90', label: 'Expiring in 90 days' },
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
        onRowClick={(row) => router.push(`/super-admin/schools/${row.id}`)}
        empty={
          <EmptyState
            icon={<Building2 />}
            title="No schools match this view"
            description="Clear the filters, or provision a new school."
            action={
              <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
                Add school
              </Button>
            }
          />
        }
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <Modal
          size="lg"
          title="Add a school"
          description="Creates the tenant with its system roles, a current academic year and a trial subscription."
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" loading={create.isPending} onClick={submit}>
                Create school
              </Button>
            </>
          }
        >
          <form className="space-y-3" onSubmit={submit}>
            <FieldRow columns={2}>
              <Field label="School name" required error={fieldErrors.name}>
                <Input
                  value={form.name}
                  onChange={(event) => set('name')(event.target.value)}
                  placeholder="Sunrise Public School"
                  required
                />
              </Field>
              <Field
                label="Code"
                required
                help="Short, unique and permanent."
                error={fieldErrors.code}
              >
                <Input
                  value={form.code}
                  onChange={(event) => set('code')(event.target.value.toUpperCase())}
                  placeholder="SPS001"
                  required
                />
              </Field>
            </FieldRow>

            <FieldRow columns={2}>
              <Field label="Contact email" required error={fieldErrors.email}>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(event) => set('email')(event.target.value)}
                  required
                />
              </Field>
              <Field label="Phone" required error={fieldErrors.phone}>
                <Input
                  value={form.phone}
                  onChange={(event) => set('phone')(event.target.value)}
                  placeholder="+91 98765 43210"
                  required
                />
              </Field>
            </FieldRow>

            <FieldRow columns={3}>
              <Field label="City" error={fieldErrors.city}>
                <Input value={form.city} onChange={(event) => set('city')(event.target.value)} />
              </Field>
              <Field label="State" error={fieldErrors.state}>
                <Input value={form.state} onChange={(event) => set('state')(event.target.value)} />
              </Field>
              <Field label="Board" error={fieldErrors.board}>
                <Select value={form.board} onChange={(event) => set('board')(event.target.value)}>
                  <option value="CBSE">CBSE</option>
                  <option value="ICSE">ICSE</option>
                  <option value="STATE">State board</option>
                  <option value="IB">IB</option>
                  <option value="IGCSE">IGCSE</option>
                </Select>
              </Field>
            </FieldRow>

            <Field
              label="Plan"
              help="The school starts on a trial of this plan."
              error={fieldErrors.planCode}
            >
              <Select
                value={form.planCode}
                onChange={(event) => set('planCode')(event.target.value)}
              >
                <option value="">Default (first active plan)</option>
                {plans?.items.map((plan) => (
                  <option key={plan.id} value={plan.code}>
                    {plan.name} — {plan.maxStudents} students, {plan.trialDays}-day trial
                  </option>
                ))}
              </Select>
            </Field>

            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3">
              <p className="mb-2 text-xs font-medium">First administrator (optional)</p>
              <p className="mb-3 text-2xs text-[var(--color-ink-muted)]">
                Leave blank to add one later. A temporary password is emailed to this address and
                must be changed on first sign-in.
              </p>
              <FieldRow columns={3}>
                <Field label="First name" error={fieldErrors['admin.firstName']}>
                  <Input
                    value={form.adminFirstName}
                    onChange={(event) => set('adminFirstName')(event.target.value)}
                  />
                </Field>
                <Field label="Last name" error={fieldErrors['admin.lastName']}>
                  <Input
                    value={form.adminLastName}
                    onChange={(event) => set('adminLastName')(event.target.value)}
                  />
                </Field>
                <Field label="Email" error={fieldErrors['admin.email']}>
                  <Input
                    type="email"
                    value={form.adminEmail}
                    onChange={(event) => set('adminEmail')(event.target.value)}
                  />
                </Field>
              </FieldRow>
            </div>
          </form>
        </Modal>
      </Dialog>
    </>
  );
}
