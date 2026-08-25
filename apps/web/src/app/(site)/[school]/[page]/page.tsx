import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPage, getSchool } from '@/lib/site/api';
import { ContentBlocks, PagePlaceholder, Section, SectionHeading } from '@/components/site/blocks';
import { formatDate } from '@/lib/dates';

/**
 * Routes that have a purpose-built page of their own.
 *
 * This catch-all sits alongside them and must not shadow them — Next resolves
 * the static segment first, but a request for one of these reaching here means
 * something is wrong, so it 404s rather than rendering a duplicate.
 */
const RESERVED = new Set([
  'admissions',
  'faculty',
  'gallery',
  'events',
  'notices',
  'contact',
]);

export async function generateMetadata({
  params,
}: PageProps<'/[school]/[page]'>): Promise<Metadata> {
  const { school: slug, page: pageSlug } = await params;
  const page = await getPage(slug, pageSlug);

  if (!page) return { title: 'Not found' };

  return {
    title: page.metaTitle ?? page.title,
    description: page.metaDescription ?? page.excerpt ?? undefined,
    openGraph: {
      title: page.metaTitle ?? page.title,
      description: page.metaDescription ?? page.excerpt ?? undefined,
      ...(page.ogImageUrl || page.coverImageUrl
        ? { images: [{ url: (page.ogImageUrl ?? page.coverImageUrl)! }] }
        : {}),
    },
  };
}

export default async function ContentPage({ params }: PageProps<'/[school]/[page]'>) {
  const { school: slug, page: pageSlug } = await params;

  if (RESERVED.has(pageSlug)) notFound();

  const [school, page] = await Promise.all([getSchool(slug), getPage(slug, pageSlug)]);

  if (!school) return null;
  if (!page) notFound();

  return (
    <>
      {page.coverImageUrl ? (
        <div className="border-b border-[var(--color-border)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={page.coverImageUrl}
            alt=""
            className="h-48 w-full object-cover sm:h-72"
          />
        </div>
      ) : null}

      <Section>
        <SectionHeading title={page.title} lead={page.excerpt ?? undefined} />

        <div className="mt-8 max-w-3xl">
          {page.content.length === 0 ? (
            <PagePlaceholder title={page.title} />
          ) : (
            <ContentBlocks blocks={page.content} />
          )}
        </div>

        {page.publishedAt ? (
          <p className="mt-10 text-xs text-[var(--color-ink-faint)]">
            Last updated {formatDate(page.updatedAt)}
          </p>
        ) : null}
      </Section>
    </>
  );
}
