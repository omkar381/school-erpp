'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex gap-4 overflow-x-auto border-b border-[var(--color-border)]',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative whitespace-nowrap border-b-2 border-transparent px-0.5 pb-2 pt-1 text-sm',
        'text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]',
        'data-[state=active]:border-[var(--color-accent)] data-[state=active]:font-medium',
        'data-[state=active]:text-[var(--color-ink)]',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-4 animate-in', className)} {...props} />;
}

/** A label/value list, the standard way this product shows a record's fields. */
export function DetailList({
  items,
  columns = 2,
  className,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const grid = {
    1: 'sm:grid-cols-[minmax(8rem,auto)_1fr]',
    2: 'sm:grid-cols-[minmax(8rem,auto)_1fr] lg:grid-cols-[minmax(8rem,auto)_1fr_minmax(8rem,auto)_1fr]',
    3: 'sm:grid-cols-[auto_1fr_auto_1fr_auto_1fr]',
  }[columns];

  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-2.5', grid, className)}>
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <dt className="text-xs text-[var(--color-ink-muted)]">{item.label}</dt>
          <dd className="text-sm text-[var(--color-ink)]">
            {item.value === null || item.value === undefined || item.value === '' ? (
              <span className="text-[var(--color-ink-faint)]">—</span>
            ) : (
              item.value
            )}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
