'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { WEEKDAYS, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useClasses, useSections } from '@/hooks/use-lookups';
import { cn } from '@/lib/utils';
import { formatClock } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface Slot {
  id: string;
  dayOfWeek: string;
  period: { id: string; name: string; startTime: string; endTime: string; type?: string } | null;
  subject: { id: string; name: string; colorHex: string | null } | null;
  staff: { id: string; firstName: string; lastName: string | null } | null;
  room: { id: string; name: string } | null;
}

interface SectionTimetable {
  section?: { name: string; class?: { name: string } | null } | null;
  periods?: Array<{ id: string; name: string; startTime: string; endTime: string; type?: string }>;
  slots: Slot[];
}

/** Saturday is a working day in most Indian schools; Sunday is not shown. */
const DAYS = WEEKDAYS.filter((day) => day !== 'SUNDAY');

export default function TimetablePage() {
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');

  const { data: classes } = useClasses();
  const { data: sections } = useSections(classId || undefined);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['timetable', 'section', sectionId],
    queryFn: () => api.get<SectionTimetable>(`/timetable/sections/${sectionId}`),
    enabled: Boolean(sectionId),
  });

  // The period list defines the rows; fall back to whatever the slots mention
  // so the grid still renders if the API omits it.
  const periods = React.useMemo(() => {
    if (data?.periods?.length) return data.periods;

    const seen = new Map<
      string,
      { id: string; name: string; startTime: string; endTime: string; type?: string }
    >();
    for (const slot of data?.slots ?? []) {
      if (slot.period && !seen.has(slot.period.id)) seen.set(slot.period.id, slot.period);
    }
    return [...seen.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [data]);

  const byCell = React.useMemo(() => {
    const map = new Map<string, Slot>();
    for (const slot of data?.slots ?? []) {
      if (slot.period) map.set(`${slot.dayOfWeek}:${slot.period.id}`, slot);
    }
    return map;
  }, [data]);

  return (
    <>
      <PageHeader
        title="Timetable"
        description="The weekly schedule for a section, period by period."
      />

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
            <span className="text-xs font-medium text-[var(--color-ink-secondary)]">Section</span>
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
          title="No timetable set for this section"
          description="Periods and slots are configured under Settings."
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
                    <tr key={period.id} className={isBreak ? 'bg-[var(--color-surface-sunken)]' : undefined}>
                      <th
                        scope="row"
                        className="px-3 py-2 text-left align-top font-normal"
                      >
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

                        return (
                          <td key={day} className="px-1.5 py-1.5 align-top">
                            {slot?.subject ? (
                              <div
                                className={cn(
                                  'rounded-[var(--radius-xs)] border-l-2 bg-[var(--color-surface-sunken)] px-2 py-1.5',
                                )}
                                style={{
                                  borderLeftColor:
                                    slot.subject.colorHex ?? 'var(--color-accent)',
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
                                —
                              </span>
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
    </>
  );
}
