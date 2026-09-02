'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BadgePercent, FileStack, Layers, Plus, Receipt, Trash2 } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useClasses } from '@/hooks/use-lookups';
import { useListQuery } from '@/hooks/use-list-query';
import { formatMoney } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface FeeHead {
  id: string;
  name: string;
  code: string;
  category: string;
  frequency: string;
  isOptional: boolean;
  isRefundable: boolean;
  isActive: boolean;
  description: string | null;
  _count?: { items: number; invoiceItems: number };
}

interface StructureItem {
  id: string;
  feeHeadId: string;
  amount: string;
  isOptional: boolean;
  feeHead: { id: string; name: string; code: string; category: string };
}

interface Installment {
  id: string;
  name: string;
  sequence: number;
  percentage: string | null;
  amount: string | null;
  dueDate: string;
}

interface FeeStructure {
  id: string;
  name: string;
  description: string | null;
  classId: string | null;
  totalAmount: string;
  currency: string;
  isActive: boolean;
  class: { id: string; name: string; level: number } | null;
  items: StructureItem[];
  installments: Installment[];
  _count: { invoices: number };
}

interface Discount {
  id: string;
  name: string;
  code: string;
  kind: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: string;
  maxAmount: string | null;
  description: string | null;
  requiresApproval: boolean;
  isActive: boolean;
  feeHeadIds: string[];
  _count: { students: number };
}

const FEE_CATEGORIES = [
  'ADMISSION',
  'TUITION',
  'EXAM',
  'TRANSPORT',
  'LIBRARY',
  'ACTIVITY',
  'HOSTEL',
  'OTHER',
];
const FREQUENCIES = ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'CUSTOM'];
const DISCOUNT_KINDS = ['DISCOUNT', 'SCHOLARSHIP', 'CONCESSION', 'SIBLING', 'STAFF_WARD', 'MERIT'];

const FEE_QUERIES = [['fee-heads'], ['fee-structures'], ['fee-discounts']];

