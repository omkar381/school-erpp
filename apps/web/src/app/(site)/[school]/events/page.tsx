import type { Metadata } from 'next';
import { CalendarDays, MapPin } from 'lucide-react';
import { getEvents, getSchool } from '@/lib/site/api';
import { Section, SectionHeading } from '@/components/site/blocks';
import { formatDateTime } from '@/lib/dates';
import { humanise } from '@erp/shared-types';

export const metadata: Metadata = {
  title: 'Events',
  description: 'Annual day, sports day, competitions and everything else on the calendar.',
};

export default async function EventsPage({ params }: PageProps<'/[school]/events'>) {
  const { school: slug } = await params;
  const [school, events] = await Promise.all([getSchool(slug), getEvents(slug)]);

  if (!school) return null;

  const now = new Date();
  const all = events ?? [];
  const upcoming = all.filter((event) => new Date(event.endAt ?? event.startAt) >= now);
  const past = all
    .filter((event) => new Date(event.endAt ?? event.startAt) < now)
    .slice(0, 12);

  return (
    <Section>
      <SectionHeading
        eyebrow="Calendar"
        title="Events"
        lead="What is happening at school through the year."
      />

      {all.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-6 py-12 text-center">
          <CalendarDays className="mx-auto size-6 text-[var(--color-ink-faint)]" aria-hidden />
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            No events have been published yet.
          </p>
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          {upcoming.length > 0 ? (
            <div>
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                Coming up
              </h2>
              <ul className="space-y-3">
                {upcoming.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            </div>
          ) : null}

          {past.length > 0 ? (
            <div>
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                Recently held
              </h2>
              <ul className="space-y-3 opacity-70">
                {past.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

function EventRow({
  event,
}: {
  event: {
    id: string;
    title: string;
    description: string | null;
    type: string;
    startAt: string;
    endAt: string | null;
    isAllDay: boolean;
    venue: string | null;
  };
}) {
  const start = new Date(event.startAt);

  return (
    <li className="flex gap-5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-5">
      <div className="w-14 shrink-0 text-center">
        <p className="text-xs uppercase text-[var(--color-ink-muted)]">
          {start.toLocaleString('en-IN', { month: 'short' })}
        </p>
        <p
          className="text-2xl font-semibold leading-tight tabular"
          style={{ color: 'var(--site-accent)' }}
        >
          {start.getDate()}
        </p>
        <p className="text-2xs text-[var(--color-ink-faint)]">{start.getFullYear()}</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 text-base font-semibold">{event.title}</h3>
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-2xs"
            style={{ color: 'var(--site-accent)', borderColor: 'var(--site-accent)' }}
          >
            {humanise(event.type)}
          </span>
        </div>

        {event.description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
            {event.description}
          </p>
        ) : null}

        <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-muted)]">
          <span>{event.isAllDay ? 'All day' : formatDateTime(event.startAt)}</span>
          {event.venue ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {event.venue}
            </span>
          ) : null}
        </p>
      </div>
    </li>
  );
}
