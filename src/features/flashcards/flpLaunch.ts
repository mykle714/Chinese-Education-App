import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDistributedWorkingLoop, workingLoopKey, type WorkingLoopRequest } from "../../api/workingLoop";
import type { VocabEntry } from "../../types";

// ── fdp ⇄ flp launch choreography ─────────────────────────────────────────────
//
// Tapping `Start` on the fdp hand (FlpStudyHand, core bar) does not navigate at once.
// The session is loaded FROM THE fdp, and the two pages hand over in sequence:
//
//   1. LOADING  — the three hand cards shake side to side, each on its own beat
//                 (StudyHand `shaking`), while the working loop and the flp's JS chunk load.
//                 No minimum: a fast load goes straight to step 2.
//   2. fdp EXIT — everything leaves by its nearest edge (FDP_EXIT): the header up; the
//                 rail tiles sideways (leftmost ←, the rest →; a lone Sort tile →); the
//                 front and bottom hand cards ←, the middle one →; the Cards / Decks
//                 pills down, with the footer (its own slide, via useHideFooter).
//   3. NAVIGATE — only once every exit animation has finished. The flp adopts the
//                 prefetched loop (`peekLaunchLoop`), so it mounts with cards, never a
//                 spinner.
//   4. flp ENTRY — (FLP_ENTER) the new header drops in; `Write it` arrives from the
//                 left and `Compare` from the right; the card stack rises from the
//                 bottom; then the More Info pill rises AFTER it, deliberately out of
//                 phase so the two do not travel as one block.
//
// BACK plays the whole thing in REVERSE (the flp's back arrow / "Leave anyway", core bar
// only — `useFlpLeave`): More Info drops first, then the card stack, then the word tools
// leave sideways and the header lifts (FLP_EXIT); then the fdp mounts and every piece
// returns along the path it left by (FDP_ENTER) — the footer rises on its own, because
// the fdp's route has one. Nothing shakes on the way back: there is nothing to wait for
// before navigating, and the hand's figures already show their own loading state (the
// SlotNumber reel). Browser Back / the iOS edge swipe bypass the arrow and get no reverse.
//
// Sequential, not overlapping, by design decision (2026-10-10): one page is fully
// cleared before the other mounts. Only the fdp's CORE hand launches this way — the
// Reading / Writing Centers' hands navigate directly, and their flps return without it.
//
// ── How elements are found ───────────────────────────────────────────────────
// Both pages are choreographed from the tables below, by CSS selector, scoped to the
// page's own root. One table per page keeps every direction and timing in one place to
// tune; the cost is that the selectors name other components' classes — each of those
// components carries a comment pointing back here, so a rename is caught.
//
// Motion runs on the CSS `translate` PROPERTY through the Web Animations API, never on
// `transform`: almost every target already owns its `transform` (the hand's fan
// geometry, SheetPill / MoreInfoPill centring), and the individual property composes
// with it instead of replacing it. Distances are measured, not guessed — each element
// travels exactly far enough to clear the phone frame's edge.
//
// Layer: feature module (src/features/flashcards). Docs: docs/DECKS_FEATURE.md
// § "Launching the flp from the hand". Callers: FlashcardsDecksPage (`useFlpLaunch`,
// `useFdpEntrance`), FlpStudyHand (`onLaunch`), FlashcardsLearnPage (`useFlpEntrance`,
// `useFlpLeave`), useWorkingLoop (`peekLaunchLoop` / `clearLaunchLoop`).

type Edge = "left" | "right" | "top" | "bottom";

interface ChoreographyStep {
    /** Matched inside the page root. An element claimed by an earlier step is skipped. */
    selector: string;
    /** The frame edge the element leaves through (exit) or arrives from (entry). */
    edge: Edge;
    delayMs: number;
    durationMs: number;
}

/** How far past the frame edge an element travels, so its shadow clears too. */
const EDGE_CLEARANCE_PX = 16;
/** Accelerate off the page… */
const EXIT_EASING = "cubic-bezier(0.4, 0, 1, 1)";
/** …decelerate into place — the app's page-slide curve (usePageSlide, FooterPresenter). */
const ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const EXIT_MS = 300;

