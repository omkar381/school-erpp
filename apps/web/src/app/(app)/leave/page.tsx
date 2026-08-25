'use client';

import * as React from 'react';
import { Check, PlaneTakeoff, X } from 'lucide-react';
import { LEAVE_STATUSES, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, Modal } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/states';

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

  return (
    <>
      <PageHeader
        title="Leave"
        description="Leave requests from students and staff, and their approval status."
      />

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
