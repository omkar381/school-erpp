'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Download, Search, TriangleAlert } from 'lucide-react';
import { collectPaymentSchema, type CollectPaymentInput } from '@erp/validation';
import { PAYMENT_METHODS, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { formatMoney, saveBlob } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, FieldRow } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, LoadingState, Spinner } from '@/components/ui/states';

interface StudentHit {
  id: string;
  fullName: string;
  admissionNumber: string;
  outstandingAmount: number;
  enrollment: { class: { name: string } | null; section: { name: string } | null } | null;
}

interface Ledger {
  summary: {
    billed: number;
    paid: number;
    refunded: number;
    outstanding: number;
    invoiceCount: number;
    overdueCount: number;
  };
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    dueDate: string;
    total: string;
    paidAmount: string;
    balance: string;
    currency: string;
    installment?: { name: string; sequence: number } | null;
  }>;
}

/** Instruments that need a reference number to be traceable later. */
const NEEDS_REFERENCE = new Set(['UPI', 'CARD', 'NET_BANKING', 'BANK_TRANSFER', 'ONLINE_GATEWAY']);

export default function CollectPaymentPage() {
  const router = useRouter();
  const params = useSearchParams();
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';

  const [studentId, setStudentId] = React.useState<string | null>(params.get('studentId'));
  const [term, setTerm] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [selectedInvoices, setSelectedInvoices] = React.useState<string[]>([]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 280);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: matches, isFetching: searching } = useQuery({
    queryKey: ['collect', 'students', debounced],
    queryFn: () =>
      api.get<{ items: StudentHit[] }>('/students', { search: debounced, limit: 8, status: 'ACTIVE' }),
    enabled: debounced.length >= 2 && !studentId,
  });

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['collect', 'ledger', studentId],
    queryFn: () => api.get<Ledger>(`/fees/students/${studentId}/ledger`),
    enabled: Boolean(studentId),
  });

  const { data: student } = useQuery({
    queryKey: ['collect', 'student', studentId],
    queryFn: () => api.get<StudentHit>(`/students/${studentId}`),
    enabled: Boolean(studentId),
  });

  const unpaid = React.useMemo(
    () => (ledger?.invoices ?? []).filter((invoice) => Number(invoice.balance) > 0),
    [ledger],
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<CollectPaymentInput>({
    resolver: zodResolver(collectPaymentSchema),
    defaultValues: { method: 'CASH', amount: 0, studentId: studentId ?? '' },
  });

  // `useWatch` rather than `watch`: it subscribes just this component to the
  // two fields that drive the layout, instead of re-rendering the whole form
  // on every keystroke.
  const method = useWatch({ control, name: 'method' });
  const amount = Number(useWatch({ control, name: 'amount' }) || 0);

  // Selecting invoices proposes their combined balance, which is what a clerk
  // taking a full-term payment almost always wants.
  const selectedTotal = unpaid
    .filter((invoice) => selectedInvoices.includes(invoice.id))
    .reduce((sum, invoice) => sum + Number(invoice.balance), 0);

  React.useEffect(() => {
    if (studentId) setValue('studentId', studentId);
  }, [studentId, setValue]);

  const collect = useAction({
    mutationFn: (values: CollectPaymentInput) => api.post<{ id: string; receiptNumber: string }>(
      '/payments/collect',
      {
        ...values,
        invoiceIds: selectedInvoices.length > 0 ? selectedInvoices : undefined,
      },
    ),
    successMessage: (data) => `Receipt ${data.receiptNumber} recorded`,
    invalidates: [['fees'], ['payments'], ['collect'], ['students']],
    onSuccess: async (data) => {
      // Hand the parent their receipt immediately rather than making them go
      // find it in the payments list.
      try {
        const file = await api.download(`/documents/receipts/${data.id}`);
        saveBlob(file.blob, file.fileName);
      } catch {
        // A failed download must not undo a recorded payment.
      }
      reset({ method: 'CASH', amount: 0, studentId: studentId ?? '' });
      setSelectedInvoices([]);
      router.push('/fees/payments');
    },
    onError: (error) => {
      for (const [field, message] of Object.entries(error.byField)) {
        setError(field as keyof CollectPaymentInput, { message });
      }
    },
  });

  const outstanding = ledger?.summary.outstanding ?? 0;
  const overpaying = amount > outstanding && outstanding > 0;

  return (
    <>
      <PageHeader
        title="Collect payment"
        description="Record a payment against a student's outstanding invoices."
      />

      {!studentId ? (
        <Card className="max-w-2xl">
          <CardHeader title="Find the student" description="Search by name or admission number" />
          <CardBody>
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Name or admission number"
              icon={<Search />}
              autoFocus
              aria-label="Search students"
            />

            <div className="mt-3">
              {debounced.length < 2 ? (
                <p className="py-6 text-center text-xs text-[var(--color-ink-muted)]">
                  Type at least two characters
                </p>
              ) : searching ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : (matches?.items ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-[var(--color-ink-muted)]">
                  No student matched “{debounced}”
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-sm)] border border-[var(--color-border)]">
                  {(matches?.items ?? []).map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => setStudentId(hit.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-sunken)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{hit.fullName}</span>
                          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                            {hit.admissionNumber}
                            {hit.enrollment?.class
                              ? ` · ${hit.enrollment.class.name} ${hit.enrollment.section?.name ?? ''}`
                              : ''}
                          </span>
                        </span>
                        {hit.outstandingAmount > 0 ? (
                          <span className="shrink-0 text-sm font-medium tabular text-[var(--color-danger)]">
                            {formatMoney(hit.outstandingAmount, currency)}
                          </span>
                        ) : (
                          <span className="shrink-0 text-2xs text-[var(--color-success)]">
                            No dues
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>
      ) : ledgerLoading ? (
        <LoadingState label="Loading fee ledger" />
      ) : (
        <form onSubmit={handleSubmit((values) => collect.mutate(values))}>
          <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <div className="space-y-4">
              <Card>
                <CardHeader
                  title={student?.fullName ?? 'Student'}
                  description={`${student?.admissionNumber ?? ''} · outstanding ${formatMoney(
                    outstanding,
                    currency,
                  )}`}
                  actions={
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setStudentId(null);
                        setSelectedInvoices([]);
                      }}
                    >
                      Change student
                    </Button>
                  }
                />
                <CardBody className="p-0">
                  {unpaid.length === 0 ? (
                    <EmptyState
                      className="py-10"
                      icon={<Check className="text-[var(--color-success)]" />}
                      title="Nothing outstanding"
                      description="This student has no unpaid invoices. A payment will be held as credit."
                    />
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--color-surface-sunken)]">
                        <tr className="hairline">
                          <th className="w-9 px-3 py-2" />
                          <th className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                            Invoice
                          </th>
                          <th className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                            Due
                          </th>
                          <th className="px-3 py-2 text-right text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                            Balance
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]">
                        {unpaid.map((invoice) => {
                          const checked = selectedInvoices.includes(invoice.id);
                          return (
                            <tr
                              key={invoice.id}
                              className={checked ? 'bg-[var(--color-accent-soft)]' : undefined}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  aria-label={`Apply payment to ${invoice.invoiceNumber}`}
                                  onChange={() =>
                                    setSelectedInvoices((current) =>
                                      checked
                                        ? current.filter((id) => id !== invoice.id)
                                        : [...current, invoice.id],
                                    )
                                  }
                                  className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <span className="block font-medium tabular">
                                  {invoice.invoiceNumber}
                                </span>
                                <span className="block text-2xs text-[var(--color-ink-muted)]">
                                  {invoice.installment?.name ?? ''}{' '}
                                  <StatusBadge status={invoice.status} />
                                </span>
                              </td>
                              <td className="px-3 py-2">{formatDate(invoice.dueDate)}</td>
                              <td className="numeric px-3 py-2 font-medium">
                                {formatMoney(invoice.balance, invoice.currency ?? currency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </CardBody>

                {selectedInvoices.length > 0 ? (
                  <CardFooter className="justify-between">
                    <span className="text-xs text-[var(--color-ink-secondary)]">
                      {selectedInvoices.length} invoice(s) selected ·{' '}
                      <span className="font-medium tabular">
                        {formatMoney(selectedTotal, currency)}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => setValue('amount', selectedTotal)}
                    >
                      Use this amount
                    </Button>
                  </CardFooter>
                ) : null}
              </Card>
            </div>

            <Card className="h-fit">
              <CardHeader title="Payment details" />
              <CardBody className="space-y-3">
                <Field label="Amount" error={errors.amount?.message} required>
                  <Input
                    {...register('amount')}
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="text-right tabular"
                  />
                </Field>

                {overpaying ? (
                  <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--color-warning-border)] bg-[var(--color-warning-soft)] px-2.5 py-2">
                    <TriangleAlert
                      className="mt-px size-3.5 shrink-0 text-[var(--color-warning)]"
                      aria-hidden
                    />
                    <p className="text-2xs text-[var(--color-warning)]">
                      This is more than the {formatMoney(outstanding, currency)} outstanding. The
                      server will refuse an overpayment against selected invoices.
                    </p>
                  </div>
                ) : null}

                <Field label="Method" error={errors.method?.message} required>
                  <Select {...register('method')}>
                    {PAYMENT_METHODS.filter((value) => value !== 'ADJUSTMENT').map((value) => (
                      <option key={value} value={value}>
                        {humanise(value)}
                      </option>
                    ))}
                  </Select>
                </Field>

                {NEEDS_REFERENCE.has(method) ? (
                  <Field
                    label="Reference number"
                    help="Transaction or UTR number, so this can be reconciled later"
                    error={errors.referenceNumber?.message}
                  >
                    <Input {...register('referenceNumber')} placeholder="e.g. 402318849201" />
                  </Field>
                ) : null}

                {method === 'CHEQUE' ? (
                  <FieldRow columns={1}>
                    <Field label="Cheque number" error={errors.chequeNumber?.message}>
                      <Input {...register('chequeNumber')} />
                    </Field>
                    <Field label="Bank" error={errors.bankName?.message}>
                      <Input {...register('bankName')} />
                    </Field>
                    <Field label="Cheque date" error={errors.chequeDate?.message}>
                      <Input {...register('chequeDate')} type="date" />
                    </Field>
                  </FieldRow>
                ) : null}

                <Field label="Notes" error={errors.notes?.message}>
                  <Textarea {...register('notes')} rows={2} placeholder="Optional" />
                </Field>
              </CardBody>

              <CardFooter>
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  loading={collect.isPending}
                  icon={<Download />}
                >
                  Record payment and print receipt
                </Button>
              </CardFooter>
            </Card>
          </div>
        </form>
      )}
    </>
  );
}
