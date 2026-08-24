'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] ' +
    'font-medium transition-colors select-none ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] shadow-[var(--shadow-xs)]',
        secondary:
          'bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-border-strong)] ' +
          'hover:bg-[var(--color-surface-sunken)] shadow-[var(--shadow-xs)]',
        ghost:
          'text-[var(--color-ink-secondary)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]',
        danger:
          'bg-[var(--color-danger)] text-white hover:opacity-90 shadow-[var(--shadow-xs)]',
        'danger-outline':
          'border border-[var(--color-danger-border)] text-[var(--color-danger)] ' +
          'bg-[var(--color-danger-soft)] hover:bg-[var(--color-danger)] hover:text-white',
        link: 'text-[var(--color-accent)] underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        xs: 'h-6 px-2 text-2xs [&_svg]:size-3',
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-8 px-3 text-sm [&_svg]:size-4',
        lg: 'h-9 px-4 text-base [&_svg]:size-4',
        icon: 'h-8 w-8 [&_svg]:size-4',
        'icon-sm': 'h-7 w-7 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Rendered before the label; hidden while loading so the row does not jump. */
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, loading, icon, children, disabled, ...props },
  ref,
) {
  // `asChild` renders the caller's element, which cannot also host a spinner.
  if (asChild) {
    return (
      <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      // Tells assistive technology the control is busy rather than just dead.
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export { buttonVariants };
