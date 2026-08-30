'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeIndianRupee, Pencil, Plus, Trash2, TriangleAlert, Users, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useDepartments, useStaffOptions } from '@/hooks/use-lookups';
import { useListQuery } from '@/hooks/use-list-query';
import { formatMoney } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Component {
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  calc: 'FIXED' | 'PERCENT_OF_BASIC';
  value: number;
}

interface ResolvedComponent extends Component {
  amount: number;
}

interface Breakdown {
  basic: number;
  earnings: ResolvedComponent[];
  deductions: ResolvedComponent[];
  totalEarnings: number;
  totalDeductions: number;
  gross: number;
  net: number;
}

interface StaffSummary {
  id: string;
  employeeId: string;
  fullName: string;
  employmentStatus: string;
  department: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
}

interface StructureRow {
  id: string;
  staffId: string;
  staff: StaffSummary | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
  basicSalary: number;
  grossSalary: number;
  netSalary: number;
  currency: string;
  notes: string | null;
  components: Component[];
  breakdown: Breakdown;
}

interface PayrollStats {
  payableStaff: number;
  onPayroll: number;
  awaitingStructure: number;
  monthlyGross: number;
  monthlyNet: number;
  monthlyDeductions: number;
  annualGross: number;
  averageGross: number;
}

interface RegisterRow {
  staff: StaffSummary;
  structureId: string | null;
  basicSalary: number | null;
  grossSalary: number | null;
  netSalary: number | null;
  totalDeductions: number | null;
}

interface Register {
  period: { month: number; year: number; label: string };
  totals: {
    staffCount: number;
    payableCount: number;
    missingStructureCount: number;
    gross: number;
    deductions: number;
    net: number;
  };
  rows: RegisterRow[];
}

