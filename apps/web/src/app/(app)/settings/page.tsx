'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Check, Palette, Pencil, Puzzle, X } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FieldRow } from '@/components/ui/field';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select } from '@/components/ui/input';
import { DetailList, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { RolesManager } from './roles-manager';

interface School {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  email: string;
  phone: string;
  alternatePhone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  board: string | null;
  affiliationNumber: string | null;
  establishedYear: number | null;
  principalName: string | null;
  timezone: string;
  currency: string;
  locale: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  reportCardHeader: string | null;
  invoiceFooter: string | null;
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
    attendance?: {
      editWindowDays?: number;
      notifyParentsOnAbsence?: boolean;
      minimumAttendancePercent?: number;
      allowFutureMarking?: boolean;
    };
    fees?: {
      lateFeeEnabled?: boolean;
      lateFeeGraceDays?: number;
      allowPartialPayment?: boolean;
      allowOnlinePayment?: boolean;
    };
    exams?: {
      passingPercentage?: number;
      showRankInReportCard?: boolean;
      lockMarksOnPublish?: boolean;
    };
    library?: {
      maxBooksPerStudent?: number;
      loanDurationDays?: number;
      finePerDay?: number;
      maxRenewals?: number;
    };
  };
  enabledModules: Record<string, boolean>;
}

interface SequenceRow {
  kind: string;
  label: string;
  prefix: string;
  padding: number;
  nextValue: number;
  preview: string;
  isConfigured: boolean;
  periodScoped?: Array<{ period: string; nextValue: number; prefix: string }>;
}

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

const SCHOOL_QUERY = [['school']];

