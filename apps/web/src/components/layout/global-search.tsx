'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { SearchResults } from '@erp/shared-types';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/states';

/**
 * The command-palette search in the top bar.
 *
 * Opens on ⌘K / Ctrl-K, queries the server (never the client — the roll runs
 * to thousands of rows), and moves through results with the arrow keys so the
 * whole thing is usable without touching the mouse.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [highlighted, setHighlighted] = React.useState(0);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Debounce so a fast typist fires one request, not eight.
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 220);
    return () => clearTimeout(timer);
  }, [term]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        // The input mounts with the panel, so focus on the next frame.
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (event.key === 'Escape') setOpen(false);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  React.useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResults>('/search', { q: debounced, limit: 5 }),
    enabled: open && debounced.length >= 2,
    staleTime: 20_000,
  });

  const flat = React.useMemo(
    () => (data?.groups ?? []).flatMap((group) => group.hits),
    [data],
  );

  // Results shrink as the term narrows, so the stored index can point past the
  // end. Clamping here beats resetting it from an effect, which would render
  // once with the stale index before correcting itself.
  const activeIndex = flat.length === 0 ? 0 : Math.min(highlighted, flat.length - 1);

  function go(url: string) {
    setOpen(false);
    setTerm('');
    router.push(url);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (flat.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => (Math.min(index, flat.length - 1) + 1) % flat.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => (Math.min(index, flat.length - 1) - 1 + flat.length) % flat.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = flat[activeIndex];
      if (hit) go(hit.url);
    }
  }

  let runningIndex = -1;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)]',
          'bg-[var(--color-surface-sunken)] px-2.5 text-left text-sm text-[var(--color-ink-faint)]',
          'hover:bg-[var(--color-surface)] transition-colors',
          open && 'invisible',
        )}
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Search students, fees, books…</span>
        <kbd className="hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-2xs text-[var(--color-ink-muted)] sm:inline">
          Ctrl K
        </kbd>
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-0 z-50">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]">
            <div className="flex h-8 items-center gap-2 border-b border-[var(--color-border)] px-2.5">
              <Search className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
              <input
                ref={inputRef}
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value);
                  setHighlighted(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search students, fees, books…"
                aria-label="Global search"
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls="global-search-results"
                className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-ink-faint)]"
              />
              {isFetching ? <Spinner className="size-3.5 text-[var(--color-ink-faint)]" /> : null}
            </div>

            <div id="global-search-results" className="max-h-[22rem] overflow-y-auto py-1">
              {debounced.length < 2 ? (
                <p className="px-3 py-6 text-center text-xs text-[var(--color-ink-muted)]">
                  Type at least two characters
                </p>
              ) : flat.length === 0 && !isFetching ? (
                <p className="px-3 py-6 text-center text-xs text-[var(--color-ink-muted)]">
                  Nothing matched “{debounced}”
                </p>
              ) : (
                (data?.groups ?? []).map((group) => (
                  <div key={group.type} className="mb-1">
                    <p className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                      {group.label}
                      {group.more ? ' (showing top 5)' : null}
                    </p>
                    {group.hits.map((hit) => {
                      runningIndex += 1;
                      const active = runningIndex === activeIndex;
                      const index = runningIndex;

                      return (
                        <button
                          key={`${hit.type}-${hit.id}`}
                          type="button"
                          onMouseEnter={() => setHighlighted(index)}
                          onClick={() => go(hit.url)}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                            active
                              ? 'bg-[var(--color-accent-soft)]'
                              : 'hover:bg-[var(--color-surface-sunken)]',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[var(--color-ink)]">
                              {hit.title}
                            </span>
                            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                              {hit.subtitle}
                            </span>
                          </span>
                          {hit.badge ? <Badge>{hit.badge}</Badge> : null}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
