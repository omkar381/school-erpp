'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock } from 'lucide-react';
import { resetPasswordSchema } from '@erp/validation';
import type { z } from 'zod';
import { ApiClientError, api } from '@/lib/api';
import { AuthNotice, AuthShell, PasswordRules } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [formError, setFormError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, newPassword: '', confirmPassword: '' },
  });

  // Tracked locally rather than with react-hook-form's `watch`, whose returned
  // function the React Compiler cannot memoize safely.
  const [newPassword, setNewPassword] = React.useState('');
  const newPasswordField = register('newPassword');

  async function onSubmit(values: ResetPasswordInput) {
    setFormError(null);

    try {
      await api.post(
        '/auth/reset-password',
        { token: values.token, password: values.newPassword },
        { anonymous: true },
      );
      setDone(true);
    } catch (error) {
      if (error instanceof ApiClientError) {
        const message = error.byField.password ?? error.byField.token;
        if (message && error.byField.password) {
          setError('newPassword', { message });
          return;
        }
        setFormError(error.message);
        return;
      }
      setFormError('Could not reach the server. Check your connection and try again.');
    }
  }

  if (!token) {
    return (
      <>
        <AuthNotice tone="danger">
          This link is missing its reset token. Request a new one.
        </AuthNotice>
        <Button variant="primary" size="lg" className="w-full" asChild>
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </>
    );
  }

  if (done) {
    return (
      <>
        <AuthNotice tone="success">
          Your password has been changed. Every other session has been signed out.
        </AuthNotice>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => router.replace('/login')}
        >
          Sign in
        </Button>
      </>
    );
  }

  return (
    <>
      {formError ? <AuthNotice tone="danger">{formError}</AuthNotice> : null}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5" noValidate>
        <input type="hidden" {...register('token')} />

        <Field label="New password" error={errors.newPassword?.message} required>
          <Input
            {...newPasswordField}
            onChange={(event) => {
              void newPasswordField.onChange(event);
              setNewPassword(event.target.value);
            }}
            type="password"
            autoComplete="new-password"
            autoFocus
            icon={<Lock />}
          />
        </Field>

        <PasswordRules value={newPassword} />

        <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
          <Input
            {...register('confirmPassword')}
            type="password"
            autoComplete="new-password"
            icon={<Lock />}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
          Set new password
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Choose a new password"
      description="Pick something you have not used on this account before."
      footer={
        <Link href="/login" className="text-[var(--color-accent)] hover:underline">
          Back to sign in
        </Link>
      }
    >
      <React.Suspense
        fallback={<div className="h-56 rounded-[var(--radius-md)] skeleton" aria-hidden />}
      >
        <ResetPasswordForm />
      </React.Suspense>
    </AuthShell>
  );
}
