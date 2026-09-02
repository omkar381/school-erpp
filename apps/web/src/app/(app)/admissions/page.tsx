'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Plus, TrendingUp, UserPlus, Users } from 'lucide-react';
import { GENDERS, GUARDIAN_RELATIONS, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useAcademicYears, useClasses, useSections } from '@/hooks/use-lookups';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, Drawer } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

const ENQUIRY_SOURCES = [
  'WALK_IN',
  'WEBSITE',
  'PHONE',
  'REFERRAL',
  'SOCIAL_MEDIA',
  'ADVERTISEMENT',
] as const;

const STATUSES = ['NEW', 'CONTACTED', 'FOLLOW_UP', 'APPLIED', 'ADMITTED', 'REJECTED', 'LOST'];

const STATUS_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  NEW: 'info',
  CONTACTED: 'info',
  FOLLOW_UP: 'warning',
  APPLIED: 'info',
  ADMITTED: 'success',
  REJECTED: 'danger',
  LOST: 'neutral',
};

interface EnquiryRow {
  id: string;
  enquiryNumber: string;
  studentName: string;
  seekingClass: string;
  parentName: string;
  phone: string;
  email: string | null;
  source: string;
  status: string;
  followUpDate: string | null;
  isFollowUpOverdue: boolean;
  isConverted: boolean;
  createdAt: string;
  ageInDays: number;
}

interface EnquiryDetail extends EnquiryRow {
  studentFirstName: string;
  studentLastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  previousSchool: string | null;
  relation: string;
  addressLine1: string | null;
  city: string | null;
  notes: string | null;
  rejectionReason: string | null;
  allowedTransitions: string[];
  convertedStudent: { id: string; admissionNumber: string } | null;
  assignee: { id: string; firstName: string; lastName: string | null } | null;
}

interface AdmissionStats {
  total: number;
  open: number;
  admitted: number;
  thisMonth: number;
  overdueFollowUps: number;
  conversionRate: number;
  bySource: Array<{ source: string; count: number }>;
}

