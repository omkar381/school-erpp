'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeIndianRupee, Check, Plus } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAction } from '@/hooks/use-action';
import { formatMoney, formatNumber } from '@/lib/utils';
import { PLAN_TIERS, type PlanSummary } from '@/lib/platform';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, Modal } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface ModuleOption {
  key: string;
  label: string;
}

interface PlanForm {
  code: string;
  name: string;
  tier: string;
  description: string;
  priceMonthly: string;
  priceYearly: string;
  maxStudents: string;
  maxStaff: string;
  storageMb: string;
  trialDays: string;
  sortOrder: string;
  modules: string[];
}

const EMPTY_FORM: PlanForm = {
  code: '',
  name: '',
  tier: 'PROFESSIONAL',
  description: '',
  priceMonthly: '0',
  priceYearly: '0',
  maxStudents: '1000',
  maxStaff: '100',
  storageMb: '10240',
  trialDays: '14',
  sortOrder: '0',
  modules: [],
};

export default function PlatformPlansPage() {
  const [editing, setEditing] = React.useState<PlanSummary | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deactivating, setDeactivating] = React.useState<PlanSummary | null>(null);

  const plansKey = ['platform', 'plans'];
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: plansKey,
    queryFn: () => api.get<{ items: PlanSummary[] }>('/platform/plans', { limit: 100 }),
  });

  const { data: modules } = useQuery({
    queryKey: ['platform', 'modules'],
    queryFn: () => api.get<ModuleOption[]>('/platform/modules'),
    staleTime: 60 * 60_000,
  });

  const setActive = useAction({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/platform/plans/${id}/active`, { isActive }),
    successMessage: 'Plan availability updated',
    invalidates: [plansKey],
    onSuccess: () => setDeactivating(null),
  });

  if (isLoading) return <LoadingState label="Loading plans" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const plans = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Subscription plans"
        description="What a school can buy: pricing, limits and the modules each plan unlocks."
        actions={
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New plan
          </Button>
        }
      />

      {plans.length === 0 ? (
        <EmptyState
          icon={<BadgeIndianRupee />}
          title="No plans configured"
          description="Add a plan before provisioning schools."
          action={
            <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
              New plan
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id} className={plan.isActive ? undefined : 'opacity-70'}>
              <CardHeader
                title={plan.name}
                description={`${plan.code} · ${humanise(plan.tier)}`}
                actions={
                  <>
                    <Badge tone={plan.isActive ? 'success' : 'neutral'}>
                      {plan.isActive ? 'On sale' : 'Retired'}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(plan)}>
                      Edit
                    </Button>
                  </>
                }
              />
              <CardBody className="space-y-3">
                <div>
                  <p className="text-xl font-semibold tabular">
                    {formatMoney(plan.priceYearly, plan.currency, { compact: true })}
                    <span className="ml-1 text-xs font-normal text-[var(--color-ink-muted)]">
                      / year
                    </span>
                  </p>
                  <p className="text-2xs text-[var(--color-ink-muted)]">
                    {formatMoney(plan.priceMonthly, plan.currency)} monthly · {plan.trialDays}-day
                    trial
                  </p>
                </div>

                {plan.description ? (
                  <p className="text-xs text-[var(--color-ink-secondary)]">{plan.description}</p>
                ) : null}

                <dl className="grid grid-cols-3 gap-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-2.5 text-center">
                  <div>
                    <dt className="text-2xs text-[var(--color-ink-muted)]">Students</dt>
                    <dd className="text-sm font-medium tabular">
                      {formatNumber(plan.maxStudents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-2xs text-[var(--color-ink-muted)]">Staff</dt>
                    <dd className="text-sm font-medium tabular">{formatNumber(plan.maxStaff)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs text-[var(--color-ink-muted)]">Storage</dt>
                    <dd className="text-sm font-medium tabular">
                      {Math.round(plan.storageMb / 1024)} GB
                    </dd>
                  </div>
                </dl>

                <div>
                  <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                    {plan.modules.length} modules
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {plan.modules.slice(0, 8).map((key) => (
                      <Badge key={key} tone="neutral">
                        {modules?.find((module) => module.key === key)?.label ?? humanise(key)}
                      </Badge>
                    ))}
                    {plan.modules.length > 8 ? (
                      <Badge tone="neutral">+{plan.modules.length - 8} more</Badge>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3">
                  <span className="text-2xs text-[var(--color-ink-muted)]">
                    {plan.activeSubscriptions ?? 0} school
                    {plan.activeSubscriptions === 1 ? '' : 's'} on this plan
                  </span>
                  {plan.isActive ? (
                    <Button variant="ghost" size="sm" onClick={() => setDeactivating(plan)}>
                      Stop selling
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Check />}
                      loading={setActive.isPending}
                      onClick={() => setActive.mutate({ id: plan.id, isActive: true })}
                    >
                      Resume selling
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      >
        {/* Mounted per plan, so the form's initial values come from props at
            mount rather than from an effect that copies them in. */}
        {creating || editing ? (
          <PlanForm
            key={editing?.id ?? 'new'}
            onClose={() => {
              setCreating(false);
              setEditing(null);
            }}
            plan={editing}
            modules={modules ?? []}
          />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
        title={`Stop selling ${deactivating?.name ?? ''}?`}
        confirmLabel="Stop selling"
        loading={setActive.isPending}
        description={
          <>
            New schools will no longer be offered this plan. The{' '}
            {deactivating?.activeSubscriptions ?? 0} school
            {deactivating?.activeSubscriptions === 1 ? '' : 's'} already on it keep it, and their
            billing is unchanged.
          </>
        }
        onConfirm={() => deactivating && setActive.mutate({ id: deactivating.id, isActive: false })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function formFor(plan: PlanSummary | null): PlanForm {
  if (!plan) return EMPTY_FORM;
  return {
    code: plan.code,
    name: plan.name,
    tier: plan.tier,
    description: plan.description ?? '',
    priceMonthly: String(plan.priceMonthly),
    priceYearly: String(plan.priceYearly),
    maxStudents: String(plan.maxStudents),
    maxStaff: String(plan.maxStaff),
    storageMb: String(plan.storageMb),
    trialDays: String(plan.trialDays),
    sortOrder: String(plan.sortOrder),
    modules: plan.modules,
  };
}

function PlanForm({
  onClose,
  plan,
  modules,
}: {
  onClose: () => void;
  plan: PlanSummary | null;
  modules: ModuleOption[];
}) {
  const [form, setForm] = React.useState<PlanForm>(() => formFor(plan));
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const save = useAction({
    mutationFn: (payload: Record<string, unknown>) =>
      plan
        ? api.patch(`/platform/plans/${plan.id}`, payload)
        : api.post('/platform/plans', payload),
    successMessage: plan ? 'Plan updated' : 'Plan created',
    invalidates: [['platform', 'plans']],
    onSuccess: onClose,
    onError: (error) => setFieldErrors(error.byField),
  });

  const set = (key: keyof PlanForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleModule = (key: string) =>
    setForm((current) => ({
      ...current,
      modules: current.modules.includes(key)
        ? current.modules.filter((module) => module !== key)
        : [...current.modules, key],
    }));

  const submit = () => {
    setFieldErrors({});
    const payload: Record<string, unknown> = {
      name: form.name,
      tier: form.tier,
      description: form.description || undefined,
      priceMonthly: Number(form.priceMonthly),
      priceYearly: Number(form.priceYearly),
      maxStudents: Number(form.maxStudents),
      maxStaff: Number(form.maxStaff),
      storageMb: Number(form.storageMb),
      trialDays: Number(form.trialDays),
      sortOrder: Number(form.sortOrder),
      modules: form.modules,
    };
    // The code identifies the plan on every billing record, so it is set once
    // at creation and never rewritten.
    if (!plan) payload.code = form.code.toUpperCase();
    save.mutate(payload);
  };

  return (
    <Modal
      size="xl"
      title={plan ? `Edit ${plan.name}` : 'New plan'}
      description={
        plan
          ? 'Changes apply to every school already on this plan the next time their limits are checked.'
          : 'Define the limits and the modules this plan unlocks.'
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" loading={save.isPending} onClick={submit}>
            {plan ? 'Save changes' : 'Create plan'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FieldRow columns={3}>
          <Field label="Name" required error={fieldErrors.name}>
            <Input value={form.name} onChange={(event) => set('name', event.target.value)} />
          </Field>
          <Field
            label="Code"
            required={!plan}
            help={plan ? 'Fixed once created' : 'UPPER_SNAKE_CASE'}
            error={fieldErrors.code}
          >
            <Input
              value={form.code}
              disabled={Boolean(plan)}
              onChange={(event) => set('code', event.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Tier" required error={fieldErrors.tier}>
            <Select value={form.tier} onChange={(event) => set('tier', event.target.value)}>
              {PLAN_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {humanise(tier)}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>

        <Field label="Description" error={fieldErrors.description}>
          <Textarea
            rows={2}
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </Field>

        <FieldRow columns={3}>
          <Field label="Monthly price" error={fieldErrors.priceMonthly}>
            <Input
              type="number"
              min={0}
              value={form.priceMonthly}
              onChange={(event) => set('priceMonthly', event.target.value)}
            />
          </Field>
          <Field label="Yearly price" error={fieldErrors.priceYearly}>
            <Input
              type="number"
              min={0}
              value={form.priceYearly}
              onChange={(event) => set('priceYearly', event.target.value)}
            />
          </Field>
          <Field label="Trial days" error={fieldErrors.trialDays}>
            <Input
              type="number"
              min={0}
              value={form.trialDays}
              onChange={(event) => set('trialDays', event.target.value)}
            />
          </Field>
        </FieldRow>

        <FieldRow columns={3}>
          <Field label="Maximum students" error={fieldErrors.maxStudents}>
            <Input
              type="number"
              min={1}
              value={form.maxStudents}
              onChange={(event) => set('maxStudents', event.target.value)}
            />
          </Field>
          <Field label="Maximum staff" error={fieldErrors.maxStaff}>
            <Input
              type="number"
              min={1}
              value={form.maxStaff}
              onChange={(event) => set('maxStaff', event.target.value)}
            />
          </Field>
          <Field label="Storage (MB)" error={fieldErrors.storageMb}>
            <Input
              type="number"
              min={64}
              value={form.storageMb}
              onChange={(event) => set('storageMb', event.target.value)}
            />
          </Field>
        </FieldRow>

        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-secondary)]">
            Modules included ({form.modules.length})
          </p>
          <p className="mb-2 text-2xs text-[var(--color-ink-muted)]">
            Core modules are always on and are added automatically.
          </p>
          <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2 sm:grid-cols-3">
            {modules.map((module) => (
              <label key={module.key} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--color-accent)]"
                  checked={form.modules.includes(module.key)}
                  onChange={() => toggleModule(module.key)}
                />
                <span className="truncate">{module.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
