'use client';

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { CurrentUser, SchoolSummary } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { LoadingState } from '@/components/ui/states';

/**
 * The authenticated shell.
 *
 * Every page under `(app)` is behind this: it will not render children until
 * the persisted session has been read back, which is the difference between
 * "signed out" and "not loaded yet" — getting that wrong bounces a signed-in
 * user to the login screen on every refresh.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const hydrated = useAuthStore((state) => state.hydrated);
  const tokens = useAuthStore((state) => state.tokens);
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const setSchool = useAuthStore((state) => state.setSchool);

  const [sidebar, setSidebar] = usePersistentState<'expanded' | 'collapsed'>(
    'erp.sidebar',
    'expanded',
    (value): value is 'expanded' | 'collapsed' =>
      value === 'expanded' || value === 'collapsed',
  );
  const collapsed = sidebar === 'collapsed';
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const toggleSidebar = React.useCallback(
    () => setSidebar(collapsed ? 'expanded' : 'collapsed'),
    [collapsed, setSidebar],
  );

  React.useEffect(() => {
    if (hydrated && !tokens) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [hydrated, tokens, router, pathname]);

  // Re-reads the principal on mount so a permission or role change made by an
  // administrator takes effect without the user signing out and back in.
  const { data: profile } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<CurrentUser>('/auth/me'),
    enabled: Boolean(tokens),
    staleTime: 5 * 60_000,
  });

  // The school is a separate resource. It carries the branding, the currency
  // and — importantly — which modules are switched on, which the sidebar needs
  // before it can decide what to show.
  const { data: school } = useQuery({
    queryKey: ['school', 'current'],
    queryFn: () => api.get<SchoolSummary>('/schools/current'),
    enabled: Boolean(tokens) && !profile?.isSuperAdmin,
    staleTime: 10 * 60_000,
  });

  React.useEffect(() => {
    if (profile) setUser(profile);
  }, [profile, setUser]);

  React.useEffect(() => {
    if (school) setSchool(school);
  }, [school, setSchool]);

  // Anyone flagged for a forced password change goes nowhere else first.
  React.useEffect(() => {
    if (user?.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [user, pathname, router]);

  if (!hydrated || !tokens) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Loading your workspace" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-canvas)]">
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-[var(--color-overlay)]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-(--spacing-sidebar) animate-in">
            <Sidebar
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-5">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
