'use client';

import * as React from 'react';
import Link from 'next/link';
import { KeyRound, Pencil, Phone, Plus, Trash2, Users } from 'lucide-react';
import { GUARDIAN_RELATIONS, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { initials } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/states';

interface GuardianRow {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string | null;
  relation: string;
  email: string | null;
  phone: string | null;
  occupation: string | null;
  organization: string | null;
  qualification: string | null;
  alternatePhone: string | null;
  addressLine1: string | null;
  city: string | null;
  hasLogin: boolean;
  user: { id: string; status: string; lastLoginAt: string | null } | null;
  children: Array<{
    id: string;
    isPrimary: boolean;
    firstName?: string;
    lastName?: string | null;
    admissionNumber?: string;
    student?: { id: string; firstName: string; lastName: string | null; admissionNumber: string };
  }>;
}

const GUARDIAN_QUERIES = [['guardians']];

export default function GuardiansPage() {
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('guardians.update'),
  );
  const canCreate = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('guardians.create'),
  );
  const canDelete = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('guardians.delete'),
  );

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<GuardianRow | null>(null);
  const [deleting, setDeleting] = React.useState<GuardianRow | null>(null);

  const list = useListQuery<GuardianRow>('guardians', '/guardians', {
    initialSortBy: 'firstName',
    initialSortOrder: 'asc',
  });

  const removeGuardian = useAction({
    mutationFn: (row: GuardianRow) => api.delete(`/guardians/${row.id}`),
    successMessage: 'Guardian deleted',
    invalidates: GUARDIAN_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  const createLogin = useAction({
    mutationFn: (row: GuardianRow) => api.post(`/guardians/${row.id}/create-login`, {}),
    successMessage: 'Parent login created — the temporary password has been sent to them',
    invalidates: GUARDIAN_QUERIES,
  });

  const columns: Column<GuardianRow>[] = [
    {
      key: 'fullName',
      header: 'Parent',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold text-[var(--color-ink-secondary)]"
            aria-hidden
          >
            {initials(row.fullName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.fullName}</span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {humanise(row.relation)}
              {row.occupation ? ` · ${row.occupation}` : ''}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'children',
      header: 'Children',
      cell: (row) => {
        // The API nests the student under `student` in some projections and
        // flattens it in others; handle both rather than showing blanks.
        const kids = row.children.map((child) => child.student ?? child);
        if (kids.length === 0) return <span className="text-[var(--color-ink-faint)]">—</span>;

        return (
          <span className="flex flex-wrap gap-1">
            {kids.slice(0, 3).map((child, index) => (
              <Link
                key={child.id ?? index}
                href={`/students/${child.id}`}
                onClick={(event) => event.stopPropagation()}
                className="rounded-[var(--radius-xs)] bg-[var(--color-surface-sunken)] px-1.5 py-0.5 text-2xs hover:text-[var(--color-accent)]"
              >
                {child.firstName} {child.lastName ?? ''}
              </Link>
            ))}
            {kids.length > 3 ? (
              <span className="text-2xs text-[var(--color-ink-muted)]">+{kids.length - 3}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'phone',
      header: 'Phone',
      cell: (row) =>
        row.phone ? (
          <a
            href={`tel:${row.phone}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 tabular hover:text-[var(--color-accent)]"
          >
            <Phone className="size-3" aria-hidden />
            {row.phone}
          </a>
        ) : (
          <span className="text-[var(--color-ink-faint)]">—</span>
        ),
    },
    {
      key: 'email',
      header: 'Email',
      hideOnMobile: true,
      cell: (row) => row.email ?? '—',
    },
    { key: 'city', header: 'City', hideOnMobile: true, cell: (row) => row.city ?? '—' },
    {
      key: 'hasLogin',
      header: 'Portal',
      cell: (row) =>
        row.hasLogin ? (
          <Badge tone="success">
            <KeyRound className="size-2.5" aria-hidden />
            Has login
          </Badge>
        ) : (
          <Badge>No login</Badge>
        ),
    },
  ];

  if (canManage || canDelete) {
    columns.push({
      key: 'actions',
      header: '',
      width: '1%',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {canManage ? (
            <>
              {!row.hasLogin && row.email ? (
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<KeyRound />}
                  loading={createLogin.isPending}
                  onClick={() => createLogin.mutate(row)}
                >
                  Give access
                </Button>
              ) : null}
              <Button
                size="icon-sm"
                variant="ghost"
                icon={<Pencil />}
                aria-label={`Edit ${row.fullName}`}
                onClick={() => setEditing(row)}
              />
            </>
          ) : null}
          {canDelete ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 />}
              aria-label={`Delete ${row.fullName}`}
              onClick={() => setDeleting(row)}
            />
          ) : null}
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Parents"
        description="Every guardian on record, their children and whether they can reach the portal."
        actions={
          canCreate ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Add parent
            </Button>
          ) : null
        }
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by name, phone or email"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Relation"
          value={list.state.filters.relation}
          onChange={(value) => list.setFilter('relation', value)}
          options={GUARDIAN_RELATIONS.map((relation) => ({
            value: relation,
            label: humanise(relation),
          }))}
        />
        <FilterSelect
          label="Portal access"
          value={list.state.filters.hasLogin}
          onChange={(value) => list.setFilter('hasLogin', value)}
          allLabel="Any access"
          options={[
            { value: 'true', label: 'Has login' },
            { value: 'false', label: 'No login' },
          ]}
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
            icon={<Users />}
            title="No parents match these filters"
            description="Guardians are usually created alongside a student, but you can add one here."
            action={
              canCreate && list.activeFilterCount === 0 ? (
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                  Add parent
                </Button>
              ) : null
            }
          />
        }
      />

      {creating ? <GuardianFormDialog onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <GuardianFormDialog guardian={editing} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this guardian?"
        description={
          deleting
            ? `${deleting.fullName} will be removed. This is refused if they are the only contact on record for a student.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={removeGuardian.isPending}
        onConfirm={() => deleting && removeGuardian.mutate(deleting)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------

function GuardianFormDialog({
  guardian,
  onClose,
}: {
  guardian?: GuardianRow;
  onClose: () => void;
}) {
  const isEdit = Boolean(guardian);

  const [firstName, setFirstName] = React.useState(guardian?.firstName ?? '');
  const [lastName, setLastName] = React.useState(guardian?.lastName ?? '');
  const [relation, setRelation] = React.useState(guardian?.relation ?? 'FATHER');
  const [phone, setPhone] = React.useState(guardian?.phone ?? '');
  const [alternatePhone, setAlternatePhone] = React.useState(guardian?.alternatePhone ?? '');
  const [email, setEmail] = React.useState(guardian?.email ?? '');
  const [occupation, setOccupation] = React.useState(guardian?.occupation ?? '');
  const [organization, setOrganization] = React.useState(guardian?.organization ?? '');
  const [qualification, setQualification] = React.useState(guardian?.qualification ?? '');
  const [addressLine1, setAddressLine1] = React.useState(guardian?.addressLine1 ?? '');
  const [city, setCity] = React.useState(guardian?.city ?? '');

  const phoneOk = /^\+?[0-9]{10,15}$/.test(phone.trim());

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={isEdit ? 'Edit parent' : 'Add parent'}
      description={
        isEdit
          ? 'Contact details here are what the school uses to reach this family.'
          : 'Link them to a student from the student record once saved.'
      }
      submitLabel={isEdit ? 'Save changes' : 'Add parent'}
      values={{
        firstName,
        lastName,
        relation,
        phone,
        alternatePhone,
        email,
        occupation,
        organization,
        qualification,
        addressLine1,
        city,
      }}
      isValid={firstName.trim().length > 0 && phoneOk}
      successMessage={isEdit ? 'Guardian updated' : 'Guardian added'}
      invalidates={GUARDIAN_QUERIES}
      submit={(values) => {
        const body = {
          firstName: values.firstName.trim(),
          ...(values.lastName.trim() ? { lastName: values.lastName.trim() } : {}),
          relation: values.relation,
          phone: values.phone.trim(),
          ...(values.alternatePhone.trim()
            ? { alternatePhone: values.alternatePhone.trim() }
            : {}),
          ...(values.email.trim() ? { email: values.email.trim() } : {}),
          ...(values.occupation.trim() ? { occupation: values.occupation.trim() } : {}),
          ...(values.organization.trim() ? { organization: values.organization.trim() } : {}),
          ...(values.qualification.trim() ? { qualification: values.qualification.trim() } : {}),
          ...(values.addressLine1.trim() ? { addressLine1: values.addressLine1.trim() } : {}),
          ...(values.city.trim() ? { city: values.city.trim() } : {}),
        };

        return isEdit ? api.patch(`/guardians/${guardian!.id}`, body) : api.post('/guardians', body);
      }}
    >
      {(errors) => (
        <>
          <FieldRow columns={3}>
            <Field label="First name" required error={errors.firstName}>
              <Input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Last name" error={errors.lastName}>
              <Input value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </Field>
            <Field label="Relation" required error={errors.relation}>
              <Select value={relation} onChange={(event) => setRelation(event.target.value)}>
                {GUARDIAN_RELATIONS.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Phone" required error={errors.phone}>
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+919876543210"
              />
            </Field>
            <Field label="Alternate phone" error={errors.alternatePhone}>
              <Input
                value={alternatePhone}
                onChange={(event) => setAlternatePhone(event.target.value)}
              />
            </Field>
            <Field
              label="Email"
              error={errors.email}
              help="Needed before a portal login can be created"
            >
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Occupation" error={errors.occupation}>
              <Input value={occupation} onChange={(event) => setOccupation(event.target.value)} />
            </Field>
            <Field label="Organization" error={errors.organization}>
              <Input
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
              />
            </Field>
            <Field label="Qualification" error={errors.qualification}>
              <Input
                value={qualification}
                onChange={(event) => setQualification(event.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Address" error={errors.addressLine1}>
              <Input
                value={addressLine1}
                onChange={(event) => setAddressLine1(event.target.value)}
              />
            </Field>
            <Field label="City" error={errors.city}>
              <Input value={city} onChange={(event) => setCity(event.target.value)} />
            </Field>
          </FieldRow>
        </>
      )}
    </FormModal>
  );
}
