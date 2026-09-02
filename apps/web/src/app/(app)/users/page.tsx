'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, LockOpen, Plus, ShieldCheck, Trash2, UserCog, Users } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { useRoles } from '@/hooks/use-lookups';
import { formatRelativeDay } from '@/lib/dates';
import { initials } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog, Dialog, Modal } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';

interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  locale: string;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  roles: Array<{ id: string; name: string; type: string }>;
  staff: { id: string; employeeId: string } | null;
  student: { id: string; admissionNumber: string } | null;
  guardian: { id: string } | null;
}

interface UserStats {
  total: number;
  activeToday: number;
  byStatus: Record<string, number>;
  byRole: Array<{ role: string; name: string; count: number }>;
}

const ROLE_TYPES = [
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'VICE_PRINCIPAL',
  'TEACHER',
  'ACCOUNTANT',
  'LIBRARIAN',
  'TRANSPORT_MANAGER',
  'RECEPTIONIST',
  'HR_MANAGER',
  'STAFF',
  'STUDENT',
  'PARENT',
];

const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION', 'LOCKED'];

const USER_QUERIES = [['users'], ['user-stats']];

export default function UsersPage() {
  const canCreate = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('users.create'),
  );
  const canUpdate = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('users.update'),
  );
  const canDelete = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('users.delete'),
  );
  const canResetPassword = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('users.reset_password'),
  );
  const canAssignRoles = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('permissions.assign'),
  );

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const [editingRoles, setEditingRoles] = React.useState<UserRow | null>(null);
  const [resetting, setResetting] = React.useState<UserRow | null>(null);
  const [deleting, setDeleting] = React.useState<UserRow | null>(null);

  const stats = useQuery({
    queryKey: ['user-stats'],
    queryFn: () => api.get<UserStats>('/users/statistics'),
    staleTime: 60_000,
  });

  const list = useListQuery<UserRow>('users', '/users', {
    initialSortBy: 'createdAt',
    initialSortOrder: 'desc',
  });

  const setStatus = useAction({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/users/${id}/status`, { status }),
    successMessage: 'Account status updated',
    invalidates: USER_QUERIES,
  });

  const unlock = useAction({
    mutationFn: (id: string) => api.post(`/users/${id}/unlock`, {}),
    successMessage: 'Account unlocked',
    invalidates: USER_QUERIES,
  });

  const removeUser = useAction({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    successMessage: 'User deleted',
    invalidates: USER_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      header: 'User',
      sortable: false,
      cell: (row) => {
        const name = row.displayName || [row.firstName, row.lastName].filter(Boolean).join(' ');
        return (
          <span className="flex items-center gap-2">
            <span
              className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold"
              aria-hidden
            >
              {row.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.avatarUrl} alt="" className="size-7 object-cover" />
              ) : (
                initials(name)
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{name}</span>
              <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                {row.email ?? row.phone ?? '—'}
              </span>
            </span>
          </span>
        );
      },
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.roles.length === 0 ? (
            <span className="text-[var(--color-ink-faint)]">—</span>
          ) : (
            row.roles.map((role) => (
              <Badge key={role.id} tone="accent">
                {role.name}
              </Badge>
            ))
          )}
        </span>
      ),
    },
    {
      key: 'linked',
      header: 'Linked to',
      hideOnMobile: true,
      cell: (row) =>
        row.staff
          ? `Staff ${row.staff.employeeId}`
          : row.student
            ? `Student ${row.student.admissionNumber}`
            : row.guardian
              ? 'Guardian'
              : '—',
    },
    {
      key: 'lastLoginAt',
      header: 'Last seen',
      hideOnMobile: true,
      cell: (row) => (row.lastLoginAt ? formatRelativeDay(row.lastLoginAt) : 'Never'),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <span className="flex items-center gap-1">
          <StatusBadge status={row.status} />
          {row.mustChangePassword ? <Badge tone="warning">Temp password</Badge> : null}
        </span>
      ),
    },
  ];

  if (canUpdate || canDelete || canResetPassword || canAssignRoles) {
    columns.push({
      key: 'actions',
      header: '',
      width: '1%',
      cell: (row) => (
        <div
          className="flex items-center justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {canUpdate && row.status === 'LOCKED' ? (
            <Button
              size="xs"
              variant="ghost"
              icon={<LockOpen />}
              loading={unlock.isPending}
              onClick={() => unlock.mutate(row.id)}
            >
              Unlock
            </Button>
          ) : null}
          {canAssignRoles ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<ShieldCheck />}
              aria-label={`Edit roles for ${row.firstName}`}
              onClick={() => setEditingRoles(row)}
            />
          ) : null}
          {canResetPassword ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<KeyRound />}
              aria-label={`Reset password for ${row.firstName}`}
              onClick={() => setResetting(row)}
            />
          ) : null}
          {canUpdate ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<UserCog />}
              aria-label={`Edit ${row.firstName}`}
              onClick={() => setEditing(row)}
            />
          ) : null}
          {canUpdate ? (
            <Select
              aria-label={`Set status for ${row.firstName}`}
              value=""
              onChange={(e) =>
                e.target.value && setStatus.mutate({ id: row.id, status: e.target.value })
              }
              className="w-auto"
            >
              <option value="">Status…</option>
              {row.status !== 'ACTIVE' ? <option value="ACTIVE">Activate</option> : null}
              {row.status !== 'INACTIVE' ? <option value="INACTIVE">Deactivate</option> : null}
              {row.status !== 'SUSPENDED' ? <option value="SUSPENDED">Suspend</option> : null}
            </Select>
          ) : null}
          {canDelete ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 />}
              aria-label={`Delete ${row.firstName}`}
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
        title="Users & access"
        description="Login accounts, their roles and account status."
        actions={
          canCreate ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Add user
            </Button>
          ) : null
        }
      />

      {stats.data ? (
        <StatGrid columns={4} className="mb-4">
          <StatCard label="Accounts" value={stats.data.total} icon={<Users />} />
          <StatCard
            label="Active"
            value={stats.data.byStatus.ACTIVE ?? 0}
            hint={`${stats.data.activeToday} signed in today`}
          />
          <StatCard label="Suspended" value={stats.data.byStatus.SUSPENDED ?? 0} />
          <StatCard label="Locked" value={stats.data.byStatus.LOCKED ?? 0} icon={<LockOpen />} />
        </StatGrid>
      ) : null}

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by name, email or phone"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={USER_STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
        />
        <FilterSelect
          label="Role"
          value={list.state.filters.role}
          onChange={(value) => list.setFilter('role', value)}
          options={ROLE_TYPES.map((role) => ({ value: role, label: humanise(role) }))}
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
        empty={
          <EmptyState
            icon={<Users />}
            title="No user accounts match these filters"
            description="Staff, teacher, parent and student logins all appear here."
            action={
              canCreate && list.activeFilterCount === 0 ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Plus />}
                  onClick={() => setCreating(true)}
                >
                  Add user
                </Button>
              ) : null
            }
          />
        }
      />

      {creating ? <UserFormDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <UserFormDialog user={editing} onClose={() => setEditing(null)} /> : null}
      {editingRoles ? (
        <RolesDialog user={editingRoles} onClose={() => setEditingRoles(null)} />
      ) : null}
      {resetting ? (
        <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this user account?"
        description={
          deleting
            ? `${deleting.firstName} ${deleting.lastName ?? ''} loses access immediately. Their staff, student or guardian record is not deleted.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={removeUser.isPending}
        onConfirm={() => deleting && removeUser.mutate(deleting.id)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function UserFormDialog({ user, onClose }: { user?: UserRow; onClose: () => void }) {
  const isEdit = Boolean(user);
  const roles = useRoles();

  const [firstName, setFirstName] = React.useState(user?.firstName ?? '');
  const [lastName, setLastName] = React.useState(user?.lastName ?? '');
  const [email, setEmail] = React.useState(user?.email ?? '');
  const [phone, setPhone] = React.useState(user?.phone ?? '');
  const [locale, setLocale] = React.useState(user?.locale ?? 'en');
  const [roleIds, setRoleIds] = React.useState<string[]>(user?.roles.map((r) => r.id) ?? []);
  const [setOwnPassword, setSetOwnPassword] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [sendWelcomeEmail, setSendWelcomeEmail] = React.useState(true);

  const contactOk = email.trim().length > 0 || phone.trim().length > 0;
  const rolesOk = isEdit || roleIds.length > 0;
  const passwordOk = !setOwnPassword || password.length >= 8;

  function toggleRole(id: string) {
    setRoleIds((current) =>
      current.includes(id) ? current.filter((r) => r !== id) : [...current, id],
    );
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={isEdit ? 'Edit user' : 'Add a user account'}
      description={
        isEdit
          ? 'Roles are managed separately from the Roles button.'
          : 'A temporary password is generated and emailed unless you set one here.'
      }
      submitLabel={isEdit ? 'Save changes' : 'Create account'}
      values={{
        firstName,
        lastName,
        email,
        phone,
        locale,
        roleIds,
        setOwnPassword,
        password,
        sendWelcomeEmail,
      }}
      isValid={firstName.trim().length > 0 && contactOk && rolesOk && passwordOk}
      successMessage={isEdit ? 'User updated' : 'User account created'}
      invalidates={USER_QUERIES}
      submit={(values) => {
        if (isEdit) {
          return api.patch(`/users/${user!.id}`, {
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim() || undefined,
            email: values.email.trim() || undefined,
            phone: values.phone.trim() || undefined,
            locale: values.locale,
          });
        }
        return api.post('/users', {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim() || undefined,
          email: values.email.trim() || undefined,
          phone: values.phone.trim() || undefined,
          locale: values.locale,
          roleIds: values.roleIds,
          ...(values.setOwnPassword && values.password ? { password: values.password } : {}),
          sendWelcomeEmail: values.sendWelcomeEmail,
        });
      }}
    >
      {(errors) => (
        <>
          <FieldRow columns={2}>
            <Field label="First name" required error={errors.firstName}>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
            </Field>
            <Field label="Last name" error={errors.lastName}>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
          </FieldRow>

          <FieldRow columns={2}>
            <Field
              label="Email"
              error={errors.email}
              help={!contactOk ? 'An email or a phone number is required' : undefined}
            >
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Phone" error={errors.phone}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
            </Field>
          </FieldRow>

          <Field label="Language">
            <Select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="kn">Kannada</option>
            </Select>
          </Field>

          {!isEdit ? (
            <>
              <Field label="Roles" required error={errors.roleIds}>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {(roles.data ?? [])
                    .filter((role) => role.type !== 'SUPER_ADMIN')
                    .map((role) => (
                      <label
                        key={role.id}
                        className="flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5 text-xs hover:bg-[var(--color-surface-sunken)]"
                      >
                        <input
                          type="checkbox"
                          checked={roleIds.includes(role.id)}
                          onChange={() => toggleRole(role.id)}
                          className="size-3.5 accent-[var(--color-accent)]"
                        />
                        <span className="truncate">{role.name}</span>
                      </label>
                    ))}
                </div>
              </Field>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={setOwnPassword}
                  onChange={(e) => setSetOwnPassword(e.target.checked)}
                  className="size-3.5 accent-[var(--color-accent)]"
                />
                Set the password myself
              </label>
              {setOwnPassword ? (
                <Field
                  label="Temporary password"
                  required
                  error={errors.password}
                  help="At least 8 characters. The user must change it at first sign-in."
                >
                  <Input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              ) : null}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sendWelcomeEmail}
                  onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                  className="size-3.5 accent-[var(--color-accent)]"
                />
                Email a welcome message with sign-in details
              </label>
            </>
          ) : null}
        </>
      )}
    </FormModal>
  );
}

function RolesDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const roles = useRoles();
  const [roleIds, setRoleIds] = React.useState<string[]>(user.roles.map((r) => r.id));

  function toggle(id: string) {
    setRoleIds((current) =>
      current.includes(id) ? current.filter((r) => r !== id) : [...current, id],
    );
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Roles for ${user.firstName} ${user.lastName ?? ''}`}
      description="Roles are enforced by the API. A user with no roles can only see their own profile."
      submitLabel="Save roles"
      values={{ roleIds }}
      isValid={roleIds.length > 0}
      successMessage="User roles updated"
      invalidates={USER_QUERIES}
      submit={(values) => api.patch(`/users/${user.id}/roles`, { roleIds: values.roleIds })}
    >
      {() => (
        <div className="space-y-1">
          {(roles.data ?? [])
            .filter((role) => role.type !== 'SUPER_ADMIN')
            .map((role) => (
              <label
                key={role.id}
                className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm hover:bg-[var(--color-surface-sunken)]"
              >
                <input
                  type="checkbox"
                  checked={roleIds.includes(role.id)}
                  onChange={() => toggle(role.id)}
                  className="size-3.5 accent-[var(--color-accent)]"
                />
                <span>
                  {role.name}
                  {role.isSystem ? (
                    <span className="ml-1.5 text-2xs text-[var(--color-ink-muted)]">system</span>
                  ) : null}
                </span>
              </label>
            ))}
        </div>
      )}
    </FormModal>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [notify, setNotify] = React.useState(Boolean(user.email));
  const [result, setResult] = React.useState<{
    temporaryPassword?: string;
    emailed: boolean;
  } | null>(null);

  const reset = useAction<void, { reset: boolean; emailed: boolean; temporaryPassword?: string }>({
    mutationFn: () => api.post(`/users/${user.id}/reset-password`, { notify }),
    successMessage: 'Password reset and all sessions ended',
    invalidates: USER_QUERIES,
    onSuccess: (data) =>
      setResult({ temporaryPassword: data.temporaryPassword, emailed: data.emailed }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Modal
        size="sm"
        title="Reset password"
        description={`A new temporary password is issued for ${user.firstName} and every active session is ended.`}
        footer={
          result ? (
            <Button size="sm" variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onClose} disabled={reset.isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={reset.isPending}
                onClick={() => reset.mutate()}
              >
                Reset password
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div className="space-y-2 text-sm">
            {result.emailed ? (
              <p className="text-[var(--color-success)]">
                The temporary password has been emailed to {user.email}.
              </p>
            ) : (
              <>
                <p>Hand this temporary password to the user in person:</p>
                <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-2 font-mono text-base">
                  {result.temporaryPassword}
                </p>
                <p className="text-2xs text-[var(--color-ink-muted)]">
                  It is shown once and cannot be retrieved later.
                </p>
              </>
            )}
          </div>
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notify}
              disabled={!user.email}
              onChange={(e) => setNotify(e.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            {user.email
              ? 'Email the temporary password to the user'
              : 'No email on file — the password will be shown here'}
          </label>
        )}
      </Modal>
    </Dialog>
  );
}
