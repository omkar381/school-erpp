'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Award, BadgeCheck, Ban, Download, IdCard, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { humanise } from '@erp/shared-types';
import { api, errorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate } from '@/lib/dates';
import { saveBlob } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const CERTIFICATE_TYPES = [
  'BONAFIDE',
  'TRANSFER',
  'CHARACTER',
  'PARTICIPATION',
  'ACHIEVEMENT',
  'CUSTOM',
] as const;

interface Template {
  id: string;
  type: string;
  name: string;
  bodyTemplate: string;
  variables: string[];
  builtInVariables: string[];
  isActive: boolean;
  isShared: boolean;
  issuedCount: number;
}

interface CertificateRow {
  id: string;
  certificateNumber: string;
  type: string;
  issuedOn: string;
  isRevoked: boolean;
  revokeReason: string | null;
  hasPdf: boolean;
  studentName: string | null;
  template: { id: string; name: string } | null;
  student: { id: string; admissionNumber: string } | null;
}

interface IdCardRow {
  id: string;
  cardNumber: string;
  issuedOn: string;
  validTill: string | null;
  isActive: boolean;
  isExpired: boolean;
  holderName: string;
  holderIdentifier: string | null;
}

interface CertificateStats {
  total: number;
  issuedThisMonth: number;
  revoked: number;
  activeIdCards: number;
  byType: Array<{ type: string; count: number }>;
}

