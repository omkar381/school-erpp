import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <FileQuestion className="size-8 text-[var(--color-ink-faint)]" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-muted)]">
        The page you were looking for does not exist, or you no longer have access to it.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
