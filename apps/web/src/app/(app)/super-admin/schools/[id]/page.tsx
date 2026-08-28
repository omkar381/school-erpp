'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, Ban, CheckCircle2, CreditCard, RefreshCw } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAction } from '@/hooks/use-action';
import { formatMoney, formatNumber } from '@/lib/utils';
import { formatAgo, formatDate, formatDateTime } from '@/lib/dates';
import { fullName, type PlanSummary, type SchoolDetail } from '@/lib/platform';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, Modal } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Meter } from '@/components/ui/meter';
import { DetailList, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

export default function PlatformSchoolDetailPage() {
  const params = useParams<{ id: string }>();
  const schoolId = params.id;

  const detailKey = ['platform', 'school', schoolId];
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: detailKey,
    queryFn: () => api.get<SchoolDetail>(`/platform/schools/${schoolId}`),
  });

  const [statusAction, setStatusAction] = React.useState<'SUSPENDED' | 'ACTIVE' | null>(null);
  const [reason, setReason] = React.useState('');
  const [planOpen, setPlanOpen] = React.useState(false);
  const [limitsOpen, setLimitsOpen] = React.useState(false);

  const invalidates = [detailKey, ['platform-schools'], ['platform', 'overview']];

  const setStatus = useAction({
    mutationFn: (payload: { status: string; reason?: string }) =>
      api.patch(`/platform/schools/${schoolId}/status`, payload),
    successMessage: 'School status updated',
    invalidates,
    onSuccess: () => {
      setStatusAction(null);
      setReason('');
    },
  });

  const toggleModule = useAction({
    mutationFn: (payload: { modules: Record<string, boolean>; ignorePlan?: boolean }) =>
      api.patch(`/platform/schools/${schoolId}/modules`, payload),
    successMessage: 'Modules updated',
    invalidates,
  });

  if (isLoading) return <LoadingState label="Loading school" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="School not found" />;

  const { school, subscription, usage, counts, academicYear } = data;
  const suspended = school.status === 'SUSPENDED';

  return (
    <>
      <PageHeader
        title={school.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={school.status} />
            <span>{school.code}</span>
            {school.city ? <span>· {school.city}</span> : null}
            <span>· Registered {formatDate(school.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" icon={<ArrowLeft />} asChild>
              <Link href="/super-admin/schools">Back</Link>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<CreditCard />}
              onClick={() => setPlanOpen(true)}
            >
              Change plan
            </Button>
            {suspended ? (
              <Button
                variant="primary"
                size="sm"
                icon={<CheckCircle2 />}
                onClick={() => setStatusAction('ACTIVE')}
              >
                Reactivate
              </Button>
            ) : (
              <Button
                variant="danger-outline"
                size="sm"
                icon={<Ban />}
                onClick={() => setStatusAction('SUSPENDED')}
              >
                Suspend
              </Button>
            )}
          </>
        }
      />

      {suspended ? (
        <div className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] p-3">
          <Ban className="mt-0.5 size-4 shrink-0 text-[var(--color-danger)]" aria-hidden />
          <div className="text-xs text-[var(--color-ink-secondary)]">
            <p className="font-medium text-[var(--color-danger)]">This school is suspended.</p>
            <p>
              Every session has been revoked and its users cannot sign in. Reactivate to restore
              access.
            </p>
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="subscription">Subscription &amp; usage</TabsTrigger>
          <TabsTrigger value="modules">Modules</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="School information" />
              <CardBody>
                <DetailList
                  items={[
                    { label: 'Legal name', value: school.legalName },
                    { label: 'Board', value: school.board },
                    { label: 'Affiliation', value: school.affiliationNumber },
                    { label: 'Established', value: school.establishedYear },
                    { label: 'Principal', value: school.principalName },
                    { label: 'Email', value: school.email },
                    { label: 'Phone', value: school.phone },
                    {
                      label: 'Website',
                      value: school.website ? (
                        <a
                          href={school.website}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[var(--color-accent)] hover:underline"
                        >
                          {school.website}
                        </a>
                      ) : null,
                    },
                    {
                      label: 'Address',
                      value: [school.addressLine1, school.city, school.state, school.postalCode]
                        .filter(Boolean)
                        .join(', '),
                    },
                    { label: 'Timezone', value: school.timezone },
                    { label: 'Currency', value: school.currency },
                    {
                      label: 'Onboarding',
                      value: school.onboardedAt
                        ? `Completed ${formatDate(school.onboardedAt)}`
                        : `Step ${school.onboardingStep} of 5`,
                    },
                  ]}
                />
              </CardBody>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="Size" description="Counts only — no pupil or staff records." />
                <CardBody>
                  <DetailList
                    columns={1}
                    items={[
                      { label: 'Students', value: formatNumber(usage.students.used) },
                      { label: 'Teachers', value: formatNumber(counts.teachers) },
                      { label: 'Non-teaching staff', value: formatNumber(counts.nonTeaching) },
                      { label: 'Portal users', value: formatNumber(usage.users) },
                      { label: 'Classes', value: formatNumber(counts.classes) },
                      {
                        label: 'Academic year',
                        value: academicYear
                          ? `${academicYear.name} (${formatDate(academicYear.startDate)} – ${formatDate(academicYear.endDate)})`
                          : null,
                      },
                      {
                        label: 'Students by status',
                        value: Object.entries(counts.studentsByStatus)
                          .map(([status, count]) => `${humanise(status)}: ${count}`)
                          .join(' · '),
                      },
                      {
                        label: 'Open tickets',
                        value:
                          counts.openTickets > 0 ? (
                            <Link
                              href={`/super-admin/support?schoolId=${school.id}`}
                              className="text-[var(--color-accent)] hover:underline"
                            >
                              {counts.openTickets} open
                            </Link>
                          ) : (
                            'None'
                          ),
                      },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Administrators" description="Who can act inside this school." />
                <CardBody className="p-0">
                  {data.administrators.length > 0 ? (
                    <ul className="divide-y divide-[var(--color-border)]">
                      {data.administrators.map((admin) => (
                        <li key={admin.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{fullName(admin)}</p>
                            <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                              {admin.email ?? admin.phone ?? '—'}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <StatusBadge status={admin.status} />
                            <p className="mt-0.5 text-2xs text-[var(--color-ink-muted)]">
                              {admin.lastLoginAt
                                ? `Last in ${formatAgo(admin.lastLoginAt)}`
                                : 'Never signed in'}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      title="No administrator yet"
                      description="This school has no active administrator account."
                    />
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="subscription">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Subscription"
                actions={
                  subscription ? (
                    <Button variant="ghost" size="sm" onClick={() => setPlanOpen(true)}>
                      Change plan
                    </Button>
                  ) : null
                }
              />
              <CardBody>
                {subscription ? (
                  <DetailList
                    items={[
                      {
                        label: 'Plan',
                        value: `${subscription.plan.name} (${humanise(subscription.plan.tier)})`,
                      },
                      { label: 'Status', value: <StatusBadge status={subscription.status} /> },
                      {
                        label: 'Trial',
                        value: subscription.isTrial
                          ? `Yes — ${subscription.plan.trialDays}-day trial`
                          : 'No',
                      },
                      { label: 'Started', value: formatDate(subscription.startDate) },
                      {
                        label: 'Ends',
                        value: (
                          <span
                            className={
                              subscription.daysRemaining <= 7
                                ? 'font-medium text-[var(--color-danger)]'
                                : undefined
                            }
                          >
                            {formatDate(subscription.endDate)} ({subscription.daysRemaining} days)
                          </span>
                        ),
                      },
                      { label: 'Billing', value: humanise(subscription.billingCycle) },
                      {
                        label: 'Amount',
                        value: formatMoney(subscription.amount, subscription.currency),
                      },
                      { label: 'Auto-renew', value: subscription.autoRenew ? 'On' : 'Off' },
                      {
                        label: 'Cancelled',
                        value: subscription.cancelledAt
                          ? formatDate(subscription.cancelledAt)
                          : null,
                      },
                      { label: 'Notes', value: subscription.notes },
                    ]}
                  />
                ) : (
                  <EmptyState
                    icon={<CreditCard />}
                    title="No subscription"
                    description="This school is running on the restricted default allowance."
                    action={
                      <Button size="sm" onClick={() => setPlanOpen(true)}>
                        Assign a plan
                      </Button>
                    }
                  />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Usage against limits"
                description={`Measured ${formatAgo(usage.measuredAt)}`}
                actions={
                  subscription ? (
                    <Button variant="ghost" size="sm" onClick={() => setLimitsOpen(true)}>
                      Adjust limits
                    </Button>
                  ) : null
                }
              />
              <CardBody className="space-y-4">
                <Meter label="Students" usage={usage.students} />
                <Meter label="Staff" usage={usage.staff} />
                <Meter label="Storage" usage={usage.storage} unit="MB" />

                {usage.overridden.length > 0 ? (
                  <p className="text-2xs text-[var(--color-ink-muted)]">
                    Overridden for this school: {usage.overridden.map(humanise).join(', ')}.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="modules">
          <Card>
            <CardHeader
              title="Feature modules"
              description="A module the plan does not include can still be granted as an exception; the server enforces whatever is set here."
            />
            <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.modules.map((module) => (
                <div
                  key={module.key}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{module.label}</p>
                    <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                      {module.core
                        ? 'Always on'
                        : module.inPlan
                          ? 'Included in the plan'
                          : 'Outside the plan'}
                    </p>
                  </div>
                  {module.core ? (
                    <Badge tone="neutral">Core</Badge>
                  ) : (
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-[var(--color-accent)]"
                        checked={module.enabled}
                        disabled={toggleModule.isPending}
                        onChange={(event) =>
                          toggleModule.mutate({
                            modules: { [module.key]: event.target.checked },
                            // Granting outside the plan is a deliberate
                            // exception, so it is sent explicitly.
                            ignorePlan: event.target.checked && !module.inPlan,
                          })
                        }
                        aria-label={`${module.enabled ? 'Disable' : 'Enable'} ${module.label}`}
                      />
                      <span className="text-2xs text-[var(--color-ink-muted)]">
                        {module.enabled ? 'On' : 'Off'}
                      </span>
                    </label>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader
              title="Recent activity"
              description="Audited actions inside this school."
              actions={
                <Button variant="ghost" size="sm" icon={<RefreshCw />} onClick={() => refetch()}>
                  Refresh
                </Button>
              }
            />
            <CardBody className="p-0">
              {data.recentActivity.length > 0 ? (
                <ul className="divide-y divide-[var(--color-border)]">
                  {data.recentActivity.map((entry) => (
                    <li key={entry.id} className="px-4 py-2.5">
                      <p className="text-xs">
                        {entry.description ?? `${humanise(entry.action)} ${entry.entity}`}
                      </p>
                      <p className="mt-0.5 text-2xs text-[var(--color-ink-muted)]">
                        {entry.user ? fullName(entry.user) : 'System'} ·{' '}
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<Activity />} title="Nothing recorded yet" />
              )}
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={statusAction !== null}
        onOpenChange={(open) => {
          if (!open) setStatusAction(null);
        }}
        destructive={statusAction === 'SUSPENDED'}
        loading={setStatus.isPending}
        title={
          statusAction === 'SUSPENDED' ? `Suspend ${school.name}?` : `Reactivate ${school.name}?`
        }
        confirmLabel={statusAction === 'SUSPENDED' ? 'Suspend school' : 'Reactivate school'}
        description={
          <span className="block space-y-3">
            <span className="block">
              {statusAction === 'SUSPENDED'
                ? 'Every active session is revoked immediately and no one at this school will be able to sign in. Their data is untouched.'
                : 'Users at this school will be able to sign in again straight away.'}
            </span>
            <span className="block">
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Reason (recorded in the audit trail)"
                aria-label="Reason"
              />
            </span>
          </span>
        }
        onConfirm={() =>
          statusAction &&
          setStatus.mutate({ status: statusAction, reason: reason.trim() || undefined })
        }
      />

      <ChangePlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        schoolId={schoolId}
        subscription={subscription}
        invalidates={invalidates}
      />

      <Dialog open={limitsOpen} onOpenChange={setLimitsOpen}>
        {/* Mounted while open so the inputs start from the limits currently in
            force, without an effect copying props into state. */}
        {limitsOpen && subscription ? (
          <LimitsForm
            onClose={() => setLimitsOpen(false)}
            subscriptionId={subscription.id}
            current={usage.limits}
            invalidates={invalidates}
          />
        ) : null}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------

function ChangePlanDialog({
  open,
  onOpenChange,
  schoolId,
  subscription,
  invalidates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  subscription: SchoolDetail['subscription'];
  invalidates: unknown[][];
}) {
  const [planId, setPlanId] = React.useState('');
  const [syncModules, setSyncModules] = React.useState(true);
  const [renew, setRenew] = React.useState(false);
  const [reason, setReason] = React.useState('');

  const { data: plans } = useQuery({
    queryKey: ['platform', 'plans', 'sellable'],
    queryFn: () =>
      api.get<{ items: PlanSummary[] }>('/platform/plans', { activeOnly: true, limit: 50 }),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const change = useAction({
    mutationFn: (payload: Record<string, unknown>) =>
      subscription
        ? api.patch(`/platform/subscriptions/${subscription.id}/plan`, payload)
        : api.post('/platform/subscriptions', { ...payload, schoolId }),
    successMessage: subscription ? 'Plan changed' : 'Subscription created',
    invalidates: invalidates as never,
    onSuccess: () => onOpenChange(false),
  });

  const selected = plans?.items.find((plan) => plan.id === planId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Modal
        title={subscription ? 'Change plan' : 'Assign a plan'}
        description={
          subscription
            ? `Currently on ${subscription.plan.name}. Downgrading below what the school already uses is refused.`
            : 'Puts this school onto a paid plan straight away.'
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={change.isPending}
              disabled={!planId}
              onClick={() =>
                change.mutate({
                  planId,
                  syncModules,
                  ...(subscription ? { renew, reason: reason.trim() || undefined } : {}),
                })
              }
            >
              {subscription ? 'Change plan' : 'Create subscription'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Plan" required>
            <Select value={planId} onChange={(event) => setPlanId(event.target.value)}>
              <option value="">Choose a plan…</option>
              {plans?.items
                .filter((plan) => plan.id !== subscription?.plan.id)
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} — {formatMoney(plan.priceYearly, plan.currency)}/year
                  </option>
                ))}
            </Select>
          </Field>

          {selected ? (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs">
              <DetailList
                columns={1}
                items={[
                  { label: 'Students', value: formatNumber(selected.maxStudents) },
                  { label: 'Staff', value: formatNumber(selected.maxStaff) },
                  { label: 'Storage', value: `${formatNumber(selected.storageMb)} MB` },
                  { label: 'Modules', value: `${selected.modules.length} included` },
                ]}
              />
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--color-accent)]"
              checked={syncModules}
              onChange={(event) => setSyncModules(event.target.checked)}
            />
            Realign the school&apos;s modules with the new plan
          </label>

          {subscription ? (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--color-accent)]"
                  checked={renew}
                  onChange={(event) => setRenew(event.target.checked)}
                />
                Extend the end date to a full cycle from today
              </label>

              <Field label="Reason">
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Recorded in the audit trail"
                />
              </Field>
            </>
          ) : null}
        </div>
      </Modal>
    </Dialog>
  );
}

function LimitsForm({
  onClose,
  subscriptionId,
  current,
  invalidates,
}: {
  onClose: () => void;
  subscriptionId: string;
  current: { maxStudents: number; maxStaff: number; storageMb: number };
  invalidates: unknown[][];
}) {
  const [values, setValues] = React.useState(current);

  const save = useAction({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch(`/platform/subscriptions/${subscriptionId}/limits`, payload),
    successMessage: 'Limits updated',
    invalidates: invalidates as never,
    onSuccess: onClose,
  });

  return (
    <Modal
      title="Adjust limits"
      description="Overrides the plan's numbers for this school alone. Reset to fall back to the plan."
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            loading={save.isPending}
            onClick={() => save.mutate({ reset: true })}
          >
            Reset to plan
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={save.isPending}
            onClick={() => save.mutate(values)}
          >
            Save limits
          </Button>
        </>
      }
    >
      <FieldRow columns={1}>
        <Field label="Maximum students">
          <Input
            type="number"
            min={1}
            value={values.maxStudents}
            onChange={(event) =>
              setValues((v) => ({ ...v, maxStudents: Number(event.target.value) }))
            }
          />
        </Field>
        <Field label="Maximum staff">
          <Input
            type="number"
            min={1}
            value={values.maxStaff}
            onChange={(event) => setValues((v) => ({ ...v, maxStaff: Number(event.target.value) }))}
          />
        </Field>
        <Field label="Storage (MB)">
          <Input
            type="number"
            min={64}
            value={values.storageMb}
            onChange={(event) =>
              setValues((v) => ({ ...v, storageMb: Number(event.target.value) }))
            }
          />
        </Field>
      </FieldRow>
    </Modal>
  );
}
