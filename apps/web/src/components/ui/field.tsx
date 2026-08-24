'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';


/**
 * A labelled form control with help text and an error slot.
 *
 * The label, the help text and the error are wired to the input by id, so a
 * screen reader announces all three — which is the part hand-rolled forms
 * usually miss.
 */
export function Field({
  label,
  help,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: React.ReactNode;
  help?: React.ReactNode;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const generated = React.useId();
  const id = htmlFor ?? generated;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        'aria-describedby': [helpId, errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
        invalid: error ? true : undefined,
      })
    : children;

  return (
    <div className={cn('space-y-1', className)}>
      {label ? (
        <label htmlFor={id} className="block text-xs font-medium text-[var(--color-ink-secondary)]">
          {label}
          {required ? (
            <span className="ml-0.5 text-[var(--color-danger)]" aria-hidden>
              *
            </span>
          ) : null}
        </label>
      ) : null}

      {control}

      {help && !error ? (
        <p id={helpId} className="text-2xs text-[var(--color-ink-muted)]">
          {help}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-2xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FieldRow({
  columns = 2,
  className,
  children,
}: {
  columns?: 1 | 2 | 3 | 4;
  className?: string;
  children: React.ReactNode;
}) {
  const grid = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
  }[columns];

  return <div className={cn('grid gap-3', grid, className)}>{children}</div>;
}

