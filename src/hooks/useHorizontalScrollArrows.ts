/**
 * useHorizontalScrollArrows — the "a mouse cannot swipe" problem, solved once.
 *
 * LAYER: shared client logic (`src/hooks/`, per FRONTEND_LAYERING.md — two feature
 * importers: the beginner keyboard's candidate row and the iw composer's hint tray).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * The app has several horizontally-overflowing strips of chips. A touch user just swipes
 * one (`touchAction: 'pan-x'`); a mouse user has no equivalent gesture — a vertical wheel
 * does not scroll a horizontal box and the scrollbars are hidden app-wide. So on
 * pointer-fine devices only, such a strip is flanked by two arrow buttons that page it.
 *
 * This hook owns the LOGIC of that pattern — desktop detection, measuring which
 * directions can still travel, and the paging scroll — but renders nothing. Each call
 * site paints its own arrows (see `ScrollArrow`), because their chrome legitimately
 * differs: the keyboard's arrows take the candidate row's per-mode accent colour.
 *
 * ── Desktop detection ────────────────────────────────────────────────────────────────
 * `(hover: hover) and (pointer: fine)` — the same test `index.css` uses. A phone or tablet
 * reports neither, so `showArrows` is false there and the buttons never mount.
 *
 * ── Optional end-of-travel paging (`onReachEnd`) ──────────────────────────────────────
 * A strip whose contents are fetched a page at a time can ask to be told when the learner
 * has scrolled to the right edge. Two deliberate properties:
 *
 *   1. It fires on the TRANSITION into the end zone, not on every scroll event while
 *      parked there, so holding at the edge does not spam the caller.
 *   2. "At the end" INCLUDES "does not overflow at all" (`maxScroll <= 0`). On a wide
 *      viewport the first page can fit entirely, leaving the learner no way to ask for
 *      more; firing there lets the strip self-fill until it actually overflows, at which
 *      point the arrows appear and normal paging takes over.
 *
 * The caller still owns "is there a next page" and "is one already in flight" — this hook
 * has no idea what is being fetched. Guard `onReachEnd` accordingly.
 *
 * ⚠️ NOT `useArrowPagedIndex`, despite the name. That hook binds the LEFT/RIGHT arrow KEYS to
 * step a catalogue index for the two editors; this one renders on-screen arrow BUTTONS that
 * scroll an overflowing strip. No keyboard, no index, no wrapping — they share nothing but the
 * word "arrow".
 *
 * Referenced by: docs/BEGINNER_KEYBOARD.md § 6p, docs/IMMERSIVE_WORLD.md § 9a.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@mui/material';

/** How much of the visible width one arrow press travels. Under 1 so a chip is kept in view as an anchor. */
const PAGE_FRACTION = 0.8;

/** Sub-pixel scroll widths mean `scrollLeft` never exactly equals the max; treat this close as "at the end". */
const EDGE_EPSILON = 2;

export interface UseHorizontalScrollArrowsOptions {
  /**
   * Re-measure whenever this changes. Pass the rendered item list: its length drives the
   * scroll width, and a strip that is replaced on every keystroke must not keep the
   * geometry of the previous one.
   */
  deps?: unknown;
  /** Called once each time the scroller arrives at (or starts at) its right edge. */
  onReachEnd?: () => void;
}

export interface UseHorizontalScrollArrowsResult {
  /** Attach to the scrolling element. */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** True only on a pointer-fine device whose strip actually overflows: mount the arrows. */
  showArrows: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  /** Page the strip by ~80% of its visible width. */
  page: (direction: -1 | 1) => void;
  /** Wire to the scroller's `onScroll`. */
  onScroll: () => void;
}

export function useHorizontalScrollArrows(
  options: UseHorizontalScrollArrowsOptions = {},
): UseHorizontalScrollArrowsResult {
  const { deps, onReachEnd } = options;

  const isDesktop = useMediaQuery('(hover: hover) and (pointer: fine)');

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  // Held in refs so `syncOverflow` can stay a stable callback: it is handed to a
  // ResizeObserver and to onScroll, and re-creating it would tear down/rebuild the
  // observer on every render.
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;
  const wasAtEndRef = useRef(false);

  /** Re-derive which arrows are live from the scroller's current geometry. */
  const syncOverflow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setOverflow({
      left: el.scrollLeft > EDGE_EPSILON,
      right: el.scrollLeft < maxScroll - EDGE_EPSILON,
    });

    // Note this is true when maxScroll <= 0 — a strip that does not overflow is already
    // "at the end", which is what lets a short first page pull the next one. See header.
    const atEnd = el.scrollLeft >= maxScroll - EDGE_EPSILON;
    if (atEnd && !wasAtEndRef.current) onReachEndRef.current?.();
    wasAtEndRef.current = atEnd;
  }, []);

  // The item list is typically replaced wholesale (every stroke, every keystroke), so
  // geometry has to be re-measured whenever it changes — and again on resize, since these
  // strips span the viewport width. ResizeObserver covers both the element growing (more
  // chips) and the window changing, so no window listener is needed.
  //
  // ⚠️ This runs on EVERY device, not just desktop. It used to be gated on `isDesktop`
  // alongside the arrows, which was correct while measuring only fed the arrows — but
  // `onReachEnd` rides the same measurement, and gating it would leave a phone unable to
  // page at all, which is the platform that can actually swipe to the edge.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // New content is a fresh chance to be "at the end": clearing the latch here is what
    // lets an appended page that STILL does not overflow pull the one after it. Without
    // it the latch would stay set from the first measurement and self-filling would stop
    // after exactly one page. Termination is the caller's job (it knows the page count).
    wasAtEndRef.current = false;
    syncOverflow();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [deps, syncOverflow]);

  const page = useCallback((direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * PAGE_FRACTION, behavior: 'smooth' });
  }, []);

  return {
    scrollerRef,
    showArrows: isDesktop && (overflow.left || overflow.right),
    canScrollLeft: overflow.left,
    canScrollRight: overflow.right,
    page,
    onScroll: syncOverflow,
  };
}

export default useHorizontalScrollArrows;
