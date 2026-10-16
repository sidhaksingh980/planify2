import type { Config } from 'tailwindcss';

/**
 * Planify design tokens.
 *
 * Two palettes are declared as CSS custom properties in `src/styles/theme.css`
 * (one per `data-theme`), and Tailwind simply references them. That keeps the
 * colour system in a single source of truth and lets the dark → light switch
 * animate with one CSS transition on `:root`.
 */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        base: 'rgb(var(--c-base) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        sunken: 'rgb(var(--c-sunken) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        lineStrong: 'rgb(var(--c-line-strong) / <alpha-value>)',

        // Text — all meet WCAG AA on their intended surface (see lib/color.ts)
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        ink2: 'rgb(var(--c-ink-2) / <alpha-value>)',
        ink3: 'rgb(var(--c-ink-3) / <alpha-value>)',

        // Accent
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        accentSoft: 'rgb(var(--c-accent-soft) / <alpha-value>)',
        accentInk: 'rgb(var(--c-accent-ink) / <alpha-value>)',

        // Status
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        success: 'rgb(var(--c-success) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'Inter',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'Inter',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '0.9375rem' }],
      },
      borderRadius: {
        glass: '1.375rem',
        sheet: '1.75rem',
      },
      boxShadow: {
        glass: 'var(--shadow-glass)',
        'glass-lg': 'var(--shadow-glass-lg)',
        float: 'var(--shadow-float)',
        inset: 'var(--shadow-inset)',
        focus: '0 0 0 3px rgb(var(--c-accent) / 0.45)',
      },
      backgroundImage: {
        'glass-sheen': 'var(--glass-sheen)',
        aurora: 'var(--aurora)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.32, 0.72, 0, 1)',
        soft: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'sheet-up': {
          '0%': { transform: 'translateY(100%) scale(0.98)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
        'sheet-down': {
          '0%': { transform: 'translateY(0) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(100%) scale(0.98)', opacity: '0' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.94) translateY(8px)', opacity: '0' },
          '100%': { transform: 'scale(1) translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(24px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.55' },
          '50%': { transform: 'scale(1.08)', opacity: '0.8' },
        },
      },
      animation: {
        'sheet-up': 'sheet-up 0.42s cubic-bezier(0.32, 0.72, 0, 1)',
        'pop-in': 'pop-in 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 0.22s ease-out',
        'slide-in-right': 'slide-in-right 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
        breathe: 'breathe 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
