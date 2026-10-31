import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDistributedWorkingLoop, workingLoopKey, type WorkingLoopRequest } from "../../api/workingLoop";
import type { VocabEntry } from "../../types";
import type { FlpWorld } from "../../../server/contracts/studyMode";
import type { StudyModeId } from "./StudyHand";

// ── fdp ⇄ flp launch choreography ─────────────────────────────────────────────
//
// Tapping `Start` on the fdp hand (FlpStudyHand, core bar) does not navigate at once.
// The session is loaded FROM THE fdp, and the two pages hand over in sequence:
//
//   1. LOADING  — the three hand cards shake side to side, each on its own beat
//                 (StudyHand `shaking`), while the working loop and the flp's JS chunk load.
//                 No minimum: a fast load goes straight to step 2 — and usually it is
//                 instant, because Home preloaded both (`preloadFlpSessions`).
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
// `useFlpLeave`), useWorkingLoop (`peekLaunchLoop` / `clearLaunchLoop`), and the flp
// game break (`playBreakAway` / `playBreakReturn` / `BREAK_AREA_MOTION` — GameBreakArea,
// FlashcardsLearnPage; docs/FLP_GAME_BREAKS.md § 2). (The Deck Tower mounts the flp in
// place and keeps it mounted — its sessions fetch their own loops; docs/DECK_TOWER.md
// § "Studying the tower" → "Parked sessions" — but a mounting session still adopts a matching Home preload
// through `peekLaunchLoop`.)

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

// ── The flp game break (docs/FLP_GAME_BREAKS.md § 2) ──
// Root: the flp's ContentArea. The game area is not in these tables: `GameBreakArea`
// animates its own box (the card growing into the panel, the fall on exit).

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
 * The game area's own motion: on Play the card GROWS into the game's panel, the plate then
 * fades off the mounted game; on exit the area falls away through the bottom.
 */
export const BREAK_AREA_MOTION = {
    growMs: 420,
    growEasing: "cubic-bezier(0.3, 0, 0.15, 1)",
    plateFadeMs: 200,
    exitMs: BREAK_ENTER_MS,
    exitEasing: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

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

// ── The preloaded loops ───────────────────────────────────────────────────────
// Home (the fdp) PRELOADS the loop for each of the hand's three modes as soon as it
// mounts (`preloadFlpSessions`), so a Start tap usually finds its loop already landed
// and the hand barely shakes. Start then only joins or reuses that load
// (`prefetchFlpSession`); it starts one of its own only when there is none.
//
// A module store rather than router state: a loop is ~100 KB of cards and has no
// business in the history entry (a Back/Forward onto the flp must deal FRESH cards).
// One entry per `workingLoopKey`, i.e. per mode. The rules that keep it from serving
// a stale deal:
//   • a landed loop is good for LOOP_FRESH_MS (5 min — a learner does not linger on
//     Home, and a cooldown that ran out in between is an accepted, marginal drift);
//   • the flp CLEARS THE WHOLE STORE when it adopts a loop — the session is about to
//     mark cards, so the other modes' deals are out of date; Home re-preloads on return;
//   • an entry is tied to the (user, language) that preloaded it — a different scope
//     drops the store before preloading;
//   • a load that lands after its entry was cleared or replaced is discarded.
//
// Preloading costs one working-loop request per mode per Home landing that has no
// fresh entry. Accepted (2026-10-12): the endpoint's side effects are harmless here —
// a lent card in a loop that is never played is re-lent on the next visit instead of
// a new one being minted (docs/PROVISIONAL_CARDS.md § 3b), and its TTS prewarm only
// fills a cache we want full anyway.

/**
 * The working-loop request a hand card launches — the WHOLE library (no category, no
 * collection) in that card's mode. Shared by FlpStudyHand (Start) and Home's preload
 * (`preloadFlpSessions`); the handoff matches on `workingLoopKey`, so
 * a request built anywhere else would silently miss the preload.
 */
export function handLaunchRequest(id: StudyModeId, world: FlpWorld): WorkingLoopRequest {
    return { category: null, mode: id === "mix" ? null : id, world, collection: null };
}

const LOOP_FRESH_MS = 5 * 60_000;

/** The scope a preloaded loop belongs to — the server deals for the selected language. */
export const flpPreloadScope = (userId: string | number, language: string | null | undefined) =>
    `${userId}:${language ?? ""}`;

interface PreloadedLoop {
    /** `${userId}:${language}` of the Home that started the load. */
    scope: string;
    /** Resolves to the cards, or null on failure / an empty loop. Never rejects. */
    promise: Promise<VocabEntry[] | null>;
    /** Set once the load lands with cards; null while in flight. */
    cards: VocabEntry[] | null;
    landedAt: number;
}

const preloadedLoops = new Map<string, PreloadedLoop>();

/** Is this entry still worth using — in flight, or landed within the window? */
function isUsable(entry: PreloadedLoop | undefined): entry is PreloadedLoop {
    if (!entry) return false;
    return entry.cards === null || Date.now() - entry.landedAt <= LOOP_FRESH_MS;
}

/** Start (and store) a load for `request`. Failures and empty loops remove the entry. */
function startLoopLoad(scope: string, request: WorkingLoopRequest): PreloadedLoop {
    const key = workingLoopKey(request);
    const entry: PreloadedLoop = { scope, promise: Promise.resolve(null), cards: null, landedAt: 0 };
    entry.promise = fetchDistributedWorkingLoop(request).then(
        (cards) => {
            // Cleared (the flp adopted a loop) or replaced while in flight — the
            // learner has moved on, so this deal must not be served later.
            if (preloadedLoops.get(key) !== entry) return null;
            if (cards.length === 0) { preloadedLoops.delete(key); return null; }
            entry.cards = cards;
            entry.landedAt = Date.now();
            return cards;
        },
        () => {
            // The flp fetches (and reports the error) itself on mount.
            if (preloadedLoops.get(key) === entry) preloadedLoops.delete(key);
            return null;
        }
    );
    preloadedLoops.set(key, entry);
    return entry;
}

/** The flp's lazy route chunk — the same module the route registry's `lazy()` imports,
 *  so the route's Suspense resolves from cache. The browser dedupes repeat imports. */
function importFlpChunk(): Promise<unknown> {
    return import("./FlashcardsLearnPage").catch(() => null);
}

/**
 * Preload the flp from Home: its JS chunk once the browser is idle, and the working loop
 * for every request in `requests` (the hand's three modes) that has no usable entry.
 *
 * The FIRST request runs alone and the rest follow once it settles. The endpoint tops a
 * short learner up with lent cards before dealing (`ensureBaselineForSurface`), and
 * concurrent calls would all pick the same most-common words — the duplicate inserts
 * are dropped (ON CONFLICT DO NOTHING), so the losing calls deal a short loop. Going
 * first, one call lends; the others then re-lend what it lent.
 *
 * Fire-and-forget; never rejects.
 */
export function preloadFlpSessions(scope: string, requests: readonly WorkingLoopRequest[]): void {
    // A different account or language preloaded what is here — none of it applies.
    for (const entry of preloadedLoops.values()) {
        if (entry.scope !== scope) { preloadedLoops.clear(); break; }
    }

    // The chunk does not compete with the page's own first loads: wait for idle.
    // `requestIdleCallback` is missing on older iOS WebViews — fall back to a timeout.
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => { void importFlpChunk(); });
    else window.setTimeout(() => { void importFlpChunk(); }, 1_000);

    const pending = requests.filter((request) => !isUsable(preloadedLoops.get(workingLoopKey(request))));
    if (pending.length === 0) return;
    const [first, ...rest] = pending;
    void startLoopLoad(scope, first).promise.then(() => {
        for (const request of rest) {
            // The learner may have launched (and cleared the store) meanwhile.
            if (!isUsable(preloadedLoops.get(workingLoopKey(request)))) startLoopLoad(scope, request);
        }
    });
}

