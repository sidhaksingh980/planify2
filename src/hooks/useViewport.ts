import { useEffect, useRef, useState } from 'react';
import { LOCAL_TZ } from '../lib/dates';

export type Breakpoint = 'mobile' | 'tablet' | 'laptop' | 'desktop';

export interface Viewport {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** True when the pointer is coarse (touch) regardless of width. */
  isTouch: boolean;
  /** Short viewport: iPhone landscape, small Android windows. */
  isShort: boolean;
  safeTop: number;
  safeBottom: number;
}

const MOBILE_MAX = 767;
const TABLET_MAX = 1023;
const LAPTOP_MAX = 1439;

function readSafeArea(): { top: number; bottom: number } {
  if (typeof getComputedStyle === 'undefined') return { top: 0, bottom: 0 };
  const probe = document.documentElement;
  const cs = getComputedStyle(probe);
  const parse = (v: string) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    top: parse(cs.getPropertyValue('--sat') || '0px'),
    bottom: parse(cs.getPropertyValue('--sab') || '0px'),
  };
}

function compute(): Viewport {
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const height = typeof window === 'undefined' ? 800 : window.innerHeight;
  const breakpoint: Breakpoint =
    width <= MOBILE_MAX ? 'mobile' : width <= TABLET_MAX ? 'tablet' : width <= LAPTOP_MAX ? 'laptop' : 'desktop';
  const { top, bottom } = readSafeArea();
  return {
    width,
    height,
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'laptop' || breakpoint === 'desktop',
    isTouch:
      typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0),
    isShort: height < 560,
    safeTop: top,
    safeBottom: bottom,
  };
}

/**
 * Viewport metrics, updated on resize/orientation change.
 *
 * Uses `matchMedia` for the breakpoint decision so a resize that does not cross
 * a breakpoint does not re-render the whole tree, and rAF-throttles the raw
 * size updates that the time-grid layout needs.
 */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(compute);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVp(compute());
      });
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    const mq = window.matchMedia('(pointer: coarse)');
    mq.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      mq.removeEventListener?.('change', update);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return vp;
}

/** True when the browser tab is visible — used to re-sync on return. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** The user's IANA timezone, kept reactive to system changes. */
export function useTimezone(): string {
  const [tz, setTz] = useState<string>(LOCAL_TZ);
  useEffect(() => {
    const id = setInterval(() => {
      const current = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTz((prev) => (prev === current ? prev : current));
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return tz;
}

/** Ticking clock, aligned to the minute boundary so labels stay correct. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return now;
}

/** Debounced value, for search-as-you-type. */
export function useDebounced<T>(value: T, ms = 220): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Lock body scroll while a sheet/modal is open, restoring the prior offset. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    return () => {
      document.body.style.overflow = prev;
      document.body.style.paddingRight = prevPad;
    };
  }, [active]);
}

/**
 * Focus trap + Escape handling for dialogs and sheets.
 * Returns a ref to attach to the dialog container.
 */
export function useDialogBehaviour(
  open: boolean,
  onClose: () => void,
): React.RefObject<HTMLDivElement | null> {
  const ref = useCallbackRef<HTMLDivElement>();

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog: first autofocusable element.
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const initial = node?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
    // A tick lets the enter animation start before focus moves.
    const t = setTimeout(() => initial?.focus({ preventScroll: true }), 40);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !node?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, ref]);

  return ref;
}

function useCallbackRef<T>() {
  const ref = useRef<T | null>(null);
  return ref as React.RefObject<T | null>;
}
