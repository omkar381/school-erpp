'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarOff, Check, ClipboardCheck, Save, Users } from 'lucide-react';
import { ATTENDANCE_STATUSES, type AttendanceStatus, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useClasses, useSections } from '@/hooks/use-lookups';
import { cn, formatPercent, initials } from '@/lib/utils';
import { today } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface RegisterRow {
  student: {
    id: string;
    admissionNumber: string;
    fullName: string;
    photoUrl: string | null;
    gender: string;
  };
  rollNumber: string | null;
  attendanceId: string | null;
  status: AttendanceStatus | null;
  remarks: string | null;
  lateMinutes: number | null;
}

interface Register {
  date: string;
  sessionType: string;
  isWorkingDay: boolean;
  holidayName: string | null;
  section: {
    id: string;
    name: string;
    class: { id: string; name: string };
    classTeacher: { firstName: string; lastName: string | null } | null;
  };
  totalStudents: number;
  markedCount: number;
  isMarked: boolean;
  summary: Partial<Record<AttendanceStatus, number>>;
  rows: RegisterRow[];
}

/** Colour and shortcut for each status, used by the segmented control. */
const STATUS_STYLES: Record<AttendanceStatus, { active: string; key: string }> = {
  PRESENT: { active: 'bg-[var(--color-success)] text-white border-[var(--color-success)]', key: 'P' },
  ABSENT: { active: 'bg-[var(--color-danger)] text-white border-[var(--color-danger)]', key: 'A' },
  LATE: { active: 'bg-[var(--color-warning)] text-white border-[var(--color-warning)]', key: 'L' },
  HALF_DAY: { active: 'bg-[var(--color-warning)] text-white border-[var(--color-warning)]', key: 'H' },
  EXCUSED: { active: 'bg-[var(--color-info)] text-white border-[var(--color-info)]', key: 'E' },
};

