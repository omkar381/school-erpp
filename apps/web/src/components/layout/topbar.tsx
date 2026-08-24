'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronRight, LogOut, Menu, Moon, Settings, Sun, User } from 'lucide-react';
import type { NotificationItem, Paginated } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { ROUTE_LABELS } from '@/lib/navigation';
import { cn, initials } from '@/lib/utils';
import { formatAgo } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { GlobalSearch } from './global-search';
import { useTheme } from './theme-provider';

const menuPanel =
  'z-50 min-w-56 rounded-[var(--radius-md)] border border-[var(--color-border)] ' +
  'bg-[var(--color-surface)] p-1 shadow-[var(--shadow-lg)] animate-in';

const menuItem =
  'flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-sm ' +
  'text-[var(--color-ink-secondary)] outline-none ' +
  'data-[highlighted]:bg-[var(--color-surface-sunken)] data-[highlighted]:text-[var(--color-ink)] ' +
  '[&_svg]:size-3.5';

export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const { theme, toggle } = useTheme();

  const crumbs = React.useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => ({
      label:
        ROUTE_LABELS[segment] ??
        // A UUID in a breadcrumb is noise; the page heading names the record.
        (/^[0-9a-f-]{20,}$/i.test(segment)
          ? 'Details'
          : segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')),
      href: `/${segments.slice(0, index + 1).join('/')}`,
      last: index === segments.length - 1,
    }));
  }, [pathname]);

  const { data: notifications } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () =>
      api.get<Paginated<NotificationItem> & { unreadCount: number }>('/notifications', {
        limit: 8,
      }),
    // Polled rather than pushed: the socket carries live events, this is the
    // fallback that keeps the count honest if the socket drops.
    refetchInterval: 60_000,
    retry: false,
  });

  // The endpoint returns the unread tally alongside the page, so the badge
  // does not need a second request.
  const unread = notifications?.unreadCount ?? 0;

  function handleSignOut() {
    api.post('/auth/logout').catch(() => undefined);
    signOut();
    router.push('/login');
  }

  return (
    <header className="sticky top-0 z-30 flex h-(--spacing-topbar) shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 md:block">
        <ol className="flex items-center gap-1 text-xs">
          {crumbs.map((crumb) => (
            <li key={crumb.href} className="flex items-center gap-1">
              {crumb.last ? (
                <span className="font-medium text-[var(--color-ink)]">{crumb.label}</span>
              ) : (
                <>
                  <Link
                    href={crumb.href}
                    className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  >
                    {crumb.label}
                  </Link>
                  <ChevronRight
                    className="size-3 text-[var(--color-ink-faint)]"
                    aria-hidden
                  />
                </>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-1 justify-end md:flex-none md:justify-center">
        <GlobalSearch />
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <Bell />
              {unread > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[9px] font-semibold leading-[14px] text-white tabular">
                  {unread > 9 ? '9+' : unread}
                </span>
              ) : null}
            </Button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className={cn(menuPanel, 'w-80 p-0')}>
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
                <span className="text-xs font-semibold">Notifications</span>
                <Link
                  href="/notifications"
                  className="text-2xs text-[var(--color-accent)] hover:underline"
                >
                  View all
                </Link>
              </div>

              <div className="max-h-80 overflow-y-auto">
                {(notifications?.items ?? []).length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-[var(--color-ink-muted)]">
                    You are all caught up
                  </p>
                ) : (
                  (notifications?.items ?? []).map((item) => (
                    <Link
                      key={item.id}
                      href={item.actionUrl ?? '/notifications'}
                      className={cn(
                        'block border-b border-[var(--color-border)] px-3 py-2 last:border-0 hover:bg-[var(--color-surface-sunken)]',
                        !item.isRead && 'bg-[var(--color-accent-soft)]',
                      )}
                    >
                      <p className="text-xs font-medium text-[var(--color-ink)]">{item.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-2xs text-[var(--color-ink-muted)]">
                        {item.body}
                      </p>
                      <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">
                        {formatAgo(item.createdAt)}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="ml-1 flex items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1 hover:bg-[var(--color-surface-sunken)]"
              aria-label="Account menu"
            >
              <span
                className="flex size-6 items-center justify-center rounded-full bg-[var(--color-accent)] text-2xs font-semibold text-white"
                aria-hidden
              >
                {initials(user?.displayName)}
              </span>
              <span className="hidden text-xs font-medium sm:block">{user?.displayName}</span>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className={menuPanel}>
              <div className="border-b border-[var(--color-border)] px-2 py-2">
                <p className="truncate text-xs font-medium text-[var(--color-ink)]">
                  {user?.displayName}
                </p>
                <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                  {user?.email ?? user?.phone}
                </p>
              </div>

              <DropdownMenu.Item asChild className={menuItem}>
                <Link href="/profile">
                  <User />
                  Profile
                </Link>
              </DropdownMenu.Item>

              <DropdownMenu.Item asChild className={menuItem}>
                <Link href="/settings">
                  <Settings />
                  Settings
                </Link>
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border)]" />

              <DropdownMenu.Item
                onSelect={handleSignOut}
                className={cn(menuItem, 'text-[var(--color-danger)]')}
              >
                <LogOut />
                Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
