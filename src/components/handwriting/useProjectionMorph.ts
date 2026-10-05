/**
 * useProjectionMorph — the "projection" every writing rectangle opens and closes with.
 *
 * Given the element the learner tapped (`origin` — a word tile, a 2×2 slot, a board
 * cell, a launcher button), the rectangle (`panelRef`) is first drawn with one of its
 * regions (`anchorRef` — the canvas, or the selector's character grid) laid exactly
 * over the origin, everything outside that region clipped away, and then grows into
 * place. `collapse()` runs the reverse before the host unmounts it. `companions` (the
 * host's scrim / backdrop, a hint line) fade alongside.
 *
 * Driven by the Web Animations API on the DOM nodes, so the morph never re-renders
 * React — a stroke-heavy canvas is not reconciled 60×/s. `prefers-reduced-motion`
 * skips it.
 *
 * Used by: WritingPanel (anchor = canvas) and WritingSelectorPanel (anchor = 2×2 grid),
 * so a multi-character word projects tile → selector → canvas with one motion language.
 * Docs: docs/PRACTICE_WRITING.md § "The writing panel" (Grow / shrink morph).
 */
import { useImperativeHandle, useLayoutEffect, useRef, type Ref, type RefObject } from "react";

/** Duration of the grow / shrink morph (ms). */
export const PROJECTION_MORPH_MS = 280;
// Material "emphasized decelerate" — fast out of the origin, gentle landing.
const MORPH_EASING = "cubic-bezier(0.05, 0.7, 0.1, 1)";
/** Corner radius assumed when the origin's own cannot be read (px). */
const FALLBACK_ORIGIN_RADIUS = 14;

export interface ProjectionHandle {
  /** Shrink back onto the origin (or fade, if there is none). Resolves when finished. */
  collapse: () => Promise<void>;
}

interface ProjectionMorphOptions {
  /** Forwarded ref the host calls `collapse()` on. */
  ref: Ref<ProjectionHandle>;
  /** The whole rectangle — the element that is transformed and clipped. */
  panelRef: RefObject<HTMLElement | null>;
  /** The region of the rectangle that lands on the origin. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The element the rectangle grows out of and shrinks back into. */
  origin?: HTMLElement | null;
  /** Host layers (scrim, backdrop, hint) that fade in / out with the morph. */
  companions?: RefObject<HTMLElement | null>[];
  /** The rectangle's resting corner radius (px). */
  restRadius: number;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The origin's rendered corner radius, so the collapsed frame matches it exactly. */
function originRadius(origin: HTMLElement | null | undefined): number {
  if (!origin?.isConnected) return FALLBACK_ORIGIN_RADIUS;
  const r = parseFloat(getComputedStyle(origin).borderTopLeftRadius);
  return Number.isFinite(r) ? r : FALLBACK_ORIGIN_RADIUS;
}

/**
 * Keyframe that places the anchor region over `originRect`. Centre-to-centre with a
 * uniform scale fitted to the origin, so a matching cell lands exactly and a
 * different-aspect origin (a pill button, a 3-cell word tile under a square 2×2 grid)
 * gets the anchor centred inside it.
 */
function collapsedFrame(panel: HTMLElement, anchor: HTMLElement, originRect: DOMRect, radius: number): Keyframe | null {
  const p = panel.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  if (a.width === 0 || originRect.width === 0) return null;
  const scale = Math.min(originRect.width / a.width, originRect.height / a.height);
  const dx = originRect.left + originRect.width / 2 - (a.left + a.width / 2);
  const dy = originRect.top + originRect.height / 2 - (a.top + a.height / 2);
  // Clip to the anchor box, 1px proud on each side so a canvas keeps the header's
  // bottom / footer's top hairline. The corner radius is counter-scaled so, once the
  // transform shrinks it, it reads as the origin's own corner.
  const inset = (n: number) => Math.max(0, n - 1);
  const top = inset(a.top - p.top);
  const right = inset(p.right - a.right);
  const bottom = inset(p.bottom - a.bottom);
  const left = inset(a.left - p.left);
  return {
    transformOrigin: `${a.left - p.left + a.width / 2}px ${a.top - p.top + a.height / 2}px`,
    transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
    clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius / scale}px)`,
  };
}

export function useProjectionMorph({ ref, panelRef, anchorRef, origin, companions = [], restRadius }: ProjectionMorphOptions) {
  // The origin's rect + radius at open time — the fallback target when the origin
  // element has left the DOM by close time (the host re-rendered the cell).
  const originRectRef = useRef<DOMRect | null>(null);
  const originRadiusRef = useRef(FALLBACK_ORIGIN_RADIUS);
  const collapsingRef = useRef<Promise<void> | null>(null);

  // The resting frame, sharing the collapsed frame's transform-origin so the two
  // interpolate along a straight path (a moving origin would curve it).
  const openFrame = (collapsed: Keyframe): Keyframe => ({
    transformOrigin: collapsed.transformOrigin,
    transform: "translate(0px, 0px) scale(1)",
    clipPath: `inset(0px 0px 0px 0px round ${restRadius}px)`,
  });

  const fadeCompanions = (direction: "in" | "out") => {
    for (const r of companions) {
      r.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: PROJECTION_MORPH_MS,
        easing: "ease-out",
        direction: direction === "in" ? "normal" : "reverse",
        fill: direction === "out" ? "forwards" : "none",
      });
    }
  };

  // Grow from the origin. Layout effect: measured and started before first paint, so
  // the rectangle never flashes at full size.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor || prefersReducedMotion()) return;
    const originRect = origin?.isConnected ? origin.getBoundingClientRect() : null;
    originRectRef.current = originRect;
    originRadiusRef.current = originRadius(origin);
    const from = originRect ? collapsedFrame(panel, anchor, originRect, originRadiusRef.current) : null;
    const anim = from
      ? panel.animate([from, openFrame(from)], { duration: PROJECTION_MORPH_MS, easing: MORPH_EASING })
      : panel.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "scale(1)" }], { duration: 180, easing: "ease-out" });
    fadeCompanions("in");
    // StrictMode re-runs this effect; cancel the first run's animation.
    return () => anim.cancel();
    // Open-once: a later `origin` change must not replay the grow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    collapse: () => {
      // A second tap-out while shrinking (or the Level 8 clock expiring during it)
      // waits on the same animation rather than starting another.
      if (collapsingRef.current) return collapsingRef.current;
      const panel = panelRef.current;
      const anchor = anchorRef.current;
      if (!panel || !anchor || prefersReducedMotion()) return Promise.resolve();
      // No more input once the rectangle is on its way out.
      panel.style.pointerEvents = "none";
      // Re-measure: the origin may have moved since open (a card settled, a reflow).
      const originRect = origin?.isConnected ? origin.getBoundingClientRect() : originRectRef.current;
      const to = originRect ? collapsedFrame(panel, anchor, originRect, originRadiusRef.current) : null;
      const anim = to
        ? panel.animate([openFrame(to), to], { duration: PROJECTION_MORPH_MS, easing: MORPH_EASING, fill: "forwards" })
        : panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-in", fill: "forwards" });
      fadeCompanions("out");
      collapsingRef.current = anim.finished.then(
        () => undefined,
        () => undefined, // cancelled (unmounted mid-shrink) — the host is closing anyway
      );
      return collapsingRef.current;
    },
  }));
}
