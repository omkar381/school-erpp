'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react';
import { forgotPasswordSchema } from '@erp/validation';
import type { z } from 'zod';
import { ApiClientError, api } from '@/lib/api';
import { AuthNotice, AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { identifier: '' },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);

    try {
      await api.post('/auth/forgot-password', values, { anonymous: true });
      setSent(true);
    } catch (error) {
      // A rate limit is worth showing; anything else is swallowed deliberately,
      // because whether an account exists must not be inferable from this form.
      if (error instanceof ApiClientError && error.status === 429) {
        setFormError('Too many attempts. Wait a minute and try again.');
        return;
      }
      setSent(true);
    }
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your inbox"
        description="If an account matches what you entered, a reset link is on its way."
        footer={
          <Link href="/login" className="text-[var(--color-accent)] hover:underline">
            Back to sign in
          </Link>
        }
      >
        <AuthNotice tone="success">
          We sent a link to the address on file for <strong>{getValues('identifier')}</strong>. It
          expires in an hour.
        </AuthNotice>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Nothing arrived? Check the spam folder, or ask your school administrator to reset it for
          you.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email or phone number you sign in with."
      footer={
        <Link href="/login" className="text-[var(--color-accent)] hover:underline">
          Back to sign in
        </Link>
      }
    >
      {formError ? <AuthNotice tone="danger">{formError}</AuthNotice> : null}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5" noValidate>
        <Field label="Email or phone" error={errors.identifier?.message} required>
          <Input
            {...register('identifier')}
            type="text"
            autoComplete="username"
            autoFocus
            placeholder="you@school.edu"
            icon={<Mail />}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
