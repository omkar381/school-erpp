'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, Download, Plus, Receipt, RotateCcw, Undo2, X } from 'lucide-react';
import { PAYMENT_METHODS, PAYMENT_STATUSES, REFUND_STATUSES, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { formatMoney, saveBlob } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PaymentRow {
  id: string;
  receiptNumber: string;
  method: string;
  status: string;
  amount: string;
  refundedAmount: string | null;
  currency: string;
  paidAt: string | null;
  referenceNumber: string | null;
  student?: {
    id: string;
    admissionNumber: string;
    firstName: string;
    lastName: string | null;
  } | null;
}

interface RefundRow {
  id: string;
  refundNumber: string;
  amount: string;
  currency: string;
  status: string;
  reason: string;
  method: string | null;
  createdAt: string;
  rejectedReason: string | null;
  payment: {
    receiptNumber: string;
    method: string;
    amount: string;
    student: {
      id: string;
      admissionNumber: string;
      firstName: string;
      lastName: string | null;
    } | null;
  };
  invoice: { invoiceNumber: string } | null;
}

const PAYMENT_QUERIES = [['payments'], ['payments', 'refunds']];

export default function PaymentsPage() {
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const canCollect = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('fees.collect'),
  );
  const canRefund = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('fees.refund'),
  );

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment received, its receipt, and any refunds against it."
        actions={
          canCollect ? (
            <Button size="sm" variant="primary" asChild icon={<Plus />}>
              <Link href="/fees/collect">Collect payment</Link>
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="payments">
        <TabsList>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="refunds">Refunds</TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          <PaymentsTab
            currency={currency}
            canCollect={Boolean(canCollect)}
            canRefund={Boolean(canRefund)}
          />
        </TabsContent>

        <TabsContent value="refunds">
          <RefundsTab currency={currency} canRefund={Boolean(canRefund)} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

function PaymentsTab({
  currency,
  canCollect,
  canRefund,
}: {
  currency: string;
  canCollect: boolean;
  canRefund: boolean;
}) {
  const list = useListQuery<PaymentRow>('payments', '/payments', {
    initialSortBy: 'paidAt',
    initialSortOrder: 'desc',
  });

  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [clearing, setClearing] = React.useState<PaymentRow | null>(null);
  const [bouncing, setBouncing] = React.useState<PaymentRow | null>(null);
  const [refunding, setRefunding] = React.useState<PaymentRow | null>(null);

  const clear = useAction({
    mutationFn: (id: string) => api.post(`/payments/${id}/clear`, {}),
    successMessage: 'Cheque cleared',
    invalidates: PAYMENT_QUERIES,
    onSuccess: () => setClearing(null),
  });

  async function downloadReceipt(id: string, receiptNumber: string) {
    setDownloading(id);
    try {
      const file = await api.download(`/documents/receipts/${id}`);
      saveBlob(file.blob, file.fileName || `${receiptNumber}.pdf`);
    } finally {
      setDownloading(null);
    }
  }

  const columns: Column<PaymentRow>[] = [
    {
      key: 'receiptNumber',
      header: 'Receipt',
      sortable: true,
      cell: (row) => <span className="font-medium tabular">{row.receiptNumber}</span>,
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
    { key: 'paidAt', header: 'Date', sortable: true, cell: (row) => formatDate(row.paidAt) },
    {
      key: 'method',
      header: 'Method',
      cell: (row) => (
        <span>
          {humanise(row.method)}
          {row.referenceNumber ? (
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.referenceNumber}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      sortable: true,
      cell: (row) => {
        const refunded = Number(row.refundedAmount ?? 0);
        return (
          <span>
            <span className="block font-medium">
              {formatMoney(row.amount, row.currency ?? currency)}
            </span>
            {refunded > 0 ? (
              <span className="block text-2xs text-[var(--color-ink-muted)]">
                −{formatMoney(refunded, row.currency ?? currency)} refunded
              </span>
            ) : null}
          </span>
        );
      },
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (row) => {
        const refundable =
          (row.status === 'SUCCESS' || row.status === 'PARTIALLY_REFUNDED') &&
          Number(row.amount) - Number(row.refundedAmount ?? 0) > 0;
        return (
          <div
            className="flex items-center justify-end gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            {canCollect && row.status === 'PROCESSING' ? (
              <>
                <Button size="xs" variant="ghost" icon={<Check />} onClick={() => setClearing(row)}>
                  Clear
                </Button>
                <Button size="xs" variant="ghost" icon={<X />} onClick={() => setBouncing(row)}>
                  Bounce
                </Button>
              </>
            ) : null}
            {canRefund && refundable ? (
              <Button size="xs" variant="ghost" icon={<Undo2 />} onClick={() => setRefunding(row)}>
                Refund
              </Button>
            ) : null}
            {row.status === 'SUCCESS' ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Download receipt ${row.receiptNumber}`}
                loading={downloading === row.id}
                onClick={() => void downloadReceipt(row.id, row.receiptNumber)}
              >
                <Download />
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by receipt number or reference"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Method"
          value={list.state.filters.method}
          onChange={(value) => list.setFilter('method', value)}
          options={PAYMENT_METHODS.map((method) => ({ value: method, label: humanise(method) }))}
        />
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={PAYMENT_STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
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
            icon={<Receipt />}
            title="No payments match these filters"
            description="Collected payments appear here with a downloadable receipt."
          />
        }
      />

      <ConfirmDialog
        open={clearing !== null}
        onOpenChange={(open) => !open && setClearing(null)}
        title="Mark this cheque as cleared?"
        description={
          clearing
            ? `${clearing.receiptNumber} for ${formatMoney(clearing.amount, currency)} will be settled and the invoice updated.`
            : undefined
        }
        confirmLabel="Mark cleared"
        loading={clear.isPending}
        onConfirm={() => clearing && clear.mutate(clearing.id)}
      />

      {bouncing ? (
        <BounceDialog payment={bouncing} currency={currency} onClose={() => setBouncing(null)} />
      ) : null}
      {refunding ? (
        <RefundDialog payment={refunding} currency={currency} onClose={() => setRefunding(null)} />
      ) : null}
    </>
  );
}

function BounceDialog({
  payment,
  currency,
  onClose,
}: {
  payment: PaymentRow;
  currency: string;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState('');

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title="Mark payment as failed"
      description={`${payment.receiptNumber} for ${formatMoney(payment.amount, currency)}. The invoice balance is restored.`}
      submitLabel="Mark as failed"
      values={{ reason }}
      isValid={reason.trim().length > 0}
      successMessage="Payment marked as failed"
      invalidates={PAYMENT_QUERIES}
      submit={(values) =>
        api.post(`/payments/${payment.id}/fail`, { reason: values.reason.trim() })
      }
    >
      {(errors) => (
        <Field label="Reason" required error={errors.reason}>
          <Textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Cheque returned unpaid — insufficient funds"
            autoFocus
          />
        </Field>
      )}
    </FormModal>
  );
}

function RefundDialog({
  payment,
  currency,
  onClose,
}: {
  payment: PaymentRow;
  currency: string;
  onClose: () => void;
}) {
  const maxRefund = Number(payment.amount) - Number(payment.refundedAmount ?? 0);
  const [amount, setAmount] = React.useState(String(maxRefund));
  const [reason, setReason] = React.useState('');

  const amountValue = Number(amount);
  const amountOk = Number.isFinite(amountValue) && amountValue > 0 && amountValue <= maxRefund;

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title="Request a refund"
      description={`Against ${payment.receiptNumber}. Up to ${formatMoney(maxRefund, currency)} can be refunded.`}
      submitLabel="Request refund"
      values={{ amount, reason }}
      isValid={amountOk && reason.trim().length > 0}
      successMessage="Refund requested — it needs approval before the money moves"
      invalidates={PAYMENT_QUERIES}
      submit={(values) =>
        api.post('/payments/refunds', {
          paymentId: payment.id,
          amount: Number(values.amount),
          reason: values.reason.trim(),
        })
      }
    >
      {(errors) => (
        <>
          <Field
            label="Amount"
            required
            error={
              errors.amount ??
              (amount && !amountOk
                ? `Enter an amount up to ${formatMoney(maxRefund, currency)}`
                : undefined)
            }
          >
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              max={maxRefund}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="text-right tabular"
              autoFocus
            />
          </Field>
          <Field label="Reason" required error={errors.reason}>
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Overpayment on the term invoice"
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

function RefundsTab({ currency, canRefund }: { currency: string; canRefund: boolean }) {
  const [status, setStatus] = React.useState('');
  const [deciding, setDeciding] = React.useState<{ refund: RefundRow; approve: boolean } | null>(
    null,
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['payments', 'refunds', status],
    queryFn: () => api.get<RefundRow[]>('/payments/refunds', status ? { status } : undefined),
  });

  const rows = data ?? [];

  const columns: Column<RefundRow>[] = [
    {
      key: 'refundNumber',
      header: 'Refund',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block font-medium tabular">{row.refundNumber}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            vs {row.payment.receiptNumber}
            {row.invoice ? ` · ${row.invoice.invoiceNumber}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'student',
      header: 'Student',
      cell: (row) =>
        row.payment.student ? (
          <Link
            href={`/students/${row.payment.student.id}`}
            className="min-w-0 hover:text-[var(--color-accent)]"
          >
            <span className="block truncate">
              {row.payment.student.firstName} {row.payment.student.lastName ?? ''}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.payment.student.admissionNumber}
            </span>
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (row) => (
        <span className="block max-w-xs truncate" title={row.reason}>
          {row.reason}
          {row.status === 'REJECTED' && row.rejectedReason ? (
            <span className="block truncate text-2xs text-[var(--color-danger)]">
              Rejected: {row.rejectedReason}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (row) => (
        <span className="font-medium">{formatMoney(row.amount, row.currency ?? currency)}</span>
      ),
    },
    { key: 'createdAt', header: 'Requested', cell: (row) => formatDate(row.createdAt) },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (row) =>
        canRefund && row.status === 'REQUESTED' ? (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="xs"
              variant="ghost"
              icon={<Check />}
              onClick={() => setDeciding({ refund: row, approve: true })}
            >
              Approve
            </Button>
            <Button
              size="xs"
              variant="ghost"
              icon={<X />}
              onClick={() => setDeciding({ refund: row, approve: false })}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <FilterBar
        search=""
        onSearchChange={() => undefined}
        searchPlaceholder=""
        activeFilterCount={0}
      >
        <FilterSelect
          label="Status"
          value={status}
          onChange={(value) => setStatus(value ?? '')}
          options={REFUND_STATUSES.map((value) => ({ value, label: humanise(value) }))}
        />
      </FilterBar>

      {isLoading ? (
        <LoadingState label="Loading refunds" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<RotateCcw />}
          title={status ? 'No refunds with this status' : 'No refunds yet'}
          description="Refunds requested against a payment are listed here for approval."
        />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />
      )}

      {deciding ? (
        <DecideRefundDialog
          refund={deciding.refund}
          approve={deciding.approve}
          currency={currency}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </>
  );
}

function DecideRefundDialog({
  refund,
  approve,
  currency,
  onClose,
}: {
  refund: RefundRow;
  approve: boolean;
  currency: string;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState('');
  const [gatewayRefundId, setGatewayRefundId] = React.useState('');
  const online = refund.payment.method === 'ONLINE_GATEWAY';

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={approve ? 'Approve this refund?' : 'Reject this refund?'}
      description={
        approve
          ? `${formatMoney(refund.amount, currency)} will be refunded against ${refund.payment.receiptNumber} and the balance restored.`
          : `${refund.refundNumber} for ${formatMoney(refund.amount, currency)} will be turned down.`
      }
      submitLabel={approve ? 'Approve refund' : 'Reject refund'}
      values={{ reason, gatewayRefundId }}
      isValid={approve || reason.trim().length > 0}
      successMessage={approve ? 'Refund approved' : 'Refund rejected'}
      invalidates={PAYMENT_QUERIES}
      submit={(values) =>
        api.post(`/payments/refunds/${refund.id}/decide`, {
          approve,
          ...(values.reason.trim() ? { reason: values.reason.trim() } : {}),
          ...(approve && online && values.gatewayRefundId.trim()
            ? { gatewayRefundId: values.gatewayRefundId.trim() }
            : {}),
        })
      }
    >
      {(errors) => (
        <>
          {approve && online ? (
            <Field
              label="Gateway refund id"
              error={errors.gatewayRefundId}
              help="From the payment gateway, if the refund was already issued there"
            >
              <Input
                value={gatewayRefundId}
                onChange={(event) => setGatewayRefundId(event.target.value)}
                placeholder="rfnd_..."
              />
            </Field>
          ) : null}
          <Field
            label="Reason"
            required={!approve}
            error={errors.reason}
            help={approve ? 'Optional note for the record' : undefined}
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={approve ? 'Optional' : 'Why the refund is being turned down'}
              autoFocus
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}