export default function AttendancePage() {
  const params = useSearchParams();
  const canMark = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('attendance.mark'),
  );

  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState(params.get('sectionId') ?? '');
  const [date, setDate] = React.useState(today());

  /** Local edits, keyed by student. Empty until the user touches something. */
  const [draft, setDraft] = React.useState<Record<string, AttendanceStatus>>({});

  // A different section or date is a different register, so edits made against
  // the previous one must not carry over. Cleared where the change happens
  // rather than from an effect, which would run a render too late.
  function selectSection(next: string) {
    setSectionId(next);
    setDraft({});
  }

  function selectDate(next: string) {
    setDate(next);
    setDraft({});
  }

  const { data: classes } = useClasses();
  const { data: sections } = useSections(classId || undefined);

  const {
    data: register,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['attendance', 'register', sectionId, date],
    queryFn: () => api.get<Register>('/attendance/register', { sectionId, date }),
    enabled: Boolean(sectionId && date),
  });


  const save = useAction({
    mutationFn: () =>
      api.post('/attendance', {
        sectionId,
        date,
        sessionType: 'DAILY',
        source: 'MANUAL',
        records: (register?.rows ?? []).map((row) => ({
          studentId: row.student.id,
          // Anyone untouched is present — the register is faster to take when
          // you only mark the exceptions.
          status: draft[row.student.id] ?? row.status ?? 'PRESENT',
        })),
      }),
    successMessage: 'Attendance saved',
    invalidates: [['attendance'], ['dashboard']],
    onSuccess: () => setDraft({}),
  });

  function setStatus(studentId: string, status: AttendanceStatus) {
    setDraft((current) => ({ ...current, [studentId]: status }));
  }

  function markAll(status: AttendanceStatus) {
    if (!register) return;
    setDraft(Object.fromEntries(register.rows.map((row) => [row.student.id, status])));
  }

  const effective = React.useCallback(
    (row: RegisterRow): AttendanceStatus => draft[row.student.id] ?? row.status ?? 'PRESENT',
    [draft],
  );

  const counts = React.useMemo(() => {
    const tally: Partial<Record<AttendanceStatus, number>> = {};
    for (const row of register?.rows ?? []) {
      const status = effective(row);
      tally[status] = (tally[status] ?? 0) + 1;
    }
    return tally;
  }, [register, effective]);

  const dirty = Object.keys(draft).length > 0;
  const present = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
  const total = register?.rows.length ?? 0;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Take the daily register. Only the exceptions need marking — everyone else is present."
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--color-ink-secondary)]">Class</span>
            <Select
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                selectSection('');
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
            <span className="text-xs font-medium text-[var(--color-ink-secondary)]">Section</span>
            <Select
              value={sectionId}
              onChange={(event) => selectSection(event.target.value)}
              disabled={!classId}
              className="w-40"
            >
              <option value="">Select a section</option>
              {(sections ?? []).map((section) => (
                <option key={section.id} value={section.id}>
                  Section {section.name} ({section.studentCount})
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--color-ink-secondary)]">Date</span>
            <Input
              type="date"
              value={date}
              max={today()}
              onChange={(event) => selectDate(event.target.value)}
              className="w-40"
            />
          </label>
        </CardBody>
      </Card>

      {!sectionId ? (
        <EmptyState
          icon={<Users />}
          title="Choose a class and section"
          description="Pick a section above to load its register for the selected date."
        />
      ) : isLoading ? (
        <LoadingState label="Loading register" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !register ? (
        <EmptyState title="No register available" />
      ) : !register.isWorkingDay ? (
        <EmptyState
          icon={<CalendarOff />}
          title={register.holidayName ? `Holiday — ${register.holidayName}` : 'Not a working day'}
          description="Attendance is not taken on this date."
        />
      ) : (
        <Card>
          <CardHeader
            title={`${register.section.class.name} ${register.section.name}`}
            description={
              register.section.classTeacher
                ? `Class teacher: ${register.section.classTeacher.firstName} ${
                    register.section.classTeacher.lastName ?? ''
                  }`
                : undefined
            }
            actions={
              canMark ? (
                <>
                  <Button size="xs" onClick={() => markAll('PRESENT')}>
                    All present
                  </Button>
                  <Button size="xs" onClick={() => markAll('ABSENT')}>
                    All absent
                  </Button>
                </>
              ) : null
            }
          />

          <CardBody className="p-0">
            <div className="flex flex-wrap items-center gap-4 border-b border-[var(--color-border)] px-4 py-2.5">
              <span className="text-sm">
                <span className="font-semibold tabular">{present}</span>
                <span className="text-[var(--color-ink-muted)]"> / {total} present</span>
                <span className="ml-2 font-medium tabular text-[var(--color-ink-secondary)]">
                  {formatPercent(total > 0 ? (present / total) * 100 : 0)}
                </span>
              </span>

              <div className="flex flex-wrap gap-3">
                {ATTENDANCE_STATUSES.map((status) => (
                  <span key={status} className="text-2xs text-[var(--color-ink-muted)]">
                    {humanise(status)}:{' '}
                    <span className="font-semibold tabular text-[var(--color-ink)]">
                      {counts[status] ?? 0}
                    </span>
                  </span>
                ))}
              </div>

              {register.isMarked && !dirty ? (
                <span className="ml-auto inline-flex items-center gap-1 text-2xs text-[var(--color-success)]">
                  <Check className="size-3" aria-hidden />
                  Already marked
                </span>
              ) : null}
            </div>

            <ul className="divide-y divide-[var(--color-border)]">
              {register.rows.map((row) => {
                const status = effective(row);
                const changed = draft[row.student.id] !== undefined;

                return (
                  <li
                    key={row.student.id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 px-4 py-2',
                      changed && 'bg-[var(--color-accent-soft)]',
                    )}
                  >
                    <span className="w-8 shrink-0 text-xs tabular text-[var(--color-ink-muted)]">
                      {row.rollNumber ?? '—'}
                    </span>

                    <span
                      className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold"
                      aria-hidden
                    >
                      {row.student.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.student.photoUrl} alt="" className="size-7 object-cover" />
                      ) : (
                        initials(row.student.fullName)
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {row.student.fullName}
                      </span>
                      <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                        {row.student.admissionNumber}
                      </span>
                    </span>

                    <div
                      role="radiogroup"
                      aria-label={`Attendance for ${row.student.fullName}`}
                      className="flex shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border-strong)]"
                    >
                      {ATTENDANCE_STATUSES.map((option) => (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={status === option}
                          disabled={!canMark}
                          title={humanise(option)}
                          onClick={() => setStatus(row.student.id, option)}
                          className={cn(
                            'w-8 border-r border-[var(--color-border)] py-1 text-2xs font-semibold last:border-r-0',
                            'transition-colors disabled:cursor-not-allowed',
                            status === option
                              ? STATUS_STYLES[option].active
                              : 'bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]',
                          )}
                        >
                          {STATUS_STYLES[option].key}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>

          {canMark ? (
            <CardFooter className="justify-between">
              <span className="text-xs text-[var(--color-ink-muted)]">
                {dirty
                  ? `${Object.keys(draft).length} change(s) not yet saved`
                  : register.isMarked
                    ? 'Saving again will update the existing register.'
                    : 'Nobody marked yet — saving records everyone as present.'}
              </span>
              <Button
                variant="primary"
                size="sm"
                loading={save.isPending}
                onClick={() => save.mutate(undefined)}
                icon={<Save />}
              >
                {register.isMarked ? 'Update register' : 'Save register'}
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      )}

      {!sectionId ? null : (
        <p className="mt-3 flex items-center gap-1.5 text-2xs text-[var(--color-ink-faint)]">
          <ClipboardCheck className="size-3" aria-hidden />P present · A absent · L late · H half
          day · E excused
        </p>
      )}
    </>
  );
}
