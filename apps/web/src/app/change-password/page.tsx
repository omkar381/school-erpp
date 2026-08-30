'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { changePasswordSchema, type ChangePasswordInput } from '@erp/validation';
import type { CurrentUser } from '@erp/shared-types';
import { ApiClientError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { AuthNotice, AuthShell, PasswordRules } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/states';

/**
 * Forced and voluntary password changes.
 *
 * This page is what the login flow and the app shell redirect to when
 * `mustChangePassword` is set — which is every account provisioned with a
 * generated password. It deliberately sits outside the `(app)` shell: that
 * shell redirects here, so rendering inside it would loop.
 */
export default function ChangePasswordPage() {
  const router = useRouter();

  const hydrated = useAuthStore((state) => state.hydrated);
  const tokens = useAuthStore((state) => state.tokens);
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [showCurrent, setShowCurrent] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const forced = Boolean(user?.mustChangePassword);

  React.useEffect(() => {
    if (hydrated && !tokens) router.replace('/login');
  }, [hydrated, tokens, router]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  // Tracked locally rather than with react-hook-form's `watch`, whose returned
  // function the React Compiler cannot memoize safely.
  const [newPassword, setNewPassword] = React.useState('');
  const newPasswordField = register('newPassword');

  async function onSubmit(values: ChangePasswordInput) {
    setFormError(null);

    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        // Anyone changing a password they were handed should not leave other
        // sessions running on the old one.
        revokeOtherSessions: true,
      });

      // The flag lives on the principal, so it is re-read rather than assumed:
      // without this the shell would redirect straight back here.
      const profile = await api.get<CurrentUser>('/auth/me');
      setUser(profile);

      router.replace('/dashboard');
    } catch (error) {
      if (error instanceof ApiClientError) {
        const fields = error.byField;
        let matched = false;
        for (const [field, message] of Object.entries(fields)) {
          if (field === 'currentPassword' || field === 'newPassword') {
            setError(field, { message });
            matched = true;
          }
        }
        if (!matched) setFormError(error.message);
        return;
      }

      setFormError('Could not reach the server. Check your connection and try again.');
    }
  }

  if (!hydrated || !tokens) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Loading" />
      </div>
    );
  }

  return (
    <AuthShell
      title={forced ? 'Set a new password' : 'Change your password'}
      description={
        forced
          ? 'Your account was created with a temporary password. Choose your own before continuing.'
          : 'Pick a new password for your account.'
      }
      footer={
        forced ? null : (
          <button
            type="button"
            className="text-[var(--color-accent)] hover:underline"
            onClick={() => router.back()}
          >
            Back
          </button>
        )
      }
    >
      {formError ? <AuthNotice tone="danger">{formError}</AuthNotice> : null}
      {forced ? (
        <AuthNotice tone="info">
          You will not be able to use the rest of the workspace until this is done.
        </AuthNotice>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5" noValidate>
        <Field
          label={forced ? 'Temporary password' : 'Current password'}
          error={errors.currentPassword?.message}
          required
        >
          <div className="relative">
            <Input
              {...register('currentPassword')}
              type={showCurrent ? 'text' : 'password'}
              autoComplete="current-password"
              autoFocus
              icon={<Lock />}
              className="pr-8"
            />
            <button
              type="button"
              onClick={() => setShowCurrent((value) => !value)}
              aria-label={showCurrent ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink-secondary)]"
            >
              {showCurrent ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        </Field>

        <Field label="New password" error={errors.newPassword?.message} required>
          <div className="relative">
            <Input
              {...newPasswordField}
              onChange={(event) => {
                void newPasswordField.onChange(event);
                setNewPassword(event.target.value);
              }}
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              icon={<Lock />}
              className="pr-8"
            />
            <button
              type="button"
              onClick={() => setShowNew((value) => !value)}
              aria-label={showNew ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink-secondary)]"
            >
              {showNew ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
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
          Change password
        </Button>
      </form>
    </AuthShell>
  );
}
