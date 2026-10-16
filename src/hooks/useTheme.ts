/**
 * Theme.
 *
 * `dark` is the default. `system` follows the device appearance setting and
 * reacts live to OS-level changes. The resolved value is written to
 * `<html data-theme>` so the whole palette swaps through CSS variables, and the
 * colour transitions declared in `theme.css` animate the change.
 */
import { createContext, useContext } from 'react';
import type { ResolvedTheme, ThemeMode } from '../types';

export interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode(mode: ThemeMode): void;
  cycle(): void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  resolved: 'dark',
  setMode: () => undefined,
  cycle: () => undefined,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return prefersDark() ? 'dark' : 'light';
  return mode;
}

export function applyThemeToDocument(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  // Keep the browser chrome (iOS status bar, Android address bar) in step.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  const colour = resolved === 'dark' ? '#0A0A0C' : '#F4F4F7';
  if (meta) meta.setAttribute('content', colour);
  root.style.colorScheme = resolved;
}