export default function CertificatesPage() {
  const permissions = useAuthStore((state) => state.user?.permissions ?? []);
  const canIssue = permissions.includes('certificates.generate');
  const canIssueCards = permissions.includes('id_cards.generate');

  const [issuing, setIssuing] = React.useState(false);
  const [creatingTemplate, setCreatingTemplate] = React.useState(false);
  const [issuingCard, setIssuingCard] = React.useState(false);
  const [revoking, setRevoking] = React.useState<CertificateRow | null>(null);
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['certificates', 'statistics'],
    queryFn: () => api.get<CertificateStats>('/certificates/statistics'),
    staleTime: 60_000,
  });

  const { data: templates } = useQuery({
    queryKey: ['certificates', 'templates'],
    queryFn: () => api.get<Template[]>('/certificates/templates'),
    staleTime: 5 * 60_000,
  });

  const initialSearch = useSearchParams().get('q') ?? undefined;
  const list = useListQuery<CertificateRow>('certificates', '/certificates', {
    initialSortBy: 'issuedOn',
    initialSortOrder: 'desc',
    initialSearch,
  });

  const cards = useListQuery<IdCardRow>('id-cards', '/certificates/id-cards/list', {
    initialSortBy: 'issuedOn',
    initialSortOrder: 'desc',
    enabled: canIssueCards,
  });

  async function download(row: CertificateRow) {
    setDownloading(row.id);
    try {
      // Rendering lives in the PDF module, which streams the file back.
      const file = await api.download(`/documents/certificates/${row.id}`);
      saveBlob(file.blob, file.fileName || `${row.certificateNumber.replace(/\//g, '-')}.pdf`);
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setDownloading(null);
    }
  }

  const columns: Column<CertificateRow>[] = [
    {
      key: 'certificateNumber',
      header: 'Certificate',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.studentName ?? '—'}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.certificateNumber}
          </span>
        </span>
      ),
    },
    { key: 'type', header: 'Type', cell: (row) => humanise(row.type) },
    {
      key: 'template',
      header: 'Template',
      hideOnMobile: true,
      cell: (row) => row.template?.name ?? 'Default wording',
    },
    {
      key: 'issuedOn',
      header: 'Issued',
      sortable: true,
      cell: (row) => formatDate(row.issuedOn),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) =>
        row.isRevoked ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Valid</Badge>,
    },
    {
      key: 'actions',
      header: '',
      width: '5rem',
      cell: (row) => (
        <span className="flex gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Download ${row.certificateNumber}`}
            loading={downloading === row.id}
            onClick={(event) => {
              event.stopPropagation();
              void download(row);
            }}
          >
            <Download />
          </Button>
          {canIssue && !row.isRevoked ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Revoke ${row.certificateNumber}`}
              onClick={(event) => {
                event.stopPropagation();
                setRevoking(row);
              }}
            >
              <Ban />
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const cardColumns: Column<IdCardRow>[] = [
    {
      key: 'holderName',
      header: 'Holder',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.holderName}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.holderIdentifier ?? '—'}
          </span>
        </span>
      ),
    },
    { key: 'cardNumber', header: 'Card', cell: (row) => row.cardNumber },
    { key: 'issuedOn', header: 'Issued', sortable: true, cell: (row) => formatDate(row.issuedOn) },
    {
      key: 'validTill',
      header: 'Valid till',
      cell: (row) =>
        row.validTill ? (
          <span className={row.isExpired ? 'text-[var(--color-danger)]' : undefined}>
            {formatDate(row.validTill)}
          </span>
        ) : (
          'No expiry'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) =>
        !row.isActive ? (
          <Badge>Deactivated</Badge>
        ) : row.isExpired ? (
          <Badge tone="warning">Expired</Badge>
        ) : (
          <Badge tone="success">Active</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Certificates & ID cards"
        description="Issue, reprint and revoke the documents the school puts its name on."
        actions={
          canIssue ? (
            <>
              <Button size="sm" onClick={() => setCreatingTemplate(true)}>
                New template
              </Button>
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setIssuing(true)}>
                Issue certificate
              </Button>
            </>
          ) : null
        }
      />

      {stats ? (
        <StatGrid columns={4} className="mb-4">
          <StatCard label="Issued" value={stats.total} icon={<Award />} />
          <StatCard label="This month" value={stats.issuedThisMonth} icon={<BadgeCheck />} />
          <StatCard label="Revoked" value={stats.revoked} invertTrend />
          <StatCard label="Live ID cards" value={stats.activeIdCards} icon={<IdCard />} />
        </StatGrid>
      ) : null}

      <Tabs defaultValue="issued">
        <TabsList>
          <TabsTrigger value="issued">Issue register</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          {canIssueCards ? <TabsTrigger value="cards">ID cards</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="issued">
          <FilterBar
            search={list.state.search}
            onSearchChange={list.setSearch}
            searchPlaceholder="Search by certificate number or student"
            activeFilterCount={list.activeFilterCount}
            onReset={list.resetFilters}
          >
            <FilterSelect
              label="Type"
              value={list.state.filters.type}
              onChange={(value) => list.setFilter('type', value)}
              options={CERTIFICATE_TYPES.map((type) => ({ value: type, label: humanise(type) }))}
            />
            <FilterSelect
              label="Revoked"
              value={list.state.filters.includeRevoked}
              onChange={(value) => list.setFilter('includeRevoked', value)}
              allLabel="Valid only"
              options={[{ value: 'true', label: 'Include revoked' }]}
            />
          </FilterBar>

          <DataTable
            columns={columns}
            rows={list.items}
            rowKey={(row) => row.id}
            isLoading={list.isLoading}
            error={list.error}
            onRetry={() => list.refetch()}
            meta={list.meta}
            onPageChange={list.setPage}
            sortBy={list.state.sortBy}
            sortOrder={list.state.sortOrder}
            onSortChange={list.setSort}
            empty={
              <EmptyState
                icon={<Award />}
                title="Nothing issued yet"
                description="Bonafide, transfer and character certificates are issued from here."
                action={
                  canIssue ? (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Plus />}
                      onClick={() => setIssuing(true)}
                    >
                      Issue a certificate
                    </Button>
                  ) : null
                }
              />
            }
          />
        </TabsContent>

        <TabsContent value="templates">
          {(templates ?? []).length === 0 ? (
            <EmptyState
              title="No templates"
              description="Without a template the certificate is issued with default wording."
              action={
                canIssue ? (
                  <Button size="sm" variant="primary" onClick={() => setCreatingTemplate(true)}>
                    Create a template
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(templates ?? []).map((template) => (
                <Card key={template.id}>
                  <CardHeader
                    title={template.name}
                    description={`${humanise(template.type)} · used ${template.issuedCount} time${
                      template.issuedCount === 1 ? '' : 's'
                    }`}
                    actions={
                      <span className="flex gap-1">
                        {template.isShared ? <Badge>Shared</Badge> : null}
                        {template.isActive ? (
                          <Badge tone="success">Active</Badge>
                        ) : (
                          <Badge>Inactive</Badge>
                        )}
                      </span>
                    }
                  />
                  <CardBody>
                    <p className="line-clamp-3 whitespace-pre-wrap text-2xs text-[var(--color-ink-secondary)]">
                      {template.bodyTemplate}
                    </p>
                    {template.variables.length > 0 ? (
                      <p className="mt-2 flex flex-wrap gap-1">
                        {template.variables.map((variable) => (
                          <Badge key={variable}>{variable}</Badge>
                        ))}
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {canIssueCards ? (
          <TabsContent value="cards">
            <div className="mb-3 flex justify-end">
              <Button
                size="sm"
                variant="primary"
                icon={<Plus />}
                onClick={() => setIssuingCard(true)}
              >
                Issue ID card
              </Button>
            </div>

            <DataTable
              columns={cardColumns}
              rows={cards.items}
              rowKey={(row) => row.id}
              isLoading={cards.isLoading}
              error={cards.error}
              onRetry={() => cards.refetch()}
              meta={cards.meta}
              onPageChange={cards.setPage}
              empty={
                <EmptyState
                  icon={<IdCard />}
                  title="No ID cards issued"
                  description="Issuing a card deactivates any the holder already has."
                  action={
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Plus />}
                      onClick={() => setIssuingCard(true)}
                    >
                      Issue an ID card
                    </Button>
                  }
                />
              }
            />
          </TabsContent>
        ) : null}
      </Tabs>

      {issuing ? (
        <IssueCertificateDialog templates={templates ?? []} onClose={() => setIssuing(false)} />
      ) : null}
      {creatingTemplate ? (
        <TemplateDialog onClose={() => setCreatingTemplate(false)} />
      ) : null}
      {issuingCard ? <IssueIdCardDialog onClose={() => setIssuingCard(false)} /> : null}
      {revoking ? (
        <RevokeDialog certificate={revoking} onClose={() => setRevoking(null)} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** Shared student picker; certificates and cards both need one. */
function useStudentPicker() {
  const search = useListQuery<{ id: string; fullName: string; admissionNumber: string }>(
    'certificate-student-search',
    '/students',
    { initialLimit: 10 },
  );
  return search;
}

function IssueCertificateDialog({
  templates,
  onClose,
}: {
  templates: Template[];
  onClose: () => void;
}) {
  const [type, setType] = React.useState<string>('BONAFIDE');
  const [templateId, setTemplateId] = React.useState('');
  const [studentId, setStudentId] = React.useState('');
  const [issuedOn, setIssuedOn] = React.useState(() => new Date().toISOString().slice(0, 10));

  const students = useStudentPicker();
  const forType = templates.filter((template) => template.type === type && template.isActive);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Issue a certificate"
      description="Placeholder values are captured now, so a reprint years later still reads correctly."
      submitLabel="Issue certificate"
      values={{ type, templateId, studentId, issuedOn }}
      isValid={studentId !== ''}
      successMessage="Certificate issued"
      invalidates={[['certificates']]}
      submit={(values) =>
        api.post('/certificates', {
          type: values.type,
          ...(values.templateId ? { templateId: values.templateId } : {}),
          studentId: values.studentId,
          ...(values.issuedOn ? { issuedOn: values.issuedOn } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow>
            <Field label="Type" required error={errors.type}>
              <Select
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setTemplateId('');
                }}
              >
                {CERTIFICATE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Template"
              error={errors.templateId}
              help={forType.length === 0 ? 'No template for this type; default wording is used' : undefined}
            >
              <Select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                disabled={forType.length === 0}
              >
                <option value="">Best available</option>
                {forType.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.isShared ? ' (shared)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <Field label="Student" required error={errors.studentId}>
            <div className="space-y-1.5">
              <Input
                placeholder="Search by name or admission number"
                value={students.state.search}
                onChange={(event) => students.setSearch(event.target.value)}
              />
              <Select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                <option value="">Select a student</option>
                {students.items.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.fullName} — {student.admissionNumber}
                  </option>
                ))}
              </Select>
            </div>
          </Field>

          <Field label="Issued on" error={errors.issuedOn}>
            <Input
              type="date"
              value={issuedOn}
              onChange={(event) => setIssuedOn(event.target.value)}
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

function TemplateDialog({ onClose }: { onClose: () => void }) {
  const [type, setType] = React.useState<string>('BONAFIDE');
  const [name, setName] = React.useState('');
  const [bodyTemplate, setBodyTemplate] = React.useState(
    'This is to certify that {{studentName}}, admission number {{admissionNumber}}, is a bonafide student of {{className}} {{sectionName}} for the academic year {{academicYear}}.',
  );

  const detected = [...new Set([...bodyTemplate.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="New certificate template"
      description="Write the wording once; the placeholders are filled at issue time."
      submitLabel="Create template"
      values={{ type, name, bodyTemplate }}
      isValid={name.trim().length > 0 && bodyTemplate.trim().length > 0}
      successMessage="Template created"
      invalidates={[['certificates']]}
      submit={(values) =>
        api.post('/certificates/templates', {
          type: values.type,
          name: values.name.trim(),
          bodyTemplate: values.bodyTemplate,
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow>
            <Field label="Type" required error={errors.type}>
              <Select value={type} onChange={(event) => setType(event.target.value)}>
                {CERTIFICATE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" required error={errors.name}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Bonafide (English)"
              />
            </Field>
          </FieldRow>

          <Field
            label="Body"
            required
            error={errors.bodyTemplate}
            help="Write placeholders as {{studentName}}"
          >
            <Textarea
              rows={6}
              value={bodyTemplate}
              onChange={(event) => setBodyTemplate(event.target.value)}
            />
          </Field>

          <div>
            <p className="mb-1 text-2xs text-[var(--color-ink-muted)]">
              Placeholders found in this template
            </p>
            <p className="flex flex-wrap gap-1">
              {detected.length === 0 ? (
                <span className="text-2xs text-[var(--color-ink-faint)]">None yet</span>
              ) : (
                detected.map((variable) => <Badge key={variable}>{variable}</Badge>)
              )}
            </p>
            <p className="mt-2 text-2xs text-[var(--color-ink-muted)]">
              Filled automatically: studentName, admissionNumber, rollNumber, className,
              sectionName, dateOfBirth, guardianName, academicYear, schoolName, issuedOn.
            </p>
          </div>
        </>
      )}
    </FormModal>
  );
}

function IssueIdCardDialog({ onClose }: { onClose: () => void }) {
  const [studentId, setStudentId] = React.useState('');
  const [issuedOn, setIssuedOn] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [validTill, setValidTill] = React.useState('');

  const students = useStudentPicker();

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title="Issue an ID card"
      description="Any card the student already holds is deactivated."
      submitLabel="Issue card"
      values={{ studentId, issuedOn, validTill }}
      isValid={studentId !== ''}
      successMessage="ID card issued"
      invalidates={[['id-cards'], ['certificates']]}
      submit={(values) =>
        api.post('/certificates/id-cards', {
          studentId: values.studentId,
          ...(values.issuedOn ? { issuedOn: values.issuedOn } : {}),
          ...(values.validTill ? { validTill: values.validTill } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Student" required error={errors.studentId}>
            <div className="space-y-1.5">
              <Input
                placeholder="Search by name or admission number"
                value={students.state.search}
                onChange={(event) => students.setSearch(event.target.value)}
              />
              <Select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                <option value="">Select a student</option>
                {students.items.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.fullName} — {student.admissionNumber}
                  </option>
                ))}
              </Select>
            </div>
          </Field>

          <FieldRow>
            <Field label="Issued on" error={errors.issuedOn}>
              <Input
                type="date"
                value={issuedOn}
                onChange={(event) => setIssuedOn(event.target.value)}
              />
            </Field>
            <Field
              label="Valid till"
              error={errors.validTill}
              help="Defaults to the end of the current academic year"
            >
              <Input
                type="date"
                value={validTill}
                onChange={(event) => setValidTill(event.target.value)}
              />
            </Field>
          </FieldRow>
        </>
      )}
    </FormModal>
  );
}

function RevokeDialog({
  certificate,
  onClose,
}: {
  certificate: CertificateRow;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState('');

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={`Revoke ${certificate.certificateNumber}?`}
      description="The certificate stays on the register so the number can still be accounted for."
      submitLabel="Revoke"
      values={{ reason }}
      isValid={reason.trim().length > 0}
      successMessage="Certificate revoked"
      invalidates={[['certificates']]}
      submit={(values) =>
        api.patch(`/certificates/${certificate.id}/revoke`, { reason: values.reason.trim() })
      }
    >
      {(errors) => (
        <Field label="Reason" required error={errors.reason}>
          <Textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Issued against the wrong academic year"
            autoFocus
          />
        </Field>
      )}
    </FormModal>
  );
}
