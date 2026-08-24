'use client';

import * as React from 'react';

/** Fired when this tab writes, so every hook on the same key re-reads. */
const CHANNEL = 'erp:persistent-state';

function emit(key: string) {
  window.dispatchEvent(new CustomEvent(CHANNEL, { detail: key }));
}

/**
 * State backed by localStorage.
 *
 * Built on `useSyncExternalStore` rather than a read-in-`useEffect`, which
 * would set state during the first commit and trigger a second render pass on
 * every mount. The server snapshot is the fallback, so hydration matches and
 * React swaps in the stored value on the first client render.
 *
 * It also listens for `storage`, so changing the theme in one tab updates the
 * others rather than leaving them stale.
 */
export function usePersistentState<T extends string>(
  key: string,
  fallback: T,
  isValid?: (value: string) => value is T,
): [T, (value: T) => void] {
  const subscribe = React.useCallback((onChange: () => void) => {
    function handleLocal(event: Event) {
      if ((event as CustomEvent<string>).detail === key) onChange();
    }
    function handleStorage(event: StorageEvent) {
      if (event.key === key) onChange();
    }

    window.addEventListener(CHANNEL, handleLocal);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(CHANNEL, handleLocal);
      window.removeEventListener('storage', handleStorage);
    };
  }, [key]);

  const getSnapshot = React.useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return fallback;
      if (isValid && !isValid(stored)) return fallback;
      return stored as T;
    } catch {
      // Private browsing and blocked storage both throw here.
      return fallback;
    }
  }, [key, fallback, isValid]);

  const getServerSnapshot = React.useCallback(() => fallback, [fallback]);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = React.useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Nothing to do — the value still applies for this session.
      }
      emit(key);
    },
    [key],
  );

  return [value, setValue];
}

/**
 * Tracks a CSS media query.
 *
 * `useSyncExternalStore` rather than an effect, so the value is correct on the
 * first client render instead of arriving one render late.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
