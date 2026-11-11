import { CIRCLE_MOTION } from "../../../../utils/pageTransition";

// ── The flp game break's motion (docs/FLP_GAME_BREAKS.md § 2) ──────────────────
//
// What the page around the card does as a game break comes and goes: More Info fades,
// the word tools leave through the top, and on the way back the next card rises in with
// them. The game area itself is not here — `GameBreakArea` animates its own box with
// `BREAK_AREA_MOTION` (the circle growing into the game's ground, the shrink or fall on
// exit).
//
// ── How elements are found ───────────────────────────────────────────────────
// Each step names its targets by CSS selector, scoped to the flp's ContentArea. The
// selectors name other components' classes (`.mobile-demo-more-info-pill`,
// `.word-tools-rail`, `.mobile-demo-card-slot`), so renaming one of those classes needs
// a matching edit here.
//
// Motion runs on the CSS `translate` PROPERTY through the Web Animations API, never on
// `transform`: the targets already own their `transform` (MoreInfoPill's centring), and
// the individual property composes with it instead of replacing it. Distances are
// measured, not guessed — each element travels exactly far enough to clear the phone
// frame's edge.
//
// This was half of `flpLaunch.ts` until 2026-11-04; the other half — the old Home
// page's launch choreography into a standalone flp and back, and its preloaded loops —
// was deleted with that page.
//
// Layer: feature module (flp game break). Callers: FlashcardsLearnPage (`playBreakAway`,
// `playBreakReturn`, `playBreakToolsReturn`), GameBreakArea (`BREAK_AREA_MOTION`).

type Edge = "left" | "right" | "top" | "bottom";
/**
 * A step that does not travel: the element FADES in place (opacity) instead. Used by the
 * flp game break for the More Info pill (docs/FLP_GAME_BREAKS.md § 2), which sits at the
 * bottom edge the game area rises through — sliding it down would cross the game area.
 */
type Motion = Edge | "fade";

interface ChoreographyStep {
    /** Matched inside the page root. An element claimed by an earlier step is skipped. */
    selector: string;
    /** The frame edge the element leaves through (exit) or arrives from (entry), or
        `fade` to change opacity in place. */
    edge: Motion;
    delayMs: number;
    durationMs: number;
}

/** How far past the frame edge an element travels, so its shadow clears too. */
const EDGE_CLEARANCE_PX = 16;
/** Accelerate off the page… */
const EXIT_EASING = "cubic-bezier(0.4, 0, 1, 1)";
/** …decelerate into place — the app's page-slide curve (usePageSlide, FooterPresenter). */
const ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Into a break: More Info fades, the word tools leave through the top. */
const BREAK_ENTER_MS = 300;
const BREAK_AWAY: readonly ChoreographyStep[] = [
    { selector: ".mobile-demo-more-info-pill", edge: "fade", delayMs: 0, durationMs: 220 },
    { selector: ".word-tools-rail > *", edge: "top", delayMs: 0, durationMs: BREAK_ENTER_MS },
];

/** Back to the cards: the next card rises, the word tools drop back in, More Info
 *  fades up last — FLP_ENTER's beat, minus the header (which never left). */
const BREAK_RETURN: readonly ChoreographyStep[] = [
    { selector: ".word-tools-rail > *", edge: "top", delayMs: 0, durationMs: 380 },
    { selector: ".mobile-demo-card-slot", edge: "bottom", delayMs: 40, durationMs: 460 },
    { selector: ".mobile-demo-more-info-pill", edge: "fade", delayMs: 260, durationMs: 320 },
];

/** Skip / undo off the break's card: the stack never left, so only the tools come back. */
const BREAK_TOOLS_RETURN: readonly ChoreographyStep[] = BREAK_RETURN.filter(
    (step) => step.selector !== ".mobile-demo-card-slot",
);

/** Play `BREAK_AWAY` on the flp's ContentArea. Holds the end state (fill forwards). */
export function playBreakAway(contentArea: Element): Promise<void> {
    return playChoreography(contentArea, BREAK_AWAY, "out");
}

/**
 * Play `BREAK_RETURN` on the flp's ContentArea. Call from a LAYOUT effect on the commit
 * that re-shows the card stack, so the slot is already off-frame on the first painted
 * frame (fill backwards).
 */
export function playBreakReturn(contentArea: Element): Promise<void> {
    return playChoreography(contentArea, BREAK_RETURN, "in");
}

/** Play `BREAK_TOOLS_RETURN` on the flp's ContentArea (see `playBreakReturn`). */
export function playBreakToolsReturn(contentArea: Element): Promise<void> {
    return playChoreography(contentArea, BREAK_TOOLS_RETURN, "in");
}

