'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, Pencil, Plus, Trash2, UserCog, UserMinus, Users } from 'lucide-react';
import { GENDERS, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { useDepartments, useDesignations, useRoles } from '@/hooks/use-lookups';
import { initials } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';

interface StaffRow {
  id: string;
  employeeId: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  email: string | null;
  phone: string;
  joiningDate: string;
  employmentStatus: string;
  employmentType: string;
  isTeacher: boolean;
  qualification: string | null;
  specialization: string | null;
  experienceYears: number | null;
  department: { id: string; name: string; code: string } | null;
  designation: { id: string; name: string } | null;
}

interface StaffStats {
  totalActive: number;
  teachers: number;
  nonTeaching: number;
  newThisYear: number;
  byStatus: Record<string, number>;
  byDepartment: Array<{ departmentId: string; name: string; count: number }>;
}

/** Mirrors the EmploymentStatus enum; anything else the API would reject. */
const EMPLOYMENT_STATUSES = [
  'ACTIVE',
  'PROBATION',
  'NOTICE_PERIOD',
  'ON_LEAVE',
  'RESIGNED',
  'TERMINATED',
  'RETIRED',
];

const EMPLOYMENT_TYPES = ['TEACHING', 'NON_TEACHING', 'SUPPORT', 'ADMIN'];

const STAFF_QUERIES = [['staff'], ['lookup', 'teachers'], ['lookup', 'staff']];

export default function StaffPage() {
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('staff.update'),
  );
  const canCreate = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('staff.create'),
  );
  const canDelete = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('staff.delete'),
  );

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<StaffRow | null>(null);
  const [changingStatus, setChangingStatus] = React.useState<StaffRow | null>(null);
  const [deleting, setDeleting] = React.useState<StaffRow | null>(null);

  const list = useListQuery<StaffRow>('staff', '/staff', {
    initialSortBy: 'employeeId',
    initialSortOrder: 'asc',
    initialFilters: { employmentStatus: 'ACTIVE' },
  });

  const { data: departments } = useDepartments();

  const { data: stats } = useQuery({
    queryKey: ['staff', 'statistics'],
    queryFn: () => api.get<StaffStats>('/staff/statistics'),
    staleTime: 5 * 60_000,
  });

  const removeStaff = useAction({
    mutationFn: (row: StaffRow) => api.delete(`/staff/${row.id}`),
    successMessage: 'Staff member removed',
    invalidates: STAFF_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  const columns: Column<StaffRow>[] = [
    {
      key: 'name',
      header: 'Staff member',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold text-[var(--color-ink-secondary)]"
            aria-hidden
          >
            {row.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.photoUrl} alt="" className="size-7 object-cover" />
            ) : (
              initials(`${row.firstName} ${row.lastName ?? ''}`)
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {[row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ')}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.employeeId}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'designation',
      header: 'Designation',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate">{row.designation?.name ?? '—'}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.department?.name ?? ''}
          </span>
        </span>
      ),
    },
    {
      key: 'isTeacher',
      header: 'Role',
      cell: (row) =>
        row.isTeacher ? (
          <Badge tone="info">
            <GraduationCap className="size-2.5" aria-hidden />
            Teaching
          </Badge>
        ) : (
          <Badge>{humanise(row.employmentType)}</Badge>
        ),
    },
    { key: 'phone', header: 'Phone', hideOnMobile: true, cell: (row) => row.phone },
    {
      key: 'qualification',
      header: 'Qualification',
      hideOnMobile: true,
      cell: (row) => row.qualification ?? '—',
    },
    {
      key: 'joiningDate',
      header: 'Joined',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => formatDate(row.joiningDate),
    },
    {
      key: 'employmentStatus',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.employmentStatus} />,
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
              <Button
                size="icon-sm"
                variant="ghost"
                icon={<Pencil />}
                aria-label={`Edit ${row.firstName}`}
                onClick={() => setEditing(row)}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                icon={<UserMinus />}
                aria-label={`Change employment status for ${row.firstName}`}
                onClick={() => setChangingStatus(row)}
              />
            </>
          ) : null}
          {canDelete ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 />}
              aria-label={`Remove ${row.firstName}`}
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
        title="Staff"
        description="Teaching and non-teaching staff, their departments and employment status."
        actions={
          canCreate ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Add staff
            </Button>
          ) : null
        }
      />

      {stats ? (
        <StatGrid columns={4} className="mb-4">
          <StatCard label="Active staff" value={stats.totalActive} icon={<UserCog />} />
          <StatCard label="Teaching" value={stats.teachers} icon={<GraduationCap />} />
          <StatCard label="Non-teaching" value={stats.nonTeaching} icon={<Users />} />
          <StatCard label="Joined this year" value={stats.newThisYear} />
        </StatGrid>
      ) : null}

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by name, employee ID or phone"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Department"
          value={list.state.filters.departmentId}
          onChange={(value) => list.setFilter('departmentId', value)}
          options={(departments ?? []).map((department) => ({
            value: department.id,
            label: department.name,
          }))}
        />
        <FilterSelect
          label="Type"
          value={list.state.filters.isTeacher}
          onChange={(value) => list.setFilter('isTeacher', value)}
          allLabel="All staff"
          options={[
            { value: 'true', label: 'Teaching only' },
            { value: 'false', label: 'Non-teaching only' },
          ]}
        />
        <FilterSelect
          label="Status"
          value={list.state.filters.employmentStatus}
          onChange={(value) => list.setFilter('employmentStatus', value)}
          options={EMPLOYMENT_STATUSES.map((status) => ({
            value: status,
            label: humanise(status),
          }))}
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
            icon={<UserCog />}
            title={list.activeFilterCount > 0 ? 'No staff match these filters' : 'No staff yet'}
            description="Try clearing a filter or widening the search."
            action={
              canCreate && list.activeFilterCount === 0 ? (
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                  Add staff
                </Button>
              ) : null
            }
          />
        }
      />

      {creating ? <StaffFormDialog onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <StaffFormDialog staff={editing} onClose={() => setEditing(null)} />
      ) : null}
      {changingStatus ? (
        <EmploymentStatusDialog staff={changingStatus} onClose={() => setChangingStatus(null)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this staff member?"
        description={
          deleting
            ? `${[deleting.firstName, deleting.lastName].filter(Boolean).join(' ')} (${deleting.employeeId}) will no longer appear in staff lists, and their login will be disabled. Attendance and payroll history is kept.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeStaff.isPending}
        onConfirm={() => deleting && removeStaff.mutate(deleting)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------

/**
 * One form for both adding and editing.
 *
 * The two differ in more than their endpoint: a new staff member needs roles
 * and an optional password for the login being created alongside them, while
 * an edit must not touch either — changing somebody's roles is the users
 * screen's job, not a side effect of correcting their phone number.
 */
function StaffFormDialog({ staff, onClose }: { staff?: StaffRow; onClose: () => void }) {
  const isEdit = Boolean(staff);

  const [firstName, setFirstName] = React.useState(staff?.firstName ?? '');
  const [middleName, setMiddleName] = React.useState(staff?.middleName ?? '');
  const [lastName, setLastName] = React.useState(staff?.lastName ?? '');
  const [email, setEmail] = React.useState(staff?.email ?? '');
  const [phone, setPhone] = React.useState(staff?.phone ?? '');
  const [gender, setGender] = React.useState('');
  const [joiningDate, setJoiningDate] = React.useState(
    staff?.joiningDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [employmentType, setEmploymentType] = React.useState(staff?.employmentType ?? 'TEACHING');
  const [isTeacher, setIsTeacher] = React.useState(staff?.isTeacher ?? true);
  const [departmentId, setDepartmentId] = React.useState(staff?.department?.id ?? '');
  const [designationId, setDesignationId] = React.useState(staff?.designation?.id ?? '');
  const [qualification, setQualification] = React.useState(staff?.qualification ?? '');
  const [specialization, setSpecialization] = React.useState(staff?.specialization ?? '');
  const [experienceYears, setExperienceYears] = React.useState(
    staff?.experienceYears != null ? String(staff.experienceYears) : '',
  );
  const [roleIds, setRoleIds] = React.useState<string[]>([]);
  const [password, setPassword] = React.useState('');

  const { data: departments } = useDepartments();
  const { data: designations } = useDesignations();
  // Roles are only part of the create form, so only that form pays for them.
  const { data: roles } = useRoles(!isEdit);

  const phoneOk = /^\+?[0-9]{10,15}$/.test(phone.trim());

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={isEdit ? 'Edit staff member' : 'Add staff member'}
      description={
        isEdit
          ? 'Changes to name, email or phone also update their login.'
          : 'This creates a staff record and a portal login. A temporary password is generated unless you set one.'
      }
      submitLabel={isEdit ? 'Save changes' : 'Add staff member'}
      values={{
        firstName,
        middleName,
        lastName,
        email,
        phone,
        gender,
        joiningDate,
        employmentType,
        isTeacher,
        departmentId,
        designationId,
        qualification,
        specialization,
        experienceYears,
        roleIds,
        password,
      }}
      isValid={
        firstName.trim().length > 0 &&
        phoneOk &&
        Boolean(joiningDate) &&
        (isEdit || roleIds.length > 0)
      }
      successMessage={isEdit ? 'Staff member updated' : 'Staff member added'}
      invalidates={STAFF_QUERIES}
      submit={(values) => {
        const common = {
          firstName: values.firstName.trim(),
          ...(values.middleName.trim() ? { middleName: values.middleName.trim() } : {}),
          ...(values.lastName.trim() ? { lastName: values.lastName.trim() } : {}),
          ...(values.email.trim() ? { email: values.email.trim() } : {}),
          phone: values.phone.trim(),
          ...(values.gender ? { gender: values.gender } : {}),
          joiningDate: values.joiningDate,
          employmentType: values.employmentType,
          isTeacher: values.isTeacher,
          ...(values.departmentId ? { departmentId: values.departmentId } : {}),
          ...(values.designationId ? { designationId: values.designationId } : {}),
          ...(values.qualification.trim() ? { qualification: values.qualification.trim() } : {}),
          ...(values.specialization.trim() ? { specialization: values.specialization.trim() } : {}),
          ...(values.experienceYears ? { experienceYears: Number(values.experienceYears) } : {}),
        };

        return isEdit
          ? api.patch(`/staff/${staff!.id}`, common)
          : api.post('/staff', {
              ...common,
              roleIds: values.roleIds,
              ...(values.password ? { password: values.password } : {}),
            });
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
            <Field label="Middle name" error={errors.middleName}>
              <Input value={middleName} onChange={(event) => setMiddleName(event.target.value)} />
            </Field>
            <Field label="Last name" error={errors.lastName}>
              <Input value={lastName} onChange={(event) => setLastName(event.target.value)} />
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
            <Field label="Email" error={errors.email} help={isEdit ? undefined : 'Used to sign in'}>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Gender" error={errors.gender}>
              <Select value={gender} onChange={(event) => setGender(event.target.value)}>
                <option value="">Not stated</option>
                {GENDERS.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Joining date" required error={errors.joiningDate}>
              <Input
                type="date"
                value={joiningDate}
                onChange={(event) => setJoiningDate(event.target.value)}
              />
            </Field>
            <Field label="Employment type" error={errors.employmentType}>
              <Select
                value={employmentType}
                onChange={(event) => {
                  setEmploymentType(event.target.value);
                  // Keeping these in step avoids the common mix-up of a
                  // "support" staff member flagged as a teacher.
                  setIsTeacher(event.target.value === 'TEACHING');
                }}
              >
                {EMPLOYMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Teaching staff" error={errors.isTeacher}>
              <Select
                value={isTeacher ? 'true' : 'false'}
                onChange={(event) => setIsTeacher(event.target.value === 'true')}
              >
                <option value="true">Yes — can be assigned classes</option>
                <option value="false">No</option>
              </Select>
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Department" error={errors.departmentId}>
              <Select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {(departments ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Designation" error={errors.designationId}>
              <Select
                value={designationId}
                onChange={(event) => setDesignationId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {(designations ?? []).map((designation) => (
                  <option key={designation.id} value={designation.id}>
                    {designation.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Years of experience" error={errors.experienceYears}>
              <Input
                type="number"
                min={0}
                max={60}
                value={experienceYears}
                onChange={(event) => setExperienceYears(event.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Qualification" error={errors.qualification}>
              <Input
                value={qualification}
                onChange={(event) => setQualification(event.target.value)}
                placeholder="M.Sc., B.Ed."
              />
            </Field>
            <Field label="Specialization" error={errors.specialization}>
              <Input
                value={specialization}
                onChange={(event) => setSpecialization(event.target.value)}
                placeholder="Mathematics"
              />
            </Field>
          </FieldRow>

          {!isEdit ? (
            <FieldRow>
              <Field
                label="Roles"
                required
                error={errors.roleIds}
                help="What this person may do in the portal"
              >
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-[var(--color-border)] p-2">
                  {(roles ?? []).map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={roleIds.includes(role.id)}
                        onChange={(event) =>
                          setRoleIds((current) =>
                            event.target.checked
                              ? [...current, role.id]
                              : current.filter((id) => id !== role.id),
                          )
                        }
                      />
                      {role.name}
                    </label>
                  ))}
                </div>
              </Field>
              <Field
                label="Temporary password"
                error={errors.password}
                help="Leave blank to generate one. They must change it at first sign-in."
              >
                <Input
                  type="text"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            </FieldRow>
          ) : null}
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Employment status
// ---------------------------------------------------------------------------

function EmploymentStatusDialog({ staff, onClose }: { staff: StaffRow; onClose: () => void }) {
  const [employmentStatus, setEmploymentStatus] = React.useState(staff.employmentStatus);
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [reason, setReason] = React.useState('');

  // Leaving the school is the case that needs a last working day on record.
  const isExit = ['RESIGNED', 'TERMINATED', 'RETIRED'].includes(employmentStatus);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Change employment status"
      description={`${[staff.firstName, staff.lastName].filter(Boolean).join(' ')} — ${staff.employeeId}`}
      submitLabel="Update status"
      values={{ employmentStatus, relievingDate: effectiveDate, reason }}
      isValid={employmentStatus !== staff.employmentStatus && (!isExit || Boolean(effectiveDate))}
      successMessage="Employment status updated"
      invalidates={STAFF_QUERIES}
      submit={(values) =>
        api.patch(`/staff/${staff.id}/employment-status`, {
          status: values.employmentStatus,
          ...(values.relievingDate ? { effectiveDate: values.relievingDate } : {}),
          ...(values.reason.trim() ? { reason: values.reason.trim() } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="New status" required error={errors.employmentStatus}>
            <Select
              value={employmentStatus}
              onChange={(event) => setEmploymentStatus(event.target.value)}
              autoFocus
            >
              {EMPLOYMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humanise(status)}
                </option>
              ))}
            </Select>
          </Field>

          {isExit ? (
            <Field label="Last working day" required error={errors.relievingDate}>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </Field>
          ) : null}

          <Field label="Reason" error={errors.reason} help="Kept on the staff record">
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}