/**
 * The preloaded loop for exactly this request, if it has landed and is fresh. Does NOT
 * consume it: read it from a useState initializer (StrictMode may run that twice) and
 * call `clearLaunchLoop` from an effect.
 */
export function peekLaunchLoop(request: WorkingLoopRequest): VocabEntry[] | null {
    const entry = preloadedLoops.get(workingLoopKey(request));
    return isUsable(entry) ? entry.cards : null;
}

/** Drop every preloaded loop — called by the flp once it has adopted (or skipped) one. */
export function clearLaunchLoop(): void {
    preloadedLoops.clear();
}

/**
 * Load everything the flp needs to mount without a spinner, for a Start tap: the working
 * loop (joined if Home's preload is still in flight, reused if it landed, fetched here
 * otherwise) and the flp's route chunk. Never rejects — on a failed fetch nothing is
 * stored and the flp simply fetches (and reports) itself.
 *
 */
export async function prefetchFlpSession(scope: string, request: WorkingLoopRequest): Promise<void> {
    const existing = preloadedLoops.get(workingLoopKey(request));
    const entry = isUsable(existing) && existing.scope === scope ? existing : startLoopLoad(scope, request);
    await Promise.all([entry.promise, importFlpChunk()]);
}

// ── fdp side ──────────────────────────────────────────────────────────────────

export type FlpLaunchPhase = "idle" | "loading" | "exiting";

/**
 * The fdp's launcher. `launch(path, request)` runs steps 1–3 above; `phase` drives the
 * hand's shake (`loading`), the footer hold (`exiting`) and the page's input lock
 * (anything but `idle`). `frameRef` is the fdp's positioned frame — the root FDP_EXIT
 * is matched in. `scope` is `flpPreloadScope(userId, language)`, the same one Home
 * preloads under, so Start reuses the preload.
 */
export function useFlpLaunch(frameRef: RefObject<HTMLElement | null>, scope: string): {
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
            await prefetchFlpSession(scope, request);
            if (!aliveRef.current) return;
            setPhase("exiting");
            const root = frameRef.current;
            if (root) await playChoreography(root, FDP_EXIT, "out");
            if (!aliveRef.current) return;
            armEntrance("flp");
            navigate(path);
        })();
    }, [navigate, frameRef, scope]);

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