/**
 * The game's own motion: on Play a circle GROWS out of the screen's middle until it is the
 * game's ground. When a run ends the board holds a beat (so the end doesn't read as a
 * crash), fades to that ground, and the circle SHRINKS back onto the break's card, the
 * grow in reverse. With no run to report the game falls away through the bottom.
 */
export const BREAK_AREA_MOTION = {
    // The circle's own motion is shared with the page-level circle transition
    // (src/utils/pageTransition.ts → CIRCLE_MOTION), so the two read as one.
    growMs: CIRCLE_MOTION.ms,
    growEasing: CIRCLE_MOTION.growEasing,
    shrinkHoldMs: 420,
    shrinkFadeMs: 200,
    /** `growEasing` mirrored, so the shrink is the grow played backwards. */
    shrinkEasing: CIRCLE_MOTION.shrinkEasing,
    exitMs: BREAK_ENTER_MS,
    exitEasing: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/**
 * The break circle's diameter for `area`: enough to pass its corners from its centre, plus
 * a pixel so no antialiased corner survives. Shared by the circle (GameBreakArea) and the
 * header row's ink swap (GameBreakChrome), whose clip must be the same circle.
 */
export function circleCoverDiameter(area: HTMLElement): number {
    return Math.ceil(Math.hypot(area.clientWidth, area.clientHeight)) + 2;
}

export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The phone frame's box — the edges elements clear. The viewport when there is no frame. */
function frameRectOf(el: Element): DOMRect {
    const frame = el.closest(".mobile-demo-frame");
    return frame ? frame.getBoundingClientRect() : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/** `translate` value that puts `rect` just past `edge` of `frame`. */
function offsetPastEdge(rect: DOMRect, frame: DOMRect, edge: Edge): string {
    switch (edge) {
        case "left": return `${frame.left - rect.right - EDGE_CLEARANCE_PX}px 0px`;
        case "right": return `${frame.right - rect.left + EDGE_CLEARANCE_PX}px 0px`;
        case "top": return `0px ${frame.top - rect.bottom - EDGE_CLEARANCE_PX}px`;
        case "bottom": return `0px ${frame.bottom - rect.top + EDGE_CLEARANCE_PX}px`;
    }
}

/**
 * Play a page's table. `out` slides each element from rest to past its edge and HOLDS
 * there (fill forwards — the page is about to unmount); `in` starts each one past its
 * edge (fill backwards, so it is already off-frame on the first painted frame even
 * while its delay runs) and lands it at rest. Resolves when every animation has
 * finished or been cancelled; never rejects. Instant under reduced motion.
 */
function playChoreography(root: Element, steps: readonly ChoreographyStep[], direction: "in" | "out"): Promise<void> {
    if (prefersReducedMotion() || typeof Element.prototype.animate !== "function") return Promise.resolve();
    const frame = frameRectOf(root);
    const claimed = new Set<Element>();
    const finishes: Promise<unknown>[] = [];
    for (const step of steps) {
        root.querySelectorAll(step.selector).forEach((el) => {
            if (claimed.has(el)) return;
            claimed.add(el);
            // An `in` lands on the element's REST state, so first drop anything still
            // holding it elsewhere — a game break's `out` holds with fill forwards until
            // the break ends. A no-op for every other caller (nothing is held).
            if (direction === "in") el.getAnimations().forEach((held) => held.cancel());
            let keyframes: Keyframe[];
            if (step.edge === "fade") {
                // Fade to/from the element's OWN resting opacity (MoreInfoPill rests at 0.32
                // before the flip), read after the cancel above so it is the underlying value.
                const restOpacity = getComputedStyle(el).opacity;
                keyframes = direction === "out" ? [{ opacity: restOpacity }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: restOpacity }];
            } else {
                const away = offsetPastEdge(el.getBoundingClientRect(), frame, step.edge);
                const rest = "0px 0px";
                keyframes = direction === "out" ? [{ translate: rest }, { translate: away }] : [{ translate: away }, { translate: rest }];
            }
            const animation = el.animate(
                keyframes,
                {
                    duration: step.durationMs,
                    delay: step.delayMs,
                    easing: direction === "out" ? EXIT_EASING : ENTER_EASING,
                    fill: direction === "out" ? "forwards" : "backwards",
                }
            );
            // `finished` rejects on cancel (e.g. the element unmounts mid-flight); a
            // cancelled slide is still a finished one as far as sequencing goes.
            finishes.push(animation.finished.catch(() => undefined));
        });
    }
    return Promise.all(finishes).then(() => undefined);
}