/**
 * fdp exit (root: `.flashcards-decks__frame`). Order matters only for the rail: the
 * leftmost-of-several rule must claim its tile before the catch-all sends the rest right.
 * The footer is not here — it lives outside the page and slides via useHideFooter.
 */
const FDP_EXIT: readonly ChoreographyStep[] = [
    { selector: ".page-header", edge: "top", delayMs: 0, durationMs: EXIT_MS },
    // DecksTopRail: with 2+ tiles the leftmost goes left; everything else (incl. a lone
    // Sort tile) goes right.
    { selector: ".flashcards-decks__top-rail > :first-child:not(:only-child)", edge: "left", delayMs: 0, durationMs: EXIT_MS },
    { selector: ".flashcards-decks__top-rail > *", edge: "right", delayMs: 0, durationMs: EXIT_MS },
    // StudyHand slots: the played card and the bottom of the stack go left, the middle
    // card goes right. Lightly staggered so the three read as dealt, not as one slab.
    { selector: ".study-hand__card--slot-front", edge: "left", delayMs: 0, durationMs: EXIT_MS },
    { selector: ".study-hand__card--slot-backRight", edge: "right", delayMs: 40, durationMs: EXIT_MS },
    { selector: ".study-hand__card--slot-backLeft", edge: "left", delayMs: 80, durationMs: EXIT_MS },
    // DecksSheets' two pills.
    { selector: ".flashcards-decks__cards-pill, .flashcards-decks__decks-pill", edge: "bottom", delayMs: 0, durationMs: EXIT_MS },
];

/**
 * flp entry (root: the parent of the flp's header and ContentArea). The More Info pill
 * starts ~220ms after the card stack and runs past it — the "out of phase" beat.
 */
const FLP_ENTER: readonly ChoreographyStep[] = [
    { selector: ".page-header", edge: "top", delayMs: 0, durationMs: 380 },
    // WordToolsRail: `Write it` (Badge-wrapped, first) from the left, `Compare` from the
    // right. A rail holding only Compare (es, or a word too long to write) brings it right.
    { selector: ".word-tools-rail > :first-child:not(:only-child)", edge: "left", delayMs: 60, durationMs: 420 },
    { selector: ".word-tools-rail > *", edge: "right", delayMs: 60, durationMs: 420 },
    { selector: ".mobile-demo-card-slot", edge: "bottom", delayMs: 80, durationMs: 460 },
    { selector: ".mobile-demo-more-info-pill", edge: "bottom", delayMs: 300, durationMs: 420 },
];

// ── The reverse (Back) ──
// Each table below is its forward twin played backwards: the same edges, the stagger
// order flipped. Kept as literal tables rather than derived, so the reverse can be tuned
// on its own (exits run shorter than entries, as they do going forward).

/** flp exit on Back — FLP_ENTER reversed: More Info leaves first, the header last. */
const FLP_EXIT: readonly ChoreographyStep[] = [
    { selector: ".mobile-demo-more-info-pill", edge: "bottom", delayMs: 0, durationMs: EXIT_MS },
    { selector: ".mobile-demo-card-slot", edge: "bottom", delayMs: 120, durationMs: EXIT_MS },
    { selector: ".word-tools-rail > :first-child:not(:only-child)", edge: "left", delayMs: 160, durationMs: EXIT_MS },
    { selector: ".word-tools-rail > *", edge: "right", delayMs: 160, durationMs: EXIT_MS },
    { selector: ".page-header", edge: "top", delayMs: 180, durationMs: EXIT_MS },
];

