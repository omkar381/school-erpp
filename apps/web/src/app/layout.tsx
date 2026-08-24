import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { Providers } from './providers';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'School ERP Platform';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'Administration, academics, finance and operations for schools.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f17' },
  ],
};

/**
 * Applied before first paint so a dark-theme user never sees a white flash.
 * It runs ahead of React, which is the only way to get this right.
 */
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('erp.theme');
    var dark = stored ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
