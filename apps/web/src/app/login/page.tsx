'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Eye, EyeOff, GraduationCap, Lock, Mail } from 'lucide-react';
import { loginSchema, type LoginInput } from '@erp/validation';
import type { LoginResult } from '@erp/shared-types';
import { ApiClientError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'School ERP Platform';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const signIn = useAuthStore((state) => state.signIn);
  const hydrated = useAuthStore((state) => state.hydrated);
  const tokens = useAuthStore((state) => state.tokens);

  const [showPassword, setShowPassword] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const next = params.get('next') ?? '/dashboard';

  // Already signed in — skip the form rather than letting them log in twice.
  React.useEffect(() => {
    if (hydrated && tokens) router.replace(next);
  }, [hydrated, tokens, router, next]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);

    try {
      const result = await api.post<LoginResult>(
        '/auth/login',
        { identifier: values.identifier, password: values.password },
        { anonymous: true },
      );

      // The school is fetched by the shell once the tokens are in place; it is
      // a separate resource and a super administrator has none until they pick
      // one, so a failure here must not block the sign-in.
      signIn({
        tokens: {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
        },
        user: result.user,
        school: null,
      });

      router.replace(result.user.mustChangePassword ? '/change-password' : next);
    } catch (error) {
      if (error instanceof ApiClientError) {
        // Field errors go on the inputs; everything else reads as one message
        // above the form, since a wrong password is not a field-level problem.
        const fields = error.byField;
        let matched = false;
        for (const [field, message] of Object.entries(fields)) {
          if (field === 'identifier' || field === 'password') {
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5" noValidate>
      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] px-3 py-2"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0 text-[var(--color-danger)]" aria-hidden />
          <p className="text-xs text-[var(--color-danger)]">{formError}</p>
        </div>
      ) : null}

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

      <Field label="Password" error={errors.password?.message} required>
        <div className="relative">
          <Input
            {...register('password')}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            icon={<Lock />}
            className="pr-8"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink-secondary)]"
          >
            {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
      </Field>

      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-ink-secondary)]">
          <input
            type="checkbox"
            {...register('rememberMe')}
            className="size-3.5 accent-[var(--color-accent)]"
          />
          Keep me signed in
        </label>
        <Link
          href="/forgot-password"
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Sign-in panel */}
      <div className="flex items-center justify-center bg-[var(--color-surface)] px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-7">
            <div
              className="mb-4 flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white"
              aria-hidden
            >
              <GraduationCap className="size-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              Access your {APP_NAME} workspace.
            </p>
          </div>

          <React.Suspense
            fallback={<div className="h-64 rounded-[var(--radius-md)] skeleton" aria-hidden />}
          >
            <LoginForm />
          </React.Suspense>

          <p className="mt-8 text-2xs text-[var(--color-ink-faint)]">
            Trouble signing in? Contact your school administrator.
          </p>
        </div>
      </div>

      {/* Brand panel — decorative, so it is hidden from assistive technology. */}
      <div
        className="relative hidden overflow-hidden bg-[var(--color-ink)] lg:block"
        aria-hidden
      >
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(var(--color-surface) 1px, transparent 1px), linear-gradient(90deg, var(--color-surface) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="relative flex h-full flex-col justify-end p-12">
          <blockquote className="max-w-md">
            <p className="text-xl font-medium leading-relaxed text-white">
              One system for admissions, attendance, examinations, fees and everything else a
              school runs on.
            </p>
            <footer className="mt-5 text-sm text-slate-400">{APP_NAME}</footer>
          </blockquote>

          <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-white/10 pt-6">
            {[
              ['Modules', '20+'],
              ['Roles', '13'],
              ['Multi-school', 'Yes'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-2xs uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold text-white tabular">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
