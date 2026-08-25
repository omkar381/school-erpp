'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Check, Palette, Puzzle, Shield, X } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface School {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  email: string;
  phone: string;
  website: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  board: string | null;
  affiliationNumber: string | null;
  establishedYear: number | null;
  principalName: string | null;
  timezone: string;
  currency: string;
  locale: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  enabledModules: Record<string, boolean>;
  status: string;
}

interface SchoolSettings {
  settings: {
    timings?: {
      startTime?: string;
      endTime?: string;
      workingDays?: string[];
      lunchStart?: string;
      lunchEnd?: string;
    };
    attendance?: Record<string, unknown>;
    library?: Record<string, unknown>;
    fees?: Record<string, unknown>;
  };
}

interface Role {
  id: string;
  name: string;
  type: string;
  isSystem?: boolean;
  permissionCount?: number;
  userCount?: number;
}

export default function SettingsPage() {
  const canManageRoles = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('roles.view'),
  );

  const school = useQuery({
    queryKey: ['school', 'current'],
    queryFn: () => api.get<School>('/schools/current'),
  });

  const settings = useQuery({
    queryKey: ['school', 'settings'],
    queryFn: () => api.get<SchoolSettings>('/schools/current/settings'),
  });

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Role[]>('/roles'),
    enabled: canManageRoles,
  });

  if (school.isLoading) return <LoadingState label="Loading settings" />;
  if (school.error) return <ErrorState error={school.error} onRetry={() => school.refetch()} />;
  if (!school.data) return <EmptyState title="No school configured" />;

  const data = school.data;
  const timings = settings.data?.settings?.timings;
  const modules = Object.entries(data.enabledModules ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <PageHeader
        title="Settings"
        description="School profile, branding, modules and access control."
      />

      <Tabs defaultValue="school">
        <TabsList>
          <TabsTrigger value="school">School</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="modules">Modules</TabsTrigger>
          {canManageRoles ? <TabsTrigger value="roles">Roles</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="school">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Identity" />
              <CardBody>
                <DetailList
                  columns={1}
                  items={[
                    { label: 'Name', value: data.name },
                    { label: 'Legal name', value: data.legalName },
                    { label: 'Code', value: data.code },
                    { label: 'Board', value: data.board },
                    { label: 'Affiliation no.', value: data.affiliationNumber },
                    { label: 'Established', value: data.establishedYear },
                    { label: 'Principal', value: data.principalName },
                    { label: 'Status', value: <Badge tone="success">{humanise(data.status)}</Badge> },
                  ]}
                />
              </CardBody>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="Contact" />
                <CardBody>
                  <DetailList
                    columns={1}
                    items={[
                      { label: 'Email', value: data.email },
                      { label: 'Phone', value: data.phone },
                      { label: 'Website', value: data.website },
                      {
                        label: 'Address',
                        value: [data.addressLine1, data.city, data.state, data.postalCode]
                          .filter(Boolean)
                          .join(', '),
                      },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Locale and hours" />
                <CardBody>
                  <DetailList
                    columns={1}
                    items={[
                      { label: 'Timezone', value: data.timezone },
                      { label: 'Currency', value: data.currency },
                      { label: 'Locale', value: data.locale },
                      {
                        label: 'School hours',
                        value:
                          timings?.startTime && timings?.endTime
                            ? `${timings.startTime} – ${timings.endTime}`
                            : null,
                      },
                      {
                        label: 'Working days',
                        value: timings?.workingDays
                          ?.map((day) => humanise(day).slice(0, 3))
                          .join(', '),
                      },
                    ]}
                  />
                </CardBody>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="branding">
          <Card className="max-w-xl">
            <CardHeader
              title="Branding"
              description="Used on invoices, receipts, report cards and the portal."
            />
            <CardBody className="space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-12 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)]"
                  aria-hidden
                >
                  {data.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.logoUrl} alt="" className="size-12 object-contain" />
                  ) : (
                    <Building2 className="size-5 text-[var(--color-ink-faint)]" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-medium">School logo</p>
                  <p className="text-2xs text-[var(--color-ink-muted)]">
                    {data.logoUrl ? 'Uploaded' : 'Not set — documents print without a logo'}
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                {[
                  ['Primary', data.primaryColor],
                  ['Secondary', data.secondaryColor],
                ].map(([label, color]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span
                      className="size-8 rounded-[var(--radius-sm)] border border-[var(--color-border)]"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <div>
                      <p className="text-xs font-medium">{label}</p>
                      <p className="text-2xs tabular text-[var(--color-ink-muted)]">{color}</p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="flex items-start gap-1.5 text-2xs text-[var(--color-ink-muted)]">
                <Palette className="mt-px size-3 shrink-0" aria-hidden />
                Changing branding re-renders every document generated from here on.
              </p>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="modules">
          <Card>
            <CardHeader
              title="Feature modules"
              description="A disabled module is hidden from the portal and refused by the API."
            />
            <CardBody className="p-0">
              <ul className="grid gap-px bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-3">
                {modules.map(([key, enabled]) => (
                  <li
                    key={key}
                    className="flex items-center gap-2 bg-[var(--color-surface)] px-4 py-2.5"
                  >
                    {enabled ? (
                      <Check className="size-3.5 shrink-0 text-[var(--color-success)]" aria-hidden />
                    ) : (
                      <X className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
                    )}
                    <span
                      className={
                        enabled ? 'text-sm' : 'text-sm text-[var(--color-ink-faint)] line-through'
                      }
                    >
                      {humanise(key)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <p className="mt-3 flex items-start gap-1.5 text-2xs text-[var(--color-ink-muted)]">
            <Puzzle className="mt-px size-3 shrink-0" aria-hidden />
            Modules available to a school are capped by its subscription plan.
          </p>
        </TabsContent>

        {canManageRoles ? (
          <TabsContent value="roles">
            <Card>
              <CardHeader
                title="Roles"
                description="What each role can do is enforced by the API, not the portal."
              />
              <CardBody className="p-0">
                {roles.isLoading ? (
                  <LoadingState label="Loading roles" />
                ) : (roles.data ?? []).length === 0 ? (
                  <EmptyState icon={<Shield />} title="No roles configured" />
                ) : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {(roles.data ?? []).map((role) => (
                      <li key={role.id} className="flex items-center gap-3 px-4 py-2.5">
                        <Shield className="size-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{role.name}</p>
                          <p className="text-2xs text-[var(--color-ink-muted)]">
                            {humanise(role.type)}
                            {role.permissionCount !== undefined
                              ? ` · ${role.permissionCount} permissions`
                              : ''}
                          </p>
                        </div>
                        {role.userCount !== undefined ? (
                          <span className="text-2xs tabular text-[var(--color-ink-muted)]">
                            {role.userCount} users
                          </span>
                        ) : null}
                        {role.isSystem ? <Badge>System</Badge> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
