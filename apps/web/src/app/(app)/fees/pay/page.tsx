'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Receipt, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { humanise } from '@erp/shared-types';
import { api, errorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { openCheckout, type RazorpayOrder } from '@/lib/razorpay';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface Child {
  id: string;
  fullName: string;
  admissionNumber: string;
  outstandingAmount: number;
  enrollment: { class?: { name: string } | null; section?: { name: string } | null } | null;
}

interface LedgerInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  total: string;
  paidAmount: string;
  balance: string;
  currency: string;
}

interface Ledger {
  summary: {
    billed: number;
    paid: number;
    outstanding: number;
    invoiceCount: number;
    overdueCount: number;
  };
  invoices: LedgerInvoice[];
}

/**
 * Self-service fee payment.
 *
 * A parent picks the invoices to clear and pays them through the gateway. The
 * amount is never sent from here — the server recomputes it from the selected
 * invoices' balances, and the signature returned by the gateway is what
 * actually settles the payment.
 */
export default function PayFeesPage() {
  const queryClient = useQueryClient();
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const user = useAuthStore((state) => state.user);
  const canPay = Boolean(user?.permissions.includes('self.fees.pay'));

  const [studentId, setStudentId] = React.useState('');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [paying, setPaying] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const gateway = useQuery({
    queryKey: ['payments', 'gateway-config'],
    queryFn: () => api.get<{ keyId: string; enabled: boolean }>('/payments/gateway/config'),
    staleTime: 30 * 60_000,
  });

  const children = useQuery({
    queryKey: ['guardians', 'my-children'],
    queryFn: () => api.get<Child[]>('/guardians/my-children'),
    enabled: Boolean(user?.guardianId),
  });

  // A parent with one child should not have to choose; a student paying their
  // own fees has no picker at all.
  const activeStudentId = studentId || user?.studentId || children.data?.[0]?.id || '';

  const ledger = useQuery({
    queryKey: ['fees', 'ledger', activeStudentId],
    queryFn: () => api.get<Ledger>(`/fees/students/${activeStudentId}/ledger`),
    enabled: activeStudentId !== '',
  });

  const payable = (ledger.data?.invoices ?? []).filter((invoice) => Number(invoice.balance) > 0);

  // Any invoice that gets settled elsewhere must drop out of the selection.
  const selectedPayable = payable.filter((invoice) => selected.includes(invoice.id));
  const selectedTotal = selectedPayable.reduce(
    (sum, invoice) => sum + Number(invoice.balance),
    0,
  );

  async function pay() {
    if (selectedPayable.length === 0) return;

    setPaying(true);
    setFailure(null);

    try {
      const order = await api.post<RazorpayOrder>('/payments/orders', {
        studentId: activeStudentId,
        invoiceIds: selectedPayable.map((invoice) => invoice.id),
      });

      const result = await openCheckout(order);

      if (!result) {
        // Dismissed. The order stays pending and reconciliation will close it.
        toast('Payment cancelled', {
          description: 'Nothing has been charged.',
        });
        return;
      }

      await api.post('/payments/verify', result);

      toast.success('Payment received', {
        description: `${formatMoney(order.amount, order.currency)} paid against ${
          order.invoices.length
        } invoice${order.invoices.length === 1 ? '' : 's'}.`,
      });

      setSelected([]);
      void queryClient.invalidateQueries({ queryKey: ['fees'] });
      void queryClient.invalidateQueries({ queryKey: ['guardians', 'my-children'] });
    } catch (caught) {
      setFailure(errorMessage(caught));
    } finally {
      setPaying(false);
    }
  }

  if (!canPay) {
    return (
      <>
        <PageHeader title="Pay fees" />
        <EmptyState
          icon={<ShieldCheck />}
          title="Online payment is not available to this account"
          description="Fees can be paid at the school office. Ask the accounts desk for a receipt."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Pay fees"
        description="Settle outstanding invoices online. A receipt is issued immediately."
        actions={
          <Button size="sm" variant="ghost" asChild icon={<Receipt />}>
            <Link href="/fees">Fee history</Link>
          </Button>
        }
      />

      {gateway.data && !gateway.data.enabled ? (
        <div className="mb-4 flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--color-warning-border)] bg-[var(--color-warning-soft)] px-3 py-2">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <p className="text-xs text-[var(--color-warning)]">
            Online payment has not been switched on for this school yet. Please pay at the school
            office.
          </p>
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="mb-4 rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]"
        >
          {failure}
        </div>
      ) : null}

      {(children.data?.length ?? 0) > 1 ? (
        <Card className="mb-4">
          <CardBody className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium">Paying for</span>
            <Select
              value={activeStudentId}
              onChange={(event) => {
                setStudentId(event.target.value);
                setSelected([]);
              }}
              className="w-auto min-w-56"
            >
              {(children.data ?? []).map((child) => (
                <option key={child.id} value={child.id}>
                  {child.fullName} — {child.enrollment?.class?.name ?? ''}{' '}
                  {child.enrollment?.section?.name ?? ''}
                </option>
              ))}
            </Select>
          </CardBody>
        </Card>
      ) : null}

      {activeStudentId === '' ? (
        <EmptyState
          icon={<CreditCard />}
          title="No student linked to this account"
          description="Ask the school office to link your children to your login."
        />
      ) : ledger.isLoading ? (
        <LoadingState label="Loading fee statement" />
      ) : ledger.error ? (
        <ErrorState error={ledger.error} onRetry={() => ledger.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Outstanding invoices"
              description={
                payable.length === 0
                  ? 'Nothing is due.'
                  : 'Tick the invoices you want to pay for now.'
              }
              actions={
                payable.length > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSelected(
                        selected.length === payable.length
                          ? []
                          : payable.map((invoice) => invoice.id),
                      )
                    }
                  >
                    {selected.length === payable.length ? 'Clear all' : 'Select all'}
                  </Button>
                ) : null
              }
            />
            <CardBody className="p-0">
              {payable.length === 0 ? (
                <EmptyState
                  icon={<Receipt />}
                  title="All settled"
                  description="There are no outstanding invoices for this student."
                />
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {payable.map((invoice) => {
                    const overdue = new Date(invoice.dueDate) < new Date();
                    const checked = selected.includes(invoice.id);

                    return (
                      <li key={invoice.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-sunken)]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, invoice.id]
                                  : current.filter((id) => id !== invoice.id),
                              )
                            }
                            className="size-3.5 accent-[var(--color-accent)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {invoice.invoiceNumber}
                            </span>
                            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                              Issued {formatDate(invoice.issueDate)} · due{' '}
                              {formatDate(invoice.dueDate)}
                            </span>
                          </span>
                          {overdue ? <Badge tone="danger">Overdue</Badge> : null}
                          {Number(invoice.paidAmount) > 0 ? (
                            <Badge tone="warning">{humanise(invoice.status)}</Badge>
                          ) : null}
                          <span className="shrink-0 text-sm font-semibold tabular">
                            {formatMoney(invoice.balance, currency)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card className="h-fit">
            <CardHeader title="Summary" />
            <CardBody className="space-y-3">
              <dl className="space-y-1.5 text-xs">
                {[
                  ['Billed this year', ledger.data?.summary.billed ?? 0],
                  ['Paid', ledger.data?.summary.paid ?? 0],
                  ['Outstanding', ledger.data?.summary.outstanding ?? 0],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between">
                    <dt className="text-[var(--color-ink-muted)]">{String(label)}</dt>
                    <dd className="font-medium tabular">{formatMoney(Number(value), currency)}</dd>
                  </div>
                ))}
              </dl>

              <div className="border-t border-[var(--color-border)] pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    Paying now ({selectedPayable.length})
                  </span>
                  <span className="text-lg font-semibold tabular">
                    {formatMoney(selectedTotal, currency)}
                  </span>
                </div>
              </div>

              <Button
                variant="primary"
                className="w-full"
                icon={<CreditCard />}
                loading={paying}
                disabled={
                  selectedPayable.length === 0 || paying || gateway.data?.enabled === false
                }
                onClick={pay}
              >
                Pay {selectedTotal > 0 ? formatMoney(selectedTotal, currency) : ''}
              </Button>

              <p className="flex items-start gap-1.5 text-2xs text-[var(--color-ink-muted)]">
                <ShieldCheck className="mt-px size-3 shrink-0" aria-hidden />
                Card details are entered on the gateway&rsquo;s own secure window. The school never
                sees them.
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
