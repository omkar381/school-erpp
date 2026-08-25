import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, Globe, Mail, MapPin, Phone, User } from 'lucide-react';
import { formatAddress, getSchool } from '@/lib/site/api';
import { Section, SectionHeading } from '@/components/site/blocks';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Address, phone, email and school hours.',
};

export default async function ContactPage({ params }: PageProps<'/[school]/contact'>) {
  const { school: slug } = await params;
  const school = await getSchool(slug);

  if (!school) return null;

  const address = formatAddress(school);

  // A map link beats an embedded map: no third-party script, no consent
  // banner, and it opens in whichever app the visitor already uses.
  const mapUrl =
    school.latitude && school.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${school.latitude},${school.longitude}`
      : address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            `${school.name}, ${address}`,
          )}`
        : null;

  return (
    <Section>
      <SectionHeading
        eyebrow="Get in touch"
        title="Contact us"
        lead="We are happy to answer questions about admissions, fees or anything else."
      />

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <dl className="grid gap-6 sm:grid-cols-2">
            {address ? (
              <ContactItem icon={MapPin} label="Address">
                <address className="not-italic">{address}</address>
                {mapUrl ? (
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-block text-sm hover:underline"
                    style={{ color: 'var(--site-accent)' }}
                  >
                    Open in maps →
                  </a>
                ) : null}
              </ContactItem>
            ) : null}

            <ContactItem icon={Phone} label="Phone">
              <a href={`tel:${school.phone}`} className="hover:underline">
                {school.phone}
              </a>
              {school.alternatePhone ? (
                <>
                  <br />
                  <a href={`tel:${school.alternatePhone}`} className="hover:underline">
                    {school.alternatePhone}
                  </a>
                </>
              ) : null}
            </ContactItem>

            <ContactItem icon={Mail} label="Email">
              <a href={`mailto:${school.email}`} className="hover:underline">
                {school.email}
              </a>
            </ContactItem>

            {school.timings?.startTime && school.timings?.endTime ? (
              <ContactItem icon={Clock} label="School hours">
                {school.timings.startTime} – {school.timings.endTime}
              </ContactItem>
            ) : null}

            {school.principalName ? (
              <ContactItem icon={User} label="Principal">
                {school.principalName}
              </ContactItem>
            ) : null}

            {school.website ? (
              <ContactItem icon={Globe} label="Website">
                <a
                  href={school.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:underline"
                >
                  {school.website.replace(/^https?:\/\//, '')}
                </a>
              </ContactItem>
            ) : null}
          </dl>
        </div>

        <aside className="space-y-4">
          <div
            className="rounded-[var(--radius-md)] p-5 text-white"
            style={{ background: 'var(--site-accent)' }}
          >
            <h2 className="text-base font-semibold">Applying for admission?</h2>
            <p className="mt-1.5 text-sm opacity-90">
              Start with an enquiry and our team will call you back.
            </p>
            <Link
              href={`/${slug}/admissions#enquiry`}
              className="mt-4 inline-block rounded-[var(--radius-sm)] bg-white px-3 py-1.5 text-sm font-medium"
              style={{ color: 'var(--site-accent)' }}
            >
              Admission enquiry
            </Link>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-5">
            <h2 className="text-sm font-semibold">Already with us?</h2>
            <p className="mt-1.5 text-sm text-[var(--color-ink-secondary)]">
              Parents and staff can sign in to the portal for attendance, fees and results.
            </p>
            <Link
              href="/login"
              className="mt-3 inline-block text-sm font-medium hover:underline"
              style={{ color: 'var(--site-accent)' }}
            >
              Open the portal →
            </Link>
          </div>
        </aside>
      </div>
    </Section>
  );
}

function ContactItem({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        <Icon className="size-3.5" style={{ color: 'var(--site-accent)' }} />
        {label}
      </dt>
      <dd className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
        {children}
      </dd>
    </div>
  );
}