export default function SettingsPage() {
  const canEditSchool = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('school.update'),
  );
  const canEditBranding = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('school.branding.update'),
  );
  const canEditSettings = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('school.settings.update'),
  );
  const canManageModules = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('school.modules.manage'),
  );
  const canManageRoles = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('roles.view'),
  );

  const school = useQuery({
    queryKey: ['school', 'current'],
    queryFn: () => api.get<School>('/schools/current'),
  });

  const settings = useQuery({
    queryKey: ['school', 'settings'],
    queryFn: () => api.get<SchoolSettings>('/schools/current/settings'),
  });

  const [editing, setEditing] = React.useState<
    'school' | 'branding' | 'hours' | 'attendance' | 'fees' | 'exams' | 'library' | null
  >(null);

  const toggleModule = useAction({
    mutationFn: (modules: Record<string, boolean>) =>
      api.patch('/schools/current/modules', { modules }),
    successMessage: 'Modules updated',
    invalidates: SCHOOL_QUERY,
  });

  if (school.isLoading) return <LoadingState label="Loading settings" />;
  if (school.error) return <ErrorState error={school.error} onRetry={() => school.refetch()} />;
  if (!school.data) return <EmptyState title="No school configured" />;

  const data = school.data;
  const cfg = settings.data?.settings ?? {};
  const timings = cfg.timings;
  const modules = Object.entries(data.enabledModules ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <PageHeader
        title="Settings"
        description="School profile, branding, operating rules and access control."
      />

      <Tabs defaultValue="school">
        <TabsList>
          <TabsTrigger value="school">School</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="numbering">Numbering</TabsTrigger>
          <TabsTrigger value="modules">Modules</TabsTrigger>
          {canManageRoles ? <TabsTrigger value="roles">Roles</TabsTrigger> : null}
        </TabsList>

        {/* --- School profile --- */}
        <TabsContent value="school">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Identity"
                actions={
                  canEditSchool ? (
                    <Button size="xs" icon={<Pencil />} onClick={() => setEditing('school')}>
                      Edit
                    </Button>
                  ) : null
                }
              />
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
                    {
                      label: 'Status',
                      value: <Badge tone="success">{humanise(data.status)}</Badge>,
                    },
                  ]}
                />
              </CardBody>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="Contact & address" />
                <CardBody>
                  <DetailList
                    columns={1}
                    items={[
                      { label: 'Email', value: data.email },
                      { label: 'Phone', value: data.phone },
                      { label: 'Alternate phone', value: data.alternatePhone },
                      { label: 'Website', value: data.website },
                      {
                        label: 'Address',
                        value: [
                          data.addressLine1,
                          data.addressLine2,
                          data.city,
                          data.state,
                          data.postalCode,
                        ]
                          .filter(Boolean)
                          .join(', '),
                      },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="School hours"
                  actions={
                    canEditSettings ? (
                      <Button size="xs" icon={<Pencil />} onClick={() => setEditing('hours')}>
                        Edit
                      </Button>
                    ) : null
                  }
                />
                <CardBody>
                  <DetailList
                    columns={1}
                    items={[
                      {
                        label: 'Hours',
                        value:
                          timings?.startTime && timings?.endTime
                            ? `${timings.startTime} – ${timings.endTime}`
                            : null,
                      },
                      {
                        label: 'Lunch',
                        value:
                          timings?.lunchStart && timings?.lunchEnd
                            ? `${timings.lunchStart} – ${timings.lunchEnd}`
                            : null,
                      },
                      {
                        label: 'Working days',
                        value: timings?.workingDays
                          ?.map((day) => humanise(day).slice(0, 3))
                          .join(', '),
                      },
                      { label: 'Timezone', value: data.timezone },
                      { label: 'Currency', value: data.currency },
                    ]}
                  />
                </CardBody>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* --- Branding --- */}
        <TabsContent value="branding">
          <Card className="max-w-xl">
            <CardHeader
              title="Branding"
              description="Used on invoices, receipts, report cards and the portal."
              actions={
                canEditBranding ? (
                  <Button size="xs" icon={<Pencil />} onClick={() => setEditing('branding')}>
                    Edit
                  </Button>
                ) : null
              }
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

              <DetailList
                columns={1}
                items={[
                  { label: 'Report card header', value: data.reportCardHeader },
                  { label: 'Invoice footer', value: data.invoiceFooter },
                ]}
              />

              <p className="flex items-start gap-1.5 text-2xs text-[var(--color-ink-muted)]">
                <Palette className="mt-px size-3 shrink-0" aria-hidden />
                Changing branding re-renders every document generated from here on.
              </p>
            </CardBody>
          </Card>
        </TabsContent>

        {/* --- Operations --- */}
        <TabsContent value="operations">
          <div className="grid gap-4 lg:grid-cols-2">
            <OperationCard
              title="Attendance"
              canEdit={canEditSettings}
              onEdit={() => setEditing('attendance')}
              items={[
                {
                  label: 'Edit window',
                  value:
                    cfg.attendance?.editWindowDays != null
                      ? `${cfg.attendance.editWindowDays} days`
                      : null,
                },
                {
                  label: 'Minimum attendance',
                  value:
                    cfg.attendance?.minimumAttendancePercent != null
                      ? `${cfg.attendance.minimumAttendancePercent}%`
                      : null,
                },
                {
                  label: 'Notify parents on absence',
                  value: yesNo(cfg.attendance?.notifyParentsOnAbsence),
                },
                { label: 'Allow future marking', value: yesNo(cfg.attendance?.allowFutureMarking) },
              ]}
            />
            <OperationCard
              title="Fees"
              canEdit={canEditSettings}
              onEdit={() => setEditing('fees')}
              items={[
                { label: 'Late fee', value: yesNo(cfg.fees?.lateFeeEnabled) },
                {
                  label: 'Grace period',
                  value:
                    cfg.fees?.lateFeeGraceDays != null ? `${cfg.fees.lateFeeGraceDays} days` : null,
                },
                { label: 'Partial payments', value: yesNo(cfg.fees?.allowPartialPayment) },
                { label: 'Online payments', value: yesNo(cfg.fees?.allowOnlinePayment) },
              ]}
            />
            <OperationCard
              title="Examinations"
              canEdit={canEditSettings}
              onEdit={() => setEditing('exams')}
              items={[
                {
                  label: 'Passing percentage',
                  value:
                    cfg.exams?.passingPercentage != null ? `${cfg.exams.passingPercentage}%` : null,
                },
                {
                  label: 'Show rank on report card',
                  value: yesNo(cfg.exams?.showRankInReportCard),
                },
                { label: 'Lock marks on publish', value: yesNo(cfg.exams?.lockMarksOnPublish) },
              ]}
            />
            <OperationCard
              title="Library"
              canEdit={canEditSettings}
              onEdit={() => setEditing('library')}
              items={[
                { label: 'Books per student', value: cfg.library?.maxBooksPerStudent },
                {
                  label: 'Loan duration',
                  value:
                    cfg.library?.loanDurationDays != null
                      ? `${cfg.library.loanDurationDays} days`
                      : null,
                },
                {
                  label: 'Fine per day',
                  value:
                    cfg.library?.finePerDay != null
                      ? `${data.currency} ${cfg.library.finePerDay}`
                      : null,
                },
                { label: 'Renewals allowed', value: cfg.library?.maxRenewals },
              ]}
            />
          </div>
        </TabsContent>

        {/* --- Numbering --- */}
        <TabsContent value="numbering">
          <NumberingTab canEdit={canEditSettings} />
        </TabsContent>

        {/* --- Modules --- */}
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
                    className="flex items-center justify-between gap-2 bg-[var(--color-surface)] px-4 py-2.5"
                  >
                    <span className="flex items-center gap-2">
                      {enabled ? (
                        <Check
                          className="size-3.5 shrink-0 text-[var(--color-success)]"
                          aria-hidden
                        />
                      ) : (
                        <X
                          className="size-3.5 shrink-0 text-[var(--color-ink-faint)]"
                          aria-hidden
                        />
                      )}
                      <span
                        className={
                          enabled ? 'text-sm' : 'text-sm text-[var(--color-ink-faint)] line-through'
                        }
                      >
                        {humanise(key)}
                      </span>
                    </span>
                    {canManageModules && key !== 'core' ? (
                      <button
                        type="button"
                        onClick={() =>
                          toggleModule.mutate({ ...data.enabledModules, [key]: !enabled })
                        }
                        disabled={toggleModule.isPending}
                        className="text-2xs font-medium text-[var(--color-accent)] hover:underline disabled:opacity-50"
                      >
                        {enabled ? 'Disable' : 'Enable'}
                      </button>
                    ) : null}
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
            <RolesManager />
          </TabsContent>
        ) : null}
      </Tabs>

      {editing === 'school' ? (
        <SchoolProfileDialog school={data} onClose={() => setEditing(null)} />
      ) : null}
      {editing === 'branding' ? (
        <BrandingDialog school={data} onClose={() => setEditing(null)} />
      ) : null}
      {editing === 'hours' ? (
        <HoursDialog timings={timings} onClose={() => setEditing(null)} />
      ) : null}
      {editing && ['attendance', 'fees', 'exams', 'library'].includes(editing) ? (
        <OperationDialog
          section={editing as 'attendance' | 'fees' | 'exams' | 'library'}
          current={cfg}
          currency={data.currency}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function yesNo(value: boolean | undefined): string | null {
  return value === undefined ? null : value ? 'Yes' : 'No';
}

function OperationCard({
  title,
  items,
  canEdit,
  onEdit,
}: {
  title: string;
  items: Array<{ label: string; value: React.ReactNode }>;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        actions={
          canEdit ? (
            <Button size="xs" icon={<Pencil />} onClick={onEdit}>
              Edit
            </Button>
          ) : null
        }
      />
      <CardBody>
        <DetailList columns={1} items={items} />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function SchoolProfileDialog({ school, onClose }: { school: School; onClose: () => void }) {
  const [values, setValues] = React.useState({
    name: school.name,
    legalName: school.legalName ?? '',
    email: school.email,
    phone: school.phone,
    alternatePhone: school.alternatePhone ?? '',
    website: school.website ?? '',
    addressLine1: school.addressLine1 ?? '',
    addressLine2: school.addressLine2 ?? '',
    city: school.city ?? '',
    state: school.state ?? '',
    postalCode: school.postalCode ?? '',
    board: school.board ?? '',
    affiliationNumber: school.affiliationNumber ?? '',
    establishedYear: school.establishedYear ? String(school.establishedYear) : '',
    principalName: school.principalName ?? '',
  });

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Edit school profile"
      submitLabel="Save profile"
      values={values}
      isValid={
        values.name.trim().length > 0 &&
        values.email.trim().length > 0 &&
        values.phone.trim().length > 0
      }
      successMessage="School profile updated"
      invalidates={SCHOOL_QUERY}
      submit={(v) =>
        api.patch('/schools/current', {
          name: v.name.trim(),
          legalName: v.legalName.trim() || undefined,
          email: v.email.trim(),
          phone: v.phone.trim(),
          alternatePhone: v.alternatePhone.trim() || undefined,
          website: v.website.trim() || undefined,
          addressLine1: v.addressLine1.trim() || undefined,
          addressLine2: v.addressLine2.trim() || undefined,
          city: v.city.trim() || undefined,
          state: v.state.trim() || undefined,
          postalCode: v.postalCode.trim() || undefined,
          board: v.board.trim() || undefined,
          affiliationNumber: v.affiliationNumber.trim() || undefined,
          establishedYear: v.establishedYear ? Number(v.establishedYear) : undefined,
          principalName: v.principalName.trim() || undefined,
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={2}>
            <Field label="Name" required error={errors.name}>
              <Input value={values.name} onChange={set('name')} autoFocus />
            </Field>
            <Field label="Legal name" error={errors.legalName}>
              <Input value={values.legalName} onChange={set('legalName')} />
            </Field>
          </FieldRow>
          <FieldRow columns={3}>
            <Field label="Email" required error={errors.email}>
              <Input type="email" value={values.email} onChange={set('email')} />
            </Field>
            <Field label="Phone" required error={errors.phone}>
              <Input value={values.phone} onChange={set('phone')} />
            </Field>
            <Field label="Alternate phone" error={errors.alternatePhone}>
              <Input value={values.alternatePhone} onChange={set('alternatePhone')} />
            </Field>
          </FieldRow>
          <Field label="Website" error={errors.website} help="Include https://">
            <Input value={values.website} onChange={set('website')} placeholder="https://" />
          </Field>
          <FieldRow columns={2}>
            <Field label="Address line 1" error={errors.addressLine1}>
              <Input value={values.addressLine1} onChange={set('addressLine1')} />
            </Field>
            <Field label="Address line 2" error={errors.addressLine2}>
              <Input value={values.addressLine2} onChange={set('addressLine2')} />
            </Field>
          </FieldRow>
          <FieldRow columns={3}>
            <Field label="City" error={errors.city}>
              <Input value={values.city} onChange={set('city')} />
            </Field>
            <Field label="State" error={errors.state}>
              <Input value={values.state} onChange={set('state')} />
            </Field>
            <Field label="Postal code" error={errors.postalCode}>
              <Input value={values.postalCode} onChange={set('postalCode')} />
            </Field>
          </FieldRow>
          <FieldRow columns={3}>
            <Field label="Board" error={errors.board}>
              <Input value={values.board} onChange={set('board')} placeholder="CBSE" />
            </Field>
            <Field label="Affiliation no." error={errors.affiliationNumber}>
              <Input value={values.affiliationNumber} onChange={set('affiliationNumber')} />
            </Field>
            <Field label="Established year" error={errors.establishedYear}>
              <Input
                type="number"
                value={values.establishedYear}
                onChange={set('establishedYear')}
              />
            </Field>
          </FieldRow>
          <Field label="Principal name" error={errors.principalName}>
            <Input value={values.principalName} onChange={set('principalName')} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

function BrandingDialog({ school, onClose }: { school: School; onClose: () => void }) {
  const [logoUrl, setLogoUrl] = React.useState(school.logoUrl ?? '');
  const [primaryColor, setPrimaryColor] = React.useState(school.primaryColor);
  const [secondaryColor, setSecondaryColor] = React.useState(school.secondaryColor);
  const [reportCardHeader, setReportCardHeader] = React.useState(school.reportCardHeader ?? '');
  const [invoiceFooter, setInvoiceFooter] = React.useState(school.invoiceFooter ?? '');

  const hex = /^#[0-9a-fA-F]{6}$/;
  const valid = hex.test(primaryColor) && hex.test(secondaryColor);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit branding"
      submitLabel="Save branding"
      values={{ logoUrl, primaryColor, secondaryColor, reportCardHeader, invoiceFooter }}
      isValid={valid}
      successMessage="Branding updated"
      invalidates={SCHOOL_QUERY}
      submit={(v) =>
        api.patch('/schools/current/branding', {
          logoUrl: v.logoUrl.trim() || undefined,
          primaryColor: v.primaryColor,
          secondaryColor: v.secondaryColor,
          reportCardHeader: v.reportCardHeader.trim() || undefined,
          invoiceFooter: v.invoiceFooter.trim() || undefined,
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Logo URL" error={errors.logoUrl} help="A public URL to a PNG or SVG">
            <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
          </Field>
          <FieldRow columns={2}>
            <Field
              label="Primary colour"
              error={errors.primaryColor}
              help={!hex.test(primaryColor) ? 'Six-digit hex, e.g. #0F172A' : undefined}
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={hex.test(primaryColor) ? primaryColor : '#000000'}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-8 w-10 shrink-0 rounded border border-[var(--color-border-strong)]"
                  aria-label="Primary colour picker"
                />
                <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              </div>
            </Field>
            <Field
              label="Secondary colour"
              error={errors.secondaryColor}
              help={!hex.test(secondaryColor) ? 'Six-digit hex' : undefined}
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={hex.test(secondaryColor) ? secondaryColor : '#000000'}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="h-8 w-10 shrink-0 rounded border border-[var(--color-border-strong)]"
                  aria-label="Secondary colour picker"
                />
                <Input value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
              </div>
            </Field>
          </FieldRow>
          <Field label="Report card header" error={errors.reportCardHeader}>
            <Input
              value={reportCardHeader}
              onChange={(e) => setReportCardHeader(e.target.value)}
              placeholder="Progress Report"
            />
          </Field>
          <Field label="Invoice footer" error={errors.invoiceFooter}>
            <Input value={invoiceFooter} onChange={(e) => setInvoiceFooter(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

function HoursDialog({
  timings,
  onClose,
}: {
  timings: SchoolSettings['settings']['timings'];
  onClose: () => void;
}) {
  const [startTime, setStartTime] = React.useState(timings?.startTime ?? '08:30');
  const [endTime, setEndTime] = React.useState(timings?.endTime ?? '15:30');
  const [lunchStart, setLunchStart] = React.useState(timings?.lunchStart ?? '');
  const [lunchEnd, setLunchEnd] = React.useState(timings?.lunchEnd ?? '');
  const [workingDays, setWorkingDays] = React.useState<string[]>(
    timings?.workingDays ?? ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
  );

  function toggleDay(day: string) {
    setWorkingDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    );
  }

  const valid = startTime < endTime && workingDays.length > 0;

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="School hours"
      submitLabel="Save hours"
      values={{ startTime, endTime, lunchStart, lunchEnd, workingDays }}
      isValid={valid}
      successMessage="School timings updated"
      invalidates={SCHOOL_QUERY}
      submit={(v) =>
        api.patch('/schools/current/timings', {
          startTime: v.startTime,
          endTime: v.endTime,
          workingDays: v.workingDays,
          ...(v.lunchStart ? { lunchStart: v.lunchStart } : {}),
          ...(v.lunchEnd ? { lunchEnd: v.lunchEnd } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={2}>
            <Field label="Day starts" required error={errors.startTime}>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field
              label="Day ends"
              required
              error={errors.endTime}
              help={startTime >= endTime ? 'Must be after the start' : undefined}
            >
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </FieldRow>
          <FieldRow columns={2}>
            <Field label="Lunch starts" error={errors.lunchStart}>
              <Input
                type="time"
                value={lunchStart}
                onChange={(e) => setLunchStart(e.target.value)}
              />
            </Field>
            <Field label="Lunch ends" error={errors.lunchEnd}>
              <Input type="time" value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} />
            </Field>
          </FieldRow>
          <Field label="Working days" required>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs ${
                    workingDays.includes(day)
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-ink-muted)]'
                  }`}
                >
                  {humanise(day).slice(0, 3)}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}
    </FormModal>
  );
}

const OPERATION_FIELDS: Record<
  'attendance' | 'fees' | 'exams' | 'library',
  Array<{ key: string; label: string; type: 'number' | 'bool'; help?: string }>
> = {
  attendance: [
    { key: 'editWindowDays', label: 'Edit window (days)', type: 'number' },
    { key: 'minimumAttendancePercent', label: 'Minimum attendance %', type: 'number' },
    { key: 'notifyParentsOnAbsence', label: 'Notify parents on absence', type: 'bool' },
    { key: 'allowFutureMarking', label: 'Allow marking future dates', type: 'bool' },
  ],
  fees: [
    { key: 'lateFeeEnabled', label: 'Charge a late fee', type: 'bool' },
    { key: 'lateFeeGraceDays', label: 'Grace period (days)', type: 'number' },
    { key: 'allowPartialPayment', label: 'Allow partial payments', type: 'bool' },
    { key: 'allowOnlinePayment', label: 'Allow online payments', type: 'bool' },
  ],
  exams: [
    { key: 'passingPercentage', label: 'Passing percentage', type: 'number' },
    { key: 'showRankInReportCard', label: 'Show rank on report cards', type: 'bool' },
    { key: 'lockMarksOnPublish', label: 'Lock marks when results publish', type: 'bool' },
  ],
  library: [
    { key: 'maxBooksPerStudent', label: 'Books per student', type: 'number' },
    { key: 'loanDurationDays', label: 'Loan duration (days)', type: 'number' },
    { key: 'finePerDay', label: 'Fine per day', type: 'number' },
    { key: 'maxRenewals', label: 'Renewals allowed', type: 'number' },
  ],
};

function OperationDialog({
  section,
  current,
  currency,
  onClose,
}: {
  section: 'attendance' | 'fees' | 'exams' | 'library';
  current: SchoolSettings['settings'];
  currency: string;
  onClose: () => void;
}) {
  const fields = OPERATION_FIELDS[section];
  const sectionData = (current[section] ?? {}) as Record<string, unknown>;

  const [values, setValues] = React.useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        f.type === 'bool'
          ? Boolean(sectionData[f.key])
          : sectionData[f.key] != null
            ? String(sectionData[f.key])
            : '',
      ]),
    ),
  );

  const titles = {
    attendance: 'Attendance rules',
    fees: 'Fee rules',
    exams: 'Examination rules',
    library: 'Library rules',
  };

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={titles[section]}
      submitLabel="Save"
      values={values}
      successMessage="Settings updated"
      invalidates={SCHOOL_QUERY}
      submit={(v) => {
        const payload: Record<string, unknown> = {};
        for (const f of fields) {
          if (f.type === 'bool') payload[f.key] = Boolean(v[f.key]);
          else if (v[f.key] !== '') payload[f.key] = Number(v[f.key]);
        }
        return api.patch('/schools/current/settings', { settings: { [section]: payload } });
      }}
    >
      {(errors) => (
        <div className="space-y-3">
          {fields.map((f) =>
            f.type === 'bool' ? (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(values[f.key])}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.checked }))}
                  className="size-3.5 accent-[var(--color-accent)]"
                />
                {f.label}
              </label>
            ) : (
              <Field
                key={f.key}
                label={f.key === 'finePerDay' ? `${f.label} (${currency})` : f.label}
                error={errors[f.key]}
              >
                <Input
                  type="number"
                  min={0}
                  value={String(values[f.key] ?? '')}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              </Field>
            ),
          )}
        </div>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

function NumberingTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['settings', 'sequences'],
    queryFn: () => api.get<SequenceRow[]>('/settings/sequences'),
  });

  const [editing, setEditing] = React.useState<SequenceRow | null>(null);

  if (isLoading) return <LoadingState label="Loading numbering" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <Card>
        <CardHeader
          title="Document numbering"
          description="Prefix, zero-padding and the next number for each kind of document."
        />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-sunken)] text-2xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Document</th>
                <th className="px-3 py-2 text-left">Prefix</th>
                <th className="px-3 py-2 text-right">Padding</th>
                <th className="px-3 py-2 text-left">Next number</th>
                <th className="px-3 py-2 text-left">Preview</th>
                {canEdit ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {(data ?? []).map((row) => {
                const currentPeriod = row.periodScoped?.[0];
                return (
                  <tr key={row.kind}>
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    <td className="px-3 py-2">{currentPeriod?.prefix ?? row.prefix}</td>
                    <td className="px-3 py-2 text-right numeric">{row.padding}</td>
                    <td className="px-3 py-2 numeric">
                      {currentPeriod?.nextValue ?? row.nextValue}
                      {currentPeriod ? (
                        <span className="ml-1.5 text-2xs text-[var(--color-ink-muted)]">
                          ({currentPeriod.period})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-2xs">{row.preview}</td>
                    {canEdit ? (
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="xs"
                          variant="ghost"
                          icon={<Pencil />}
                          onClick={() => setEditing(row)}
                        >
                          Edit
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {editing ? <SequenceDialog row={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function SequenceDialog({ row, onClose }: { row: SequenceRow; onClose: () => void }) {
  const currentPeriod = row.periodScoped?.[0];
  const [prefix, setPrefix] = React.useState(currentPeriod?.prefix ?? row.prefix);
  const [padding, setPadding] = React.useState(String(row.padding));
  const [nextValue, setNextValue] = React.useState(
    String(currentPeriod?.nextValue ?? row.nextValue),
  );

  const minNext = currentPeriod?.nextValue ?? row.nextValue;
  const prefixOk = /^[A-Za-z0-9-]*$/.test(prefix);
  const nextOk = Number(nextValue) >= minNext;

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Numbering — ${row.label}`}
      description="A counter can only be moved forwards, never back over numbers already issued."
      submitLabel="Save"
      values={{ prefix, padding, nextValue }}
      isValid={prefixOk && nextOk && Number(padding) >= 1}
      successMessage="Numbering updated"
      invalidates={[['settings', 'sequences']]}
      submit={(v) =>
        api.patch('/settings/sequences', {
          sequences: [
            {
              kind: row.kind,
              prefix: v.prefix.trim().toUpperCase(),
              padding: Number(v.padding),
              nextValue: Number(v.nextValue),
            },
          ],
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={3}>
            <Field
              label="Prefix"
              error={errors.prefix}
              help={!prefixOk ? 'Letters, digits and dashes only' : undefined}
            >
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Padding" error={errors.padding}>
              <Select value={padding} onChange={(e) => setPadding(e.target.value)}>
                {[3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} digits
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Next number"
              error={errors.nextValue}
              help={!nextOk ? `Cannot go below ${minNext}` : undefined}
            >
              <Input
                type="number"
                min={minNext}
                value={nextValue}
                onChange={(e) => setNextValue(e.target.value)}
              />
            </Field>
          </FieldRow>
          <p className="text-2xs text-[var(--color-ink-muted)]">
            Preview:{' '}
            <span className="font-mono">
              {prefix ? `${prefix}/` : ''}
              {String(Number(nextValue) || 1).padStart(Number(padding) || 5, '0')}
            </span>
          </p>
        </>
      )}
    </FormModal>
  );
}
