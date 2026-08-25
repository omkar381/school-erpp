'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import type { PublicSchool } from '@/lib/site/api';
import { cn } from '@/lib/utils';

const LINKS = [
  ['About', 'about'],
  ['Academics', 'academics'],
  ['Admissions', 'admissions'],
  ['Faculty', 'faculty'],
  ['Facilities', 'facilities'],
  ['Gallery', 'gallery'],
  ['Events', 'events'],
  ['Contact', 'contact'],
] as const;

export function SiteNav({ school, slug }: { school: PublicSchool; slug: string }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Any navigation closes the mobile sheet; doing it here rather than in an
  // effect keeps it to the event that actually caused it.
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5">
        <Link href={`/${slug}`} onClick={close} className="flex items-center gap-2.5">
          {school.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logoUrl} alt="" className="size-8 shrink-0 object-contain" />
          ) : (
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-sm font-bold text-white"
              style={{ background: 'var(--site-accent)' }}
              aria-hidden
            >
              {school.name.charAt(0)}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight">
              {school.name}
            </span>
            {school.board ? (
              <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                {school.board}
              </span>
            ) : null}
          </span>
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {LINKS.map(([label, href]) => {
              const active = pathname === `/${slug}/${href}`;
              return (
                <li key={href}>
                  <Link
                    href={`/${slug}/${href}`}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm transition-colors',
                      active
                        ? 'font-medium text-[var(--color-ink)]'
                        : 'text-[var(--color-ink-secondary)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]',
                    )}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <Link
          href={`/${slug}/admissions#enquiry`}
          onClick={close}
          className="ml-auto hidden shrink-0 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 lg:ml-0 lg:block"
          style={{ background: 'var(--site-accent)' }}
        >
          Enquire now
        </Link>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="site-mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="ml-auto rounded-[var(--radius-sm)] p-1.5 hover:bg-[var(--color-surface-sunken)] lg:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open ? (
        <nav
          id="site-mobile-nav"
          aria-label="Primary"
          className="border-t border-[var(--color-border)] lg:hidden"
        >
          <ul className="mx-auto max-w-6xl px-3 py-2">
            {LINKS.map(([label, href]) => (
              <li key={href}>
                <Link
                  href={`/${slug}/${href}`}
                  onClick={close}
                  className="block rounded-[var(--radius-sm)] px-2 py-2 text-sm text-[var(--color-ink-secondary)] hover:bg-[var(--color-surface-sunken)]"
                >
                  {label}
                </Link>
              </li>
            ))}
            <li className="mt-2 px-2 pb-2">
              <Link
                href={`/${slug}/admissions#enquiry`}
                onClick={close}
                className="block rounded-[var(--radius-sm)] px-3 py-2 text-center text-sm font-medium text-white"
                style={{ background: 'var(--site-accent)' }}
              >
                Enquire now
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
