// Forward-navigation page transitions via the View Transitions API.
//
// When you navigate INTO a leaf/node page, we want the new page to slide OVER the
// old one (which stays visible beneath), instead of sliding in over a blank frame.
// The browser's view transition snapshots the old page as a composited image and
// holds it beneath while the new page's snapshot slides in — no DOM cloning (which
// reflowed the live tree and broke the incoming CSS transition).
//
// Direction mirrors LeafPage/NodePage: leaf pages slide UP, node pages slide in
// from the RIGHT. The direction is published on <html data-vt-dir> and read by the
// `::view-transition-*(root)` rules in index.css.
//
// We also arm the skip-enter latch so the real page mounts in its FINAL position
// (static) — otherwise its own usePageSlide enter would offset the snapshot the VT
// captures, double-sliding it.
//
// ── Where the classification lives ────────────────────────────────────────────
// In `src/routes/routeMeta.ts`, with every other per-route fact. This file used to
// keep its own three tables (NODE_ROUTES / NODE_PREFIXES / LEAF_EXACT) hand-synced
// with FooterPresenter and Layout — and they had already drifted:
// `/games/word-search` was missing from LEAF_EXACT, so it silently lost the
// slide-up that Bubble Match got. See docs/ARCHITECTURE_REVIEW.md finding 4.

import { routeChrome } from "../routes/routeMeta";

export type SlideDir = "up" | "right";

/**
 * The slide direction for navigating INTO `to`, or null when that route does not
 * slide (footer-tab destinations, auth pages, the 404).
 *
 * Accepts a raw `to` value — querystring and hash are stripped by `findRoute`.
 */
export function routeSlideDir(to: string): SlideDir | null {
    switch (routeChrome(to)) {
        case "leaf":
            return "up";
        case "node":
            return "right";
        default:
            return null;
    }
}

// True when the browser supports the View Transitions API.
export function supportsViewTransitions(): boolean {
    return typeof document !== "undefined" && "startViewTransition" in document;
}

// ── The circle transition ─────────────────────────────────────────────────────
// A page revealed inside a circle that grows out of a point (the thing tapped) until it
// passes the screen's corners, and closed again by the reverse: a circle shrinking back
// onto that point. The motion is the flp game break's (docs/FLP_GAME_BREAKS.md, whose
// `BREAK_AREA_MOTION` reads these numbers), so the two read as one transition.
//
//   enter  useSlideNavigate(to, { circleFrom })  — a view transition: the old page is held
//          beneath as a snapshot while the new one's snapshot is clipped to the circle;
//   exit   LeafPage `exitCircleTo` → usePageSlide `exit` — the leaving page's clone (the
//          same clone the slide-down uses) shrinks into the circle over the destination.
//
// Used by: the Deck Tower's notebook paper stack ↔ the Writing Notebook
// (docs/DECK_TOWER.md § "The notebook stack"), and its mini sort platform ↔ Add Cards
// (docs/DECK_TOWER.md § "The sort platform").

/** A point on screen, in viewport px (a `getBoundingClientRect` centre). */
export interface ScreenPoint {
    x: number;
    y: number;
}

/**
 * `state.circleFrom` off a circle launch, validated (nav state is untyped). The opened page
 * hands it back to its Back (LeafPage / NodePage `exitCircleTo`) so the circle closes onto
 * the point it grew from. Undefined after a reload or deep link — Back slides then.
 * Used by: WritingNotebookPage, AddCardsPage.
 */
export function readCirclePoint(state: unknown): ScreenPoint | undefined {
    const p = (state as { circleFrom?: Partial<ScreenPoint> } | null)?.circleFrom;
    return p && typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : undefined;
}

export const CIRCLE_MOTION = {
    /** The circle's grow, and its shrink (the same length, played backwards). */
    ms: 520,
    growEasing: "cubic-bezier(0.5, 0, 0.3, 1)",
    /** `growEasing` mirrored, so the shrink is the grow played backwards. */
    shrinkEasing: "cubic-bezier(0.7, 0, 0.5, 1)",
} as const;

/** The radius that covers `box` (a rect in the same px as `at`) from `at`: the distance to its farthest corner, plus a pixel so no antialiased corner survives. */
export function circleCoverRadius(at: ScreenPoint, box: { left: number; top: number; width: number; height: number }): number {
    const dx = Math.max(at.x - box.left, box.left + box.width - at.x);
    const dy = Math.max(at.y - box.top, box.top + box.height - at.y);
    return Math.hypot(dx, dy) + 1;
}

/** `clip-path` for a circle of `r` px at `at` (px in the clipped box's own coordinates). */
export function circleClip(at: ScreenPoint, r: number): string {
    return `circle(${r.toFixed(1)}px at ${at.x.toFixed(1)}px ${at.y.toFixed(1)}px)`;
}

export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
