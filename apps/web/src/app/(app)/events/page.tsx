'use client';

import { CalendarDays, MapPin, Users } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDateTime } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Pagination } from '@/components/ui/data-table';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';

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
  'OTHER',
];

export default function EventsPage() {
  const list = useListQuery<EventRow>('events', '/events', {
    initialSortBy: 'startAt',
    initialSortOrder: 'asc',
  });

  return (
    <>
      <PageHeader title="Events" description="What is coming up across the school calendar." />

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
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" aria-hidden />
                          {event.registrationCount ?? 0}
                          {event.capacity ? ` / ${event.capacity}` : ''} registered
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
    </>
  );
}
