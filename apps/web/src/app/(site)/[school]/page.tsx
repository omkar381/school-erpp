import Link from 'next/link';
import { ArrowRight, CalendarDays, GraduationCap, Megaphone, Users } from 'lucide-react';
import { getEvents, getNotices, getPage, getSchool, getStatistics } from '@/lib/site/api';
import { ContentBlocks, Section, SectionHeading } from '@/components/site/blocks';
import { formatDate, formatDateTime } from '@/lib/dates';

export default async function SchoolHomePage({ params }: PageProps<'/[school]'>) {
  const { school: slug } = await params;

  // Fetched together: one slow section should not hold up the rest of the page.
  const [school, statistics, notices, events, about] = await Promise.all([
    getSchool(slug),
    getStatistics(slug),
    getNotices(slug, 4),
    getEvents(slug),
    getPage(slug, 'about'),
  ]);

  if (!school) return null;

  const upcoming = (events ?? [])
    .filter((event) => new Date(event.endAt ?? event.startAt) >= new Date())
    .slice(0, 3);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--color-border)]">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            color: 'var(--site-accent)',
          }}
          aria-hidden
        />

        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="max-w-3xl">
            {school.board ? (
              <p
                className="mb-3 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{
                  color: 'var(--site-accent)',
                  borderColor: 'var(--site-accent)',
                }}
              >
                {school.board}
                {school.affiliationNumber ? ` · ${school.affiliationNumber}` : ''}
              </p>
            ) : null}

            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              {school.name}
            </h1>

            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-secondary)]">
              {about?.excerpt ??
                `A ${school.board ?? 'school'} in ${school.city ?? 'your neighbourhood'}` +
                  `${school.establishedYear ? `, educating since ${school.establishedYear}` : ''}.`}
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href={`/${slug}/admissions#enquiry`}
                className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--site-accent)' }}
              >
                Apply for admission
              </Link>
              <Link
                href={`/${slug}/about`}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
              >
                About the school
              </Link>
            </div>
          </div>

          {statistics ? (
            <dl className="mt-14 grid grid-cols-2 gap-6 border-t border-[var(--color-border)] pt-8 sm:grid-cols-4">
              {[
                ['Students', statistics.students.toLocaleString('en-IN')],
                ['Teachers', statistics.teachers.toLocaleString('en-IN')],
                [
                  'Student–teacher ratio',
                  statistics.studentTeacherRatio ? `1 : ${statistics.studentTeacherRatio}` : '—',
                ],
                [
                  'Established',
                  statistics.establishedYear ? String(statistics.establishedYear) : '—',
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                    {label}
                  </dt>
                  <dd
                    className="mt-1 text-2xl font-semibold tabular sm:text-3xl"
                    style={{ color: 'var(--site-accent)' }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>

      {about && about.content.length > 0 ? (
        <Section>
          <SectionHeading eyebrow="About us" title={about.title} />
          <div className="mt-6 max-w-3xl">
            <ContentBlocks blocks={about.content.slice(0, 3)} />
            <Link
              href={`/${slug}/about`}
              className="mt-5 inline-flex items-center gap-1 text-sm font-medium"
              style={{ color: 'var(--site-accent)' }}
            >
              Read more <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </Section>
      ) : null}

      {/* What the school offers */}
      <Section muted>
        <SectionHeading
          eyebrow="Why us"
          title="An education that goes beyond the syllabus"
          align="center"
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: GraduationCap,
              title: 'Academic rigour',
              body: `A ${school.board ?? 'structured'} curriculum delivered by qualified subject teachers, with continuous assessment throughout the year.`,
            },
            {
              icon: Users,
              title: 'Small classes',
              body: statistics?.studentTeacherRatio
                ? `A student–teacher ratio of 1 : ${statistics.studentTeacherRatio} means every child is known by name.`
                : 'Class sizes kept small enough that every child is known by name.',
            },
            {
              icon: CalendarDays,
              title: 'A full calendar',
              body: 'Sports, arts, competitions and field trips run alongside academics through the year.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
            >
              <item.icon
                className="size-5"
                style={{ color: 'var(--site-accent)' }}
                aria-hidden
              />
              <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Notices and events */}
      {(notices ?? []).length > 0 || upcoming.length > 0 ? (
        <Section>
          <div className="grid gap-10 lg:grid-cols-2">
            {(notices ?? []).length > 0 ? (
              <div>
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <Megaphone className="size-4" style={{ color: 'var(--site-accent)' }} aria-hidden />
                    Latest notices
                  </h2>
                  <Link
                    href={`/${slug}/notices`}
                    className="text-sm hover:underline"
                    style={{ color: 'var(--site-accent)' }}
                  >
                    All notices
                  </Link>
                </div>

                <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                  {(notices ?? []).map((notice) => (
                    <li key={notice.id} className="py-3.5">
                      <p className="text-sm font-medium">{notice.title}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-[var(--color-ink-secondary)]">
                        {notice.body}
                      </p>
                      <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
                        {formatDate(notice.publishAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {upcoming.length > 0 ? (
              <div>
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <CalendarDays
                      className="size-4"
                      style={{ color: 'var(--site-accent)' }}
                      aria-hidden
                    />
                    Upcoming events
                  </h2>
                  <Link
                    href={`/${slug}/events`}
                    className="text-sm hover:underline"
                    style={{ color: 'var(--site-accent)' }}
                  >
                    Full calendar
                  </Link>
                </div>

                <ul className="space-y-3">
                  {upcoming.map((event) => (
                    <li
                      key={event.id}
                      className="flex gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3.5"
                    >
                      <div className="w-12 shrink-0 text-center">
                        <p className="text-xs uppercase text-[var(--color-ink-muted)]">
                          {new Date(event.startAt).toLocaleString('en-IN', { month: 'short' })}
                        </p>
                        <p
                          className="text-xl font-semibold leading-tight tabular"
                          style={{ color: 'var(--site-accent)' }}
                        >
                          {new Date(event.startAt).getDate()}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{event.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                          {event.isAllDay ? 'All day' : formatDateTime(event.startAt)}
                          {event.venue ? ` · ${event.venue}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* Admissions call to action */}
      <section
        className="border-t border-[var(--color-border)]"
        style={{ background: 'var(--site-accent)' }}
      >
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-5 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl text-white">
            <h2 className="text-xl font-semibold sm:text-2xl">Admissions are open</h2>
            <p className="mt-1.5 text-sm leading-relaxed opacity-90">
              Tell us about your child and the class you are applying for. Our admissions team
              will call you back.
            </p>
          </div>
          <Link
            href={`/${slug}/admissions#enquiry`}
            className="shrink-0 rounded-[var(--radius-sm)] bg-white px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ color: 'var(--site-accent)' }}
          >
            Start an enquiry
          </Link>
        </div>
      </section>
    </>
  );
}
