'use client';

import * as React from 'react';
import { useMediaQuery, usePersistentState } from '@/hooks/use-persistent-state';

type Theme = 'light' | 'dark';

const ThemeContext = React.createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'light',
  toggle: () => undefined,
});

export function useTheme() {
  return React.useContext(ThemeContext);
}

function isTheme(value: string): value is Theme {
  return value === 'light' || value === 'dark';
}

/**
 * Whether a preference has ever been saved.
 *
 * Read through the store so it re-evaluates when the toggle writes, rather
 * than being sampled once during render.
 */
function useStoredFlag(key: string): boolean {
  const [value] = usePersistentState(key, '');
  return value !== '';
}

/**
 * Keeps the theme class on <html> in step with the stored preference.
 *
 * The first paint is handled by a blocking inline script in the document head
 * (see `layout.tsx`), so nobody sees a white flash before dark mode applies.
 * This provider only owns changes made after that.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = usePersistentState<Theme>('erp.theme', 'light', isTheme);

  // With nothing stored, follow the operating system rather than forcing light.
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const hasStored = useStoredFlag('erp.theme');

  const theme: Theme = hasStored ? stored : systemDark ? 'dark' : 'light';

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const toggle = React.useCallback(
    () => setStored(theme === 'dark' ? 'light' : 'dark'),
    [theme, setStored],
  );

  const value = React.useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
