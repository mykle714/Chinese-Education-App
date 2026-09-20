import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useArrowPagedIndex — a wrapping index paged with the LEFT/RIGHT arrow keys, where a single
 * press steps once and HOLDING a key steps rapidly.
 *
 * LAYER: view plumbing (a hook over `window` key events; owns no domain meaning).
 *
 * WHY A TIMER RATHER THAN NATIVE KEY REPEAT. The OS auto-repeat rate is a per-machine
 * accessibility setting, so leaning on it makes "hold to page rapidly" mean something
 * different on every author's machine. Both editors that use this also deliberately DROP
 * `e.repeat` events in their hotkey handlers (a held letter key must not re-fire a tool), so
 * there is no native repeat to lean on in the first place. This hook owns the cadence.
 *
 * Callers: the Furniture tool in the night market template editor
 * (`src/features/nightmarket/TemplateEditorPage.tsx`) and in the Immersive World scene editor
 * (`src/features/immersiveworld/useIWEditorTools.ts`) — one catalogue, paged the same way in
 * both, which is the point of the extraction.
 */

/** Wait before a held key starts repeating — long enough that a normal tap steps exactly once. */
export const ARROW_PAGE_DELAY_MS = 300;
/** Step interval while a key is held. ~14 steps/second: fast to scan, slow enough to stop on one. */
export const ARROW_PAGE_INTERVAL_MS = 70;

export interface ArrowPagedIndex {
  /** The current index, always in `[0, length)` (0 when `length` is 0). */
  index: number;
  /** Jump straight to an index — for callers with their own reasons to move (a sibling swap). */
  setIndex: (next: number) => void;
}

/**
 * @param length     Size of the catalogue being paged. The index WRAPS in both directions.
 * @param enabled    Bind the arrow keys. False (a different tool is active) unbinds them and
 *                   cancels any repeat in flight, so the arrows stay free for everything else.
 * @param suppressed Momentary "not right now" — a modal is open, or focus is in a text field.
 *                   Kept separate from `enabled` because it changes often and must not tear
 *                   down the listeners; it is read through a ref inside the handler.
 */
export function useArrowPagedIndex(
  length: number,
  enabled: boolean,
  suppressed = false,
): ArrowPagedIndex {
  const [index, setIndexState] = useState(0);

  // Read inside the key handler so a changing modal/focus state does not re-bind listeners
  // (and cannot strand a repeat that is already running).
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;
  const lengthRef = useRef(length);
  lengthRef.current = length;

  // One timer chain per hold: a delay timeout that hands off to a repeat interval. Held in a
  // ref (not state) because nothing renders from it and every tick must see the same handle.
  const repeatRef = useRef<{ timeout?: number; interval?: number; key?: string }>({});

  const setIndex = useCallback((next: number) => {
    const len = lengthRef.current;
    setIndexState(len > 0 ? ((next % len) + len) % len : 0);
  }, []);

  useEffect(() => {
    const timers = repeatRef.current;
    const stopRepeat = () => {
      if (timers.timeout !== undefined) window.clearTimeout(timers.timeout);
      if (timers.interval !== undefined) window.clearInterval(timers.interval);
      timers.timeout = undefined;
      timers.interval = undefined;
      timers.key = undefined;
    };
    if (!enabled || length === 0) return stopRepeat;

    // `+ length` keeps the modulo positive, so paging left off the first entry lands on the
    // last: the catalogue is a ring in both directions.
    const step = (delta: number) => setIndexState((i) => (i + delta + length) % length);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return; // native auto-repeat is ignored — this handler owns the cadence
      if (suppressedRef.current) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); // arrows would otherwise scroll the page / walk a focused control

      const delta = e.key === 'ArrowRight' ? 1 : -1;
      stopRepeat(); // a second arrow pressed mid-hold takes over cleanly
      timers.key = e.key;
      step(delta); // a single press is exactly one step
      timers.timeout = window.setTimeout(() => {
        timers.interval = window.setInterval(() => step(delta), ARROW_PAGE_INTERVAL_MS);
      }, ARROW_PAGE_DELAY_MS);
    };
    // Only the key that STARTED the repeat may stop it, so tapping the other arrow mid-hold
    // and releasing it does not cancel the hold that is still down.
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === timers.key) stopRepeat(); };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // A keyup never arrives if focus leaves mid-hold (alt-tab, devtools), which would page the
    // catalogue forever — stop on blur too. Same for unbinding and unmount, below.
    window.addEventListener('blur', stopRepeat);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stopRepeat);
      stopRepeat();
    };
  }, [enabled, length]);

  // A shrinking catalogue must not leave the index past its end (defensive: the packs are
  // static today, so this only ever fires if a pack becomes dynamic).
  const safeIndex = length > 0 ? index % length : 0;
  return { index: safeIndex, setIndex };
}
