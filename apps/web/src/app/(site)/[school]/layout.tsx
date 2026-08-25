import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, MapPin, Phone } from 'lucide-react';
import { formatAddress, getSchool } from '@/lib/site/api';
import { SiteNav } from '@/components/site/site-nav';

/**
 * Per-school metadata.
 *
 * Built from the school's own record, so every site in the platform gets its
 * own title, description and link preview rather than a shared placeholder.
 */
export async function generateMetadata({
  params,
}: LayoutProps<'/[school]'>): Promise<Metadata> {
  const { school: slug } = await params;
  const school = await getSchool(slug);

  if (!school) return { title: 'School' };

  const description =
    `${school.name}${school.board ? `, a ${school.board} school` : ''}` +
    `${school.city ? ` in ${school.city}` : ''}` +
    `${school.establishedYear ? `, established ${school.establishedYear}` : ''}.`;

  return {
    title: { default: school.name, template: `%s · ${school.name}` },
    description,
    // The portal is noindex; a school's public site is the opposite.
    robots: { index: true, follow: true },
    icons: school.faviconUrl ? { icon: school.faviconUrl } : undefined,
    openGraph: {
      type: 'website',
      siteName: school.name,
      title: school.name,
      description,
      ...(school.logoUrl ? { images: [{ url: school.logoUrl }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: school.name,
      description,
    },
    alternates: { canonical: `/${slug}` },
  };
}

export default async function SiteLayout({ children, params }: LayoutProps<'/[school]'>) {
  const { school: slug } = await params;
  const school = await getSchool(slug);

  if (!school) return null;

  const address = formatAddress(school);

  /**
   * Structured data so search engines describe the school correctly in
   * results rather than guessing from the page copy.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'School',
    name: school.name,
    ...(school.legalName ? { legalName: school.legalName } : {}),
    ...(school.logoUrl ? { logo: school.logoUrl } : {}),
    ...(school.website ? { url: school.website } : {}),
    email: school.email,
    telephone: school.phone,
    ...(school.establishedYear ? { foundingDate: String(school.establishedYear) } : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: [school.addressLine1, school.addressLine2].filter(Boolean).join(', '),
      addressLocality: school.city,
      addressRegion: school.state,
      postalCode: school.postalCode,
      addressCountry: school.country ?? 'IN',
    },
    ...(school.latitude && school.longitude
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: school.latitude,
            longitude: school.longitude,
          },
        }
      : {}),
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-[var(--color-surface)]"
      // The school's own colours drive the site, scoped here so the portal's
      // palette is untouched.
      style={
        {
          '--site-accent': school.primaryColor,
          '--site-accent-alt': school.secondaryColor,
        } as React.CSSProperties
      }
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <SiteNav school={school} slug={slug} />

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              {school.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={school.logoUrl} alt="" className="size-8 object-contain" />
              ) : null}
              <span className="text-sm font-semibold">{school.name}</span>
            </div>
            {school.board ? (
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                Affiliated to {school.board}
                {school.affiliationNumber ? ` · ${school.affiliationNumber}` : ''}
              </p>
            ) : null}
            {school.establishedYear ? (
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                Established {school.establishedYear}
              </p>
            ) : null}
          </div>

          <nav aria-label="Footer">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Explore
            </h2>
            <ul className="space-y-1.5 text-sm">
              {[
                ['About', 'about'],
                ['Academics', 'academics'],
                ['Admissions', 'admissions'],
                ['Faculty', 'faculty'],
              ].map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={`/${slug}/${href}`}
                    className="text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="More">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              More
            </h2>
            <ul className="space-y-1.5 text-sm">
              {[
                ['Facilities', 'facilities'],
                ['Gallery', 'gallery'],
                ['Events', 'events'],
                ['Notices', 'notices'],
                ['Contact', 'contact'],
              ].map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={`/${slug}/${href}`}
                    className="text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Reach us
            </h2>
            <address className="space-y-2 text-sm not-italic text-[var(--color-ink-secondary)]">
              {address ? (
                <p className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {address}
                </p>
              ) : null}
              <p className="flex items-center gap-1.5">
                <Phone className="size-3.5 shrink-0" aria-hidden />
                <a href={`tel:${school.phone}`} className="hover:text-[var(--color-ink)]">
                  {school.phone}
                </a>
              </p>
              <p className="flex items-center gap-1.5">
                <Mail className="size-3.5 shrink-0" aria-hidden />
                <a href={`mailto:${school.email}`} className="hover:text-[var(--color-ink)]">
                  {school.email}
                </a>
              </p>
            </address>
          </div>
        </div>

        <div className="border-t border-[var(--color-border)]">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-4 text-xs text-[var(--color-ink-muted)] sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()} {school.legalName ?? school.name}. All rights reserved.
            </p>
            <Link href="/login" className="hover:text-[var(--color-ink)]">
              Staff & parent portal →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
