'use client';

import * as React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { DashboardMetric } from '@erp/shared-types';
import { cn, formatMoney, formatNumber, formatPercent } from '@/lib/utils';
import { Skeleton } from './states';

export function formatMetric(metric: DashboardMetric, currency = 'INR'): string {
  switch (metric.format) {
    case 'currency':
      return formatMoney(metric.value, currency, { compact: metric.value >= 100000 });
    case 'percent':
      return formatPercent(metric.value);
    default:
      return formatNumber(metric.value);
  }
}

/**
 * A single headline figure.
 *
 * The change indicator is only shown when a comparison actually exists —
 * a "0%" on a metric with nothing to compare against is worse than silence.
 */
export function StatCard({
  label,
  value,
  hint,
  changePercent,
  /** Whether a rise is good news. Outstanding fees going up is not. */
  invertTrend,
  icon,
  loading,
  className,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  changePercent?: number;
  invertTrend?: boolean;
  icon?: React.ReactNode;
  loading?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  const rising = (changePercent ?? 0) > 0;
  const good = invertTrend ? !rising : rising;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
          {label}
        </p>
        {icon ? (
          <span className="text-[var(--color-ink-faint)] [&_svg]:size-4" aria-hidden>
            {icon}
          </span>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className="mt-1.5 text-2xl font-semibold tabular text-[var(--color-ink)]">{value}</p>
      )}

      <div className="mt-1 flex items-center gap-1.5">
        {changePercent !== undefined && Number.isFinite(changePercent) ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-2xs font-medium',
              good ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]',
            )}
          >
            {rising ? (
              <TrendingUp className="size-3" aria-hidden />
            ) : (
              <TrendingDown className="size-3" aria-hidden />
            )}
            {Math.abs(changePercent).toFixed(1)}%
          </span>
        ) : null}
        {hint ? <span className="text-2xs text-[var(--color-ink-muted)]">{hint}</span> : null}
      </div>
    </>
  );

  const base = cn(
    'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 text-left',
    'shadow-[var(--shadow-xs)] transition-colors',
    onClick && 'hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-sunken)] cursor-pointer',
    className,
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={base}>
      {content}
    </button>
  ) : (
    <div className={base}>{content}</div>
  );
}

export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const grid = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
    5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
    6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
  }[columns];

  return <div className={cn('grid gap-3', grid, className)}>{children}</div>;
}
