'use client';

import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Inbox } from 'lucide-react';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';
import type { TicketOptions, TicketStats } from '@/lib/platform';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { TicketList } from '@/components/support/ticket-list';

export default function PlatformSupportPage() {
  const searchParams = useSearchParams();
  const schoolId = searchParams.get('schoolId') ?? undefined;

  const { data: stats, isLoading } = useQuery({
    queryKey: ['support', 'statistics', 'platform', schoolId],
    queryFn: () =>
      api.get<TicketStats>('/platform/support/statistics', schoolId ? { schoolId } : undefined),
    staleTime: 30_000,
  });

  const { data: options } = useQuery({
    queryKey: ['support', 'categories'],
    queryFn: () => api.get<TicketOptions>('/support/categories'),
    staleTime: 60 * 60_000,
  });

  return (
    <>
      <PageHeader
        title="Support desk"
        description="Every ticket raised across the platform, and who is dealing with it."
      />

      <StatGrid columns={4} className="mb-4">
        <StatCard
          label="Open"
          value={stats ? formatNumber(stats.open) : '—'}
          hint={stats ? `${stats.inProgress} in progress` : undefined}
          icon={<Inbox />}
          loading={isLoading}
        />
        <StatCard
          label="Pending"
          value={stats ? formatNumber(stats.pending) : '—'}
          hint={stats ? `${stats.waiting} waiting on a reply` : undefined}
          loading={isLoading}
        />
        <StatCard
          label="Urgent"
          value={stats ? formatNumber(stats.urgent) : '—'}
          hint={stats ? `${stats.unassigned} unassigned` : undefined}
          icon={<AlertTriangle />}
          invertTrend
          loading={isLoading}
        />
        <StatCard
          label="Resolved"
          value={stats ? formatNumber(stats.resolved) : '—'}
          hint={
            stats?.averageResolutionHours !== null && stats?.averageResolutionHours !== undefined
              ? `${stats.averageResolutionHours}h average over ${stats.windowDays} days`
              : undefined
          }
          icon={<CheckCircle2 />}
          loading={isLoading}
        />
      </StatGrid>

      <TicketList
        queryKey="platform-tickets"
        path="/platform/support/tickets"
        basePath="/super-admin/support"
        showSchool
        categories={options?.categories}
        initialFilters={schoolId ? { schoolId } : undefined}
        queueFilter
      />
    </>
  );
}
