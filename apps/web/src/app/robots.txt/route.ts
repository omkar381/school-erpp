const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * Robots policy for the whole deployment.
 *
 * Public school sites are meant to be indexed; everything behind the sign-in —
 * the portal, the API and the auth screens — is explicitly disallowed so a
 * crawler never wanders into a page it will only be bounced from.
 */
export function GET() {
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    '# The administrative portal is private',
    'Disallow: /login',
    'Disallow: /dashboard',
    'Disallow: /students',
    'Disallow: /guardians',
    'Disallow: /staff',
    'Disallow: /attendance',
    'Disallow: /timetable',
    'Disallow: /homework',
    'Disallow: /exams',
    'Disallow: /academics',
    'Disallow: /fees',
    'Disallow: /transport',
    'Disallow: /library',
    'Disallow: /inventory',
    'Disallow: /leave',
    'Disallow: /notices',
    'Disallow: /messages',
    'Disallow: /events',
    'Disallow: /reports',
    'Disallow: /audit',
    'Disallow: /settings',
    'Disallow: /support',
    'Disallow: /profile',
    'Disallow: /notifications',
    '',
    `Sitemap: ${ORIGIN}/sitemap.xml`,
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
