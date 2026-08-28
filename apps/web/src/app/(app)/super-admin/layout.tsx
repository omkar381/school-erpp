'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { EmptyState, LoadingState } from '@/components/ui/states';

/**
 * Platform administration.
 *
 * This only decides what to render — every `/platform/*` endpoint behind these
 * screens checks the super admin role and a `platform.*` permission on the
 * server, so hiding the pages is a courtesy, not the control.
 */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const user = useAuthStore((state) => state.user);

  const allowed = Boolean(user?.isSuperAdmin);

  React.useEffect(() => {
    if (hydrated && user && !allowed) {
      const timer = setTimeout(() => router.replace('/dashboard'), 2500);
      return () => clearTimeout(timer);
    }
  }, [hydrated, user, allowed, router]);

  if (!hydrated || !user) return <LoadingState label="Checking your access" />;

  if (!allowed) {
    return (
      <EmptyState
        icon={<ShieldAlert className="text-[var(--color-warning)]" />}
        title="Platform administration is restricted"
        description="Only platform administrators can open these pages. Taking you back to your dashboard."
      />
    );
  }

  return <>{children}</>;
}
