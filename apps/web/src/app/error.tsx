'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Kept to the console rather than shown: a stack trace is for the
    // developer, and the user gets a sentence they can act on.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <AlertTriangle className="size-8 text-[var(--color-danger)]" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">Something went wrong</h1>
      <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-muted)]">
        The page could not be displayed. Trying again often fixes it.
      </p>
      {error.digest ? (
        <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Reference: {error.digest}</p>
      ) : null}
      <Button className="mt-5" variant="primary" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
