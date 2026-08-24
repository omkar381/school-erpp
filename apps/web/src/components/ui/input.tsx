'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-[var(--radius-sm)] border bg-[var(--color-surface)] text-[var(--color-ink)] ' +
  'transition-colors placeholder:text-[var(--color-ink-faint)] ' +
  'disabled:cursor-not-allowed disabled:bg-[var(--color-surface-sunken)] disabled:opacity-70';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Rendered inside the field on the leading edge. */
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, icon, ...props },
  ref,
) {
  const field = (
    <input
      ref={ref}
      // Announces the error to a screen reader, not just to the eye.
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        'h-8 px-2.5 text-sm',
        icon && 'pl-8',
        invalid
          ? 'border-[var(--color-danger)] focus-visible:outline-[var(--color-danger)]'
          : 'border-[var(--color-border-strong)]',
        className,
      )}
      {...props}
    />
  );

  if (!icon) return field;

  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] [&_svg]:size-3.5"
        aria-hidden
      >
        {icon}
      </span>
      {field}
    </div>
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        'px-2.5 py-2 text-sm resize-y',
        invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-strong)]',
        className,
      )}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, ...props }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        'h-8 px-2 pr-7 text-sm appearance-none cursor-pointer',
        // Chevron drawn as a background image so the control stays a real
        // <select> — native keyboard behaviour and mobile pickers included.
        "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")] bg-[length:12px] bg-[right_0.5rem_center] bg-no-repeat",
        invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-strong)]',
        className,
      )}
      {...props}
    />
  );
});
