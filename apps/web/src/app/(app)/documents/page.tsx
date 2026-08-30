'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Download,
  FileText,
  FolderPlus,
  HardDrive,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { humanise } from '@erp/shared-types';
import { api, errorMessage, uploadFile } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate } from '@/lib/dates';
import { saveBlob } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog, Dialog, Modal } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';

const OWNER_TYPES = ['STUDENT', 'STAFF', 'SCHOOL', 'PARENT', 'CLASS', 'GENERIC'] as const;

interface Category {
  id: string;
  name: string;
  code: string;
  ownerType: string;
  isRequired: boolean;
  hasExpiry: boolean;
  documentCount: number;
  isShared: boolean;
}

interface DocumentRow {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  ownerType: string;
  ownerName: string | null;
  isVerified: boolean;
  isExpired: boolean;
  daysUntilExpiry: number | null;
  issueDate: string | null;
  expiryDate: string | null;
  createdAt: string;
  category: { id: string; name: string; code: string } | null;
  uploadedBy: { firstName: string; lastName: string | null } | null;
}

interface DocumentStats {
  total: number;
  unverified: number;
  expired: number;
  expiringSoon: number;
  storageBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function DocumentsPage() {
  const permissions = useAuthStore((state) => state.user?.permissions ?? []);
  const canUpload = permissions.includes('documents.upload');
  const canDelete = permissions.includes('documents.delete');

  const [uploading, setUploading] = React.useState(false);
  const [creatingCategory, setCreatingCategory] = React.useState(false);
  const [deleting, setDeleting] = React.useState<DocumentRow | null>(null);
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['documents', 'statistics'],
    queryFn: () => api.get<DocumentStats>('/documents/statistics'),
    staleTime: 60_000,
  });

  const { data: categories } = useQuery({
    queryKey: ['documents', 'categories'],
    queryFn: () => api.get<Category[]>('/documents/categories'),
    staleTime: 10 * 60_000,
  });

  const list = useListQuery<DocumentRow>('documents', '/documents', {
    initialSortBy: 'createdAt',
    initialSortOrder: 'desc',
  });

  const remove = useAction({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    successMessage: 'Document deleted',
    invalidates: [['documents']],
    onSuccess: () => setDeleting(null),
  });

  async function download(row: DocumentRow) {
    setDownloading(row.id);
    try {
      // Streamed through the API rather than fetched from a storage URL: the
      // request carries the bearer token, which a plain link could not.
      const file = await api.download(`/documents/${row.id}/download`);
      saveBlob(file.blob, file.fileName || row.fileName);
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setDownloading(null);
    }
  }

  const columns: Column<DocumentRow>[] = [
    {
      key: 'title',
      header: 'Document',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.title}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.fileName} · {formatBytes(row.sizeBytes)}
          </span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      cell: (row) => row.category?.name ?? '—',
    },
    {
      key: 'ownerName',
      header: 'Belongs to',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate">{row.ownerName ?? '—'}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {humanise(row.ownerType)}
          </span>
        </span>
      ),
    },
    {
      key: 'expiryDate',
      header: 'Expires',
      sortable: true,
      hideOnMobile: true,
      cell: (row) =>
        row.expiryDate ? (
          <span className={row.isExpired ? 'text-[var(--color-danger)]' : undefined}>
            {formatDate(row.expiryDate)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.isVerified ? (
            <Badge tone="success">Verified</Badge>
          ) : (
            <Badge tone="warning">Unverified</Badge>
          )}
          {row.isExpired ? <Badge tone="danger">Expired</Badge> : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '6rem',
      cell: (row) => (
        <span className="flex gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Download ${row.title}`}
            loading={downloading === row.id}
            onClick={(event) => {
              event.stopPropagation();
              void download(row);
            }}
          >
            <Download />
          </Button>
          {canUpload ? <VerifyButton row={row} /> : null}
          {canDelete ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${row.title}`}
              onClick={(event) => {
                event.stopPropagation();
                setDeleting(row);
              }}
            >
              <TriangleAlert />
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Documents"
        description="Certificates, ID proofs and anything else held against a student or staff member."
        actions={
          canUpload ? (
            <>
              <Button size="sm" icon={<FolderPlus />} onClick={() => setCreatingCategory(true)}>
                New category
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Upload />}
                onClick={() => setUploading(true)}
              >
                Upload
              </Button>
            </>
          ) : null
        }
      />

      {stats ? (
        <StatGrid columns={5} className="mb-4">
          <StatCard label="Documents" value={stats.total} icon={<FileText />} />
          <StatCard
            label="Awaiting check"
            value={stats.unverified}
            icon={<BadgeCheck />}
            invertTrend
          />
          <StatCard label="Expired" value={stats.expired} invertTrend />
          <StatCard label="Expiring in 30 days" value={stats.expiringSoon} invertTrend />
          <StatCard
            label="Storage used"
            value={formatBytes(stats.storageBytes)}
            icon={<HardDrive />}
          />
        </StatGrid>
      ) : null}

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by title, file name or description"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Belongs to"
          value={list.state.filters.ownerType}
          onChange={(value) => list.setFilter('ownerType', value)}
          options={OWNER_TYPES.map((type) => ({ value: type, label: humanise(type) }))}
        />
        <FilterSelect
          label="Category"
          value={list.state.filters.categoryId}
          onChange={(value) => list.setFilter('categoryId', value)}
          options={(categories ?? []).map((category) => ({
            value: category.id,
            label: category.name,
          }))}
        />
        <FilterSelect
          label="Verification"
          value={list.state.filters.unverifiedOnly}
          onChange={(value) => list.setFilter('unverifiedOnly', value)}
          allLabel="Any"
          options={[{ value: 'true', label: 'Unverified only' }]}
        />
        <FilterSelect
          label="Expiry"
          value={list.state.filters.expiredOnly}
          onChange={(value) => list.setFilter('expiredOnly', value)}
          allLabel="Any"
          options={[{ value: 'true', label: 'Expired only' }]}
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
            icon={<FileText />}
            title={
              list.activeFilterCount > 0 ? 'No documents match these filters' : 'No documents yet'
            }
            description="Upload birth certificates, ID proofs and transfer certificates here."
            action={
              canUpload && list.activeFilterCount === 0 ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Upload />}
                  onClick={() => setUploading(true)}
                >
                  Upload a document
                </Button>
              ) : null
            }
          />
        }
      />

      {uploading ? (
        <UploadDialog categories={categories ?? []} onClose={() => setUploading(false)} />
      ) : null}
      {creatingCategory ? (
        <CategoryDialog onClose={() => setCreatingCategory(false)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.title ?? ''}"?`}
        description="The record is removed from the register. The stored file is retained so it can be recovered by an administrator."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

function VerifyButton({ row }: { row: DocumentRow }) {
  const verify = useAction({
    mutationFn: () => api.patch(`/documents/${row.id}/verify`, { isVerified: !row.isVerified }),
    successMessage: row.isVerified ? 'Verification withdrawn' : 'Document verified',
    invalidates: [['documents']],
  });

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={row.isVerified ? `Withdraw verification of ${row.title}` : `Verify ${row.title}`}
      loading={verify.isPending}
      onClick={(event) => {
        event.stopPropagation();
        verify.mutate(undefined);
      }}
    >
      <BadgeCheck className={row.isVerified ? 'text-[var(--color-success)]' : undefined} />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function UploadDialog({
  categories,
  onClose,
}: {
  categories: Category[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = React.useState<File | null>(null);
  const [ownerType, setOwnerType] = React.useState('STUDENT');
  const [ownerId, setOwnerId] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [issueDate, setIssueDate] = React.useState('');
  const [expiryDate, setExpiryDate] = React.useState('');

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const search = useListQuery<{ id: string; fullName: string; admissionNumber: string }>(
    'documents-owner-search',
    '/students',
    { initialLimit: 8, enabled: ownerType === 'STUDENT' },
  );

  const staffSearch = useListQuery<{
    id: string;
    firstName: string;
    lastName: string | null;
    employeeId: string;
  }>('documents-staff-search', '/staff', { initialLimit: 8, enabled: ownerType === 'STAFF' });

  // GENERIC, SCHOOL and CLASS documents are not attached to a person.
  const needsOwner = ownerType === 'STUDENT' || ownerType === 'STAFF';
  const ready = file !== null && title.trim().length > 0 && (!needsOwner || ownerId !== '');

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);

    try {
      await uploadFile('/documents', file, 'file', {
        ownerType,
        ...(ownerType === 'STUDENT' ? { studentId: ownerId } : {}),
        ...(ownerType === 'STAFF' ? { staffId: ownerId } : {}),
        ...(categoryId ? { categoryId } : {}),
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(issueDate ? { issueDate } : {}),
        ...(expiryDate ? { expiryDate } : {}),
      });
      toast.success('Document uploaded');
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Modal
        title="Upload a document"
        description="Files are stored privately and reached through a short-lived link."
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!ready}
              onClick={() => void submit()}
            >
              Upload
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]"
            >
              {error}
            </p>
          ) : null}

          <Field label="File" required help="PDF, image or Office document up to 10 MB">
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                // Saves retyping the obvious title for most uploads.
                if (picked && !title) setTitle(picked.name.replace(/\.[^.]+$/, ''));
              }}
              className="h-auto py-1.5"
            />
          </Field>

          <FieldRow>
            <Field label="Belongs to" required>
              <Select
                value={ownerType}
                onChange={(event) => {
                  setOwnerType(event.target.value);
                  setOwnerId('');
                }}
              >
                {OWNER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {humanise(type)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Uncategorised</option>
                {categories
                  .filter((category) => category.ownerType === ownerType || category.ownerType === 'GENERIC')
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </FieldRow>

          {needsOwner ? (
            <Field
              label={ownerType === 'STUDENT' ? 'Student' : 'Staff member'}
              required
              help="Type to narrow the list"
            >
              <div className="space-y-1.5">
                <Input
                  placeholder="Search by name or number"
                  value={ownerType === 'STUDENT' ? search.state.search : staffSearch.state.search}
                  onChange={(event) =>
                    ownerType === 'STUDENT'
                      ? search.setSearch(event.target.value)
                      : staffSearch.setSearch(event.target.value)
                  }
                />
                <Select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                  <option value="">Select</option>
                  {ownerType === 'STUDENT'
                    ? search.items.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.fullName} — {student.admissionNumber}
                        </option>
                      ))
                    : staffSearch.items.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {[staff.firstName, staff.lastName].filter(Boolean).join(' ')} —{' '}
                          {staff.employeeId}
                        </option>
                      ))}
                </Select>
              </div>
            </Field>
          ) : null}

          <Field label="Title" required>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>

          <Field label="Description">
            <Textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
            />
          </Field>

          <FieldRow>
            <Field label="Issued on">
              <Input
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </Field>
            <Field
              label="Expires on"
              error={
                issueDate && expiryDate && expiryDate < issueDate
                  ? 'Expiry cannot fall before the issue date'
                  : undefined
              }
            >
              <Input
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
              />
            </Field>
          </FieldRow>
        </div>
      </Modal>
    </Dialog>
  );
}

function CategoryDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [ownerType, setOwnerType] = React.useState('STUDENT');
  const [isRequired, setIsRequired] = React.useState(false);
  const [hasExpiry, setHasExpiry] = React.useState(false);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title="New document category"
      submitLabel="Create category"
      values={{ name, code, ownerType, isRequired, hasExpiry }}
      isValid={name.trim().length > 0 && code.trim().length > 0}
      successMessage="Category created"
      invalidates={[['documents']]}
      submit={(values) =>
        api.post('/documents/categories', {
          name: values.name.trim(),
          code: values.code.trim().toUpperCase().replace(/\s+/g, '_'),
          ownerType: values.ownerType,
          isRequired: values.isRequired,
          hasExpiry: values.hasExpiry,
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow>
            <Field label="Name" required error={errors.name}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Birth certificate"
                autoFocus
              />
            </Field>
            <Field label="Code" required error={errors.code}>
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="BIRTH_CERT"
              />
            </Field>
          </FieldRow>

          <Field label="Belongs to" error={errors.ownerType}>
            <Select value={ownerType} onChange={(event) => setOwnerType(event.target.value)}>
              {OWNER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {humanise(type)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(event) => setIsRequired(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Required — flagged on records that have not supplied it
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={hasExpiry}
                onChange={(event) => setHasExpiry(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Documents in this category expire
            </label>
          </div>
        </>
      )}
    </FormModal>
  );
}
