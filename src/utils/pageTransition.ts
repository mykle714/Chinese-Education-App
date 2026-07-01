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

export type SlideDir = "up" | "right";

// Node pages (keep footer, slide from the right). Everything else that slides is a
// leaf (slide up). Keep in sync with LeafPage/NodePage usage + FooterPresenter.
const NODE_ROUTES = new Set<string>(["/games", "/flashcards/mastered"]);
// Node pages reached via a parameterized path (matched by prefix).
const NODE_PREFIXES = ["/discover/skipped/", "/discover/sort/"];
const LEAF_EXACT = new Set<string>([
    "/dictionary",
    "/reader",
    "/tester-dashboard",
    "/settings",
    "/night-market",
    "/games/bubble-match",
]);
const LEAF_PREFIXES = ["/flashcards/card/"];

export function routeSlideDir(to: string): SlideDir | null {
    const path = to.split(/[?#]/)[0];
    if (NODE_ROUTES.has(path) || NODE_PREFIXES.some((p) => path.startsWith(p))) return "right";
    if (LEAF_EXACT.has(path) || LEAF_PREFIXES.some((p) => path.startsWith(p))) return "up";
    return null;
}

// True when the browser supports the View Transitions API.
export function supportsViewTransitions(): boolean {
    return typeof document !== "undefined" && "startViewTransition" in document;
}
