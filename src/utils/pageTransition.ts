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
