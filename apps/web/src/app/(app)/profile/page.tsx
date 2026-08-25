'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, LogOut, Monitor } from 'lucide-react';
import { changePasswordSchema, type ChangePasswordInput } from '@erp/validation';
import { ROLE_LABELS, type RoleType } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { initials } from '@/lib/utils';
import { formatAgo, formatDateTime } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { DetailList } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/states';

interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  isCurrent?: boolean;
}

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const school = useAuthStore((state) => state.school);

  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.get<Session[]>('/auth/sessions'),
  });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  const changePassword = useAction({
    mutationFn: (values: ChangePasswordInput) =>
      api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }),
    successMessage: 'Password changed',
    onSuccess: () => reset(),
    onError: (error) => {
      for (const [field, message] of Object.entries(error.byField)) {
        setError(field as keyof ChangePasswordInput, { message });
      }
    },
  });

  const revoke = useAction({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    successMessage: 'Session signed out',
    invalidates: [['auth', 'sessions']],
  });

  const signOutEverywhere = useAction({
    mutationFn: () => api.post('/auth/logout-all'),
    successMessage: 'Signed out of every other device',
    invalidates: [['auth', 'sessions']],
  });

  if (!user) return <EmptyState title="Not signed in" />;

  return (
    <>
      <PageHeader title="Profile" description="Your account, password and active sessions." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" />
          <CardBody>
            <div className="mb-4 flex items-center gap-3">
              <span
                className="flex size-12 items-center justify-center rounded-full bg-[var(--color-accent)] text-sm font-semibold text-white"
                aria-hidden
              >
                {initials(user.displayName)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.displayName}</p>
                <p className="truncate text-xs text-[var(--color-ink-muted)]">
                  {user.email ?? user.phone}
                </p>
              </div>
            </div>

            <DetailList
              columns={1}
              items={[
                { label: 'School', value: school?.name },
                {
                  label: 'Roles',
                  value: (
                    <span className="flex flex-wrap gap-1">
                      {user.roles.map((role) => (
                        <Badge key={role} tone="info">
                          {ROLE_LABELS[role as RoleType] ?? role}
                        </Badge>
                      ))}
                    </span>
                  ),
                },
                { label: 'Permissions', value: `${user.permissions.length} granted` },
                { label: 'Locale', value: user.locale },
                { label: 'Timezone', value: user.timezone ?? school?.timezone },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Change password" />
          <form onSubmit={handleSubmit((values) => changePassword.mutate(values))}>
            <CardBody className="space-y-3">
              <Field label="Current password" error={errors.currentPassword?.message} required>
                <Input
                  {...register('currentPassword')}
                  type="password"
                  autoComplete="current-password"
                />
              </Field>
              <Field
                label="New password"
                error={errors.newPassword?.message}
                help="At least 8 characters with an uppercase letter, a lowercase letter and a number"
                required
              >
                <Input {...register('newPassword')} type="password" autoComplete="new-password" />
              </Field>
              <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
                <Input
                  {...register('confirmPassword')}
                  type="password"
                  autoComplete="new-password"
                />
              </Field>
            </CardBody>
            <CardFooter>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={changePassword.isPending}
                icon={<KeyRound />}
              >
                Change password
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Active sessions"
          description="Every device currently signed in to this account."
          actions={
            <Button
              size="xs"
              variant="danger-outline"
              loading={signOutEverywhere.isPending}
              onClick={() => signOutEverywhere.mutate(undefined)}
              icon={<LogOut />}
            >
              Sign out everywhere else
            </Button>
          }
        />
        <CardBody className="p-0">
          {(sessions.data ?? []).length === 0 ? (
            <EmptyState title="No other sessions" />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {(sessions.data ?? []).map((session) => (
                <li key={session.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Monitor className="size-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {/* The full user agent is noise; the first token names the browser. */}
                      {session.userAgent?.split(' ')[0] ?? 'Unknown device'}
                      {session.isCurrent ? (
                        <Badge tone="success" className="ml-1.5">
                          This device
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-2xs text-[var(--color-ink-muted)]">
                      {session.ipAddress ?? 'Unknown IP'} · signed in{' '}
                      {formatAgo(session.createdAt)}
                      {session.lastUsedAt
                        ? ` · last used ${formatDateTime(session.lastUsedAt)}`
                        : ''}
                    </p>
                  </div>
                  {!session.isCurrent ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      loading={revoke.isPending}
                      onClick={() => revoke.mutate(session.id)}
                    >
                      Sign out
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
