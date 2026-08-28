'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Check, CreditCard, Minus } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAction } from '@/hooks/use-action';
import { useAuthStore } from '@/lib/auth-store';
import { formatMoney, formatNumber } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import type { PlanSummary, SchoolSubscriptionView } from '@/lib/platform';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, Modal } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select, Textarea } from '@/components/ui/input';
import { Meter } from '@/components/ui/meter';
import { DetailList } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

const MODULE_LABELS: Record<string, string> = {
  core: 'Core',
  students: 'Student management',
  staff: 'Staff management',
  attendance: 'Attendance',
  timetable: 'Timetable',
  homework: 'Homework',
  assignments: 'Assignments',
  exams: 'Examinations',
  report_cards: 'Report cards',
  fees: 'Fee management',
  payments: 'Online payments',
  communication: 'Communication',
  chat: 'Messaging',
  leave: 'Leave management',
  events: 'Events',
  transport: 'Transport',
  library: 'Library',
  inventory: 'Inventory',
  hr: 'Human resources',
  payroll: 'Payroll',
  admissions: 'Admissions',
  documents: 'Documents',
  certificates: 'Certificates',
  id_cards: 'ID cards',
  reports: 'Reports',
  analytics: 'Analytics',
  website: 'Public website',
  support: 'Support desk',
};