export default function AdmissionsPage() {
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('admissions.manage'),
  );

  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['admissions', 'statistics'],
    queryFn: () => api.get<AdmissionStats>('/admissions/statistics'),
    staleTime: 60_000,
  });

  const initialSearch = useSearchParams().get('q') ?? undefined;
  const list = useListQuery<EnquiryRow>('admissions-enquiries', '/admissions/enquiries', {
    initialSortBy: 'createdAt',
    initialSortOrder: 'desc',
    initialSearch,
  });

  const columns: Column<EnquiryRow>[] = [
    {
      key: 'enquiryNumber',
      header: 'Enquiry',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.studentName}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.enquiryNumber}
          </span>
        </span>
      ),
    },
    { key: 'seekingClass', header: 'Seeking', cell: (row) => row.seekingClass },
    {
      key: 'parentName',
      header: 'Parent',
      hideOnMobile: true,
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate">{row.parentName}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">{row.phone}</span>
        </span>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      hideOnMobile: true,
      cell: (row) => humanise(row.source),
    },
    {
      key: 'followUpDate',
      header: 'Follow-up',
      sortable: true,
      hideOnMobile: true,
      cell: (row) =>
        row.followUpDate ? (
          <span className={row.isFollowUpOverdue ? 'text-[var(--color-danger)]' : undefined}>
            {formatDate(row.followUpDate)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{humanise(row.status)}</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Admissions"
        description="Every enquiry from first contact to an admitted student."
        actions={
          canManage ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Record enquiry
            </Button>
          ) : null
        }
      />

      {stats ? (
        <StatGrid columns={5} className="mb-4">
          <StatCard label="Open enquiries" value={stats.open} icon={<Users />} />
          <StatCard label="This month" value={stats.thisMonth} icon={<UserPlus />} />
          <StatCard label="Admitted" value={stats.admitted} />
          <StatCard
            label="Overdue follow-ups"
            value={stats.overdueFollowUps}
            icon={<CalendarClock />}
            invertTrend
          />
          <StatCard
            label="Conversion"
            value={`${stats.conversionRate}%`}
            icon={<TrendingUp />}
          />
        </StatGrid>
      ) : null}

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by name, enquiry number, phone or email"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
        />
        <FilterSelect
          label="Source"
          value={list.state.filters.source}
          onChange={(value) => list.setFilter('source', value)}
          options={ENQUIRY_SOURCES.map((source) => ({
            value: source,
            label: humanise(source),
          }))}
        />
        <FilterSelect
          label="Follow-up"
          value={list.state.filters.overdueOnly}
          onChange={(value) => list.setFilter('overdueOnly', value)}
          allLabel="Any"
          options={[{ value: 'true', label: 'Overdue only' }]}
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
        onRowClick={(row) => setOpenId(row.id)}
        empty={
          <EmptyState
            icon={<UserPlus />}
            title={list.activeFilterCount > 0 ? 'No enquiries match these filters' : 'No enquiries yet'}
            description="Walk-ins, phone calls and website enquiries all land here."
            action={
              canManage && list.activeFilterCount === 0 ? (
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                  Record enquiry
                </Button>
              ) : null
            }
          />
        }
      />

      {creating ? <CreateEnquiryDialog onClose={() => setCreating(false)} /> : null}
      {openId ? (
        <EnquiryDrawer id={openId} canManage={Boolean(canManage)} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreateEnquiryDialog({ onClose }: { onClose: () => void }) {
  const [studentFirstName, setStudentFirstName] = React.useState('');
  const [studentLastName, setStudentLastName] = React.useState('');
  const [seekingClass, setSeekingClass] = React.useState('');
  const [parentName, setParentName] = React.useState('');
  const [relation, setRelation] = React.useState('FATHER');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [source, setSource] = React.useState('WALK_IN');
  const [dateOfBirth, setDateOfBirth] = React.useState('');
  const [gender, setGender] = React.useState('');
  const [followUpDate, setFollowUpDate] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const { data: classes } = useClasses();

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Record an enquiry"
      description="Capture enough to call them back; the rest can be filled in later."
      submitLabel="Record enquiry"
      values={{
        studentFirstName,
        studentLastName,
        seekingClass,
        parentName,
        relation,
        phone,
        email,
        source,
        dateOfBirth,
        gender,
        followUpDate,
        notes,
      }}
      isValid={
        studentFirstName.trim().length > 0 &&
        seekingClass.trim().length > 0 &&
        parentName.trim().length > 0 &&
        /^\+?[0-9]{10,15}$/.test(phone.trim())
      }
      successMessage="Enquiry recorded"
      invalidates={[['admissions-enquiries'], ['admissions']]}
      submit={(values) =>
        api.post('/admissions/enquiries', {
          studentFirstName: values.studentFirstName.trim(),
          ...(values.studentLastName.trim() ? { studentLastName: values.studentLastName.trim() } : {}),
          seekingClass: values.seekingClass.trim(),
          parentName: values.parentName.trim(),
          relation: values.relation,
          phone: values.phone.trim(),
          ...(values.email.trim() ? { email: values.email.trim() } : {}),
          source: values.source,
          ...(values.dateOfBirth ? { dateOfBirth: values.dateOfBirth } : {}),
          ...(values.gender ? { gender: values.gender } : {}),
          ...(values.followUpDate ? { followUpDate: values.followUpDate } : {}),
          ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow>
            <Field label="Student first name" required error={errors.studentFirstName}>
              <Input
                value={studentFirstName}
                onChange={(event) => setStudentFirstName(event.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Student last name" error={errors.studentLastName}>
              <Input
                value={studentLastName}
                onChange={(event) => setStudentLastName(event.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field
              label="Seeking class"
              required
              error={errors.seekingClass}
              help="Free text — the class may not exist yet"
            >
              <Input
                value={seekingClass}
                onChange={(event) => setSeekingClass(event.target.value)}
                placeholder="Grade 1"
                list="admission-classes"
              />
            </Field>
            <Field label="Date of birth" error={errors.dateOfBirth}>
              <Input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
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

          <datalist id="admission-classes">
            {(classes ?? []).map((klass) => (
              <option key={klass.id} value={klass.name} />
            ))}
          </datalist>

          <FieldRow columns={3}>
            <Field label="Parent name" required error={errors.parentName}>
              <Input value={parentName} onChange={(event) => setParentName(event.target.value)} />
            </Field>
            <Field label="Relation" error={errors.relation}>
              <Select value={relation} onChange={(event) => setRelation(event.target.value)}>
                {GUARDIAN_RELATIONS.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Phone" required error={errors.phone}>
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+919876543210"
                inputMode="tel"
              />
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Email" error={errors.email}>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Source" error={errors.source}>
              <Select value={source} onChange={(event) => setSource(event.target.value)}>
                {ENQUIRY_SOURCES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Follow up on" error={errors.followUpDate}>
              <Input
                type="date"
                value={followUpDate}
                onChange={(event) => setFollowUpDate(event.target.value)}
              />
            </Field>
          </FieldRow>

          <Field label="Notes" error={errors.notes}>
            <Textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What did they ask about?"
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function EnquiryDrawer({
  id,
  canManage,
  onClose,
}: {
  id: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const [converting, setConverting] = React.useState(false);

  const detail = useQuery({
    queryKey: ['admissions', 'enquiry', id],
    queryFn: () => api.get<EnquiryDetail>(`/admissions/enquiries/${id}`),
  });

  const enquiry = detail.data;

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <Drawer
          title={enquiry ? enquiry.studentName : 'Enquiry'}
          description={enquiry ? `${enquiry.enquiryNumber} · seeking ${enquiry.seekingClass}` : undefined}
          footer={
            enquiry && canManage && !enquiry.isConverted && enquiry.status !== 'REJECTED' ? (
              <Button size="sm" variant="primary" onClick={() => setConverting(true)}>
                Admit as student
              </Button>
            ) : null
          }
        >
          {detail.isLoading ? (
            <LoadingState label="Loading enquiry" />
          ) : detail.error ? (
            <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
          ) : enquiry ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[enquiry.status] ?? 'neutral'}>
                  {humanise(enquiry.status)}
                </Badge>
                <span className="text-2xs text-[var(--color-ink-muted)]">
                  Raised {formatDate(enquiry.createdAt)} · {enquiry.ageInDays} day
                  {enquiry.ageInDays === 1 ? '' : 's'} old
                </span>
                {enquiry.isFollowUpOverdue ? <Badge tone="danger">Follow-up overdue</Badge> : null}
              </div>

              {enquiry.convertedStudent ? (
                <p className="rounded-[var(--radius-sm)] border border-[var(--color-success-border)] bg-[var(--color-success-soft)] px-3 py-2 text-xs text-[var(--color-success)]">
                  Admitted as {enquiry.convertedStudent.admissionNumber}.
                </p>
              ) : null}

              {enquiry.rejectionReason ? (
                <p className="rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
                  Rejected: {enquiry.rejectionReason}
                </p>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {[
                  ['Parent', `${enquiry.parentName} (${humanise(enquiry.relation)})`],
                  ['Phone', enquiry.phone],
                  ['Email', enquiry.email ?? '—'],
                  ['Source', humanise(enquiry.source)],
                  ['Date of birth', enquiry.dateOfBirth ? formatDate(enquiry.dateOfBirth) : '—'],
                  ['Gender', enquiry.gender ? humanise(enquiry.gender) : '—'],
                  ['Previous school', enquiry.previousSchool ?? '—'],
                  ['City', enquiry.city ?? '—'],
                  [
                    'Follow-up',
                    enquiry.followUpDate ? formatDate(enquiry.followUpDate) : 'Not scheduled',
                  ],
                  [
                    'Owner',
                    enquiry.assignee
                      ? `${enquiry.assignee.firstName} ${enquiry.assignee.lastName ?? ''}`.trim()
                      : 'Unassigned',
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[var(--color-ink-muted)]">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              {enquiry.notes ? (
                <div>
                  <p className="mb-1 text-xs font-medium">Log</p>
                  <pre className="whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2 font-sans text-2xs text-[var(--color-ink-secondary)]">
                    {enquiry.notes}
                  </pre>
                </div>
              ) : null}

              {canManage && enquiry.allowedTransitions.length > 0 ? (
                <StatusActions enquiry={enquiry} />
              ) : null}
            </div>
          ) : null}
        </Drawer>
      </Dialog>

      {converting && enquiry ? (
        <ConvertDialog enquiry={enquiry} onClose={() => setConverting(false)} onDone={onClose} />
      ) : null}
    </>
  );
}

function StatusActions({ enquiry }: { enquiry: EnquiryDetail }) {
  const [status, setStatus] = React.useState('');
  const [note, setNote] = React.useState('');
  const [rejectionReason, setRejectionReason] = React.useState('');
  const [followUpDate, setFollowUpDate] = React.useState('');

  const move = useAction({
    mutationFn: () =>
      api.patch(`/admissions/enquiries/${enquiry.id}/status`, {
        status,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(status === 'REJECTED' ? { rejectionReason: rejectionReason.trim() } : {}),
        ...(followUpDate ? { followUpDate } : {}),
      }),
    successMessage: 'Enquiry updated',
    invalidates: [['admissions'], ['admissions-enquiries']],
    onSuccess: () => {
      setStatus('');
      setNote('');
      setRejectionReason('');
      setFollowUpDate('');
    },
  });

  const needsReason = status === 'REJECTED';
  const canSubmit = status !== '' && (!needsReason || rejectionReason.trim().length > 0);

  return (
    <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
      <p className="text-xs font-medium">Move this enquiry on</p>

      <Field label="New status">
        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Select</option>
          {enquiry.allowedTransitions.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </Select>
      </Field>

      {needsReason ? (
        <Field label="Reason" required help="Recorded on the enquiry and shown to staff">
          <Input
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
          />
        </Field>
      ) : null}

      <Field label="Next follow-up">
        <Input
          type="date"
          value={followUpDate}
          onChange={(event) => setFollowUpDate(event.target.value)}
        />
      </Field>

      <Field label="Note" help="Added to the log with today's date">
        <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>

      <Button
        size="sm"
        variant="primary"
        loading={move.isPending}
        disabled={!canSubmit}
        onClick={() => move.mutate(undefined)}
      >
        Update
      </Button>
    </div>
  );
}

function ConvertDialog({
  enquiry,
  onClose,
  onDone,
}: {
  enquiry: EnquiryDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [academicYearId, setAcademicYearId] = React.useState('');
  const [admissionDate, setAdmissionDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [dateOfBirth, setDateOfBirth] = React.useState(
    enquiry.dateOfBirth ? enquiry.dateOfBirth.slice(0, 10) : '',
  );
  const [gender, setGender] = React.useState(enquiry.gender ?? '');

  const { data: classes } = useClasses();
  const { data: sections } = useSections(classId || undefined);
  const { data: years } = useAcademicYears();

  // The enquiry may predate a full record, so anything the API insists on and
  // the enquiry lacks has to be supplied here.
  const needsDob = !enquiry.dateOfBirth;
  const needsGender = !enquiry.gender;

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Admit ${enquiry.studentName}`}
      description="Creates the student, the enrolment and a guardian from the enquiry contact."
      submitLabel="Admit student"
      values={{ classId, sectionId, academicYearId, admissionDate, dateOfBirth, gender }}
      isValid={
        classId !== '' &&
        sectionId !== '' &&
        admissionDate !== '' &&
        (!needsDob || dateOfBirth !== '') &&
        (!needsGender || gender !== '')
      }
      successMessage="Student admitted"
      invalidates={[['admissions'], ['admissions-enquiries'], ['students'], ['lookup']]}
      submit={(values) =>
        api.post(`/admissions/enquiries/${enquiry.id}/convert`, {
          classId: values.classId,
          sectionId: values.sectionId,
          admissionDate: values.admissionDate,
          ...(values.academicYearId ? { academicYearId: values.academicYearId } : {}),
          ...(needsDob ? { dateOfBirth: values.dateOfBirth } : {}),
          ...(needsGender ? { gender: values.gender } : {}),
        })
      }
      onSaved={() => {
        onClose();
        onDone();
      }}
    >
      {(errors) => (
        <>
          <FieldRow>
            <Field label="Class" required error={errors.classId}>
              <Select
                value={classId}
                onChange={(event) => {
                  setClassId(event.target.value);
                  setSectionId('');
                }}
              >
                <option value="">Select a class</option>
                {(classes ?? []).map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Section" required error={errors.sectionId}>
              <Select
                value={sectionId}
                onChange={(event) => setSectionId(event.target.value)}
                disabled={!classId}
              >
                <option value="">{classId ? 'Select a section' : 'Choose a class first'}</option>
                {(sections ?? []).map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name} — {section.availableSeats} free
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Admission date" required error={errors.admissionDate}>
              <Input
                type="date"
                value={admissionDate}
                onChange={(event) => setAdmissionDate(event.target.value)}
              />
            </Field>
            <Field label="Academic year" error={errors.academicYearId} help="Defaults to the current year">
              <Select
                value={academicYearId}
                onChange={(event) => setAcademicYearId(event.target.value)}
              >
                <option value="">Current year</option>
                {(years ?? []).map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          {needsDob || needsGender ? (
            <FieldRow>
              {needsDob ? (
                <Field
                  label="Date of birth"
                  required
                  error={errors.dateOfBirth}
                  help="The enquiry did not capture one"
                >
                  <Input
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={dateOfBirth}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                  />
                </Field>
              ) : null}
              {needsGender ? (
                <Field label="Gender" required error={errors.gender}>
                  <Select value={gender} onChange={(event) => setGender(event.target.value)}>
                    <option value="">Select</option>
                    {GENDERS.map((value) => (
                      <option key={value} value={value}>
                        {humanise(value)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </FieldRow>
          ) : null}
        </>
      )}
    </FormModal>
  );
}
