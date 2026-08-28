'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, RotateCw, XCircle } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/use-list-query';
import { useAction } from '@/hooks/use-action';
import { formatMoney } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { SUBSCRIPTION_STATUSES, type PlanSummary, type SubscriptionSummary } from '@/lib/platform';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog, Dialog, Modal } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/states';

export default function PlatformSubscriptionsPage() {
  const searchParams = useSearchParams();
  const expiringParam = searchParams.get('expiring') ?? undefined;

  const [renewing, setRenewing] = React.useState<SubscriptionSummary | null>(null);
  const [cancelling, setCancelling] = React.useState<SubscriptionSummary | null>(null);

  const list = useListQuery<SubscriptionSummary>(
    'platform-subscriptions',
    '/platform/subscriptions',
    {
      initialSortBy: 'endDate',
      initialSortOrder: 'asc',
      initialFilters: expiringParam ? { expiringWithinDays: expiringParam } : {},
    },
  );

  const { data: plans } = useQuery({
    queryKey: ['platform', 'plans', 'all'],
    queryFn: () => api.get<{ items: PlanSummary[] }>('/platform/plans', { limit: 100 }),
    staleTime: 5 * 60_000,
  });

  const invalidates = [['platform-subscriptions'], ['platform', 'overview']];

  const cancel = useAction({
    mutationFn: ({ id, ...payload }: { id: string; reason?: string; immediate?: boolean }) =>
      api.post(`/platform/subscriptions/${id}/cancel`, payload),
    successMessage: 'Subscription cancelled',
    invalidates: invalidates as never,
    onSuccess: () => setCancelling(null),
  });

  const columns: Column<SubscriptionSummary>[] = [
    {
      key: 'school',
      header: 'School',
      cell: (row) => (
        <span className="min-w-0">
          {row.school ? (
            <Link
              href={`/super-admin/schools/${row.school.id}`}
              className="block truncate font-medium hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {row.school.name}
            </Link>
          ) : (
            <span className="block truncate font-medium">—</span>
          )}
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.school?.code}
            {row.school?.city ? ` · ${row.school.city}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate">{row.plan.name}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {humanise(row.billingCycle)} · {row.autoRenew ? 'auto-renews' : 'no auto-renew'}
          </span>
        </span>
      ),
    },
    {
      key: 'startDate',
      header: 'Started',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => formatDate(row.startDate),
    },
    {
      key: 'endDate',
      header: 'Ends',
      sortable: true,
      cell: (row) => (
        <span>
          {formatDate(row.endDate)}
          <span className="block text-2xs">
            {row.daysRemaining < 0 ? (
              <span className="text-[var(--color-danger)]">
                {Math.abs(row.daysRemaining)} days ago
              </span>
            ) : row.daysRemaining <= 30 ? (
              <span className="text-[var(--color-warning)]">in {row.daysRemaining} days</span>
            ) : (
              <span className="text-[var(--color-ink-muted)]">in {row.daysRemaining} days</span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Value',
      numeric: true,
      sortable: true,
      cell: (row) => formatMoney(row.amount, row.currency),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <span className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Renew"
            title="Renew"
            onClick={(event) => {
              event.stopPropagation();
              setRenewing(row);
            }}
          >
            <RotateCw />
          </Button>
          {row.status !== 'CANCELLED' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel"
              title="Cancel"
              onClick={(event) => {
                event.stopPropagation();
                setCancelling(row);
              }}
            >
              <XCircle />
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Every school's contract: plan, period, value and renewal state."
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by school name or code"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={SUBSCRIPTION_STATUSES.map((status) => ({
            value: status,
            label: humanise(status),
          }))}
        />
        <FilterSelect
          label="Plan"
          value={list.state.filters.planId}
          onChange={(value) => list.setFilter('planId', value)}
          options={(plans?.items ?? []).map((plan) => ({ value: plan.id, label: plan.name }))}
        />
        <FilterSelect
          label="Expiry"
          value={list.state.filters.expiringWithinDays}
          onChange={(value) => list.setFilter('expiringWithinDays', value)}
          allLabel="Any expiry"
          options={[
            { value: '7', label: 'Ending in 7 days' },
            { value: '30', label: 'Ending in 30 days' },
            { value: '90', label: 'Ending in 90 days' },
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
            icon={<CreditCard />}
            title="No subscriptions match this view"
            description="Clear the filters to see every contract."
          />
        }
      />

      <Dialog
        open={renewing !== null}
        onOpenChange={(open) => {
          if (!open) setRenewing(null);
        }}
      >
        {/* Mounted per subscription, so the form's defaults come from props at
            mount rather than from an effect that re-syncs them. */}
        {renewing ? (
          <RenewForm
            subscription={renewing}
            onClose={() => setRenewing(null)}
            invalidates={invalidates}
          />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
        destructive
        loading={cancel.isPending}
        title={`Cancel ${cancelling?.school?.name ?? 'this'} subscription?`}
        confirmLabel="Cancel subscription"
        cancelLabel="Keep it"
        description={
          <>
            The school keeps access until {formatDate(cancelling?.endDate)} and auto-renewal is
            switched off. Nothing is deleted.
          </>
        }
        onConfirm={() => cancelling && cancel.mutate({ id: cancelling.id })}
      />
    </>
  );
}

function RenewForm({
  subscription,
  onClose,
  invalidates,
}: {
  subscription: SubscriptionSummary;
  onClose: () => void;
  invalidates: unknown[][];
}) {
  const [billingCycle, setBillingCycle] = React.useState(subscription.billingCycle);
  const [endDate, setEndDate] = React.useState('');
  const [amount, setAmount] = React.useState('');

  const renew = useAction({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post(`/platform/subscriptions/${subscription.id}/renew`, payload),
    successMessage: 'Subscription renewed',
    invalidates: invalidates as never,
    onSuccess: onClose,
  });

  return (
    <Modal
      title="Renew subscription"
      description={`${subscription.school?.name ?? 'This school'} is on ${subscription.plan.name}, ending ${formatDate(subscription.endDate)}. Renewing early extends from the existing end date.`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={renew.isPending}
            onClick={() =>
              renew.mutate({
                billingCycle,
                ...(endDate ? { endDate } : {}),
                ...(amount ? { amount: Number(amount) } : {}),
              })
            }
          >
            Renew
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Billing cycle">
          <Select value={billingCycle} onChange={(event) => setBillingCycle(event.target.value)}>
            <option value="YEARLY">Yearly</option>
            <option value="MONTHLY">Monthly</option>
          </Select>
        </Field>

        <Field label="End date" help="Leave blank to add one full cycle.">
          <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </Field>

        <Field label="Amount" help="Leave blank to charge the plan's list price.">
          <Input
            type="number"
            min={0}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={String(subscription.amount)}
          />
        </Field>

        {subscription.status === 'CANCELLED' ? (
          <Badge tone="warning">Renewing will reactivate this cancelled subscription.</Badge>
        ) : null}
      </div>
    </Modal>
  );
}
