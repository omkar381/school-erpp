import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getAlbum, getSchool } from '@/lib/site/api';
import { Section, SectionHeading } from '@/components/site/blocks';
import { formatDate } from '@/lib/dates';

export async function generateMetadata({
  params,
}: PageProps<'/[school]/gallery/[album]'>): Promise<Metadata> {
  const { school: slug, album: albumSlug } = await params;
  const album = await getAlbum(slug, albumSlug);

  if (!album) return { title: 'Album' };

  return {
    title: album.title,
    description: album.description ?? `Photographs from ${album.title}.`,
    openGraph: {
      title: album.title,
      description: album.description ?? undefined,
      ...(album.photos?.[0] ? { images: [{ url: album.photos[0].url }] } : {}),
    },
  };
}

export default async function AlbumPage({ params }: PageProps<'/[school]/gallery/[album]'>) {
  const { school: slug, album: albumSlug } = await params;
  const [school, album] = await Promise.all([getSchool(slug), getAlbum(slug, albumSlug)]);

  if (!school) return null;
  if (!album) notFound();

  const photos = album.photos ?? [];

  return (
    <Section>
      <Link
        href={`/${slug}/gallery`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All albums
      </Link>

      <SectionHeading
        title={album.title}
        lead={album.description ?? undefined}
        eyebrow={album.eventDate ? formatDate(album.eventDate) : undefined}
      />

      {photos.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">
          This album has no photographs yet.
        </p>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo) => (
            <li key={photo.id}>
              <figure className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.caption ?? ''}
                  loading="lazy"
                  className="aspect-[4/3] w-full bg-[var(--color-surface-sunken)] object-cover"
                />
                {photo.caption ? (
                  <figcaption className="px-3 py-2 text-xs text-[var(--color-ink-secondary)]">
                    {photo.caption}
                  </figcaption>
                ) : null}
              </figure>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
