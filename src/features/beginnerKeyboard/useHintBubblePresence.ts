/**
 * Mount/unmount choreography for the § 6z-4 hint bubbles: a delayed, staggered
 * grow-in, and a pop that keeps a bubble mounted until its animation finishes.
 *
 * LAYER: client feature hook. Pure presence bookkeeping — it knows nothing about
 * hints or chips beyond a stable key and a payload, and it does not animate; it
 * only tells each bubble which phase it is in and how long to wait before growing.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-4 ("Motion").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ENTRANCE DELAY NEEDS NO TIMER
 *
 * An entering bubble is mounted at once, with `animation-fill-mode: both` and an
 * `animation-delay`. During the delay it is held at the keyframe's first frame —
 * scale 0 — which has no area and so cannot be tapped. That makes the delay pure
 * CSS: nothing to cancel if the bubble is wanted gone before it ever appeared.
 *
 * The EXIT does need a timer. A popping bubble is no longer "desired", so without
 * this hook React would unmount it on the spot and the pop would never play.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DELAY IS FROZEN AT ENTRY
 *
 * Each entry's `delayMs` is computed once, when it enters, and never recomputed.
 * Changing a running element's `animation` value restarts the animation, so a
 * delay that was re-derived on every render (stagger rank shifts as bubbles come
 * and go) would make bubbles flicker back to scale 0 mid-grow.
 */
import { useEffect, useRef, useState } from 'react';

export interface PresenceItem<T> {
  key: string;
  /** Left-to-right position, used only to rank a batch for the stagger. */
  order: number;
  value: T;
}

export interface RenderedItem<T> extends PresenceItem<T> {
  phase: 'in' | 'out';
  /** Wait before growing in; fixed at entry (see header). */
  delayMs: number;
  /** Bumped on every exit, so a stale removal timer cannot remove a revived item. */
  exitId: number;
  /** `performance.now()` at which the grow-in begins — before it, the bubble is unseen. */
  visibleAt: number;
}

export interface PresenceTiming {
  /** Pause before the first bubble of a batch grows in. */
  enterDelayMs: number;
  /** Extra pause per bubble after the first, left to right. */
  staggerMs: number;
  /** How long the pop plays before the bubble is unmounted. */
  exitMs: number;
}

/**
 * One reconcile step, as a pure function (the hook's effect is a thin shell
 * around it, so the rules are testable without a DOM).
 *
 * - still wanted, showing   → keep; refresh payload/anchor, no restart
 * - still wanted, popping   → revive as a fresh (staggered) entrance
 * - not wanted, showing     → start popping; reported in `exiting` so the caller
 *                             can arm the removal timer
 * - not wanted, never seen  → drop at once (still inside its entrance delay)
 * - not wanted, popping     → leave it to finish
 * - newly wanted            → enter, staggered left to right within this batch
 */
export function reconcilePresence<T>(
  previous: readonly RenderedItem<T>[],
  desired: readonly PresenceItem<T>[],
  timing: Pick<PresenceTiming, 'enterDelayMs' | 'staggerMs'>,
  now: number,
): { next: RenderedItem<T>[]; exiting: { key: string; exitId: number }[] } {
  const wanted = new Map(desired.map((item) => [item.key, item]));
  const exiting: { key: string; exitId: number }[] = [];
  const known = new Set(previous.map((item) => item.key));

  const next: RenderedItem<T>[] = [];
  for (const item of previous) {
    const want = wanted.get(item.key);
    if (want) {
      // Same key ⇒ same chip slot (the row keys by position), so this only ever
      // refreshes the payload/measured anchor — it never slides a bubble along.
      next.push(item.phase === 'in' ? { ...item, ...want } : item);
    } else if (item.phase === 'out') {
      next.push(item);
    } else if (now < item.visibleAt) {
      // Never seen — popping it would flash a bubble that never arrived.
    } else {
      const exitId = item.exitId + 1;
      exiting.push({ key: item.key, exitId });
      next.push({ ...item, phase: 'out', exitId });
    }
  }

  const entering = desired
    .filter((item) => !known.has(item.key) || previous.some((p) => p.key === item.key && p.phase === 'out'))
    .sort((a, b) => a.order - b.order);
  entering.forEach((item, rank) => {
    const delayMs = timing.enterDelayMs + rank * timing.staggerMs;
    const entry: RenderedItem<T> = { ...item, phase: 'in', delayMs, exitId: 0, visibleAt: now + delayMs };
    const at = next.findIndex((existing) => existing.key === item.key);
    // A revival bumps exitId so the earlier pop's removal timer no longer matches.
    if (at >= 0) next[at] = { ...entry, exitId: next[at].exitId + 1 };
    else next.push(entry);
  });

  return { next, exiting };
}

/**
 * `desired` may be null, meaning "the caller's inputs are mid-update — do not
 * reconcile against them". The row passes null for the one render in which its
 * chip measurements still describe the previous candidate list; reconciling there
 * would spawn a bubble for a mismatched chip and pop it a frame later.
 */
export function useHintBubblePresence<T>(desired: PresenceItem<T>[] | null, timing: PresenceTiming): RenderedItem<T>[] {
  const [rendered, setRendered] = useState<RenderedItem<T>[]>([]);
  // Mirror of `rendered` for the reconcile effect. The reconcile must run its side
  // effects (arming removal timers) exactly once, so it computes from this ref
  // rather than inside a setState updater, which React may defer or double-invoke.
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // The timing object is usually a fresh literal each render; read it through a
  // ref so it does not re-run the reconcile effect below.
  const timingRef = useRef(timing);
  timingRef.current = timing;

  useEffect(() => {
    if (desired === null) return;
    const { next, exiting } = reconcilePresence(renderedRef.current, desired, timingRef.current, performance.now());
    renderedRef.current = next;
    setRendered(next);

    // Unmount each popped bubble once its animation has played. The exitId check
    // is what keeps a bubble that popped and then came back from being removed
    // by the first pop's timer.
    for (const { key, exitId } of exiting) {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setRendered((current) => current.filter((item) => !(item.key === key && item.phase === 'out' && item.exitId === exitId)));
      }, timingRef.current.exitMs);
      timers.current.add(timer);
    }
  }, [desired]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return rendered;
}