const PAYROLL_QUERIES = [['payroll'], ['payroll-structures']];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function PayrollPage() {
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('payroll.manage'),
  );

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<StructureRow | null>(null);
  const [deleting, setDeleting] = React.useState<StructureRow | null>(null);

  const now = new Date();
  const [month, setMonth] = React.useState(now.getMonth() + 1);
  const [year, setYear] = React.useState(now.getFullYear());

  const { data: stats } = useQuery({
    queryKey: ['payroll', 'statistics'],
    queryFn: () => api.get<PayrollStats>('/payroll/statistics'),
    staleTime: 60_000,
  });

  const { data: departments } = useDepartments();

  const structures = useListQuery<StructureRow>('payroll-structures', '/payroll/structures', {
    initialSortBy: 'effectiveFrom',
    initialSortOrder: 'desc',
  });

  const register = useQuery({
    queryKey: ['payroll', 'register', month, year],
    queryFn: () => api.get<Register>('/payroll/register', { month, year }),
  });

  const removeStructure = useAction({
    mutationFn: (row: StructureRow) => api.delete(`/payroll/structures/${row.id}`),
    successMessage: 'Salary structure removed',
    invalidates: PAYROLL_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  const structureColumns: Column<StructureRow>[] = [
    {
      key: 'staff',
      header: 'Employee',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.staff?.fullName ?? '—'}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.staff?.employeeId}
            {row.staff?.designation ? ` · ${row.staff.designation.name}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      hideOnMobile: true,
      cell: (row) => row.staff?.department?.name ?? '—',
    },
    {
      key: 'effectiveFrom',
      header: 'Effective',
      sortable: true,
      cell: (row) => (
        <span>
          {formatDate(row.effectiveFrom)}
          <span className="block text-2xs text-[var(--color-ink-muted)]">
            {row.effectiveTo ? `until ${formatDate(row.effectiveTo)}` : 'open-ended'}
          </span>
        </span>
      ),
    },
    {
      key: 'basicSalary',
      header: 'Basic',
      numeric: true,
      sortable: true,
      cell: (row) => formatMoney(row.basicSalary, currency),
    },
    {
      key: 'grossSalary',
      header: 'Gross',
      numeric: true,
      sortable: true,
      cell: (row) => formatMoney(row.grossSalary, currency),
    },
    {
      key: 'netSalary',
      header: 'Net',
      numeric: true,
      sortable: true,
      cell: (row) => (
        <span className="font-medium">{formatMoney(row.netSalary, currency)}</span>
      ),
    },
    {
      key: 'isCurrent',
      header: '',
      cell: (row) =>
        row.isCurrent ? (
          <Badge tone="success">In force</Badge>
        ) : new Date(row.effectiveFrom) > new Date() ? (
          <Badge tone="info">Scheduled</Badge>
        ) : (
          <Badge>Superseded</Badge>
        ),
    },
  ];

  if (canManage) {
    structureColumns.push({
      key: 'actions',
      header: '',
      width: '1%',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            icon={<Pencil />}
            aria-label={`Edit salary for ${row.staff?.fullName ?? 'employee'}`}
            onClick={() => setEditing(row)}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            icon={<Trash2 />}
            aria-label={`Remove salary structure for ${row.staff?.fullName ?? 'employee'}`}
            onClick={() => setDeleting(row)}
          />
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Salary structures and the monthly wage bill."
        actions={
          canManage ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Set a salary
            </Button>
          ) : null
        }
      />

      {stats ? (
        <StatGrid columns={4} className="mb-4">
          <StatCard label="On payroll" value={stats.onPayroll} icon={<Users />} />
          <StatCard
            label="Monthly gross"
            value={formatMoney(stats.monthlyGross, currency)}
            icon={<BadgeIndianRupee />}
          />
          <StatCard
            label="Monthly net"
            value={formatMoney(stats.monthlyNet, currency)}
            icon={<Wallet />}
            hint={`${formatMoney(stats.monthlyDeductions, currency)} deducted`}
          />
          <StatCard
            label="Awaiting a salary"
            value={stats.awaitingStructure}
            icon={<TriangleAlert />}
            invertTrend
            hint={stats.awaitingStructure > 0 ? 'Payroll would skip these people' : undefined}
          />
        </StatGrid>
      ) : null}

      <Tabs defaultValue="structures">
        <TabsList>
          <TabsTrigger value="structures">Salary structures</TabsTrigger>
          <TabsTrigger value="register">Monthly register</TabsTrigger>
        </TabsList>

        <TabsContent value="structures">
          <FilterBar
            search={structures.state.search}
            onSearchChange={structures.setSearch}
            searchPlaceholder="Search by name or employee ID"
            activeFilterCount={structures.activeFilterCount}
            onReset={structures.resetFilters}
          >
            <FilterSelect
              label="Department"
              value={structures.state.filters.departmentId}
              onChange={(value) => structures.setFilter('departmentId', value)}
              options={(departments ?? []).map((department) => ({
                value: department.id,
                label: department.name,
              }))}
            />
            <FilterSelect
              label="Show"
              value={structures.state.filters.currentOnly}
              onChange={(value) => structures.setFilter('currentOnly', value)}
              allLabel="In force only"
              options={[{ value: 'false', label: 'Include past revisions' }]}
            />
          </FilterBar>

          <DataTable
            columns={structureColumns}
            rows={structures.items}
            rowKey={(row) => row.id}
            isLoading={structures.isLoading}
            error={structures.error}
            onRetry={() => structures.refetch()}
            meta={structures.meta}
            onPageChange={structures.setPage}
            sortBy={structures.state.sortBy}
            sortOrder={structures.state.sortOrder}
            onSortChange={structures.setSort}
            empty={
              <EmptyState
                icon={<Wallet />}
                title="No salary structures yet"
                description="Set a salary for each employee; payroll skips anyone without one."
                action={
                  canManage ? (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Plus />}
                      onClick={() => setCreating(true)}
                    >
                      Set a salary
                    </Button>
                  ) : null
                }
              />
            }
          />
        </TabsContent>

        <TabsContent value="register">
          <Card className="mb-4">
            <CardBody className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-ink-secondary)]">Month</span>
                <Select
                  value={String(month)}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="w-40"
                >
                  {MONTHS.map((label, index) => (
                    <option key={label} value={index + 1}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-ink-secondary)]">Year</span>
                <Input
                  type="number"
                  min={2000}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-28"
                />
              </label>
            </CardBody>
          </Card>

          {register.isLoading ? (
            <LoadingState label="Building the register" />
          ) : register.error ? (
            <ErrorState error={register.error} onRetry={() => register.refetch()} />
          ) : register.data ? (
            <>
              <StatGrid columns={4} className="mb-4">
                <StatCard label="Employees" value={register.data.totals.staffCount} />
                <StatCard
                  label="Gross"
                  value={formatMoney(register.data.totals.gross, currency)}
                />
                <StatCard
                  label="Deductions"
                  value={formatMoney(register.data.totals.deductions, currency)}
                />
                <StatCard
                  label="Net payable"
                  value={formatMoney(register.data.totals.net, currency)}
                />
              </StatGrid>

              {register.data.totals.missingStructureCount > 0 ? (
                <Card className="mb-4">
                  <CardBody className="flex items-start gap-2 text-sm">
                    <TriangleAlert
                      className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]"
                      aria-hidden
                    />
                    <span>
                      {register.data.totals.missingStructureCount} of{' '}
                      {register.data.totals.staffCount} employees have no salary structure in force
                      for {register.data.period.label} and would be skipped by this run.
                    </span>
                  </CardBody>
                </Card>
              ) : null}

              <DataTable
                columns={
                  [
                    {
                      key: 'staff',
                      header: 'Employee',
                      cell: (row) => (
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{row.staff.fullName}</span>
                          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                            {row.staff.employeeId}
                          </span>
                        </span>
                      ),
                    },
                    {
                      key: 'department',
                      header: 'Department',
                      hideOnMobile: true,
                      cell: (row) => row.staff.department?.name ?? '—',
                    },
                    {
                      key: 'basicSalary',
                      header: 'Basic',
                      numeric: true,
                      cell: (row) =>
                        row.basicSalary === null ? '—' : formatMoney(row.basicSalary, currency),
                    },
                    {
                      key: 'grossSalary',
                      header: 'Gross',
                      numeric: true,
                      cell: (row) =>
                        row.grossSalary === null ? '—' : formatMoney(row.grossSalary, currency),
                    },
                    {
                      key: 'totalDeductions',
                      header: 'Deductions',
                      numeric: true,
                      hideOnMobile: true,
                      cell: (row) =>
                        row.totalDeductions === null
                          ? '—'
                          : formatMoney(row.totalDeductions, currency),
                    },
                    {
                      key: 'netSalary',
                      header: 'Net',
                      numeric: true,
                      cell: (row) =>
                        row.netSalary === null ? (
                          <Badge tone="warning">No structure</Badge>
                        ) : (
                          <span className="font-medium">
                            {formatMoney(row.netSalary, currency)}
                          </span>
                        ),
                    },
                  ] satisfies Column<RegisterRow>[]
                }
                rows={register.data.rows}
                rowKey={(row) => row.staff.id}
                empty={
                  <EmptyState
                    icon={<Users />}
                    title="Nobody to pay this month"
                    description="Employees appear once they have joined."
                  />
                }
              />
            </>
          ) : null}
        </TabsContent>
      </Tabs>

      {creating ? <SalaryDialog onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <SalaryDialog structure={editing} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this salary structure?"
        description={
          deleting
            ? `${deleting.staff?.fullName ?? 'This employee'} falls back to their previous salary, if they had one. Otherwise payroll will skip them.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeStructure.isPending}
        onConfirm={() => deleting && removeStructure.mutate(deleting)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Setting a salary
// ---------------------------------------------------------------------------

interface ComponentDraft {
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  calc: 'FIXED' | 'PERCENT_OF_BASIC';
  value: string;
}

/** Mirrors the server's arithmetic so the preview matches what will be saved. */
function computeLocal(basic: number, components: ComponentDraft[]) {
  const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

  const amount = (component: ComponentDraft) => {
    const value = Number(component.value);
    if (!Number.isFinite(value)) return 0;
    return component.calc === 'PERCENT_OF_BASIC' ? round2((basic * value) / 100) : round2(value);
  };

  const earnings = components.filter((c) => c.type === 'EARNING');
  const deductions = components.filter((c) => c.type === 'DEDUCTION');

  const totalEarnings = round2(earnings.reduce((sum, c) => sum + amount(c), 0));
  const totalDeductions = round2(deductions.reduce((sum, c) => sum + amount(c), 0));
  const gross = round2(basic + totalEarnings);

  return { totalEarnings, totalDeductions, gross, net: round2(gross - totalDeductions), amount };
}

function SalaryDialog({
  structure,
  onClose,
}: {
  structure?: StructureRow;
  onClose: () => void;
}) {
  const isEdit = Boolean(structure);
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';

  const [staffId, setStaffId] = React.useState(structure?.staffId ?? '');
  const [effectiveFrom, setEffectiveFrom] = React.useState(
    structure?.effectiveFrom?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [basicSalary, setBasicSalary] = React.useState(
    structure ? String(structure.basicSalary) : '',
  );
  const [notes, setNotes] = React.useState(structure?.notes ?? '');
  const [components, setComponents] = React.useState<ComponentDraft[]>(
    structure?.components.map((c) => ({ ...c, value: String(c.value) })) ?? [],
  );

  const { data: staff } = useStaffOptions(!isEdit);

  const { data: presets } = useQuery({
    queryKey: ['payroll', 'components'],
    queryFn: () => api.get<{ presets: Component[] }>('/payroll/components'),
    staleTime: 10 * 60_000,
  });

  const basic = Number(basicSalary) || 0;
  const preview = computeLocal(basic, components);

  function updateComponent(index: number, patch: Partial<ComponentDraft>) {
    setComponents((current) =>
      current.map((component, position) =>
        position === index ? { ...component, ...patch } : component,
      ),
    );
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="xl"
      title={isEdit ? 'Revise salary structure' : 'Set a salary'}
      description={
        isEdit
          ? 'Corrects this structure in place, keeping its effective dates.'
          : 'A new structure supersedes the current one from its effective date; the old one is kept for history.'
      }
      submitLabel={isEdit ? 'Save changes' : 'Set salary'}
      values={{ staffId, effectiveFrom, basicSalary, notes, components }}
      isValid={(isEdit || Boolean(staffId)) && basic > 0 && Boolean(effectiveFrom)}
      successMessage={isEdit ? 'Salary structure updated' : 'Salary set'}
      invalidates={PAYROLL_QUERIES}
      submit={(values) => {
        const payload = {
          basicSalary: Number(values.basicSalary),
          components: values.components
            .filter((c) => c.name.trim().length > 0)
            .map((c) => ({
              name: c.name.trim(),
              type: c.type,
              calc: c.calc,
              value: Number(c.value) || 0,
            })),
          ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
        };

        return isEdit
          ? api.patch(`/payroll/structures/${structure!.id}`, payload)
          : api.post('/payroll/structures', {
              ...payload,
              staffId: values.staffId,
              effectiveFrom: values.effectiveFrom,
            });
      }}
    >
      {(errors) => (
        <>
          <FieldRow columns={3}>
            {!isEdit ? (
              <Field label="Employee" required error={errors.staffId}>
                <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} autoFocus>
                  <option value="">Choose an employee</option>
                  {(staff ?? []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName ?? `${member.firstName} ${member.lastName ?? ''}`} (
                      {member.employeeId})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Employee">
                <Input value={structure!.staff?.fullName ?? ''} readOnly disabled />
              </Field>
            )}
            <Field
              label="Effective from"
              required
              error={errors.effectiveFrom}
              help={isEdit ? 'Fixed — a new date means a new structure' : undefined}
            >
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                disabled={isEdit}
              />
            </Field>
            <Field label="Basic salary" required error={errors.basicSalary}>
              <Input
                type="number"
                min={0}
                value={basicSalary}
                onChange={(e) => setBasicSalary(e.target.value)}
                autoFocus={isEdit}
              />
            </Field>
          </FieldRow>

          <Field
            label="Allowances and deductions"
            help="Percentages are always of the basic salary, never of a running total."
          >
            <div className="space-y-2">
              {components.map((component, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Input
                    className="min-w-40 flex-1"
                    value={component.name}
                    onChange={(e) => updateComponent(index, { name: e.target.value })}
                    placeholder="Component name"
                    aria-label={`Name of component ${index + 1}`}
                  />
                  <Select
                    className="w-32"
                    value={component.type}
                    onChange={(e) =>
                      updateComponent(index, {
                        type: e.target.value as 'EARNING' | 'DEDUCTION',
                      })
                    }
                    aria-label={`Type of component ${index + 1}`}
                  >
                    <option value="EARNING">Allowance</option>
                    <option value="DEDUCTION">Deduction</option>
                  </Select>
                  <Select
                    className="w-28"
                    value={component.calc}
                    onChange={(e) =>
                      updateComponent(index, {
                        calc: e.target.value as 'FIXED' | 'PERCENT_OF_BASIC',
                      })
                    }
                    aria-label={`Calculation for component ${index + 1}`}
                  >
                    <option value="FIXED">Amount</option>
                    <option value="PERCENT_OF_BASIC">% of basic</option>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-24"
                    value={component.value}
                    onChange={(e) => updateComponent(index, { value: e.target.value })}
                    aria-label={`Value of component ${index + 1}`}
                  />
                  <span className="w-24 text-right text-xs tabular text-[var(--color-ink-muted)]">
                    {formatMoney(preview.amount(component), currency)}
                  </span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    icon={<Trash2 />}
                    aria-label={`Remove component ${index + 1}`}
                    onClick={() =>
                      setComponents((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  />
                </div>
              ))}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="xs"
                  icon={<Plus />}
                  onClick={() =>
                    setComponents((current) => [
                      ...current,
                      { name: '', type: 'EARNING', calc: 'FIXED', value: '' },
                    ])
                  }
                >
                  Add component
                </Button>
                {components.length === 0 && presets?.presets?.length ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setComponents(
                        presets.presets.map((preset) => ({
                          ...preset,
                          value: String(preset.value),
                        })),
                      )
                    }
                  >
                    Use the standard set
                  </Button>
                ) : null}
              </div>
            </div>
          </Field>

          {/* The figure being agreed to is the net, so it is shown as it is built. */}
          <Card>
            <CardBody className="grid grid-cols-2 gap-y-1 text-sm sm:grid-cols-4">
              <span className="text-[var(--color-ink-muted)]">Basic</span>
              <span className="text-right font-medium tabular sm:text-left">
                {formatMoney(basic, currency)}
              </span>
              <span className="text-[var(--color-ink-muted)]">Allowances</span>
              <span className="text-right font-medium tabular sm:text-left">
                {formatMoney(preview.totalEarnings, currency)}
              </span>
              <span className="text-[var(--color-ink-muted)]">Gross</span>
              <span className="text-right font-medium tabular sm:text-left">
                {formatMoney(preview.gross, currency)}
              </span>
              <span className="text-[var(--color-ink-muted)]">Deductions</span>
              <span className="text-right font-medium tabular sm:text-left">
                −{formatMoney(preview.totalDeductions, currency)}
              </span>
              <span className="font-semibold">Net payable</span>
              <span className="text-right font-semibold tabular sm:text-left">
                {formatMoney(preview.net, currency)}
              </span>
            </CardBody>
          </Card>

          <Field label="Notes" error={errors.notes}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
