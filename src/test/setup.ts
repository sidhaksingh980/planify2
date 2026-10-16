/**
 * Test environment shims.
 *
 * Only the jsdom tests need these — the pure-logic suites (dates, recurrence,
 * the NLP parser) run in a plain Node environment where `window` does not
 * exist, so everything DOM-shaped is guarded.
 *
 * IndexedDB comes from fake-indexeddb, which means the component tests exercise
 * the *real* on-device provider: the same code path a user hits.
 */
import 'fake-indexeddb/auto';

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';

if (hasDom) {
  // Theme + reduced-motion detection.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }

  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // Pointer-event based drag uses setPointerCapture, which jsdom lacks.
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
}
