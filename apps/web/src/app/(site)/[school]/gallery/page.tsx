import type { Metadata } from 'next';
import Link from 'next/link';
import { Images } from 'lucide-react';
import { getGallery, getSchool } from '@/lib/site/api';
import { Section, SectionHeading } from '@/components/site/blocks';
import { formatDate } from '@/lib/dates';

export const metadata: Metadata = {
  title: 'Gallery',
  description: 'Photographs from events, celebrations and everyday school life.',
};

export default async function GalleryPage({ params }: PageProps<'/[school]/gallery'>) {
  const { school: slug } = await params;
  const [school, albums] = await Promise.all([getSchool(slug), getGallery(slug)]);

  if (!school) return null;

  return (
    <Section>
      <SectionHeading
        eyebrow="Photographs"
        title="Gallery"
        lead="Moments from events, celebrations and everyday life at school."
      />

      {!albums || albums.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-6 py-12 text-center">
          <Images className="mx-auto size-6 text-[var(--color-ink-faint)]" aria-hidden />
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            No photo albums have been published yet.
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((album) => (
            <li key={album.id}>
              <Link
                href={`/${slug}/gallery/${album.slug}`}
                className="group block overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] transition-colors hover:border-[var(--color-border-strong)]"
              >
                <div className="aspect-[4/3] overflow-hidden bg-[var(--color-surface-sunken)]">
                  {album.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={album.coverImageUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center">
                      <Images className="size-8 text-[var(--color-ink-faint)]" aria-hidden />
                    </span>
                  )}
                </div>

                <div className="p-4">
                  <h2 className="text-sm font-semibold">{album.title}</h2>
                  <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                    {album.eventDate ? formatDate(album.eventDate) : null}
                    {album.eventDate && album._count ? ' · ' : ''}
                    {album._count ? `${album._count.photos} photos` : null}
                  </p>
                  {album.description ? (
                    <p className="mt-1.5 line-clamp-2 text-xs text-[var(--color-ink-secondary)]">
                      {album.description}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
