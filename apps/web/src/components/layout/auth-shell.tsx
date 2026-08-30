'use client';

import * as React from 'react';
import { GraduationCap } from 'lucide-react';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'School ERP Platform';

/**
 * The frame the signed-out pages share.
 *
 * Sign-in has its own two-panel layout with the brand panel; the pages a user
 * only passes through once — resetting a password, being forced to change one
 * — get this narrower single-column frame instead, so they read as a step
 * rather than as a second front door.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-7">
          <div
            className="mb-4 flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white"
            aria-hidden
          >
            <GraduationCap className="size-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{description}</p>
          ) : null}
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
          {children}
        </div>

        {footer ? <div className="mt-6 text-xs text-[var(--color-ink-muted)]">{footer}</div> : null}

        <p className="mt-8 text-2xs text-[var(--color-ink-faint)]">{APP_NAME}</p>
      </div>
    </div>
  );
}

/** A short block of prose above a form, used for errors and confirmations. */
export function AuthNotice({
  tone,
  children,
}: {
  tone: 'danger' | 'success' | 'info';
  children: React.ReactNode;
}) {
  const palette = {
    danger: 'border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
    success:
      'border-[var(--color-success-border)] bg-[var(--color-success-soft)] text-[var(--color-success)]',
    info: 'border-[var(--color-border)] bg-[var(--color-surface-sunken)] text-[var(--color-ink-secondary)]',
  }[tone];

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`mb-3.5 rounded-[var(--radius-sm)] border px-3 py-2 text-xs ${palette}`}
    >
      {children}
    </div>
  );
}

/**
 * Live feedback on whether a new password satisfies the policy.
 *
 * Shown as a checklist rather than a strength bar, because the rules are
 * fixed and a user who is being rejected needs to know which rule they missed.
 */
export function PasswordRules({ value }: { value: string }) {
  const rules = [
    { label: 'At least 8 characters', met: value.length >= 8 },
    { label: 'A lowercase letter', met: /[a-z]/.test(value) },
    { label: 'An uppercase letter', met: /[A-Z]/.test(value) },
    { label: 'A number', met: /[0-9]/.test(value) },
  ];

  return (
    <ul className="space-y-0.5" aria-live="polite">
      {rules.map((rule) => (
        <li
          key={rule.label}
          className={
            rule.met
              ? 'text-2xs text-[var(--color-success)]'
              : 'text-2xs text-[var(--color-ink-muted)]'
          }
        >
          <span aria-hidden>{rule.met ? '✓' : '○'}</span> {rule.label}
        </li>
      ))}
    </ul>
  );
}
