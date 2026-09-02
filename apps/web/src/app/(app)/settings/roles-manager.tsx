'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, RotateCcw, Shield, Trash2 } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, Drawer } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface RoleRow {
  id: string;
  type: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isDefault: boolean;
  userCount?: number;
  permissionCount?: number;
}

interface RoleDetail extends RoleRow {
  permissions: Array<{ id: string; key: string; module: string }>;
}

interface PermissionGroup {
  module: string;
  label: string;
  permissions: Array<{ id: string; key: string; action: string; description: string }>;
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
];

export function RolesManager() {
  const canAssign = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('permissions.assign'),
  );
  const canCreate = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('roles.create'),
  );
  const canDelete = useAuthStore(
    (s) => s.user?.isSuperAdmin || !!s.user?.permissions.includes('roles.delete'),
  );

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<RoleRow[]>('/roles'),
  });

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<RoleRow | null>(null);

  const removeRole = useAction({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    successMessage: 'Role deleted',
    invalidates: [['roles']],
    onSuccess: () => setDeleting(null),
  });

  if (roles.isLoading) return <LoadingState label="Loading roles" />;
  if (roles.error) return <ErrorState error={roles.error} onRetry={() => roles.refetch()} />;

  return (
    <>
      <Card>
        <CardHeader
          title="Roles"
          description="Permissions are enforced by the API, not the portal."
          actions={
            canCreate ? (
              <Button size="xs" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                New role
              </Button>
            ) : null
          }
        />
        <CardBody className="p-0">
          {(roles.data ?? []).length === 0 ? (
            <EmptyState icon={<Shield />} title="No roles configured" />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {(roles.data ?? []).map((role) => (
                <li key={role.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Shield className="size-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setEditingId(role.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-medium hover:text-[var(--color-accent)]">
                      {role.name}
                    </p>
                    <p className="text-2xs text-[var(--color-ink-muted)]">
                      {humanise(role.type)}
                      {role.permissionCount !== undefined
                        ? ` · ${role.permissionCount} permissions`
                        : ''}
                      {role.userCount !== undefined ? ` · ${role.userCount} users` : ''}
                    </p>
                  </button>
                  {role.isSystem ? <Badge>System</Badge> : <Badge tone="accent">Custom</Badge>}
                  <Button size="xs" variant="ghost" onClick={() => setEditingId(role.id)}>
                    {canAssign ? 'Edit' : 'View'}
                  </Button>
                  {canDelete && !role.isSystem ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      icon={<Trash2 />}
                      aria-label={`Delete ${role.name}`}
                      onClick={() => setDeleting(role)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {editingId ? (
        <RolePermissionsDrawer
          roleId={editingId}
          canAssign={Boolean(canAssign)}
          onClose={() => setEditingId(null)}
        />
      ) : null}
      {creating ? <CreateRoleDialog onClose={() => setCreating(false)} /> : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this role?"
        description={
          deleting
            ? `"${deleting.name}" will be removed. This is refused while users still hold it.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={removeRole.isPending}
        onConfirm={() => deleting && removeRole.mutate(deleting.id)}
      />
    </>
  );
}

function RolePermissionsDrawer({
  roleId,
  canAssign,
  onClose,
}: {
  roleId: string;
  canAssign: boolean;
  onClose: () => void;
}) {
  const role = useQuery({
    queryKey: ['role', roleId],
    queryFn: () => api.get<RoleDetail>(`/roles/${roleId}`),
  });
  const catalogue = useQuery({
    queryKey: ['permissions'],
    queryFn: () => api.get<PermissionGroup[]>('/permissions'),
    staleTime: 10 * 60_000,
  });

  const [selected, setSelected] = React.useState<Set<string> | null>(null);
  const [seededFrom, setSeededFrom] = React.useState<RoleDetail | null>(null);

  if (role.data && role.data !== seededFrom) {
    setSeededFrom(role.data);
    setSelected(new Set(role.data.permissions.map((p) => p.key)));
  }

  const save = useAction({
    mutationFn: () =>
      api.patch(`/roles/${roleId}/permissions`, { permissions: [...(selected ?? [])] }),
    successMessage: 'Role permissions updated',
    invalidates: [['roles'], ['role', roleId]],
    onSuccess: onClose,
  });

  const reset = useAction({
    mutationFn: () => api.post(`/roles/${roleId}/reset`, {}),
    successMessage: 'Role reset to its default permissions',
    invalidates: [['roles'], ['role', roleId]],
    onSuccess: () => {
      setSeededFrom(null);
      void role.refetch();
    },
  });

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(group: PermissionGroup, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const p of group.permissions) {
        if (on) next.add(p.key);
        else next.delete(p.key);
      }
      return next;
    });
  }

  const dirty =
    seededFrom != null &&
    selected != null &&
    (selected.size !== seededFrom.permissions.length ||
      seededFrom.permissions.some((p) => !selected.has(p.key)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Drawer
        width="lg"
        title={role.data ? role.data.name : 'Role'}
        description={
          role.data
            ? `${humanise(role.data.type)}${role.data.isSystem ? ' · system role' : ''} · ${selected?.size ?? 0} permissions`
            : undefined
        }
        footer={
          canAssign && role.data ? (
            <>
              {role.data.isDefault ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCcw />}
                  loading={reset.isPending}
                  onClick={() => reset.mutate()}
                >
                  Reset to defaults
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="primary"
                loading={save.isPending}
                disabled={!dirty}
                onClick={() => save.mutate()}
              >
                Save permissions
              </Button>
            </>
          ) : null
        }
      >
        {role.isLoading || catalogue.isLoading ? (
          <LoadingState label="Loading permissions" />
        ) : role.error ? (
          <ErrorState error={role.error} onRetry={() => role.refetch()} />
        ) : (
          <div className="space-y-4">
            {(catalogue.data ?? []).map((group) => {
              const inGroup = group.permissions.filter((p) => selected?.has(p.key)).length;
              const allOn = inGroup === group.permissions.length;
              return (
                <div key={group.module}>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs font-semibold">{group.label}</p>
                    {canAssign ? (
                      <button
                        type="button"
                        onClick={() => toggleGroup(group, !allOn)}
                        className="text-2xs text-[var(--color-accent)] hover:underline"
                      >
                        {allOn ? 'Clear all' : 'Select all'}
                      </button>
                    ) : (
                      <span className="text-2xs text-[var(--color-ink-muted)]">
                        {inGroup}/{group.permissions.length}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                    {group.permissions.map((permission) => (
                      <label
                        key={permission.id}
                        className="flex items-center gap-2 rounded-[var(--radius-xs)] px-1.5 py-1 text-xs hover:bg-[var(--color-surface-sunken)]"
                      >
                        <input
                          type="checkbox"
                          checked={selected?.has(permission.key) ?? false}
                          disabled={!canAssign}
                          onChange={() => toggle(permission.key)}
                          className="size-3.5 accent-[var(--color-accent)]"
                        />
                        <span className="min-w-0">
                          <span className="block truncate">{humanise(permission.action)}</span>
                          <span className="block truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
                            {permission.key}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Drawer>
    </Dialog>
  );
}

function CreateRoleDialog({ onClose }: { onClose: () => void }) {
  const [type, setType] = React.useState('STAFF');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Create a custom role"
      description="Start from a base role type, then set its permissions."
      submitLabel="Create role"
      values={{ type, name, description }}
      isValid={name.trim().length > 0}
      successMessage="Role created"
      invalidates={[['roles']]}
      submit={(v) =>
        api.post('/roles', {
          type: v.type,
          name: v.name.trim(),
          description: v.description.trim() || undefined,
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Base type" required error={errors.type}>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {ROLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanise(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" required error={errors.name}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Senior Accountant"
              autoFocus
            />
          </Field>
          <Field label="Description" error={errors.description}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
