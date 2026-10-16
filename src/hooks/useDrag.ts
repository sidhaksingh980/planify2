/**
 * Drag-and-drop rescheduling.
 *
 * Pointer-event based rather than HTML5 drag-and-drop, because HTML5 DnD does
 * not work on touch. One implementation therefore covers trackpad, mouse and
 * finger, on iPhone, iPad and Android alike.
 *
 * Behaviour:
 *   • Time grid (day/week): pointerdown on an event → after a short hold on
 *     touch (or immediately with a mouse) the card lifts and follows the
 *     pointer vertically, snapping to 15 minutes. Horizontal movement across
 *     columns changes the day.
 *   • Month grid: dragging moves the event to the day under the pointer.
 *   • A tap (movement below the threshold, released quickly) is NOT a drag — it
 *     opens the event, which keeps normal clicking/tapping intact.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DragState {
  /** Unique occurrence id being dragged. */
  occurrenceId: string;
  seriesId: string;
  /** Pixel offset from the pointer to the card's top-left, for smooth follow. */
  offsetX: number;
  offsetY: number;
  /** Current pointer position in viewport coordinates. */
  pointerX: number;
  pointerY: number;
  /** Minutes the event has moved by (time grid). */
  deltaMinutes: number;
  /** Day key the pointer is currently over (month grid, and time-grid columns). */
  overDayKey: string | null;
  /** True once the gesture has passed the drag threshold. */
  active: boolean;
  /** True while the pointer is held but the threshold is not yet crossed. */
  pending: boolean;
}

export interface DragResult {
  occurrenceId: string;
  seriesId: string;
  deltaMinutes: number;
  overDayKey: string | null;
}

export interface UseDragOptions {
  /** Minutes of vertical travel per pixel — set by the caller from row height. */
  minutesPerPixel: number;
  /** Snap increment in minutes. */
  snapMinutes?: number;
  /** Long-press delay before a touch drag begins. */
  holdMs?: number;
  /** Movement in px before a mouse drag begins. */
  thresholdPx?: number;
  onCommit: (result: DragResult) => void;
  onCancel?: () => void;
}

const TOUCH_HOLD_MS = 170;
const THRESHOLD_PX = 5;

export function useDrag({
  minutesPerPixel,
  snapMinutes = 15,
  holdMs = TOUCH_HOLD_MS,
  thresholdPx = THRESHOLD_PX,
  onCommit,
  onCancel,
}: UseDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const stateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetY: number;
    offsetX: number;
    occurrenceId: string;
    seriesId: string;
    isTouch: boolean;
    holdTimer: number | null;
    active: boolean;
    lastDelta: number;
    lastDayKey: string | null;
  } | null>(null);

  const cleanup = useCallback(() => {
    const s = stateRef.current;
    if (s?.holdTimer) window.clearTimeout(s.holdTimer);
    stateRef.current = null;
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('-webkit-user-select');
    document.body.style.removeProperty('cursor');
  }, []);

  const begin = useCallback(
    (e: React.PointerEvent<HTMLElement>, occurrenceId: string, seriesId: string) => {
      // Only the primary button; let right-click open the context menu.
      if (e.button !== undefined && e.button !== 0) return;
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';

      const base = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        occurrenceId,
        seriesId,
        isTouch,
        holdTimer: null as number | null,
        active: false,
        lastDelta: 0,
        lastDayKey: null as string | null,
      };

      const publish = (active: boolean, pending: boolean, x = base.startX, y = base.startY) => {
        setDrag({
          occurrenceId,
          seriesId,
          offsetX: base.offsetX,
          offsetY: base.offsetY,
          pointerX: x,
          pointerY: y,
          deltaMinutes: base.lastDelta,
          overDayKey: base.lastDayKey,
          active,
          pending,
        });
      };

      if (isTouch) {
        stateRef.current = base;
        publish(false, true);
        // Long-press to drag; a quick lift stays a tap so opening events on
        // touch still works naturally.
        base.holdTimer = window.setTimeout(() => {
          const s = stateRef.current;
          if (!s) return;
          s.active = true;
          publish(true, false);
          if (navigator.vibrate) navigator.vibrate(10);
        }, holdMs);
        return;
      }

      base.active = false;
      stateRef.current = base;
      publish(false, true);
    },
    [holdMs],
  );

  useEffect(() => {
    if (!drag) return;

    const move = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;

      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;

      if (!s.active) {
        if (s.isTouch) {
          // Any real movement cancels the pending long-press → it becomes a tap.
          if (Math.hypot(dx, dy) > 10) {
            if (s.holdTimer) window.clearTimeout(s.holdTimer);
            s.holdTimer = null;
            stateRef.current = null;
            setDrag(null);
          }
          return;
        }
        if (Math.hypot(dx, dy) < thresholdPx) return;
        s.active = true;
        document.body.style.userSelect = 'none';
        document.body.style.setProperty('-webkit-user-select', 'none');
        document.body.style.cursor = 'grabbing';
      }

      e.preventDefault();

      // Which day column is under the pointer? Elements opt in with
      // data-daykey, so this works for both month and time grids.
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const cell = under?.closest?.('[data-daykey]') as HTMLElement | null;
      s.lastDayKey = cell?.dataset.daykey ?? s.lastDayKey;

      const rawMinutes = dy * minutesPerPixel;
      const snapped = Math.round(rawMinutes / snapMinutes) * snapMinutes;
      s.lastDelta = snapped;

      setDrag((prev) =>
        prev
          ? {
              ...prev,
              pointerX: e.clientX,
              pointerY: e.clientY,
              deltaMinutes: snapped,
              overDayKey: s.lastDayKey,
              active: true,
              pending: false,
            }
          : prev,
      );
    };

    const up = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const wasActive = s.active;
      if (s.holdTimer) window.clearTimeout(s.holdTimer);

      if (wasActive) {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const cell = under?.closest?.('[data-daykey]') as HTMLElement | null;
        onCommit({
          occurrenceId: s.occurrenceId,
          seriesId: s.seriesId,
          deltaMinutes: s.lastDelta,
          overDayKey: cell?.dataset.daykey ?? s.lastDayKey,
        });
      } else {
        onCancel?.();
      }
      cleanup();
      setDrag(null);
    };

    const cancel = () => {
      onCancel?.();
      cleanup();
      setDrag(null);
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [drag, minutesPerPixel, snapMinutes, thresholdPx, onCommit, onCancel, cleanup]);

  return { drag, beginDrag: begin };
}

/**
 * Attach a `data-daykey` to a droppable region. Kept as a helper so the
 * convention is defined in exactly one place.
 */
export function droppable(dayKey: string) {
  return { 'data-daykey': dayKey } as const;
}
