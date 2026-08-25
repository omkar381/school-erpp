import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { getFaculty, getSchool } from '@/lib/site/api';
import { Section, SectionHeading } from '@/components/site/blocks';
import { initials } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Faculty',
  description: 'The teachers who make up our academic team.',
};

export default async function FacultyPage({ params }: PageProps<'/[school]/faculty'>) {
  const { school: slug } = await params;
  const [school, faculty] = await Promise.all([getSchool(slug), getFaculty(slug)]);

  if (!school) return null;

  // Grouped by department so a visitor can find the subject they care about
  // rather than scanning one long alphabetical list.
  const byDepartment = new Map<string, NonNullable<typeof faculty>>();
  for (const member of faculty ?? []) {
    const key = member.department ?? 'Faculty';
    byDepartment.set(key, [...(byDepartment.get(key) ?? []), member]);
  }
  const departments = [...byDepartment.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <Section>
      <SectionHeading
        eyebrow="Our people"
        title="Faculty"
        lead={
          faculty && faculty.length > 0
            ? `${faculty.length} teachers across ${departments.length} departments.`
            : undefined
        }
      />

      {!faculty || faculty.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-6 py-12 text-center">
          <Users className="mx-auto size-6 text-[var(--color-ink-faint)]" aria-hidden />
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            Faculty details are not published yet.
          </p>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {departments.map(([department, members]) => (
            <div key={department}>
              <h2 className="mb-4 border-b border-[var(--color-border)] pb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                {department}
              </h2>

              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {members.map((member) => (
                  <li
                    key={member.id}
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 text-center"
                  >
                    <span
                      className="mx-auto flex size-16 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-lg font-semibold text-[var(--color-ink-secondary)]"
                      aria-hidden
                    >
                      {member.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={member.photoUrl} alt="" className="size-16 object-cover" />
                      ) : (
                        initials(member.name)
                      )}
                    </span>

                    <h3 className="mt-3 text-sm font-semibold">{member.name}</h3>
                    {member.designation ? (
                      <p className="mt-0.5 text-xs" style={{ color: 'var(--site-accent)' }}>
                        {member.designation}
                      </p>
                    ) : null}
                    {member.qualification ? (
                      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                        {member.qualification}
                      </p>
                    ) : null}
                    {member.yearsOfService >= 1 ? (
                      <p className="mt-1.5 text-2xs text-[var(--color-ink-faint)]">
                        {member.yearsOfService} year
                        {member.yearsOfService === 1 ? '' : 's'} with us
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