export default function FeesSetupPage() {
  const canManage = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('fees.structure.manage'),
  );
  const canGenerate = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('fees.invoice.create'),
  );
  const canDiscount = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('fees.discount.manage'),
  );

  return (
    <>
      <PageHeader
        title="Fee setup"
        description="Fee heads, the structures that bill them, and discounts."
        actions={
          <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
            <Link href="/fees">Back to fees</Link>
          </Button>
        }
      />

      <Tabs defaultValue="structures">
        <TabsList>
          <TabsTrigger value="structures">Fee structures</TabsTrigger>
          <TabsTrigger value="heads">Fee heads</TabsTrigger>
          <TabsTrigger value="discounts">Discounts</TabsTrigger>
        </TabsList>

        <TabsContent value="structures">
          <StructuresTab canManage={canManage} canGenerate={canGenerate} />
        </TabsContent>
        <TabsContent value="heads">
          <HeadsTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="discounts">
          <DiscountsTab canManage={canManage} canDiscount={canDiscount} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ===========================================================================
// Fee heads
// ===========================================================================

function HeadsTab({ canManage }: { canManage: boolean }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fee-heads'],
    queryFn: () => api.get<FeeHead[]>('/fees/heads', { inactive: 'true' }),
  });

  const [editing, setEditing] = React.useState<FeeHead | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<FeeHead | null>(null);

  const remove = useAction({
    mutationFn: (id: string) => api.delete(`/fees/heads/${id}`),
    successMessage: 'Fee head removed',
    invalidates: FEE_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  if (isLoading) return <LoadingState label="Loading fee heads" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const rows = data ?? [];

  return (
    <>
      {canManage ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New fee head
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No fee heads yet"
          description="A fee head is a billable line — Tuition, Transport, Exam — that structures draw on."
          action={
            canManage ? (
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                New fee head
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
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-left">Frequency</th>
                    <th className="px-3 py-2 text-left">Flags</th>
                    <th className="px-3 py-2 text-right">Used by</th>
                    {canManage ? <th className="px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {rows.map((head) => (
                    <tr key={head.id} className={!head.isActive ? 'opacity-50' : undefined}>
                      <td className="px-3 py-2 font-medium">{head.name}</td>
                      <td className="px-3 py-2 font-mono text-2xs">{head.code}</td>
                      <td className="px-3 py-2">{humanise(head.category)}</td>
                      <td className="px-3 py-2">{humanise(head.frequency)}</td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {head.isOptional ? <Badge>Optional</Badge> : null}
                          {head.isRefundable ? <Badge tone="info">Refundable</Badge> : null}
                          {!head.isActive ? <Badge tone="warning">Inactive</Badge> : null}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right numeric text-2xs text-[var(--color-ink-muted)]">
                        {head._count
                          ? `${head._count.items} structure(s)`
                          : ''}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="xs" variant="ghost" onClick={() => setEditing(head)}>
                              Edit
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              icon={<Trash2 />}
                              aria-label={`Remove ${head.name}`}
                              onClick={() => setDeleting(head)}
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {creating ? <HeadDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <HeadDialog head={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this fee head?"
        description={
          deleting
            ? `"${deleting.name}" will be deactivated. It is kept if any structure or invoice still references it.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

function HeadDialog({ head, onClose }: { head?: FeeHead; onClose: () => void }) {
  const isEdit = Boolean(head);
  const [name, setName] = React.useState(head?.name ?? '');
  const [code, setCode] = React.useState(head?.code ?? '');
  const [category, setCategory] = React.useState(head?.category ?? 'OTHER');
  const [frequency, setFrequency] = React.useState(head?.frequency ?? 'ONE_TIME');
  const [isOptional, setIsOptional] = React.useState(head?.isOptional ?? false);
  const [isRefundable, setIsRefundable] = React.useState(head?.isRefundable ?? false);
  const [description, setDescription] = React.useState(head?.description ?? '');

  const codeOk = /^[A-Z0-9_-]{2,30}$/.test(code.trim());

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={isEdit ? 'Edit fee head' : 'New fee head'}
      submitLabel={isEdit ? 'Save changes' : 'Create fee head'}
      values={{ name, code, category, frequency, isOptional, isRefundable, description }}
      isValid={name.trim().length > 0 && (isEdit || codeOk)}
      successMessage={isEdit ? 'Fee head updated' : 'Fee head created'}
      invalidates={FEE_QUERIES}
      submit={(v) => {
        const body = {
          name: v.name.trim(),
          category: v.category,
          frequency: v.frequency,
          isOptional: v.isOptional,
          isRefundable: v.isRefundable,
          description: v.description.trim() || undefined,
        };
        return isEdit
          ? api.patch(`/fees/heads/${head!.id}`, body)
          : api.post('/fees/heads', { ...body, code: v.code.trim().toUpperCase() });
      }}
    >
      {(errors) => (
        <>
          <FieldRow columns={2}>
            <Field label="Name" required error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            {!isEdit ? (
              <Field
                label="Code"
                required
                error={errors.code}
                help={code && !codeOk ? 'Uppercase letters, digits, dash or underscore' : undefined}
              >
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              </Field>
            ) : null}
          </FieldRow>
          <FieldRow columns={2}>
            <Field label="Category" error={errors.category}>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {FEE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {humanise(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Frequency" error={errors.frequency}>
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {humanise(f)}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isOptional}
                onChange={(e) => setIsOptional(e.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Optional
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isRefundable}
                onChange={(e) => setIsRefundable(e.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Refundable
            </label>
          </div>
          <Field label="Description" error={errors.description}>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

// ===========================================================================
// Fee structures
// ===========================================================================

function StructuresTab({
  canManage,
  canGenerate,
}: {
  canManage: boolean;
  canGenerate: boolean;
}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fee-structures'],
    queryFn: () =>
      api.get<{ items: FeeStructure[] } | FeeStructure[]>('/fees/structures', { limit: 100 }),
  });

  const [creating, setCreating] = React.useState(false);
  const [generating, setGenerating] = React.useState<FeeStructure | null>(null);
  const [deleting, setDeleting] = React.useState<FeeStructure | null>(null);

  const remove = useAction({
    mutationFn: (id: string) => api.delete(`/fees/structures/${id}`),
    successMessage: 'Fee structure removed',
    invalidates: FEE_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  if (isLoading) return <LoadingState label="Loading fee structures" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const rows = Array.isArray(data) ? data : (data?.items ?? []);

  return (
    <>
      {canManage ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New structure
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileStack />}
          title="No fee structures yet"
          description="A structure lists what a class pays for the year, then bills it as invoices."
          action={
            canManage ? (
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                New structure
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((structure) => (
            <Card key={structure.id}>
              <CardHeader
                title={structure.name}
                description={`${structure.class?.name ?? 'School-wide'} · ${structure.items.length} heads · ${structure._count.invoices} invoices raised`}
                actions={
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold tabular">
                      {formatMoney(structure.totalAmount, structure.currency)}
                    </span>
                    {canGenerate ? (
                      <Button
                        size="xs"
                        icon={<Receipt />}
                        onClick={() => setGenerating(structure)}
                      >
                        Generate invoices
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        icon={<Trash2 />}
                        aria-label={`Remove ${structure.name}`}
                        onClick={() => setDeleting(structure)}
                      />
                    ) : null}
                  </span>
                }
              />
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {structure.items.map((item) => (
                        <tr key={item.id}>
                          <td className="px-4 py-1.5">
                            {item.feeHead.name}
                            {item.isOptional ? (
                              <Badge className="ml-1.5">Optional</Badge>
                            ) : null}
                          </td>
                          <td className="px-4 py-1.5 text-right numeric">
                            {formatMoney(item.amount, structure.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {structure.installments.length > 0 ? (
                  <div className="border-t border-[var(--color-border)] px-4 py-2 text-2xs text-[var(--color-ink-muted)]">
                    Installments:{' '}
                    {structure.installments
                      .map(
                        (i) =>
                          `${i.name} (${i.percentage ? `${Number(i.percentage)}%` : formatMoney(i.amount ?? 0, structure.currency)}, due ${formatDate(i.dueDate)})`,
                      )
                      .join(' · ')}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {creating ? <StructureDialog onClose={() => setCreating(false)} /> : null}
      {generating ? (
        <GenerateInvoicesDialog structure={generating} onClose={() => setGenerating(null)} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this fee structure?"
        description={
          deleting
            ? `"${deleting.name}" will be deactivated. Invoices already raised from it are untouched.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

interface ItemDraft {
  feeHeadId: string;
  amount: string;
  isOptional: boolean;
}

function StructureDialog({ onClose }: { onClose: () => void }) {
  const classes = useClasses();
  const heads = useQuery({
    queryKey: ['fee-heads'],
    queryFn: () => api.get<FeeHead[]>('/fees/heads'),
  });

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [classId, setClassId] = React.useState('');
  const [items, setItems] = React.useState<ItemDraft[]>([
    { feeHeadId: '', amount: '', isOptional: false },
  ]);

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const validItems = items.filter((row) => row.feeHeadId && Number(row.amount) > 0);
  const total = validItems.reduce((sum, row) => sum + Number(row.amount), 0);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="New fee structure"
      description="Add each billable head and its annual amount. Installments can be added later."
      submitLabel="Create structure"
      values={{ name, description, classId, validItems }}
      isValid={name.trim().length > 0 && validItems.length > 0}
      successMessage="Fee structure created"
      invalidates={FEE_QUERIES}
      submit={(v) =>
        api.post('/fees/structures', {
          name: v.name.trim(),
          description: v.description.trim() || undefined,
          ...(v.classId ? { classId: v.classId } : {}),
          items: v.validItems.map((row) => ({
            feeHeadId: row.feeHeadId,
            amount: Number(row.amount),
            isOptional: row.isOptional,
          })),
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
                placeholder="Class 10 — 2026-27"
                autoFocus
              />
            </Field>
            <Field label="Class" error={errors.classId} help="Leave blank for a school-wide structure">
              <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">School-wide</option>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <Field label="Fee heads" required error={errors.validItems}>
            <div className="space-y-2">
              {items.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select
                    value={row.feeHeadId}
                    onChange={(e) => updateItem(index, { feeHeadId: e.target.value })}
                    className="flex-1"
                  >
                    <option value="">Select a fee head</option>
                    {(heads.data ?? []).map((head) => (
                      <option key={head.id} value={head.id}>
                        {head.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    value={row.amount}
                    onChange={(e) => updateItem(index, { amount: e.target.value })}
                    placeholder="Amount"
                    className="w-28"
                    aria-label={`Amount for row ${index + 1}`}
                  />
                  <label className="flex shrink-0 items-center gap-1 text-2xs">
                    <input
                      type="checkbox"
                      checked={row.isOptional}
                      onChange={(e) => updateItem(index, { isOptional: e.target.checked })}
                      className="size-3 accent-[var(--color-accent)]"
                    />
                    Opt.
                  </label>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    icon={<Trash2 />}
                    aria-label={`Remove row ${index + 1}`}
                    onClick={() => setItems((c) => c.filter((_, i) => i !== index))}
                  />
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  size="xs"
                  icon={<Plus />}
                  onClick={() =>
                    setItems((c) => [...c, { feeHeadId: '', amount: '', isOptional: false }])
                  }
                >
                  Add head
                </Button>
                <span className="text-xs font-medium tabular">
                  Total: {formatMoney(total, 'INR')}
                </span>
              </div>
            </div>
          </Field>

          <Field label="Description" error={errors.description}>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

function GenerateInvoicesDialog({
  structure,
  onClose,
}: {
  structure: FeeStructure;
  onClose: () => void;
}) {
  const [installmentId, setInstallmentId] = React.useState('');
  const [issueDate, setIssueDate] = React.useState(new Date().toISOString().slice(0, 10));

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Generate invoices"
      description={`Raises one invoice per active student in ${structure.class?.name ?? 'the school'} from "${structure.name}". Students who already have an invoice for this period are skipped.`}
      submitLabel="Generate invoices"
      values={{ installmentId, issueDate }}
      successMessage={(result: { generated: number; skipped: number; message?: string }) =>
        result.generated === 0
          ? (result.message ?? 'No new invoices — every student was already billed')
          : `${result.generated} invoice(s) raised${result.skipped ? `, ${result.skipped} skipped` : ''}`
      }
      invalidates={[['fee-structures'], ['fees'], ['invoices']]}
      submit={(v) =>
        api.post<{ generated: number; skipped: number; totalBilled: number; message?: string }>(
          '/fees/invoices/generate',
          {
            feeStructureId: structure.id,
            ...(v.installmentId ? { installmentId: v.installmentId } : {}),
            issueDate: v.issueDate,
          },
        )
      }
    >
      {(errors) => (
        <>
          <Field
            label="Period"
            error={errors.installmentId}
            help="Bill one installment, or the whole year at once"
          >
            <Select value={installmentId} onChange={(e) => setInstallmentId(e.target.value)}>
              <option value="">Full year ({formatMoney(structure.totalAmount, structure.currency)})</option>
              {structure.installments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} — due {formatDate(i.dueDate)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Issue date" error={errors.issueDate}>
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

// ===========================================================================
// Discounts
// ===========================================================================

function DiscountsTab({
  canManage,
  canDiscount,
}: {
  canManage: boolean;
  canDiscount: boolean;
}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fee-discounts'],
    queryFn: () => api.get<Discount[]>('/fees/discounts'),
  });

  const [creating, setCreating] = React.useState(false);
  const [granting, setGranting] = React.useState<Discount | null>(null);

  if (isLoading) return <LoadingState label="Loading discounts" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const rows = data ?? [];

  return (
    <>
      {canManage ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New discount
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<BadgePercent />}
          title="No discounts defined"
          description="Define a concession or scholarship here, then grant it to individual students."
          action={
            canManage ? (
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                New discount
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((discount) => (
            <Card key={discount.id}>
              <CardBody>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{discount.name}</p>
                    <p className="text-2xs text-[var(--color-ink-muted)]">
                      {humanise(discount.kind)} · {discount.code}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular">
                    {discount.type === 'PERCENTAGE'
                      ? `${Number(discount.value)}%`
                      : formatMoney(discount.value, 'INR')}
                  </span>
                </div>
                {discount.description ? (
                  <p className="mb-2 text-xs text-[var(--color-ink-muted)]">{discount.description}</p>
                ) : null}
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-[var(--color-ink-muted)]">
                    {discount._count.students} student(s)
                    {discount.requiresApproval ? ' · needs approval' : ''}
                  </span>
                  {canDiscount ? (
                    <Button size="xs" onClick={() => setGranting(discount)}>
                      Grant to student
                    </Button>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {creating ? <DiscountDialog onClose={() => setCreating(false)} /> : null}
      {granting ? (
        <GrantDiscountDialog discount={granting} onClose={() => setGranting(null)} />
      ) : null}
    </>
  );
}

function DiscountDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [kind, setKind] = React.useState('DISCOUNT');
  const [type, setType] = React.useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');
  const [value, setValue] = React.useState('');
  const [maxAmount, setMaxAmount] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [requiresApproval, setRequiresApproval] = React.useState(true);

  const codeOk = /^[A-Z0-9_-]{2,30}$/.test(code.trim());
  const valueOk = Number(value) > 0 && (type === 'FIXED' || Number(value) <= 100);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="New discount"
      submitLabel="Create discount"
      values={{ name, code, kind, type, value, maxAmount, description, requiresApproval }}
      isValid={name.trim().length > 0 && codeOk && valueOk}
      successMessage="Discount created"
      invalidates={[['fee-discounts']]}
      submit={(v) =>
        api.post('/fees/discounts', {
          name: v.name.trim(),
          code: v.code.trim().toUpperCase(),
          kind: v.kind,
          type: v.type,
          value: Number(v.value),
          ...(v.type === 'PERCENTAGE' && v.maxAmount ? { maxAmount: Number(v.maxAmount) } : {}),
          description: v.description.trim() || undefined,
          requiresApproval: v.requiresApproval,
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={2}>
            <Field label="Name" required error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field
              label="Code"
              required
              error={errors.code}
              help={code && !codeOk ? 'Uppercase letters, digits, dash or underscore' : undefined}
            >
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </Field>
          </FieldRow>
          <FieldRow columns={3}>
            <Field label="Kind" error={errors.kind}>
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {DISCOUNT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {humanise(k)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type" error={errors.type}>
              <Select
                value={type}
                onChange={(e) => setType(e.target.value as 'PERCENTAGE' | 'FIXED')}
              >
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED">Fixed amount</option>
              </Select>
            </Field>
            <Field
              label={type === 'PERCENTAGE' ? 'Percent' : 'Amount'}
              required
              error={errors.value}
              help={!valueOk && value ? (type === 'PERCENTAGE' ? '1–100' : 'More than 0') : undefined}
            >
              <Input
                type="number"
                min={0}
                max={type === 'PERCENTAGE' ? 100 : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          </FieldRow>
          {type === 'PERCENTAGE' ? (
            <Field label="Maximum amount" error={errors.maxAmount} help="Optional cap on the discount">
              <Input
                type="number"
                min={0}
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Description" error={errors.description}>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            A grant of this discount needs approval before it takes effect
          </label>
        </>
      )}
    </FormModal>
  );
}

function GrantDiscountDialog({ discount, onClose }: { discount: Discount; onClose: () => void }) {
  const students = useListQuery<{ id: string; fullName: string; admissionNumber: string }>(
    'fee-discount-student-search',
    '/students',
    { initialLimit: 10 },
  );

  const [studentId, setStudentId] = React.useState('');
  const [overrideValue, setOverrideValue] = React.useState('');
  const [reason, setReason] = React.useState('');

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Grant "${discount.name}"`}
      description={
        discount.requiresApproval
          ? 'This discount needs approval; the grant is recorded as pending unless you can approve it.'
          : 'The discount applies to the student’s future invoices immediately.'
      }
      submitLabel="Grant discount"
      values={{ studentId, overrideValue, reason }}
      isValid={studentId !== ''}
      successMessage="Discount granted"
      invalidates={[['fee-discounts'], ['fees']]}
      submit={(v) =>
        api.post('/fees/discounts/grant', {
          studentId: v.studentId,
          discountId: discount.id,
          ...(v.overrideValue ? { overrideValue: Number(v.overrideValue) } : {}),
          ...(v.reason.trim() ? { reason: v.reason.trim() } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Student" required error={errors.studentId}>
            <div className="space-y-1.5">
              <Input
                placeholder="Search by name or admission number"
                value={students.state.search}
                onChange={(e) => students.setSearch(e.target.value)}
              />
              <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Select a student</option>
                {students.items.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.fullName} — {student.admissionNumber}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field
            label={`Override ${discount.type === 'PERCENTAGE' ? 'percent' : 'amount'}`}
            error={errors.overrideValue}
            help={`Leave blank to use the discount's own ${
              discount.type === 'PERCENTAGE' ? `${Number(discount.value)}%` : formatMoney(discount.value, 'INR')
            }`}
          >
            <Input
              type="number"
              min={0}
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
            />
          </Field>
          <Field label="Reason" error={errors.reason}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
