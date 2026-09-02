'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, KeyRound, Pencil, Phone, Users } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api, errorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { formatMoney, initials, saveBlob } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { GuardianFormDialog, type EditableGuardian } from '../guardian-form-dialog';

interface GuardianChild {
  id: string;
  studentId: string;
  firstName: string;
  lastName: string | null;
  admissionNumber: string;
  photoUrl: string | null;
  status: string;
  isPrimary: boolean;
  isPayer: boolean;
  canPickup: boolean;
  enrollments: Array<{
    rollNumber: string | null;
    class: { id: string; name: string } | null;
    section: { id: string; name: string } | null;
  }>;
}

interface GuardianDetail extends EditableGuardian {
  fullName: string;
  state: string | null;
  postalCode: string | null;
  annualIncome: string | number | null;
  createdAt: string;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    status: string;
    lastLoginAt: string | null;
    mustChangePassword: boolean;
  } | null;
  children: GuardianChild[];
  documents: Array<{
    id: string;
    title: string;
    fileName: string;
    createdAt: string;
  }>;
}

export default function GuardianDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('guardians.update'),
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['guardian', id],
    queryFn: () => api.get<GuardianDetail>(`/guardians/${id}`),
    enabled: Boolean(id),
  });

  const [editing, setEditing] = React.useState(false);
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const createLogin = useAction({
    mutationFn: () => api.post(`/guardians/${id}/create-login`, {}),
    successMessage: 'Parent login created — the temporary password has been sent to them',
    invalidates: [['guardian', id], ['guardians']],
  });

  async function download(docId: string, fileName: string) {
    setDownloading(docId);
    try {
      const file = await api.download(`/documents/${docId}/download`);
      saveBlob(file.blob, file.fileName || fileName);
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setDownloading(null);
    }
  }

  if (isLoading) return <LoadingState label="Loading parent" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="Parent not found" />;

  const address = [data.addressLine1, data.city, data.state, data.postalCode]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-sm font-semibold text-[var(--color-ink-secondary)]"
              aria-hidden
            >
              {initials(data.fullName)}
            </span>
            <span>
              {data.fullName}
              <Badge className="ml-2 align-middle">{humanise(data.relation)}</Badge>
            </span>
          </span>
        }
        description={`${data.children.length} ${data.children.length === 1 ? 'child' : 'children'} on record`}
        actions={
          <>
            <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
              <Link href="/guardians">All parents</Link>
            </Button>
            {canManage && !data.user && data.email ? (
              <Button
                size="sm"
                icon={<KeyRound />}
                loading={createLogin.isPending}
                onClick={() => createLogin.mutate(undefined)}
              >
                Give portal access
              </Button>
            ) : null}
            {canManage ? (
              <Button
                size="sm"
                variant="primary"
                icon={<Pencil />}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contact" />
          <CardBody>
            <DetailList
              columns={1}
              items={[
                {
                  label: 'Phone',
                  value: data.phone ? (
                    <a
                      href={`tel:${data.phone}`}
                      className="inline-flex items-center gap-1 hover:text-[var(--color-accent)]"
                    >
                      <Phone className="size-3" aria-hidden />
                      {data.phone}
                    </a>
                  ) : null,
                },
                { label: 'Alternate phone', value: data.alternatePhone },
                { label: 'Email', value: data.email },
                { label: 'Address', value: address },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Background" />
          <CardBody>
            <DetailList
              columns={1}
              items={[
                { label: 'Occupation', value: data.occupation },
                { label: 'Organisation', value: data.organization },
                { label: 'Qualification', value: data.qualification },
                {
                  label: 'Annual income',
                  value:
                    data.annualIncome != null && data.annualIncome !== ''
                      ? formatMoney(data.annualIncome, currency)
                      : null,
                },
                { label: 'On record since', value: formatDate(data.createdAt) },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Portal access"
          description="Whether this parent can sign in to see fees, attendance and notices."
        />
        <CardBody>
          {data.user ? (
            <DetailList
              columns={1}
              items={[
                {
                  label: 'Status',
                  value: (
                    <Badge tone={data.user.status === 'ACTIVE' ? 'success' : 'warning'}>
                      {humanise(data.user.status)}
                    </Badge>
                  ),
                },
                { label: 'Sign-in email', value: data.user.email },
                {
                  label: 'Last signed in',
                  value: data.user.lastLoginAt ? formatDate(data.user.lastLoginAt) : 'Never',
                },
                {
                  label: 'Password',
                  value: data.user.mustChangePassword
                    ? 'Temporary — not yet changed'
                    : 'Set by the parent',
                },
              ]}
            />
          ) : (
            <EmptyState
              icon={<KeyRound />}
              title="No portal login"
              description={
                data.email
                  ? 'This parent has an email on file but cannot sign in yet.'
                  : 'Add an email address first, then a login can be created.'
              }
              action={
                canManage && data.email ? (
                  <Button
                    size="sm"
                    icon={<KeyRound />}
                    loading={createLogin.isPending}
                    onClick={() => createLogin.mutate(undefined)}
                  >
                    Give portal access
                  </Button>
                ) : null
              }
            />
          )}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title={`Children (${data.children.length})`} />
        <CardBody className="p-0">
          {data.children.length === 0 ? (
            <EmptyState icon={<Users />} title="No children linked" />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {data.children.map((child) => {
                const enrollment = child.enrollments[0];
                const name = [child.firstName, child.lastName].filter(Boolean).join(' ');
                return (
                  <li key={child.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold"
                      aria-hidden
                    >
                      {child.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={child.photoUrl} alt="" className="size-8 object-cover" />
                      ) : (
                        initials(name)
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/students/${child.studentId}`}
                        className="block truncate text-sm font-medium hover:text-[var(--color-accent)]"
                      >
                        {name}
                      </Link>
                      <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                        {child.admissionNumber}
                        {enrollment?.class
                          ? ` · ${enrollment.class.name} ${enrollment.section?.name ?? ''}`
                          : ''}
                        {enrollment?.rollNumber ? ` · Roll ${enrollment.rollNumber}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {child.isPrimary ? <Badge tone="accent">Primary</Badge> : null}
                      {child.isPayer ? <Badge tone="info">Fee payer</Badge> : null}
                      {child.canPickup ? <Badge>Pickup</Badge> : null}
                      {child.status !== 'ACTIVE' ? (
                        <Badge tone="warning">{humanise(child.status)}</Badge>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {data.documents.length > 0 ? (
        <Card className="mt-4">
          <CardHeader title={`Documents (${data.documents.length})`} />
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--color-border)]">
              {data.documents.map((document) => (
                <li key={document.id} className="flex items-center gap-3 px-4 py-2.5">
                  <FileText className="size-4 text-[var(--color-ink-faint)]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{document.title}</p>
                    <p className="text-2xs text-[var(--color-ink-muted)]">
                      {document.fileName} · {formatDate(document.createdAt)}
                    </p>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Download ${document.title}`}
                    loading={downloading === document.id}
                    onClick={() => download(document.id, document.fileName)}
                  >
                    <Download />
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {editing ? <GuardianFormDialog guardian={data} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
