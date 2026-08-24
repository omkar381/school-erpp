'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ApiClientError } from '@/lib/api';
import { ThemeProvider } from '@/components/layout/theme-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Retrying a 401, 403, 404 or a validation error just repeats the
              // same answer; only transient failures are worth another attempt.
              if (error instanceof ApiClientError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        {children}
        <Toaster
          position="bottom-right"
          closeButton
          toastOptions={{
            classNames: {
              toast:
                'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-ink)] shadow-[var(--shadow-md)]',
              description: 'text-[var(--color-ink-muted)]',
            },
          }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