export default function SchoolSubscriptionPage() {
  const canRequest = useAuthStore((state) =>
    Boolean(state.user?.permissions.includes('school.update')),
  );
  const [upgrading, setUpgrading] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['subscription', 'current'],
    queryFn: () => api.get<SchoolSubscriptionView>('/subscription'),
    staleTime: 60_000,
  });

  if (isLoading) return <LoadingState label="Loading your subscription" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="No subscription information" />;

  const { subscription, plan, usage } = data;
  const currency = plan?.currency ?? 'INR';
  const expiringSoon = subscription ? subscription.daysRemaining <= 14 : false;
  const overLimit =
    usage.students.exceeded || usage.staff.exceeded || usage.storage.exceeded;
  const nearLimit = usage.students.warning || usage.staff.warning || usage.storage.warning;

  return (
    <>
      <PageHeader
        title="Subscription"
        description="What your school is on, what it includes, and how much of it you are using."
        actions={
          canRequest ? (
            <Button
              size="sm"
              variant="primary"
              icon={<ArrowUpRight />}
              onClick={() => setUpgrading(true)}
            >
              Request a change
            </Button>
          ) : null
        }
      />

      {overLimit || nearLimit ? (
        <div
          className={`mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border p-3 ${
            overLimit
              ? 'border-[var(--color-danger-border)] bg-[var(--color-danger-soft)]'
              : 'border-[var(--color-warning-border)] bg-[var(--color-warning-soft)]'
          }`}
        >
          <AlertTriangle
            className={`mt-0.5 size-4 shrink-0 ${
              overLimit ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning)]'
            }`}
            aria-hidden
          />
          <div className="text-xs text-[var(--color-ink-secondary)]">
            <p
              className={`font-medium ${
                overLimit ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning)]'
              }`}
            >
              {overLimit
                ? 'A plan limit has been reached.'
                : 'You are close to a plan limit.'}
            </p>
            <p>
              {overLimit
                ? 'New records of that kind will be refused until you upgrade or free up space.'
                : 'Request an upgrade before it starts blocking new records.'}
            </p>
          </div>
        </div>
      ) : null}

      {subscription && expiringSoon ? (
        <div className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning-border)] bg-[var(--color-warning-soft)] p-3">
          <CreditCard className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <div className="text-xs text-[var(--color-ink-secondary)]">
            <p className="font-medium text-[var(--color-warning)]">
              {subscription.isTrial ? 'Your trial ends' : 'Your subscription ends'} in{' '}
              {subscription.daysRemaining} day{subscription.daysRemaining === 1 ? '' : 's'}.
            </p>
            <p>
              {subscription.autoRenew
                ? `It renews automatically on ${formatDate(subscription.endDate)}.`
                : `Contact us before ${formatDate(subscription.endDate)} to keep full access.`}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={plan ? plan.name : 'No plan'}
            description={plan?.description ?? 'Your school is running on a restricted allowance.'}
            actions={subscription ? <StatusBadge status={subscription.status} /> : null}
          />
          <CardBody>
            {subscription && plan ? (
              <DetailList
                items={[
                  { label: 'Plan', value: `${plan.name} (${humanise(plan.tier)})` },
                  {
                    label: 'Status',
                    value: subscription.isTrial ? (
                      <Badge tone="info">Trial — {subscription.trialDays} days</Badge>
                    ) : (
                      <StatusBadge status={subscription.status} />
                    ),
                  },
                  { label: 'Started', value: formatDate(subscription.startDate) },
                  {
                    label: subscription.isTrial ? 'Trial ends' : 'Renews',
                    value: (
                      <span className={expiringSoon ? 'font-medium text-[var(--color-warning)]' : undefined}>
                        {formatDate(subscription.endDate)} · {subscription.daysRemaining} days left
                      </span>
                    ),
                  },
                  { label: 'Billing cycle', value: humanise(subscription.billingCycle) },
                  {
                    label: 'Amount',
                    value: formatMoney(subscription.amount, subscription.currency),
                  },
                  { label: 'Auto-renew', value: subscription.autoRenew ? 'On' : 'Off' },
                  {
                    label: 'Cancelled',
                    value: subscription.cancelledAt ? formatDate(subscription.cancelledAt) : null,
                  },
                ]}
              />
            ) : (
              <EmptyState
                icon={<CreditCard />}
                title="No active subscription"
                description="Contact the platform team to put your school on a plan."
                action={
                  canRequest ? (
                    <Button size="sm" onClick={() => setUpgrading(true)}>
                      Request a plan
                    </Button>
                  ) : null
                }
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Usage"
            description="Counted live against the limits in force for your school."
          />
          <CardBody className="space-y-4">
            <Meter label="Students" usage={usage.students} />
            <Meter label="Staff" usage={usage.staff} />
            <Meter label="Storage" usage={usage.storage} unit="MB" />

            <dl className="grid grid-cols-2 gap-2 border-t border-[var(--color-border)] pt-3 text-xs">
              <div>
                <dt className="text-[var(--color-ink-muted)]">Portal users</dt>
                <dd className="font-medium tabular">{formatNumber(usage.users)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-muted)]">Documents stored</dt>
                <dd className="font-medium tabular">{formatNumber(usage.documents)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Modules"
            description="What your plan includes, and what is switched on right now."
          />
          <CardBody className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.modules.map((module) => (
              <div
                key={module.key}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 py-1.5"
              >
                <span className="truncate text-xs">
                  {MODULE_LABELS[module.key] ?? humanise(module.key)}
                </span>
                {module.enabled ? (
                  <Badge tone="success">
                    <Check className="size-2.5" aria-hidden /> On
                  </Badge>
                ) : module.inPlan ? (
                  <Badge tone="neutral">Off</Badge>
                ) : (
                  <Badge tone="neutral">
                    <Minus className="size-2.5" aria-hidden /> Not in plan
                  </Badge>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <UpgradeDialog
        open={upgrading}
        onOpenChange={setUpgrading}
        currentPlanId={plan?.id}
        currency={currency}
      />
    </>
  );
}

function UpgradeDialog({
  open,
  onOpenChange,
  currentPlanId,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlanId: string | undefined;
  currency: string;
}) {
  const [planId, setPlanId] = React.useState('');
  const [message, setMessage] = React.useState('');

  const { data: plans } = useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: () => api.get<PlanSummary[]>('/subscription/plans'),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const request = useAction({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post('/subscription/upgrade-request', payload),
    successMessage: 'Request sent — our team will be in touch',
    invalidates: [['support-tickets'], ['support', 'statistics']],
    onSuccess: () => {
      onOpenChange(false);
      setPlanId('');
      setMessage('');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Modal
        title="Request a plan change"
        description="This opens a support ticket with our team. Nothing is charged automatically."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={request.isPending}
              onClick={() =>
                request.mutate({
                  ...(planId ? { planId } : {}),
                  ...(message.trim() ? { message: message.trim() } : {}),
                })
              }
            >
              Send request
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Plan you are interested in">
            <Select value={planId} onChange={(event) => setPlanId(event.target.value)}>
              <option value="">Not sure — advise me</option>
              {plans
                ?.filter((plan) => plan.id !== currentPlanId)
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} — {formatNumber(plan.maxStudents)} students,{' '}
                    {formatMoney(plan.priceYearly, plan.currency ?? currency, { compact: true })}
                    /year
                  </option>
                ))}
            </Select>
          </Field>

          <Field label="Anything we should know?">
            <Textarea
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="We are opening two more sections in April and expect around 300 more students."
            />
          </Field>
        </div>
      </Modal>
    </Dialog>
  );
}
