'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CalendarOff, Clock, Plus, Trash2, UserX } from 'lucide-react';
import { WEEKDAYS, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useClasses, useSections, useSubjects, useTeachers } from '@/hooks/use-lookups';
import { cn } from '@/lib/utils';
import { formatClock, today } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Field, FieldRow } from '@/components/ui/field';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface Slot {
  id: string;
  dayOfWeek: string;
  periodId: string;
  subject: { id: string; name: string; colorHex: string | null } | null;
  staff: { id: string; firstName: string; lastName: string | null } | null;
  room: { id: string; name: string } | null;
}

interface SectionTimetable {
  section?: { name: string; class?: { name: string } | null } | null;
  periods?: Array<{
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    type?: string;
    sequence?: number;
  }>;
  /** One row per weekday; `slots` is aligned to `periods`, with null for a free period. */
  days: Array<{ day: string; slots: Array<Slot | null> }>;
}

interface Period {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  type?: string;
  sequence?: number;
}

/** Saturday is a working day in most Indian schools; Sunday is not shown. */
const DAYS = WEEKDAYS.filter((day) => day !== 'SUNDAY');

const PERIOD_TYPES = ['CLASS', 'BREAK', 'LUNCH', 'ASSEMBLY', 'ACTIVITY'];

export default function TimetablePage() {
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('timetable.manage'),
  );

  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [managingPeriods, setManagingPeriods] = React.useState(false);
  const [editingCell, setEditingCell] = React.useState<{
    day: string;
    period: Period;
    slot: Slot | undefined;
  } | null>(null);

  const { data: classes } = useClasses();
  const { data: sections } = useSections(classId || undefined);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['timetable', 'section', sectionId],
    queryFn: () => api.get<SectionTimetable>(`/timetable/sections/${sectionId}`),
    enabled: Boolean(sectionId),
  });

  const periods = React.useMemo(
    () =>
      (data?.periods ?? [])
        .slice()
        .sort(
          (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.startTime.localeCompare(b.startTime),
        ),
    [data],
  );

  // The API returns a grid (one row per weekday, cells aligned to `periods`);
  // flatten it to a day:period lookup for the table below.
  const byCell = React.useMemo(() => {
    const map = new Map<string, Slot>();
    for (const row of data?.days ?? []) {
      row.slots.forEach((slot, index) => {
        const period = periods[index];
        if (slot && period) map.set(`${row.day}:${period.id}`, slot);
      });
    }
    return map;
  }, [data, periods]);

  return (
    <>
      <PageHeader
        title="Timetable"
        description="The weekly schedule for a section, and cover when a teacher is out."
        actions={
          canManage ? (
            <Button size="sm" icon={<Clock />} onClick={() => setManagingPeriods(true)}>
              Manage periods
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="grid">
        <TabsList>
          <TabsTrigger value="grid">Weekly grid</TabsTrigger>
          <TabsTrigger value="substitutions">Substitutions</TabsTrigger>
        </TabsList>

        <TabsContent value="substitutions">
          <SubstitutionsPanel />
        </TabsContent>

        <TabsContent value="grid">
          <Card className="mb-4">
            <CardBody className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-ink-secondary)]">Class</span>
                <Select
                  value={classId}
                  onChange={(event) => {
                    setClassId(event.target.value);
                    setSectionId('');
                  }}
                  className="w-40"
                >
                  <option value="">Select a class</option>
                  {(classes ?? []).map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-ink-secondary)]">
                  Section
                </span>
                <Select
                  value={sectionId}
                  onChange={(event) => setSectionId(event.target.value)}
                  disabled={!classId}
                  className="w-40"
                >
                  <option value="">Select a section</option>
                  {(sections ?? []).map((section) => (
                    <option key={section.id} value={section.id}>
                      Section {section.name}
                    </option>
                  ))}
                </Select>
              </label>
            </CardBody>
          </Card>

          {!sectionId ? (
            <EmptyState
              icon={<CalendarClock />}
              title="Choose a class and section"
              description="Pick a section above to see its weekly timetable."
            />
          ) : isLoading ? (
            <LoadingState label="Loading timetable" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : periods.length === 0 ? (
            <EmptyState
              icon={<CalendarClock />}
              title="No periods defined yet"
              description="Define the daily periods first, then fill in the week."
              action={
                canManage ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Clock />}
                    onClick={() => setManagingPeriods(true)}
                  >
                    Manage periods
                  </Button>
                ) : null
              }
            />
          ) : (
            <Card>
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full min-w-[46rem] border-collapse text-sm">
                  <thead>
                    <tr className="bg-[var(--color-surface-sunken)] hairline">
                      <th className="w-28 px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                        Period
                      </th>
                      {DAYS.map((day) => (
                        <th
                          key={day}
                          className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]"
                        >
                          {humanise(day).slice(0, 3)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {periods.map((period) => {
                      const isBreak = period.type && period.type !== 'CLASS';

                      return (
                        <tr
                          key={period.id}
                          className={isBreak ? 'bg-[var(--color-surface-sunken)]' : undefined}
                        >
                          <th scope="row" className="px-3 py-2 text-left align-top font-normal">
                            <span className="block text-xs font-medium">{period.name}</span>
                            <span className="block text-2xs tabular text-[var(--color-ink-muted)]">
                              {formatClock(period.startTime)}
                            </span>
                          </th>

                          {DAYS.map((day) => {
                            const slot = byCell.get(`${day}:${period.id}`);

                            if (isBreak) {
                              return (
                                <td
                                  key={day}
                                  className="px-3 py-2 text-center text-2xs text-[var(--color-ink-faint)]"
                                >
                                  {humanise(period.type ?? '')}
                                </td>
                              );
                            }

                            const content = slot?.subject ? (
                              <div
                                className={cn(
                                  'rounded-[var(--radius-xs)] border-l-2 bg-[var(--color-surface-sunken)] px-2 py-1.5 text-left',
                                )}
                                style={{
                                  borderLeftColor: slot.subject.colorHex ?? 'var(--color-accent)',
                                }}
                              >
                                <span className="block truncate text-xs font-medium">
                                  {slot.subject.name}
                                </span>
                                {slot.staff ? (
                                  <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                                    {slot.staff.firstName} {slot.staff.lastName ?? ''}
                                  </span>
                                ) : null}
                                {slot.room ? (
                                  <span className="block truncate text-2xs text-[var(--color-ink-faint)]">
                                    {slot.room.name}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="block py-1.5 text-center text-2xs text-[var(--color-ink-faint)]">
                                {canManage ? 'Add' : '—'}
                              </span>
                            );

                            return (
                              <td key={day} className="px-1.5 py-1.5 align-top">
                                {canManage ? (
                                  <button
                                    type="button"
                                    className="w-full rounded-[var(--radius-xs)] transition-colors hover:bg-[var(--color-surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
                                    onClick={() => setEditingCell({ day, period, slot })}
                                    aria-label={`${slot?.subject ? 'Edit' : 'Add'} ${humanise(day)} ${period.name}`}
                                  >
                                    {content}
                                  </button>
                                ) : (
                                  content
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {managingPeriods ? (
        <PeriodsDialog periods={periods} onClose={() => setManagingPeriods(false)} />
      ) : null}
      {editingCell ? (
        <SlotDialog
          sectionId={sectionId}
          day={editingCell.day}
          period={editingCell.period}
          slot={editingCell.slot}
          onClose={() => setEditingCell(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Substitutions
// ---------------------------------------------------------------------------

interface Substitution {
  id: string;
  date: string;
  isCancelled: boolean;
  reason: string | null;
  substituteStaff: { id: string; firstName: string; lastName: string | null } | null;
  slot: {
    id: string;
    period: { name: string; sequence: number; startTime: string; endTime: string } | null;
    subject: { name: string; code: string } | null;
    staff: { id: string; firstName: string; lastName: string | null } | null;
    section: { name: string; class: { name: string } | null } | null;
  };
}

function SubstitutionsPanel() {
  const canSubstitute = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('timetable.substitute'),
  );

  const [date, setDate] = React.useState(today());
  const [arranging, setArranging] = React.useState(false);
  const [removing, setRemoving] = React.useState<Substitution | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['timetable', 'substitutions', date],
    queryFn: () => api.get<Substitution[]>('/timetable/substitutions', { date }),
  });

  const remove = useAction({
    mutationFn: (id: string) => api.delete(`/timetable/substitutions/${id}`),
    successMessage: 'Substitution removed',
    invalidates: [['timetable', 'substitutions']],
    onSuccess: () => setRemoving(null),
  });

  const rows = data ?? [];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--color-ink-secondary)]">Date</span>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
        </label>
        {canSubstitute ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus />}
            className="ml-auto self-end"
            onClick={() => setArranging(true)}
          >
            Arrange cover
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <LoadingState label="Loading substitutions" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UserX />}
          title="No cover arranged for this date"
          description="When a teacher is out, arrange a substitute or cancel the class here."
          action={
            canSubstitute ? (
              <Button
                size="sm"
                variant="primary"
                icon={<Plus />}
                onClick={() => setArranging(true)}
              >
                Arrange cover
              </Button>
            ) : null
          }
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--color-border)]">
              {rows.map((sub) => (
                <li key={sub.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="w-14 shrink-0 text-2xs tabular text-[var(--color-ink-muted)]">
                    {sub.slot.period ? formatClock(sub.slot.period.startTime) : '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {sub.slot.subject?.name ?? 'Class'}
                      <span className="ml-1.5 text-2xs font-normal text-[var(--color-ink-muted)]">
                        {sub.slot.section?.class?.name} {sub.slot.section?.name}
                        {sub.slot.period ? ` · ${sub.slot.period.name}` : ''}
                      </span>
                    </p>
                    <p className="text-2xs text-[var(--color-ink-muted)]">
                      {sub.slot.staff
                        ? `Normally ${sub.slot.staff.firstName} ${sub.slot.staff.lastName ?? ''}`
                        : ''}
                      {sub.reason ? ` — ${sub.reason}` : ''}
                    </p>
                  </div>
                  {sub.isCancelled ? (
                    <Badge tone="danger">
                      <CalendarOff className="size-2.5" aria-hidden />
                      Cancelled
                    </Badge>
                  ) : sub.substituteStaff ? (
                    <Badge tone="success">
                      Covered by {sub.substituteStaff.firstName}{' '}
                      {sub.substituteStaff.lastName ?? ''}
                    </Badge>
                  ) : (
                    <Badge tone="warning">Uncovered</Badge>
                  )}
                  {canSubstitute ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      icon={<Trash2 />}
                      aria-label="Remove this substitution"
                      onClick={() => setRemoving(sub)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {arranging ? (
        <ArrangeSubstitutionDialog date={date} onClose={() => setArranging(false)} />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this substitution?"
        description="The class reverts to its usual teacher on the timetable."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </>
  );
}

interface AvailableTeacher {
  id: string;
  fullName: string;
  employeeId: string;
  department: { name: string } | null;
  photoUrl: string | null;
}

function ArrangeSubstitutionDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const classes = useClasses();
  const [classId, setClassId] = React.useState('');
  const { data: sections } = useSections(classId || undefined);
  const [sectionId, setSectionId] = React.useState('');
  const [slotId, setSlotId] = React.useState('');
  const [mode, setMode] = React.useState<'substitute' | 'cancel'>('substitute');
  const [substituteStaffId, setSubstituteStaffId] = React.useState('');
  const [reason, setReason] = React.useState('');

  const weekday = React.useMemo(() => {
    const d = new Date(`${date}T00:00:00`);
    return WEEKDAYS[(d.getDay() + 6) % 7]; // JS Sunday=0 → our Monday-first list
  }, [date]);

  const timetable = useQuery({
    queryKey: ['timetable', 'section', sectionId],
    queryFn: () => api.get<SectionTimetable>(`/timetable/sections/${sectionId}`),
    enabled: Boolean(sectionId),
  });

  const periods = React.useMemo(
    () =>
      (timetable.data?.periods ?? []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)),
    [timetable.data],
  );

  // Real teaching periods on the chosen weekday: a slot with a subject.
  const daySlots = React.useMemo(() => {
    const row = timetable.data?.days?.find((d) => d.day === weekday);
    if (!row) return [];
    return row.slots
      .map((slot, index) => (slot ? { slot, period: periods[index] } : null))
      .filter(
        (entry): entry is { slot: Slot; period: (typeof periods)[number] } =>
          entry !== null && Boolean(entry.slot.subject) && Boolean(entry.period),
      );
  }, [timetable.data, weekday, periods]);

  const selected = daySlots.find((entry) => entry.slot.id === slotId);

  const available = useQuery({
    queryKey: ['timetable', 'available-teachers', date, selected?.period.id],
    queryFn: () =>
      api.get<AvailableTeacher[]>('/timetable/substitutions/available-teachers', {
        date,
        periodId: selected!.period.id,
      }),
    enabled: Boolean(selected?.period.id) && mode === 'substitute',
  });

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Arrange cover"
      description={`For ${humanise(weekday)}, ${date}. Pick the class that needs cover.`}
      submitLabel={mode === 'cancel' ? 'Cancel the class' : 'Assign substitute'}
      values={{ slotId, mode, substituteStaffId, reason }}
      isValid={Boolean(slotId) && (mode === 'cancel' || Boolean(substituteStaffId))}
      successMessage="Substitution arranged"
      invalidates={[['timetable', 'substitutions']]}
      submit={(v) =>
        api.post('/timetable/substitutions', {
          slotId: v.slotId,
          date,
          ...(v.mode === 'cancel'
            ? { isCancelled: true }
            : { substituteStaffId: v.substituteStaffId }),
          ...(v.reason.trim() ? { reason: v.reason.trim() } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={2}>
            <Field label="Class">
              <Select
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setSectionId('');
                  setSlotId('');
                }}
              >
                <option value="">Select a class</option>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Section">
              <Select
                value={sectionId}
                onChange={(e) => {
                  setSectionId(e.target.value);
                  setSlotId('');
                }}
                disabled={!classId}
              >
                <option value="">Select a section</option>
                {(sections ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    Section {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <Field
            label="Period to cover"
            required
            error={errors.slotId}
            help={
              sectionId && daySlots.length === 0 && !timetable.isLoading
                ? `No classes scheduled for this section on ${humanise(weekday)}`
                : undefined
            }
          >
            <Select
              value={slotId}
              onChange={(e) => setSlotId(e.target.value)}
              disabled={!sectionId}
            >
              <option value="">Select a period</option>
              {daySlots.map(({ slot, period }) => (
                <option key={slot.id} value={slot.id}>
                  {period.name} · {slot.subject?.name} ·{' '}
                  {slot.staff
                    ? `${slot.staff.firstName} ${slot.staff.lastName ?? ''}`
                    : 'unassigned'}
                </option>
              ))}
            </Select>
          </Field>

          <FieldRow columns={2}>
            <Field label="Action">
              <Select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'substitute' | 'cancel')}
              >
                <option value="substitute">Assign a substitute</option>
                <option value="cancel">Cancel the class</option>
              </Select>
            </Field>
            {mode === 'substitute' ? (
              <Field
                label="Substitute"
                required
                error={errors.substituteStaffId}
                help={
                  selected && available.data && available.data.length === 0
                    ? 'No teacher is free this period'
                    : undefined
                }
              >
                <Select
                  value={substituteStaffId}
                  onChange={(e) => setSubstituteStaffId(e.target.value)}
                  disabled={!selected}
                >
                  <option value="">Select a teacher</option>
                  {(available.data ?? []).map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.fullName}
                      {teacher.department ? ` · ${teacher.department.name}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </FieldRow>

          <Field label="Reason" error={errors.reason}>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Teacher on sick leave"
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// One cell of the week
// ---------------------------------------------------------------------------

function SlotDialog({
  sectionId,
  day,
  period,
  slot,
  onClose,
}: {
  sectionId: string;
  day: string;
  period: Period;
  slot: Slot | undefined;
  onClose: () => void;
}) {
  const [subjectId, setSubjectId] = React.useState(slot?.subject?.id ?? '');
  const [staffId, setStaffId] = React.useState(slot?.staff?.id ?? '');
  const [roomId, setRoomId] = React.useState(slot?.room?.id ?? '');
  const [clearing, setClearing] = React.useState(false);

  const { data: subjects } = useSubjects();
  const { data: teachers } = useTeachers();
  const { data: rooms } = useQuery({
    queryKey: ['lookup', 'rooms'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/academics/rooms'),
    staleTime: 10 * 60_000,
  });

  const invalidates = [['timetable']];

  const clearSlot = useAction({
    mutationFn: () => api.delete(`/timetable/slots/${slot!.id}`),
    successMessage: 'Slot cleared',
    invalidates,
    onSuccess: onClose,
  });

  return (
    <>
      <FormModal
        open={!clearing}
        onOpenChange={(open) => !open && onClose()}
        title={`${humanise(day)} — ${period.name}`}
        description={`${formatClock(period.startTime)} – ${formatClock(period.endTime)}. A teacher already busy in this period is refused.`}
        submitLabel="Save slot"
        values={{ subjectId, staffId, roomId }}
        isValid={Boolean(subjectId)}
        successMessage="Timetable updated"
        invalidates={invalidates}
        submit={(values) =>
          api.post('/timetable/slots', {
            sectionId,
            periodId: period.id,
            dayOfWeek: day,
            subjectId: values.subjectId,
            ...(values.staffId ? { staffId: values.staffId } : {}),
            ...(values.roomId ? { roomId: values.roomId } : {}),
          })
        }
      >
        {(errors) => (
          <>
            <Field label="Subject" required error={errors.subjectId}>
              <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} autoFocus>
                <option value="">Choose a subject</option>
                {(subjects ?? []).map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            </Field>

            <FieldRow>
              <Field label="Teacher" error={errors.staffId}>
                <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {(teachers ?? []).map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.fullName ?? `${teacher.firstName} ${teacher.lastName ?? ''}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Room" error={errors.roomId}>
                <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {(rooms ?? []).map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>

            {slot ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={<Trash2 />}
                onClick={() => setClearing(true)}
              >
                Clear this slot
              </Button>
            ) : null}
          </>
        )}
      </FormModal>

      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title="Clear this slot?"
        description={`${humanise(day)} ${period.name} will be left free.`}
        confirmLabel="Clear"
        destructive
        loading={clearSlot.isPending}
        onConfirm={() => clearSlot.mutate()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

function PeriodsDialog({ periods, onClose }: { periods: Period[]; onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [sequence, setSequence] = React.useState(String(periods.length + 1));
  const [startTime, setStartTime] = React.useState('');
  const [endTime, setEndTime] = React.useState('');
  const [type, setType] = React.useState('CLASS');
  const [deleting, setDeleting] = React.useState<Period | null>(null);

  const invalidates = [['timetable']];

  const removePeriod = useAction({
    mutationFn: (period: Period) => api.delete(`/timetable/periods/${period.id}`),
    successMessage: 'Period removed',
    invalidates,
    onSuccess: () => setDeleting(null),
  });

  // A period that ends before it starts would make the grid nonsense.
  const timesOk = Boolean(startTime) && Boolean(endTime) && endTime > startTime;

  return (
    <>
      <FormModal
        open={deleting === null}
        onOpenChange={(open) => !open && onClose()}
        size="lg"
        title="Periods"
        description="The rows of the timetable grid. Breaks and lunch are periods too."
        submitLabel="Add period"
        values={{ name, sequence, startTime, endTime, type }}
        isValid={name.trim().length > 0 && timesOk}
        successMessage="Period added"
        invalidates={invalidates}
        submit={(values) =>
          api.post('/timetable/periods', {
            name: values.name.trim(),
            sequence: Number(values.sequence),
            startTime: values.startTime,
            endTime: values.endTime,
            type: values.type,
          })
        }
        onSaved={() => {
          setName('');
          setStartTime('');
          setEndTime('');
          setSequence(String(periods.length + 2));
        }}
      >
        {(errors) => (
          <>
            {periods.length > 0 ? (
              <ul className="mb-3 divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
                {periods.map((period) => (
                  <li key={period.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{period.name}</span>
                    <span className="tabular text-2xs text-[var(--color-ink-muted)]">
                      {formatClock(period.startTime)} – {formatClock(period.endTime)}
                    </span>
                    {period.type && period.type !== 'CLASS' ? (
                      <span className="text-2xs text-[var(--color-ink-faint)]">
                        {humanise(period.type)}
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      icon={<Trash2 />}
                      aria-label={`Remove ${period.name}`}
                      onClick={() => setDeleting(period)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}

            <FieldRow columns={3}>
              <Field label="Name" required error={errors.name}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Period 1"
                  autoFocus
                />
              </Field>
              <Field label="Order" required error={errors.sequence}>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={sequence}
                  onChange={(e) => setSequence(e.target.value)}
                />
              </Field>
              <Field label="Type" error={errors.type}>
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  {PERIOD_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Starts" required error={errors.startTime}>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </Field>
              <Field
                label="Ends"
                required
                error={errors.endTime}
                help={endTime && !timesOk ? 'Must be after the start' : undefined}
              >
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </Field>
            </FieldRow>
          </>
        )}
      </FormModal>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this period?"
        description={
          deleting
            ? `${deleting.name} will be removed from every section's timetable, along with the slots in it.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removePeriod.isPending}
        onConfirm={() => deleting && removePeriod.mutate(deleting)}
      />
    </>
  );
}
