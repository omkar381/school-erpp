'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Check, MapPin, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDateTime } from '@/lib/dates';
import { initials } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog, Dialog, Drawer } from '@/components/ui/dialog';
import { Pagination } from '@/components/ui/data-table';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from '@/components/ui/states';

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  startAt: string;
  endAt: string | null;
  isAllDay: boolean;
  venue: string | null;
  audience: string;
  requiresRegistration: boolean;
  registrationCount?: number;
  capacity?: number | null;
  maxParticipants?: number | null;
  registrationDeadline?: string | null;
  isPublic?: boolean;
}

const EVENT_TYPES = [
  'ANNUAL_DAY',
  'SPORTS_DAY',
  'PARENT_MEETING',
  'EXAM',
  'HOLIDAY',
  'COMPETITION',
  'TRIP',
  'WORKSHOP',
  'CELEBRATION',
  'OTHER',
];

const EVENT_AUDIENCES = ['ALL', 'STUDENTS', 'PARENTS', 'TEACHERS', 'STAFF'];

const EVENT_QUERIES = [['events']];

export default function EventsPage() {
  const canCreate = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('events.create'),
  );
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('events.update'),
  );
  const canDelete = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('events.delete'),
  );

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<EventRow | null>(null);
  const [deleting, setDeleting] = React.useState<EventRow | null>(null);
  const [managing, setManaging] = React.useState<EventRow | null>(null);

  const canRegister = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('events.update'),
  );

  const initialSearch = useSearchParams().get('q') ?? undefined;
  const list = useListQuery<EventRow>('events', '/events', {
    initialSortBy: 'startAt',
    initialSortOrder: 'asc',
    initialSearch,
  });

  const removeEvent = useAction({
    mutationFn: (row: EventRow) => api.delete(`/events/${row.id}`),
    successMessage: 'Event deleted',
    invalidates: EVENT_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader
        title="Events"
        description="What is coming up across the school calendar."
        actions={
          canCreate ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Add event
            </Button>
          ) : null
        }
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search events"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Type"
          value={list.state.filters.type}
          onChange={(value) => list.setFilter('type', value)}
          options={EVENT_TYPES.map((type) => ({ value: type, label: humanise(type) }))}
        />
        <FilterSelect
          label="When"
          value={list.state.filters.upcoming}
          onChange={(value) => list.setFilter('upcoming', value)}
          allLabel="All dates"
          options={[{ value: 'true', label: 'Upcoming only' }]}
        />
      </FilterBar>

      {list.isLoading ? (
        <Card>
          <TableSkeleton rows={4} columns={3} />
        </Card>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title="No events match these filters"
          description="Scheduled events appear here with their dates and venues."
          action={
            canCreate && list.activeFilterCount === 0 ? (
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                Add event
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-2.5">
          {list.items.map((event) => {
            const past = new Date(event.endAt ?? event.startAt) < new Date();

            return (
              <Card key={event.id} className={past ? 'opacity-70' : undefined}>
                <CardBody className="flex flex-wrap items-start gap-4">
                  {/* Date block, so a calendar scans quickly down the left edge. */}
                  <div className="w-14 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] py-1.5 text-center">
                    <p className="text-2xs uppercase text-[var(--color-ink-muted)]">
                      {new Date(event.startAt).toLocaleString('en-IN', { month: 'short' })}
                    </p>
                    <p className="text-lg font-semibold leading-tight tabular">
                      {new Date(event.startAt).getDate()}
                    </p>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {event.title}
                      </h3>
                      <Badge tone={past ? 'neutral' : 'info'}>{humanise(event.type)}</Badge>
                      {past ? <Badge>Past</Badge> : null}
                    </div>

                    {event.description ? (
                      <p className="line-clamp-2 text-sm text-[var(--color-ink-secondary)]">
                        {event.description}
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-2xs text-[var(--color-ink-muted)]">
                      <span>
                        {event.isAllDay
                          ? 'All day'
                          : `${formatDateTime(event.startAt)}${
                              event.endAt ? ` – ${formatDateTime(event.endAt)}` : ''
                            }`}
                      </span>
                      {event.venue ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden />
                          {event.venue}
                        </span>
                      ) : null}
                      <Badge>{humanise(event.audience)}</Badge>
                      {event.requiresRegistration ? (
                        <button
                          type="button"
                          onClick={() => setManaging(event)}
                          className="inline-flex items-center gap-1 hover:text-[var(--color-accent)]"
                        >
                          <Users className="size-3" aria-hidden />
                          {event.registrationCount ?? 0}
                          {(event.capacity ?? event.maxParticipants)
                            ? ` / ${event.capacity ?? event.maxParticipants}`
                            : ''}{' '}
                          registered
                        </button>
                      ) : null}

                      {canManage || canDelete || (canRegister && event.requiresRegistration) ? (
                        <span className="ml-auto flex items-center gap-1">
                          {canRegister && event.requiresRegistration ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              icon={<Users />}
                              onClick={() => setManaging(event)}
                            >
                              Registrations
                            </Button>
                          ) : null}
                          {canManage ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              icon={<Pencil />}
                              aria-label={`Edit ${event.title}`}
                              onClick={() => setEditing(event)}
                            />
                          ) : null}
                          {canDelete ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              icon={<Trash2 />}
                              aria-label={`Delete ${event.title}`}
                              onClick={() => setDeleting(event)}
                            />
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}

          {list.meta ? (
            <Card>
              <Pagination meta={list.meta} onPageChange={list.setPage} />
            </Card>
          ) : null}
        </div>
      )}

      {creating ? <EventFormDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <EventFormDialog event={editing} onClose={() => setEditing(null)} /> : null}
      {managing ? (
        <RegistrationsDrawer
          event={managing}
          canManage={Boolean(canRegister)}
          onClose={() => setManaging(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this event?"
        description={
          deleting
            ? `"${deleting.title}" and any registrations against it will be removed.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={removeEvent.isPending}
        onConfirm={() => deleting && removeEvent.mutate(deleting)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time, not a UTC ISO string. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function EventFormDialog({ event, onClose }: { event?: EventRow; onClose: () => void }) {
  const isEdit = Boolean(event);

  const [title, setTitle] = React.useState(event?.title ?? '');
  const [description, setDescription] = React.useState(event?.description ?? '');
  const [type, setType] = React.useState(event?.type ?? 'OTHER');
  const [startAt, setStartAt] = React.useState(toLocalInput(event?.startAt));
  const [endAt, setEndAt] = React.useState(toLocalInput(event?.endAt));
  const [isAllDay, setIsAllDay] = React.useState(event?.isAllDay ?? false);
  const [venue, setVenue] = React.useState(event?.venue ?? '');
  const [audience, setAudience] = React.useState(event?.audience ?? 'ALL');
  const [requiresRegistration, setRequiresRegistration] = React.useState(
    event?.requiresRegistration ?? false,
  );
  const [maxParticipants, setMaxParticipants] = React.useState(
    event?.maxParticipants != null ? String(event.maxParticipants) : '',
  );
  const [registrationDeadline, setRegistrationDeadline] = React.useState(
    event?.registrationDeadline?.slice(0, 10) ?? '',
  );
  const [isPublic, setIsPublic] = React.useState(event?.isPublic ?? false);
  const [publish, setPublish] = React.useState(true);

  // An event that ends before it starts is the mistake this form exists to catch.
  const datesOk = Boolean(startAt) && Boolean(endAt) && new Date(endAt) >= new Date(startAt);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={isEdit ? 'Edit event' : 'Add an event'}
      description="Events show on the school calendar, and on the public website when marked public."
      submitLabel={isEdit ? 'Save changes' : 'Add event'}
      values={{
        title,
        description,
        type,
        startAt,
        endAt,
        isAllDay,
        venue,
        audience,
        requiresRegistration,
        maxParticipants,
        registrationDeadline,
        isPublic,
        publish,
      }}
      isValid={title.trim().length > 0 && datesOk}
      successMessage={isEdit ? 'Event updated' : 'Event added'}
      invalidates={EVENT_QUERIES}
      submit={(values) => {
        const body = {
          title: values.title.trim(),
          ...(values.description.trim() ? { description: values.description.trim() } : {}),
          type: values.type,
          startAt: new Date(values.startAt).toISOString(),
          endAt: new Date(values.endAt).toISOString(),
          isAllDay: values.isAllDay,
          ...(values.venue.trim() ? { venue: values.venue.trim() } : {}),
          audience: values.audience,
          requiresRegistration: values.requiresRegistration,
          ...(values.requiresRegistration && values.maxParticipants
            ? { maxParticipants: Number(values.maxParticipants) }
            : {}),
          ...(values.requiresRegistration && values.registrationDeadline
            ? { registrationDeadline: values.registrationDeadline }
            : {}),
          isPublic: values.isPublic,
        };

        return isEdit
          ? api.patch(`/events/${event!.id}`, body)
          : api.post('/events', { ...body, publish: values.publish });
      }}
    >
      {(errors) => (
        <>
          <Field label="Title" required error={errors.title}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>

          <Field label="Description" error={errors.description}>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <FieldRow columns={3}>
            <Field label="Type" error={errors.type}>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {EVENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Audience" error={errors.audience}>
              <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
                {EVENT_AUDIENCES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Venue" error={errors.venue}>
              <Input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="School grounds"
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Starts" required error={errors.startAt}>
              <Input
                type="datetime-local"
                value={startAt}
                onChange={(e) => {
                  setStartAt(e.target.value);
                  // A same-day default saves the second most common edit.
                  if (!endAt) setEndAt(e.target.value);
                }}
              />
            </Field>
            <Field
              label="Ends"
              required
              error={errors.endAt}
              help={startAt && endAt && !datesOk ? 'Must be on or after the start' : undefined}
            >
              <Input
                type="datetime-local"
                value={endAt}
                min={startAt || undefined}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </Field>
          </FieldRow>

          {requiresRegistration ? (
            <FieldRow>
              <Field
                label="Maximum participants"
                error={errors.maxParticipants}
                help="Registrations beyond this are waitlisted"
              >
                <Input
                  type="number"
                  min={1}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(e.target.value)}
                />
              </Field>
              <Field label="Registration closes" error={errors.registrationDeadline}>
                <Input
                  type="date"
                  value={registrationDeadline}
                  onChange={(e) => setRegistrationDeadline(e.target.value)}
                />
              </Field>
            </FieldRow>
          ) : null}

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
              />
              All-day event
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresRegistration}
                onChange={(e) => setRequiresRegistration(e.target.checked)}
              />
              Requires registration
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              Show on the public website
            </label>
            {!isEdit ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={publish}
                  onChange={(e) => setPublish(e.target.checked)}
                />
                Publish now
              </label>
            ) : null}
          </div>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

interface Registration {
  id: string;
  status: string;
  notes: string | null;
  student: {
    id: string;
    admissionNumber: string;
    firstName: string;
    lastName: string | null;
    photoUrl: string | null;
    enrollments: Array<{ class: { name: string } | null; section: { name: string } | null }>;
  };
}

interface EventDetail extends EventRow {
  seatsRemaining: number | null;
  registrations: Registration[];
}

function RegistrationsDrawer({
  event,
  canManage,
  onClose,
}: {
  event: EventRow;
  canManage: boolean;
  onClose: () => void;
}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['event', event.id],
    queryFn: () => api.get<EventDetail>(`/events/${event.id}`),
  });

  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<Registration | null>(null);

  const eventQueries = [['event', event.id], ['events']];

  const remove = useAction({
    mutationFn: (studentId: string) => api.delete(`/events/${event.id}/register/${studentId}`),
    successMessage: 'Registration cancelled',
    invalidates: eventQueries,
    onSuccess: () => setRemoving(null),
  });

  const markAttended = useAction({
    mutationFn: (studentIds: string[]) =>
      api.post(`/events/${event.id}/attendance`, { studentIds }),
    successMessage: 'Attendance recorded',
    invalidates: eventQueries,
  });

  const registrations = data?.registrations ?? [];
  const notAttended = registrations
    .filter((r) => r.status !== 'ATTENDED' && r.status !== 'CANCELLED')
    .map((r) => r.student.id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Drawer
        width="md"
        title={event.title}
        description={
          data
            ? `${registrations.length} registered${
                data.seatsRemaining !== null ? ` · ${data.seatsRemaining} seats left` : ''
              }`
            : 'Registrations'
        }
        footer={
          canManage ? (
            <>
              {notAttended.length > 0 ? (
                <Button
                  size="sm"
                  icon={<Check />}
                  loading={markAttended.isPending}
                  onClick={() => markAttended.mutate(notAttended)}
                >
                  Mark all attended
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="primary"
                icon={<UserPlus />}
                onClick={() => setAdding(true)}
              >
                Register a student
              </Button>
            </>
          ) : null
        }
      >
        {isLoading ? (
          <LoadingState label="Loading registrations" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : registrations.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="Nobody registered yet"
            description="Register students individually, or let them sign up from the portal."
            action={
              canManage ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<UserPlus />}
                  onClick={() => setAdding(true)}
                >
                  Register a student
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-sm)] border border-[var(--color-border)]">
            {registrations.map((registration) => {
              const enrollment = registration.student.enrollments[0];
              const name = [registration.student.firstName, registration.student.lastName]
                .filter(Boolean)
                .join(' ');
              return (
                <li key={registration.id} className="flex items-center gap-2.5 px-3 py-2">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold"
                    aria-hidden
                  >
                    {registration.student.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={registration.student.photoUrl}
                        alt=""
                        className="size-7 object-cover"
                      />
                    ) : (
                      initials(name)
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                      {registration.student.admissionNumber}
                      {enrollment?.class
                        ? ` · ${enrollment.class.name} ${enrollment.section?.name ?? ''}`
                        : ''}
                    </p>
                  </div>
                  <Badge
                    tone={
                      registration.status === 'ATTENDED'
                        ? 'success'
                        : registration.status === 'WAITLISTED'
                          ? 'warning'
                          : registration.status === 'CANCELLED'
                            ? 'danger'
                            : 'neutral'
                    }
                  >
                    {humanise(registration.status)}
                  </Badge>
                  {canManage && registration.status !== 'CANCELLED' ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      icon={<Trash2 />}
                      aria-label={`Cancel ${name} registration`}
                      onClick={() => setRemoving(registration)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Drawer>

      {adding ? (
        <RegisterStudentDialog eventId={event.id} onClose={() => setAdding(false)} />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Cancel this registration?"
        description="If there is a waitlist, the next student is promoted automatically."
        confirmLabel="Cancel registration"
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.student.id)}
      />
    </Dialog>
  );
}

function RegisterStudentDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const students = useListQuery<{ id: string; fullName: string; admissionNumber: string }>(
    'event-student-search',
    '/students',
    { initialLimit: 10 },
  );

  const [studentId, setStudentId] = React.useState('');
  const [notes, setNotes] = React.useState('');

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Register a student"
      description="Past capacity, the student is added to the waitlist."
      submitLabel="Register"
      values={{ studentId, notes }}
      isValid={studentId !== ''}
      successMessage="Student registered"
      invalidates={[['event', eventId], ['events']]}
      submit={(v) =>
        api.post(`/events/${eventId}/register`, {
          studentId: v.studentId,
          ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
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
                onChange={(e) => students.setSearch(e.target.value)}
              />
              <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Select a student</option>
                {students.items.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.fullName} — {student.admissionNumber}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field label="Notes" error={errors.notes}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
