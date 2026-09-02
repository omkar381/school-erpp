'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Check, PlaneTakeoff, Plus, X } from 'lucide-react';
import { LEAVE_STATUSES, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, Modal } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface LeaveRow {
  id: string;
  applicantType: string;
  fromDate: string;
  toDate: string;
  totalDays: string;
  reason: string;
  status: string;
  isHalfDay: boolean;
  reviewedAt: string | null;
  reviewRemarks: string | null;
  leaveType: { id: string; name: string } | null;
  student: {
    id: string;
    admissionNumber: string;
    firstName: string;
    lastName: string | null;
  } | null;
  staff: { id: string; employeeId: string; firstName: string; lastName: string | null } | null;
}

type Decision = 'APPROVED' | 'REJECTED';

export default function LeavePage() {
  const canDecide = useAuthStore(
    (state) =>
      state.user?.isSuperAdmin ||
      state.user?.permissions.includes('leave.approve') ||
      state.user?.permissions.includes('leave.manage'),
  );

  const [pending, setPending] = React.useState<{ row: LeaveRow; decision: Decision } | null>(null);

  const list = useListQuery<LeaveRow>('leave', '/leave', {
    initialSortBy: 'fromDate',
    initialSortOrder: 'desc',
    initialFilters: { status: 'PENDING' },
  });

  const columns: Column<LeaveRow>[] = [
    {
      key: 'applicant',
      header: 'Applicant',
      cell: (row) => {
        const person = row.student ?? row.staff;
        const identifier = row.student?.admissionNumber ?? row.staff?.employeeId;
        return (
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {person ? `${person.firstName} ${person.lastName ?? ''}` : '—'}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {identifier} · {humanise(row.applicantType)}
            </span>
          </span>
        );
      },
    },
    {
      key: 'leaveType',
      header: 'Type',
      hideOnMobile: true,
      cell: (row) => row.leaveType?.name ?? '—',
    },
    {
      key: 'fromDate',
      header: 'Dates',
      sortable: true,
      cell: (row) => (
        <span>
          {formatDate(row.fromDate)}
          {row.fromDate !== row.toDate ? ` – ${formatDate(row.toDate)}` : ''}
        </span>
      ),
    },
    {
      key: 'totalDays',
      header: 'Days',
      numeric: true,
      cell: (row) => (
        <span>
          {Number(row.totalDays)}
          {row.isHalfDay ? <Badge className="ml-1">Half</Badge> : null}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      hideOnMobile: true,
      cell: (row) => <span className="line-clamp-2 max-w-xs">{row.reason}</span>,
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    ...(canDecide
      ? [
          {
            key: 'actions',
            header: '',
            width: '5rem',
            cell: (row: LeaveRow) =>
              // Only a pending request is still open to a decision.
              row.status === 'PENDING' ? (
                <span className="flex gap-0.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Approve"
                    className="text-[var(--color-success)]"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPending({ row, decision: 'APPROVED' });
                    }}
                  >
                    <Check />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Reject"
                    className="text-[var(--color-danger)]"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPending({ row, decision: 'REJECTED' });
                    }}
                  >
                    <X />
                  </Button>
                </span>
              ) : null,
          } satisfies Column<LeaveRow>,
        ]
      : []),
  ];

  const canManageTypes = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('leave.types.manage'),
  );

  return (
    <>
      <PageHeader
        title="Leave"
        description="Leave requests from students and staff, their approval status, and the leave policy."
      />

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="types">Leave types</TabsTrigger>
        </TabsList>

        <TabsContent value="types">
          <LeaveTypesPanel canManage={Boolean(canManageTypes)} />
        </TabsContent>

        <TabsContent value="requests">
          <FilterBar
            search={list.state.search}
            onSearchChange={list.setSearch}
            searchPlaceholder="Search by applicant or reason"
            activeFilterCount={list.activeFilterCount}
            onReset={list.resetFilters}
          >
            <FilterSelect
              label="Status"
              value={list.state.filters.status}
              onChange={(value) => list.setFilter('status', value)}
              options={LEAVE_STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
            />
            <FilterSelect
              label="Applicant"
              value={list.state.filters.applicantType}
              onChange={(value) => list.setFilter('applicantType', value)}
              options={[
                { value: 'STUDENT', label: 'Students' },
                { value: 'STAFF', label: 'Staff' },
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
                icon={<PlaneTakeoff />}
                title="No leave requests match these filters"
                description={
                  list.state.filters.status === 'PENDING'
                    ? 'Nothing is waiting on a decision.'
                    : 'Requests appear here as they are submitted.'
                }
              />
            }
          />
        </TabsContent>
      </Tabs>

      {pending ? (
        <DecisionDialog
          row={pending.row}
          decision={pending.decision}
          onClose={() => setPending(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

interface LeaveType {
  id: string;
  name: string;
  code: string;
  applicableTo: 'STUDENT' | 'STAFF';
  annualQuota: string | null;
  isPaid: boolean;
  carryForward: boolean;
  maxCarryForward: string | null;
  requiresDocument: boolean;
  isActive: boolean;
}

function LeaveTypesPanel({ canManage }: { canManage: boolean }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api.get<LeaveType[]>('/leave/types'),
  });

  const [creating, setCreating] = React.useState(false);

  const year = new Date().getFullYear();
  const allocate = useAction({
    mutationFn: () => api.post<{ created: number }>(`/leave/balances/allocate/${year}`, {}),
    successMessage: (result) => `Allocated this year's balances (${result.created} created)`,
    invalidates: [['leave-types'], ['leave']],
  });

  if (isLoading) return <LoadingState label="Loading leave types" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const rows = data ?? [];

  return (
    <>
      {canManage ? (
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            icon={<CalendarRange />}
            loading={allocate.isPending}
            onClick={() => allocate.mutate(undefined)}
          >
            Allocate {year} balances
          </Button>
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New leave type
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarRange />}
          title="No leave types defined"
          description="Define the kinds of leave (Casual, Sick, Earned…) and their annual quota."
          action={
            canManage ? (
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                New leave type
              </Button>
            ) : null
          }
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-surface-sunken)] text-2xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">For</th>
                    <th className="px-3 py-2 text-right">Annual quota</th>
                    <th className="px-3 py-2 text-left">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {rows.map((type) => (
                    <tr key={type.id}>
                      <td className="px-3 py-2 font-medium">{type.name}</td>
                      <td className="px-3 py-2 font-mono text-2xs">{type.code}</td>
                      <td className="px-3 py-2">{humanise(type.applicableTo)}</td>
                      <td className="px-3 py-2 text-right numeric">
                        {type.annualQuota != null ? Number(type.annualQuota) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {type.isPaid ? <Badge tone="success">Paid</Badge> : <Badge>Unpaid</Badge>}
                          {type.carryForward ? (
                            <Badge tone="info">
                              Carry forward
                              {type.maxCarryForward ? ` ≤ ${Number(type.maxCarryForward)}` : ''}
                            </Badge>
                          ) : null}
                          {type.requiresDocument ? (
                            <Badge tone="warning">Doc required</Badge>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {creating ? <LeaveTypeDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function LeaveTypeDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [applicableTo, setApplicableTo] = React.useState<'STAFF' | 'STUDENT'>('STAFF');
  const [annualQuota, setAnnualQuota] = React.useState('');
  const [isPaid, setIsPaid] = React.useState(true);
  const [carryForward, setCarryForward] = React.useState(false);
  const [maxCarryForward, setMaxCarryForward] = React.useState('');
  const [requiresDocument, setRequiresDocument] = React.useState(false);

  const codeOk = /^[A-Z0-9_-]{1,20}$/.test(code.trim());

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="New leave type"
      submitLabel="Create leave type"
      values={{
        name,
        code,
        applicableTo,
        annualQuota,
        isPaid,
        carryForward,
        maxCarryForward,
        requiresDocument,
      }}
      isValid={name.trim().length > 0 && codeOk}
      successMessage="Leave type created"
      invalidates={[['leave-types']]}
      submit={(v) =>
        api.post('/leave/types', {
          name: v.name.trim(),
          code: v.code.trim().toUpperCase(),
          applicableTo: v.applicableTo,
          ...(v.annualQuota ? { annualQuota: Number(v.annualQuota) } : {}),
          isPaid: v.isPaid,
          carryForward: v.carryForward,
          ...(v.carryForward && v.maxCarryForward
            ? { maxCarryForward: Number(v.maxCarryForward) }
            : {}),
          requiresDocument: v.requiresDocument,
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={2}>
            <Field label="Name" required error={errors.name}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Casual Leave"
                autoFocus
              />
            </Field>
            <Field
              label="Code"
              required
              error={errors.code}
              help={code && !codeOk ? 'Uppercase letters, digits, dash or underscore' : undefined}
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CL"
              />
            </Field>
          </FieldRow>
          <FieldRow columns={2}>
            <Field label="Applies to" error={errors.applicableTo}>
              <Select
                value={applicableTo}
                onChange={(e) => setApplicableTo(e.target.value as 'STAFF' | 'STUDENT')}
              >
                <option value="STAFF">Staff</option>
                <option value="STUDENT">Students</option>
              </Select>
            </Field>
            <Field label="Annual quota (days)" error={errors.annualQuota}>
              <Input
                type="number"
                min={0}
                max={365}
                value={annualQuota}
                onChange={(e) => setAnnualQuota(e.target.value)}
              />
            </Field>
          </FieldRow>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPaid}
                onChange={(e) => setIsPaid(e.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Paid leave
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={carryForward}
                onChange={(e) => setCarryForward(e.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Carry forward unused days
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresDocument}
                onChange={(e) => setRequiresDocument(e.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Requires supporting document
            </label>
          </div>
          {carryForward ? (
            <Field label="Max days to carry forward" error={errors.maxCarryForward}>
              <Input
                type="number"
                min={0}
                max={365}
                value={maxCarryForward}
                onChange={(e) => setMaxCarryForward(e.target.value)}
              />
            </Field>
          ) : null}
        </>
      )}
    </FormModal>
  );
}

function DecisionDialog({
  row,
  decision,
  onClose,
}: {
  row: LeaveRow;
  decision: Decision;
  onClose: () => void;
}) {
  const [remarks, setRemarks] = React.useState('');
  const approving = decision === 'APPROVED';
  const person = row.student ?? row.staff;

  const decide = useAction({
    mutationFn: () =>
      api.patch(`/leave/${row.id}/review`, {
        status: decision,
        remarks: remarks || undefined,
      }),
    successMessage: approving ? 'Leave approved' : 'Leave rejected',
    invalidates: [['leave'], ['dashboard']],
    onSuccess: onClose,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Modal
        size="sm"
        title={approving ? 'Approve leave request' : 'Reject leave request'}
        description={`${person?.firstName ?? ''} ${person?.lastName ?? ''} · ${formatDate(
          row.fromDate,
        )}${row.fromDate !== row.toDate ? ` – ${formatDate(row.toDate)}` : ''} · ${Number(
          row.totalDays,
        )} day(s)`}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={approving ? 'primary' : 'danger'}
              loading={decide.isPending}
              // A rejection without a reason leaves the applicant guessing.
              disabled={!approving && remarks.trim().length === 0}
              onClick={() => decide.mutate(undefined)}
            >
              {approving ? 'Approve' : 'Reject'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-2.5 py-2">
            <p className="text-2xs text-[var(--color-ink-muted)]">Reason given</p>
            <p className="mt-0.5 text-sm">{row.reason}</p>
          </div>

          <Field
            label="Remarks"
            required={!approving}
            help={
              approving
                ? 'Optional — shared with the applicant'
                : 'Explain why, so the applicant knows what to do next'
            }
          >
            <Textarea
              rows={3}
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              autoFocus
            />
          </Field>
        </div>
      </Modal>
    </Dialog>
  );
}
