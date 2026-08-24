import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { toneFor, humanise, type ToneName } from '@erp/shared-types';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-[var(--radius-xs)] border px-1.5 py-0.5 ' +
    'text-2xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral:
          'bg-[var(--color-surface-sunken)] text-[var(--color-ink-secondary)] border-[var(--color-border)]',
        success:
          'bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success-border)]',
        warning:
          'bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[var(--color-warning-border)]',
        danger:
          'bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[var(--color-danger-border)]',
        info: 'bg-[var(--color-info-soft)] text-[var(--color-info)] border-[var(--color-info-border)]',
        accent:
          'bg-[var(--color-accent-alt-soft)] text-[var(--color-accent-alt)] border-[var(--color-accent-alt-border)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/**
 * A badge whose colour is derived from the status itself, so a PAID invoice
 * looks identical in every table it appears in.
 */
export function StatusBadge({
  status,
  className,
  label,
}: {
  status: string | null | undefined;
  className?: string;
  label?: string;
}) {
  if (!status) return <span className="text-[var(--color-ink-faint)]">—</span>;
  return (
    <Badge tone={toneFor(status) as ToneName} className={className}>
      {label ?? humanise(status)}
    </Badge>
  );
}
