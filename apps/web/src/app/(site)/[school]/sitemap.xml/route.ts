import { getSchool, getSitemap } from '@/lib/site/api';

/** Where the site is served from, used to build absolute URLs. */
const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * Per-school sitemap.
 *
 * Built from what is actually published, so an unpublished draft is never
 * advertised to a crawler.
 */
export async function GET(_request: Request, { params }: RouteContext<'/[school]/sitemap.xml'>) {
  const { school: slug } = await params;
  const school = await getSchool(slug);

  if (!school) {
    return new Response('Not found', { status: 404 });
  }

  const sitemap = await getSitemap(slug);
  const base = `${ORIGIN}/${slug}`;
  const now = new Date().toISOString();

  const entries: Array<{ loc: string; lastmod: string; priority: string }> = [
    { loc: base, lastmod: now, priority: '1.0' },
    { loc: `${base}/admissions`, lastmod: now, priority: '0.9' },
    { loc: `${base}/faculty`, lastmod: now, priority: '0.7' },
    { loc: `${base}/gallery`, lastmod: now, priority: '0.6' },
    { loc: `${base}/events`, lastmod: now, priority: '0.6' },
    { loc: `${base}/notices`, lastmod: now, priority: '0.6' },
    { loc: `${base}/contact`, lastmod: now, priority: '0.8' },
    ...(sitemap?.pages ?? []).map((page) => ({
      loc: `${base}/${page.slug}`,
      lastmod: new Date(page.updatedAt).toISOString(),
      priority: '0.7',
    })),
    ...(sitemap?.albums ?? []).map((album) => ({
      loc: `${base}/gallery/${album.slug}`,
      lastmod: new Date(album.updatedAt).toISOString(),
      priority: '0.5',
    })),
  ];

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map(
        (entry) =>
          `  <url>\n` +
          `    <loc>${escapeXml(entry.loc)}</loc>\n` +
          `    <lastmod>${entry.lastmod}</lastmod>\n` +
          `    <priority>${entry.priority}</priority>\n` +
          `  </url>`,
      )
      .join('\n') +
    '\n</urlset>';

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
