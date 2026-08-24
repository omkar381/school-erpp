'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen, School } from 'lucide-react';
import { NAVIGATION, type NavItem } from '@/lib/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Core modules are always on, mirroring the server's rule. */
const CORE_MODULES = new Set([
  'core',
  'students',
  'staff',
  'attendance',
  'communication',
  'documents',
]);

export function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
  badges,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** Called after a link is followed, so the mobile drawer can close itself. */
  onNavigate?: () => void;
  badges?: Partial<Record<NonNullable<NavItem['badgeKey']>, number>>;
}) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const school = useAuthStore((state) => state.school);

  const visibleSections = React.useMemo(() => {
    if (!user) return [];

    const modules = (school?.enabledModules ?? {}) as Record<string, boolean>;

    const allowed = (item: NavItem) => {
      if (item.module && !CORE_MODULES.has(item.module) && modules[item.module] !== true) {
        return false;
      }
      if (!item.permissions || user.isSuperAdmin) return true;
      return item.permissions.some((permission) => user.permissions.includes(permission));
    };

    return NAVIGATION.map((section) => ({
      ...section,
      items: section.items.filter(allowed),
    })).filter((section) => section.items.length > 0);
  }, [user, school]);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]',
        'transition-[width] duration-150',
        collapsed ? 'w-(--spacing-sidebar-collapsed)' : 'w-(--spacing-sidebar)',
      )}
    >
      {/* School identity */}
      <div className="flex h-(--spacing-topbar) shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <div
          className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-[var(--color-accent)] text-white"
          aria-hidden
        >
          {school?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logoUrl} alt="" className="size-6 rounded-[var(--radius-xs)]" />
          ) : (
            <School className="size-3.5" />
          )}
        </div>
        {!collapsed ? (
          <span className="truncate text-xs font-semibold" title={school?.name}>
            {school?.name ?? 'School ERP'}
          </span>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {visibleSections.map((section) => (
          <div key={section.label} className="mb-3">
            {!collapsed ? (
              <p className="px-3 pb-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                {section.label}
              </p>
            ) : (
              <div className="mx-3 mb-2 border-t border-[var(--color-border)]" aria-hidden />
            )}

            <ul className="space-y-px px-1.5">
              {section.items.map((item) => {
                // `/students` must not stay active while on `/staff`, so match
                // the segment boundary rather than a bare prefix.
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'group flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                          : 'text-[var(--color-ink-secondary)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]',
                        collapsed && 'justify-center px-0',
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {!collapsed ? (
                        <>
                          <span className="flex-1 truncate">{item.label}</span>
                          {badge && badge > 0 ? (
                            <span className="rounded-full bg-[var(--color-danger)] px-1.5 py-0.5 text-2xs font-semibold text-white tabular">
                              {badge > 99 ? '99+' : badge}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-[var(--color-border)] p-1.5">
        <Button
          variant="ghost"
          size={collapsed ? 'icon-sm' : 'sm'}
          onClick={onToggle}
          className={cn('w-full', collapsed && 'w-auto mx-auto')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        >
          {!collapsed ? <span className="flex-1 text-left">Collapse</span> : null}
        </Button>
      </div>
    </nav>
  );
}
