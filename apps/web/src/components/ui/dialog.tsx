'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay({ className }: { className?: string }) {
  return (
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-[var(--color-overlay)] backdrop-blur-[1px]', className)}
    />
  );
}

/** A centred modal for a focused, self-contained task. */
export function Modal({
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];

  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
          'rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]',
          'shadow-[var(--shadow-lg)] animate-in',
          width,
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Close">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-3">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** A side panel for a longer workflow that should not lose the page behind it. */
export function Drawer({
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  const size = { sm: 'max-w-sm', md: 'max-w-xl', lg: 'max-w-3xl' }[width];

  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-[var(--color-border)]',
          'bg-[var(--color-surface)] shadow-[var(--shadow-lg)]',
          size,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Close">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-3">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * Confirmation for anything destructive.
 *
 * Deliberately names what will happen rather than asking "Are you sure?", so
 * the reader can tell a delete from an archive before clicking.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Modal
        size="sm"
        title={title}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button
              size="sm"
              variant={destructive ? 'danger' : 'primary'}
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-ink-secondary)]">{description}</p>
      </Modal>
    </Dialog>
  );
}