/** fdp entry on Back — FDP_EXIT reversed: the hand's stagger runs bottom card first. */
const FDP_ENTER_MS = 380;
const FDP_ENTER: readonly ChoreographyStep[] = [
    { selector: ".page-header", edge: "top", delayMs: 0, durationMs: FDP_ENTER_MS },
    { selector: ".flashcards-decks__top-rail > :first-child:not(:only-child)", edge: "left", delayMs: 0, durationMs: FDP_ENTER_MS },
    { selector: ".flashcards-decks__top-rail > *", edge: "right", delayMs: 0, durationMs: FDP_ENTER_MS },
    { selector: ".study-hand__card--slot-backLeft", edge: "left", delayMs: 0, durationMs: FDP_ENTER_MS },
    { selector: ".study-hand__card--slot-backRight", edge: "right", delayMs: 40, durationMs: FDP_ENTER_MS },
    { selector: ".study-hand__card--slot-front", edge: "left", delayMs: 80, durationMs: FDP_ENTER_MS },
    { selector: ".flashcards-decks__cards-pill, .flashcards-decks__decks-pill", edge: "bottom", delayMs: 0, durationMs: FDP_ENTER_MS },
];

function prefersReducedMotion(): boolean {
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
            const away = offsetPastEdge(el.getBoundingClientRect(), frame, step.edge);
            const rest = "0px 0px";
            const animation = el.animate(
                direction === "out" ? [{ translate: rest }, { translate: away }] : [{ translate: away }, { translate: rest }],
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

// ── The prefetched loop handoff ───────────────────────────────────────────────
// A module slot rather than router state: the loop is a few KB of cards and has no
// business in the history entry (a Back/Forward onto the flp must deal FRESH cards).
// One-shot by construction — the flp peeks it on mount and clears it right after, and
// a stash older than HANDOFF_FRESH_MS is ignored, so an abandoned launch (the learner
// tapped a footer tab mid-shake) cannot feed a later visit stale cards.

const HANDOFF_FRESH_MS = 10_000;
let handoff: { key: string; cards: VocabEntry[]; at: number } | null = null;

/**
 * The prefetched loop for exactly this request, if one is fresh. Does NOT consume it:
 * read it from a useState initializer (StrictMode may run that twice) and call
 * `clearLaunchLoop` from an effect.
 */
export function peekLaunchLoop(request: WorkingLoopRequest): VocabEntry[] | null {
    if (!handoff || handoff.key !== workingLoopKey(request)) return null;
    if (Date.now() - handoff.at > HANDOFF_FRESH_MS) return null;
    return handoff.cards;
}

export function clearLaunchLoop(): void {
    handoff = null;
}

/**
 * Load everything the flp needs to mount without a spinner: the working loop (stashed
 * for `peekLaunchLoop`) and the flp's lazy route chunk (the same module the route
 * registry's `lazy()` imports, so its Suspense resolves from cache). Never rejects — on
 * a failed fetch nothing is stashed and the flp simply fetches (and reports) itself.
 */
async function prefetchFlpSession(request: WorkingLoopRequest): Promise<void> {
    const [cards] = await Promise.all([
        fetchDistributedWorkingLoop(request).catch(() => null),
        import("./FlashcardsLearnPage").catch(() => null),
    ]);
    if (cards && cards.length > 0) handoff = { key: workingLoopKey(request), cards, at: Date.now() };
}

// ── fdp side ──────────────────────────────────────────────────────────────────

export type FlpLaunchPhase = "idle" | "loading" | "exiting";

/**
 * The fdp's launcher. `launch(path, request)` runs steps 1–3 above; `phase` drives the
 * hand's shake (`loading`), the footer hold (`exiting`) and the page's input lock
 * (anything but `idle`). `frameRef` is the fdp's positioned frame — the root FDP_EXIT
 * is matched in.
 */
export function useFlpLaunch(frameRef: RefObject<HTMLElement | null>): {
    phase: FlpLaunchPhase;
    launch: (path: string, request: WorkingLoopRequest) => void;
} {
    const navigate = useNavigate();
    const [phase, setPhase] = useState<FlpLaunchPhase>("idle");
    // Synchronous re-entry guard — `phase` lags a tap by a render.
    const busyRef = useRef(false);
    // A launch outlives nothing: if the fdp unmounts mid-load (a footer tab), the
    // pending steps must not animate a dead page or yank the learner into the flp.
    const aliveRef = useRef(true);
    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    const launch = useCallback((path: string, request: WorkingLoopRequest) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setPhase("loading");
        void (async () => {
            await prefetchFlpSession(request);
            if (!aliveRef.current) return;
            setPhase("exiting");
            const root = frameRef.current;
            if (root) await playChoreography(root, FDP_EXIT, "out");
            if (!aliveRef.current) return;
            armEntrance("flp");
            navigate(path);
        })();
    }, [navigate, frameRef]);

    return { phase, launch };
}

// ── Entrances (both directions) ───────────────────────────────────────────────

type ChoreographedPage = "fdp" | "flp";

/** How long after the leaving page navigates the arriving one may still claim its entrance. */
const ENTRANCE_ARM_WINDOW_MS = 2_000;
const entranceArmedAt: Record<ChoreographedPage, number> = { fdp: 0, flp: 0 };

function armEntrance(page: ChoreographedPage): void {
    entranceArmedAt[page] = Date.now();
}

/**
 * Plays `steps` once, on the first render where the page is `ready` — but only when the
 * other page armed this one's latch just before navigating. Any other arrival (a deck's
 * "Study these cards", a footer tab, Back/Forward, a reload) gets no entrance.
 *
 * A layout effect, so the off-frame start is applied before the first paint — no flash
 * of the page at rest.
 */
function usePageEntrance(
    page: ChoreographedPage,
    rootRef: RefObject<HTMLElement | null>,
    rootIsParent: boolean,
    ready: boolean,
    steps: readonly ChoreographyStep[],
): void {
    // Read in an initializer (both StrictMode invocations see the same value), cleared
    // in an effect, so the latch is per-mount and cannot leak into a later visit.
    const [armed] = useState(() => Date.now() - entranceArmedAt[page] < ENTRANCE_ARM_WINDOW_MS);
    useEffect(() => { entranceArmedAt[page] = 0; }, [page]);
    const playedRef = useRef(false);
    useLayoutEffect(() => {
        if (!armed || !ready || playedRef.current) return;
        const el = rootRef.current;
        const root = rootIsParent ? el?.parentElement : el;
        if (!root) return;
        playedRef.current = true;
        void playChoreography(root, steps, "in");
    }, [armed, ready, rootRef, rootIsParent, steps]);
}

/**
 * The fdp's entrance on Back from the flp (FDP_ENTER). `frameRef` is the same frame
 * `useFlpLaunch` exits from. Ready at once: header, rail, hand and pills all render on
 * the first frame (the hand's figures arrive later, inside their own reels).
 */
export function useFdpEntrance(frameRef: RefObject<HTMLElement | null>): void {
    usePageEntrance("fdp", frameRef, false, true, FDP_ENTER);
}

// ── flp side ──────────────────────────────────────────────────────────────────

/**
 * The flp's entrance after a launch (FLP_ENTER), once its content is `ready`.
 * `anchorRef` is the flp's ContentArea; the choreography root is its parent, which also
 * holds the flp header.
 */
export function useFlpEntrance(anchorRef: RefObject<HTMLElement | null>, ready: boolean): void {
    usePageEntrance("flp", anchorRef, true, ready, FLP_ENTER);
}

/**
 * The flp's Back exit (FLP_EXIT), then `navigateAway()` and the fdp's entrance. Only for
 * the CORE flp leaving to the fdp — the caller decides; the Centers' flps navigate
 * plainly. `leaving` is true from the first tap: the page should stop taking input,
 * since the session is already being torn down. Re-entry is guarded synchronously, so a
 * second tap on the arrow mid-slide is a no-op. Same `anchorRef` as `useFlpEntrance`.
 */
export function useFlpLeave(anchorRef: RefObject<HTMLElement | null>): {
    leaving: boolean;
    leave: (navigateAway: () => void) => void;
} {
    const [leaving, setLeaving] = useState(false);
    const busyRef = useRef(false);
    const leave = useCallback((navigateAway: () => void) => {
        if (busyRef.current) return;
        const root = anchorRef.current?.parentElement;
        // No page to animate (still loading, or errored): just go.
        if (!root) { navigateAway(); return; }
        busyRef.current = true;
        setLeaving(true);
        void playChoreography(root, FLP_EXIT, "out").then(() => {
            armEntrance("fdp");
            navigateAway();
        });
    }, [anchorRef]);
    return { leaving, leave };
}
