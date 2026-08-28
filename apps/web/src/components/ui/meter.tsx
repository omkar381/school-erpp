'use client';

import * as React from 'react';
import { cn, formatNumber } from '@/lib/utils';

export interface UsageValue {
  used: number;
  limit: number;
  percent: number;
  remaining: number;
  exceeded: boolean;
  warning: boolean;
}

/**
 * Usage against an allowance.
 *
 * The bar changes colour before the limit rather than at it — a school that
 * finds out it is full while enrolling a pupil has found out too late.
 */
export function Meter({
  label,
  usage,
  unit,
  hint,
  className,
}: {
  label: string;
  usage: UsageValue;
  /** Appended to both numbers, e.g. "MB". Omit for plain counts. */
  unit?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  const tone = usage.exceeded
    ? 'var(--color-danger)'
    : usage.warning
      ? 'var(--color-warning)'
      : 'var(--color-accent)';

  const format = (value: number) =>
    unit ? `${formatNumber(Math.round(value))} ${unit}` : formatNumber(value);

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-[var(--color-ink-secondary)]">{label}</span>
        <span className="text-xs tabular text-[var(--color-ink-muted)]">
          <span className="font-medium text-[var(--color-ink)]">{format(usage.used)}</span>
          {' / '}
          {format(usage.limit)}
        </span>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
        role="meter"
        aria-label={label}
        aria-valuenow={usage.used}
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuetext={`${format(usage.used)} of ${format(usage.limit)}`}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.min(100, Math.max(usage.percent, usage.used > 0 ? 2 : 0))}%`, background: tone }}
        />
      </div>

      <p className="text-2xs text-[var(--color-ink-muted)]">
        {usage.exceeded ? (
          <span className="font-medium text-[var(--color-danger)]">
            Limit reached — no further {label.toLowerCase()} can be added.
          </span>
        ) : usage.warning ? (
          <span className="font-medium text-[var(--color-warning)]">
            {format(usage.remaining)} left of the allowance.
          </span>
        ) : (
          (hint ?? `${format(usage.remaining)} remaining`)
        )}
      </p>
    </div>
  );
}

/** A compact bar for a table cell, where there is no room for the full meter. */
export function MiniMeter({
  percent,
  className,
  title,
}: {
  percent: number | null;
  className?: string;
  title?: string;
}) {
  if (percent === null) return <span className="text-[var(--color-ink-faint)]">—</span>;

  const tone =
    percent >= 100
      ? 'var(--color-danger)'
      : percent >= 90
        ? 'var(--color-warning)'
        : 'var(--color-accent)';

  return (
    <span className={cn('flex items-center gap-1.5', className)} title={title}>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.min(100, percent)}%`, background: tone }}
        />
      </span>
      <span className="text-2xs tabular text-[var(--color-ink-muted)]">{percent}%</span>
    </span>
  );
}
