'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  GraduationCap,
  LifeBuoy,
  TrendingUp,
  UserCog,
} from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { formatMoney, formatNumber } from '@/lib/utils';
import { formatAgo, formatDate } from '@/lib/dates';
import type { PlatformOverview } from '@/lib/platform';
import { fullName } from '@/lib/platform';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';

export default function PlatformOverviewPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['platform', 'overview'],
    queryFn: () => api.get<PlatformOverview>('/platform/overview'),
    staleTime: 60_000,
  });

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const currency = data?.revenue.currency ?? 'INR';

  return (
    <>
      <PageHeader
        title="Platform overview"
        description={
          data
            ? `Live across ${formatNumber(data.schools.total)} schools · updated ${formatAgo(data.generatedAt)}`
            : 'Every school on the platform, at a glance.'
        }
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/super-admin/schools">All schools</Link>
            </Button>
            <Button variant="primary" size="sm" asChild>
              <Link href="/super-admin/support">Support desk</Link>
            </Button>
          </>
        }
      />

      <StatGrid columns={4} className="mb-3">
        <StatCard
          label="Schools"
          value={data ? formatNumber(data.schools.total) : '—'}
          hint={data ? `${data.schools.newThisMonth} added this month` : undefined}
          icon={<Building2 />}
          loading={isLoading}
        />
        <StatCard
          label="Active"
          value={data ? formatNumber(data.schools.active) : '—'}
          hint={data ? `${data.schools.trial} on trial` : undefined}
          loading={isLoading}
        />
        <StatCard
          label="Suspended"
          value={data ? formatNumber(data.schools.suspended) : '—'}
          hint={data ? `${data.schools.expired} expired` : undefined}
          icon={<AlertTriangle />}
          loading={isLoading}
        />
        <StatCard
          label="Annual run rate"
          value={data ? formatMoney(data.revenue.annualRunRate, currency, { compact: true }) : '—'}
          hint={data ? `${data.revenue.payingSubscriptions} paying` : undefined}
          icon={<TrendingUp />}
          loading={isLoading}
        />
      </StatGrid>

      <StatGrid columns={4} className="mb-5">
        <StatCard
          label="Students"
          value={data ? formatNumber(data.people.students) : '—'}
          icon={<GraduationCap />}
          loading={isLoading}
        />
        <StatCard
          label="Teachers & staff"
          value={data ? formatNumber(data.people.staff) : '—'}
          icon={<UserCog />}
          loading={isLoading}
        />
        <StatCard
          label="Open tickets"
          value={data ? formatNumber(data.support.open + data.support.inProgress) : '—'}
          hint={data ? `${data.support.waiting} waiting on a reply` : undefined}
          icon={<LifeBuoy />}
          loading={isLoading}
        />
        <StatCard
          label="Urgent tickets"
          value={data ? formatNumber(data.support.urgent) : '—'}
          icon={<AlertTriangle />}
          invertTrend
          loading={isLoading}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Expiring subscriptions"
            description="Ending within 30 days"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/super-admin/subscriptions?expiring=30">View all</Link>
              </Button>
            }
          />
          <CardBody className="p-0">
            {isLoading ? (
              <ListSkeleton />
            ) : data && data.expiringSubscriptions.length > 0 ? (
              <ul className="divide-y divide-[var(--color-border)]">
                {data.expiringSubscriptions.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/super-admin/schools/${item.school.id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {item.school.name}
                      </Link>
                      <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                        {item.plan.name} · {formatMoney(item.amount, item.currency)} ·{' '}
                        {item.autoRenew ? 'auto-renews' : 'will not renew'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge tone={item.daysRemaining <= 7 ? 'danger' : 'warning'}>
                        {item.daysRemaining}d left
                      </Badge>
                      <p className="mt-0.5 text-2xs text-[var(--color-ink-muted)]">
                        {formatDate(item.endDate)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<CalendarClock />}
                title="Nothing expiring soon"
                description="No subscription ends within the next 30 days."
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent registrations"
            description="The newest schools on the platform"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/super-admin/schools">View all</Link>
              </Button>
            }
          />
          <CardBody className="p-0">
            {isLoading ? (
              <ListSkeleton />
            ) : data && data.recentSchools.length > 0 ? (
              <ul className="divide-y divide-[var(--color-border)]">
                {data.recentSchools.map((school) => (
                  <li key={school.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/super-admin/schools/${school.id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {school.name}
                      </Link>
                      <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                        {school.code}
                        {school.city ? ` · ${school.city}` : ''} ·{' '}
                        {formatNumber(school.studentCount)} students
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusBadge status={school.status} />
                      <p className="mt-0.5 text-2xs text-[var(--color-ink-muted)]">
                        {formatAgo(school.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Building2 />}
                title="No schools yet"
                description="Provision the first school to get started."
                action={
                  <Button size="sm" asChild>
                    <Link href="/super-admin/schools">Add a school</Link>
                  </Button>
                }
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Plan mix" description="Live subscriptions by plan" />
          <CardBody>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : data && data.planBreakdown.length > 0 ? (
              <ul className="space-y-3">
                {data.planBreakdown.map((plan) => {
                  const share = data.schools.total
                    ? Math.round((plan.schools / data.schools.total) * 100)
                    : 0;
                  return (
                    <li key={plan.planId}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium">{plan.name}</span>
                        <span className="text-2xs tabular text-[var(--color-ink-muted)]">
                          {plan.schools} school{plan.schools === 1 ? '' : 's'} · {share}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                        <div
                          className="h-full rounded-full bg-[var(--color-accent)]"
                          style={{ width: `${Math.max(share, plan.schools > 0 ? 2 : 0)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No live subscriptions" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent platform activity" description="Audited administrative actions" />
          <CardBody className="p-0">
            {isLoading ? (
              <ListSkeleton />
            ) : data && data.recentActivity.length > 0 ? (
              <ul className="divide-y divide-[var(--color-border)]">
                {data.recentActivity.map((entry) => (
                  <li key={entry.id} className="px-4 py-2.5">
                    <p className="text-xs text-[var(--color-ink)]">
                      {entry.description ?? `${humanise(entry.action)} ${entry.entity}`}
                    </p>
                    <p className="mt-0.5 text-2xs text-[var(--color-ink-muted)]">
                      {entry.user ? fullName(entry.user) : 'System'}
                      {entry.school ? ` · ${entry.school.name}` : ''} · {formatAgo(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Activity />} title="No activity recorded yet" />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-[var(--color-border)]" aria-hidden>
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
