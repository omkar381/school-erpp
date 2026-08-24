'use client';

import * as React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />;
}

/** A block-level loading state with an accessible announcement. */
export function LoadingState({
  label = 'Loading',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-12 text-[var(--color-ink-muted)]',
        className,
      )}
    >
      <Spinner className="size-5" />
      <span className="text-xs">{label}…</span>
    </div>
  );
}

/** Grey bars sized like the content they stand in for. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-[var(--radius-xs)]', className)} aria-hidden />;
}

export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-[var(--color-border)]" aria-hidden>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-3 py-2.5">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-3.5', columnIndex === 0 ? 'w-1/4' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div
        className="mb-3 flex size-10 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[var(--color-ink-faint)] [&_svg]:size-5"
        aria-hidden
      >
        {icon ?? <Inbox />}
      </div>
      <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-[var(--color-ink-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Renders a failed request.
 *
 * A 403 is a different situation from a crash — the user did nothing wrong and
 * retrying will not help — so it gets its own wording and no retry button.
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const forbidden = error instanceof ApiClientError && error.isForbidden;
  const notFound = error instanceof ApiClientError && error.isNotFound;

  const message =
    error instanceof ApiClientError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong.';

  if (forbidden) {
    return (
      <EmptyState
        className={className}
        icon={<ShieldAlert className="text-[var(--color-warning)]" />}
        title="You do not have access to this"
        description={message}
      />
    );
  }

  return (
    <EmptyState
      className={className}
      icon={<AlertTriangle className="text-[var(--color-danger)]" />}
      title={notFound ? 'Not found' : 'Could not load this'}
      description={message}
      action={
        onRetry && !notFound ? (
          <Button size="sm" onClick={onRetry} icon={<RefreshCw />}>
            Try again
          </Button>
        ) : null
      }
    />
  );
}

/**
 * Picks the right state for a query.
 *
 * Every list and detail view goes through this, so loading, error and empty
 * are never accidentally skipped on one screen and present on another.
 */
export function QueryBoundary<T>({
  isLoading,
  error,
  data,
  onRetry,
  isEmpty,
  empty,
  skeleton,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  data: T | undefined;
  onRetry?: () => void;
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
  skeleton?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (isLoading) return <>{skeleton ?? <LoadingState />}</>;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (data === undefined) return <>{empty ?? <EmptyState title="Nothing to show" />}</>;
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState title="Nothing to show" />}</>;
  return <>{children(data)}</>;
}
