import type { Metadata } from 'next';
import { Megaphone, Pin } from 'lucide-react';
import { getNotices, getSchool } from '@/lib/site/api';
import { Section, SectionHeading } from '@/components/site/blocks';
import { formatDate } from '@/lib/dates';

export const metadata: Metadata = {
  title: 'Notices',
  description: 'Announcements and circulars from the school.',
};

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: 'border-[var(--color-danger-border)] bg-[var(--color-danger-soft)]',
  IMPORTANT: 'border-[var(--color-warning-border)] bg-[var(--color-warning-soft)]',
};

export default async function NoticesPage({ params }: PageProps<'/[school]/notices'>) {
  const { school: slug } = await params;
  const [school, notices] = await Promise.all([getSchool(slug), getNotices(slug, 50)]);

  if (!school) return null;

  return (
    <Section>
      <SectionHeading
        eyebrow="Announcements"
        title="Notices"
        lead="Circulars and announcements for parents and students, newest first."
      />

      {!notices || notices.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-6 py-12 text-center">
          <Megaphone className="mx-auto size-6 text-[var(--color-ink-faint)]" aria-hidden />
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            There are no notices at the moment.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {notices.map((notice) => (
            <li
              key={notice.id}
              className={`rounded-[var(--radius-md)] border p-5 ${
                PRIORITY_STYLES[notice.priority] ?? 'border-[var(--color-border)]'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {notice.isPinned ? (
                  <Pin
                    className="size-3.5 shrink-0"
                    style={{ color: 'var(--site-accent)' }}
                    aria-label="Pinned"
                  />
                ) : null}
                <h2 className="min-w-0 flex-1 text-base font-semibold">{notice.title}</h2>
                <time
                  className="shrink-0 text-xs text-[var(--color-ink-muted)]"
                  dateTime={notice.publishAt ?? undefined}
                >
                  {formatDate(notice.publishAt)}
                </time>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-secondary)]">
                {notice.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
