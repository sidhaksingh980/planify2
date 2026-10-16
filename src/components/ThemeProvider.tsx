/**
 * ThemeProvider — owns the theme mode, resolves `system` against the device
 * appearance setting, and writes the result to `<html data-theme>`.
 *
 * The resolved value is persisted alongside the user's other settings so a
 * reload never flashes the wrong palette (the inline script in index.html
 * applies it before first paint).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyThemeToDocument, prefersDark, resolveTheme, ThemeContext } from '../hooks/useTheme';
import type { ResolvedTheme, ThemeMode } from '../types';

export interface ThemeProviderProps {
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
  children: ReactNode;
}

export function ThemeProvider({ mode, onModeChange, children }: ThemeProviderProps) {
  const [systemDark, setSystemDark] = useState<boolean>(() => prefersDark());

  // Follow the OS live, so flipping appearance in System Settings updates
  // Planify immediately when mode === 'system'.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const resolved: ResolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    applyThemeToDocument(resolved);
  }, [resolved]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      onModeChange(next);
      applyThemeToDocument(resolveTheme(next));
    },
    [onModeChange],
  );

  const cycle = useCallback(() => {
    const order: ThemeMode[] = ['dark', 'light', 'system'];
    setMode(order[(order.indexOf(mode) + 1) % order.length]);
  }, [mode, setMode]);

  const value = useMemo(() => ({ mode, resolved, setMode, cycle }), [mode, resolved, setMode, cycle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
