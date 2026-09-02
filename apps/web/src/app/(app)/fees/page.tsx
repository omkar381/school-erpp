'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeIndianRupee, Download, Plus, Settings2, TriangleAlert } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatMoney, formatNumber, saveBlob } from '@/lib/utils';
import { DonutChart, TrendChart } from '@/components/charts';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface FeeDashboard {
  currency: string;
  period: { from: string; to: string };
  collection: { today: number; thisMonth: number; thisYear: number; inPeriod: number };
  outstanding: {
    total: number;
    overdue: number;
    studentsWithDues: number;
    overdueInvoices: number;
  };
  billed: { total: number; invoiceCount: number };
  refunds: { total: number; count: number; pending: number };
  byMethod: Array<{ method: string; amount: number; count: number; percentage: number }>;
  monthlyTrend: Array<{ month: string; amount: number }>;
  byClass: Array<{
    className: string;
    billed: number;
    collected: number;
    outstanding: number;
    collectionRate: number;
  }>;
  topDefaulters: Array<{
    studentId: string;
    name: string;
    admissionNumber: string;
    className: string;
    outstanding: number;
  }>;
}

export default function FeesPage() {
  const canCollect = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('fees.collect'),
  );
  const canSetup = useAuthStore(
    (state) =>
      state.user?.isSuperAdmin ||
      state.user?.permissions.includes('fees.structure.manage') ||
      state.user?.permissions.includes('fees.invoice.create'),
  );
  const [exporting, setExporting] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fees', 'dashboard'],
    queryFn: () => api.get<FeeDashboard>('/fees/dashboard'),
    staleTime: 60_000,
  });

  async function exportOutstanding() {
    setExporting(true);
    try {
      const file = await api.download('/reports/export', {
        method: 'POST',
        body: { key: 'outstanding-fees', filters: {}, format: 'xlsx' },
      });
      saveBlob(file.blob, file.fileName);
    } finally {
      setExporting(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading fee dashboard" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="No fee data" />;

  const currency = data.currency;
  const collectionRate =
    data.billed.total > 0 ? (data.collection.thisYear / data.billed.total) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Fees"
        description={`Collection and outstanding for ${data.period.from} to ${data.period.to}.`}
        actions={
          <>
            <Button size="sm" onClick={exportOutstanding} loading={exporting} icon={<Download />}>
              Export outstanding
            </Button>
            {canSetup ? (
              <Button size="sm" asChild icon={<Settings2 />}>
                <Link href="/fees/setup">Fee setup</Link>
              </Button>
            ) : null}
            <Button size="sm" asChild>
              <Link href="/fees/invoices">Invoices</Link>
            </Button>
            {canCollect ? (
              <Button size="sm" variant="primary" asChild icon={<Plus />}>
                <Link href="/fees/collect">Collect payment</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <StatGrid columns={5} className="mb-4">
        <StatCard
          label="Collected today"
          value={formatMoney(data.collection.today, currency)}
          icon={<BadgeIndianRupee />}
        />
        <StatCard
          label="This month"
          value={formatMoney(data.collection.thisMonth, currency, { compact: true })}
        />
        <StatCard
          label="This year"
          value={formatMoney(data.collection.thisYear, currency, { compact: true })}
          hint={`${collectionRate.toFixed(1)}% of billed`}
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(data.outstanding.total, currency, { compact: true })}
          hint={`${data.outstanding.studentsWithDues} students`}
          invertTrend
        />
        <StatCard
          label="Overdue"
          value={formatMoney(data.outstanding.overdue, currency, { compact: true })}
          hint={`${data.outstanding.overdueInvoices} invoices`}
          icon={<TriangleAlert />}
        />
      </StatGrid>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly collection" description="Received per month this year" />
          <CardBody>
            <TrendChart
              data={data.monthlyTrend.map((point) => ({
                label: point.month,
                value: point.amount,
              }))}
              name="Collected"
              format="currency"
              height={220}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="By payment method" />
          <CardBody>
            <DonutChart
              data={data.byMethod.map((entry) => ({
                label: humanise(entry.method),
                value: entry.amount,
              }))}
              format="currency"
              height={220}
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Collection by class" />
          <CardBody className="max-h-96 overflow-y-auto p-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--color-surface-sunken)]">
                <tr className="hairline">
                  <th className="px-4 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    Class
                  </th>
                  <th className="px-4 py-2 text-right text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    Billed
                  </th>
                  <th className="px-4 py-2 text-right text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    Collected
                  </th>
                  <th className="px-4 py-2 text-right text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.byClass.map((row) => (
                  <tr key={row.className}>
                    <td className="px-4 py-2">{row.className}</td>
                    <td className="numeric px-4 py-2">
                      {formatMoney(row.billed, currency, { compact: true })}
                    </td>
                    <td className="numeric px-4 py-2">
                      {formatMoney(row.collected, currency, { compact: true })}
                    </td>
                    <td className="numeric px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-1 w-10 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
                          aria-hidden
                        >
                          <span
                            className="block h-full rounded-full bg-[var(--color-accent)]"
                            style={{ width: `${Math.min(100, row.collectionRate)}%` }}
                          />
                        </span>
                        {row.collectionRate.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Largest outstanding balances"
            actions={
              <Button size="xs" variant="ghost" asChild>
                <Link href="/reports?report=outstanding-fees">
                  Full report <ArrowRight />
                </Link>
              </Button>
            }
          />
          <CardBody className="p-0">
            {data.topDefaulters.length === 0 ? (
              <EmptyState className="py-10" title="Nothing outstanding" />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {data.topDefaulters.map((student) => (
                  <li key={student.studentId}>
                    <Link
                      href={`/students/${student.studentId}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-sunken)]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{student.name}</p>
                        <p className="text-2xs text-[var(--color-ink-muted)]">
                          {student.admissionNumber} · {student.className}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular text-[var(--color-danger)]">
                        {formatMoney(student.outstanding, currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {data.refunds.count > 0 ? (
        <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
          {formatNumber(data.refunds.count)} refund(s) totalling{' '}
          {formatMoney(data.refunds.total, currency)}
          {data.refunds.pending > 0 ? ` · ${data.refunds.pending} awaiting approval` : ''}
        </p>
      ) : null}
    </>
  );
}
