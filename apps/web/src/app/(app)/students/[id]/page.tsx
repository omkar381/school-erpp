'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BadgeIndianRupee, Bus, Download, FileText, Pencil, Phone, Users } from 'lucide-react';
import { BLOOD_GROUP_LABELS, type BloodGroup, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatMoney, formatPercent, initials, saveBlob } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { DetailList, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface StudentDetail {
  id: string;
  admissionNumber: string;
  rollNumber: string | null;
  fullName: string;
  firstName: string;
  photoUrl: string | null;
  dateOfBirth: string;
  gender: string;
  bloodGroup: BloodGroup;
  nationality: string | null;
  religion: string | null;
  category: string | null;
  motherTongue: string | null;
  status: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyRelation: string | null;
  medicalConditions: string | null;
  allergies: string | null;
  medications: string | null;
  previousSchool: string | null;
  previousClass: string | null;
  admissionDate: string;
  outstandingAmount: number;
  attendance: {
    totalDays: number;
    presentDays: number;
    absentDays: number;
    lateDays: number;
    percentage: number;
  } | null;
  currentEnrollment: {
    rollNumber: string | null;
    class?: { id: string; name: string } | null;
    section?: { id: string; name: string } | null;
  } | null;
  guardians: Array<{
    id: string;
    firstName: string;
    lastName: string | null;
    relation: string;
    phone: string | null;
    email: string | null;
    occupation: string | null;
  }>;
  enrollments: Array<{
    id: string;
    rollNumber: string | null;
    status: string;
    class?: { name: string } | null;
    section?: { name: string } | null;
    academicYear?: { name: string } | null;
  }>;
  transport: Array<{
    id: string;
    direction: string;
    fareAmount: string | number;
    isActive: boolean;
    route?: { name: string; vehicle?: { registrationNumber: string } | null } | null;
    pickupStop?: { name: string; pickupTime: string | null } | null;
  }>;
  documents: Array<{
    id: string;
    title: string;
    fileName: string;
    createdAt: string;
    isVerified: boolean;
  }>;
}

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const canEdit = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('students.update'),
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['student', id],
    queryFn: () => api.get<StudentDetail>(`/students/${id}`),
    enabled: Boolean(id),
  });

  const [downloading, setDownloading] = React.useState(false);

  async function downloadStatement() {
    setDownloading(true);
    try {
      const file = await api.download(`/documents/fee-statements/${id}`);
      saveBlob(file.blob, file.fileName);
    } finally {
      setDownloading(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading student" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="Student not found" />;

  const enrollment = data.currentEnrollment;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-sm font-semibold text-[var(--color-ink-secondary)]"
              aria-hidden
            >
              {data.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.photoUrl} alt="" className="size-10 object-cover" />
              ) : (
                initials(data.fullName)
              )}
            </span>
            <span>
              {data.fullName}
              <StatusBadge status={data.status} className="ml-2 align-middle" />
            </span>
          </span>
        }
        description={
          <>
            {data.admissionNumber}
            {enrollment?.class ? (
              <>
                {' · '}
                {enrollment.class.name} {enrollment.section?.name}
                {enrollment.rollNumber ? ` · Roll ${enrollment.rollNumber}` : ''}
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <Button size="sm" onClick={downloadStatement} loading={downloading} icon={<Download />}>
              Fee statement
            </Button>
            {canEdit ? (
              <Button size="sm" variant="primary" asChild icon={<Pencil />}>
                <Link href={`/students/${id}/edit`}>Edit</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <StatGrid columns={4} className="mb-4">
        <StatCard
          label="Attendance"
          value={formatPercent(data.attendance?.percentage ?? null)}
          hint={
            data.attendance
              ? `${data.attendance.presentDays}/${data.attendance.totalDays} days`
              : 'No records yet'
          }
        />
        <StatCard
          label="Days absent"
          value={data.attendance?.absentDays ?? 0}
          hint={data.attendance ? `${data.attendance.lateDays} late` : undefined}
        />
        <StatCard
          label="Outstanding fees"
          value={formatMoney(data.outstandingAmount, currency)}
          icon={<BadgeIndianRupee />}
        />
        <StatCard label="Guardians" value={data.guardians.length} icon={<Users />} />
      </StatGrid>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="guardians">Guardians ({data.guardians.length})</TabsTrigger>
          <TabsTrigger value="academic">Academic history</TabsTrigger>
          <TabsTrigger value="transport">Transport</TabsTrigger>
          <TabsTrigger value="documents">Documents ({data.documents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Personal" />
              <CardBody>
                <DetailList
                  columns={1}
                  items={[
                    { label: 'Full name', value: data.fullName },
                    { label: 'Date of birth', value: formatDate(data.dateOfBirth) },
                    { label: 'Gender', value: humanise(data.gender) },
                    { label: 'Blood group', value: BLOOD_GROUP_LABELS[data.bloodGroup] },
                    { label: 'Nationality', value: data.nationality },
                    { label: 'Religion', value: data.religion },
                    { label: 'Category', value: data.category },
                    { label: 'Mother tongue', value: data.motherTongue },
                    { label: 'Admitted on', value: formatDate(data.admissionDate) },
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
                      {
                        label: 'Address',
                        value: [data.addressLine1, data.addressLine2, data.city, data.state, data.postalCode]
                          .filter(Boolean)
                          .join(', '),
                      },
                      { label: 'Emergency contact', value: data.emergencyContactName },
                      { label: 'Emergency phone', value: data.emergencyContactPhone },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Medical"
                  description="Shown to staff who need it in an emergency"
                />
                <CardBody>
                  <DetailList
                    columns={1}
                    items={[
                      { label: 'Conditions', value: data.medicalConditions },
                      { label: 'Allergies', value: data.allergies },
                      { label: 'Medications', value: data.medications },
                    ]}
                  />
                </CardBody>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="guardians">
          {data.guardians.length === 0 ? (
            <EmptyState icon={<Users />} title="No guardians linked" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.guardians.map((guardian) => (
                <Card key={guardian.id}>
                  <CardBody>
                    <div className="mb-3 flex items-center gap-2">
                      <span
                        className="flex size-8 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold"
                        aria-hidden
                      >
                        {initials(`${guardian.firstName} ${guardian.lastName ?? ''}`)}
                      </span>
                      <div className="min-w-0">
                        <Link
                          href={`/guardians/${guardian.id}`}
                          className="block truncate text-sm font-medium hover:text-[var(--color-accent)]"
                        >
                          {guardian.firstName} {guardian.lastName ?? ''}
                        </Link>
                        <p className="text-2xs text-[var(--color-ink-muted)]">
                          {humanise(guardian.relation)}
                        </p>
                      </div>
                    </div>

                    <DetailList
                      columns={1}
                      items={[
                        {
                          label: 'Phone',
                          value: guardian.phone ? (
                            <a
                              href={`tel:${guardian.phone}`}
                              className="inline-flex items-center gap-1 hover:text-[var(--color-accent)]"
                            >
                              <Phone className="size-3" aria-hidden />
                              {guardian.phone}
                            </a>
                          ) : null,
                        },
                        { label: 'Email', value: guardian.email },
                        { label: 'Occupation', value: guardian.occupation },
                      ]}
                    />
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="academic">
          <Card>
            <CardHeader title="Enrolment history" />
            <CardBody className="p-0">
              {data.enrollments.length === 0 ? (
                <EmptyState title="No enrolment records" />
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {data.enrollments.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {entry.class?.name} {entry.section?.name}
                        </p>
                        <p className="text-2xs text-[var(--color-ink-muted)]">
                          {entry.academicYear?.name}
                          {entry.rollNumber ? ` · Roll ${entry.rollNumber}` : ''}
                        </p>
                      </div>
                      <StatusBadge status={entry.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="transport">
          {data.transport.filter((entry) => entry.isActive).length === 0 ? (
            <EmptyState
              icon={<Bus />}
              title="Not using school transport"
              description="This student is not assigned to a route."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.transport
                .filter((entry) => entry.isActive)
                .map((entry) => (
                  <Card key={entry.id}>
                    <CardHeader title={entry.route?.name ?? 'Route'} />
                    <CardBody>
                      <DetailList
                        columns={1}
                        items={[
                          { label: 'Bus', value: entry.route?.vehicle?.registrationNumber },
                          { label: 'Pickup stop', value: entry.pickupStop?.name },
                          { label: 'Pickup time', value: entry.pickupStop?.pickupTime },
                          { label: 'Direction', value: humanise(entry.direction) },
                          {
                            label: 'Annual fare',
                            value: formatMoney(entry.fareAmount, currency),
                          },
                        ]}
                      />
                    </CardBody>
                  </Card>
                ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardBody className="p-0">
              {data.documents.length === 0 ? (
                <EmptyState
                  icon={<FileText />}
                  title="No documents uploaded"
                  description="Birth certificates, previous marks cards and IDs appear here."
                />
              ) : (
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
                      {document.isVerified ? <StatusBadge status="ACTIVE" label="Verified" /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
