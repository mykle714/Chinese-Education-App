import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "../../../../types";
import type { VocabEntry } from "../../types";
import type { FlpWorld } from "../../../../../server/contracts/studyMode";
import { focusGameMinimum } from "../../../../../server/contracts/focusMode";
import { fetchFocusStatus } from "../../../../api/focusMode";
import {
    flpBreakCandidatesFor,
    flpBreakGameFor,
    pickBreakCandidate,
    type FlpBreakCandidate,
    type FlpBreakContext,
    type FlpBreakResults,
} from "../../../../games/flpBreak";
import { readBreakProgress, writeBreakProgress } from "./breakProgressStore";

/** Cards per break: the 15th card is the last before a game (docs/FLP_GAME_BREAKS.md § 1). */
export const BREAK_INTERVAL = 15;

/**
 * The longest Play waits on a prefetch that has not settled (§ 1). A prefetch that never
 * answers (a hung request) used to hold Play disabled forever. Past this, the plan gives
 * up on its prefetch — settled with no board, the same state a FAILED prefetch leaves, so
 * the Stage deals its own opening board — and Play comes back enabled: the next tap
 * opens the game at once. A prefetch landing after the give-up is dropped
 * (`prefetchGaveUpRef`), so it cannot swap the board or the game under a running break.
 */
export const PLAY_WAIT_TIMEOUT_MS = 8000;

/**
 * Where the session is relative to a break.
 *   cards    — studying; a break may be DUE (the front card is the last before it).
 *   title    — the break's card is the top card of the stack (Skip / Play).
 *   skipping — Skip: the break's card is flying off, the next card already under it.
 *   growing  — Play: the card is growing into the game's panel.
 *   playing  — the game's Stage is mounted.
 *   shrinking — the run ended: the game is closing down onto the break's card (the grow in reverse).
 *   results  — the break's card is on top again, showing the run's results; a swipe sends
 *              it off through `skipping`.
 *   leaving  — no run to report: the game area is sliding away, the stack hidden behind it.
 */
export type GameBreakPhase = "cards" | "title" | "skipping" | "growing" | "playing" | "shrinking" | "results" | "leaving";

/**
 * Phases in which a break is OFFERED or UNDER WAY but not finished: the break's card is up,
 * or the game is growing / mid-run. A session that ends in one of these (the visit is
 * parked, or the app is closed) saves BREAK_INTERVAL − 1, so the next session's first card
 * is the last before the break and the break comes straight back (§ 1 "The count
 * persists"). From `shrinking` on, the run is over, so the break counts as spent.
 */
const MID_BREAK_PHASES: ReadonlySet<GameBreakPhase> = new Set(["title", "growing", "playing"]);

/** The count a session in `phase` with `cardsSinceBreak` dismisses should resume at. */
function progressToResume(cardsSinceBreak: number, phase: GameBreakPhase): number {
    return MID_BREAK_PHASES.has(phase) ? BREAK_INTERVAL - 1 : cardsSinceBreak % BREAK_INTERVAL;
}

/** How the page brings the flp back: the word tools only, or the whole stack too. */
export type BreakReturnMotion = "tools" | "full";

/** A break that has been decided on: which game, and the board it will be dealt. */
interface PlannedBreak {
    /** Per-plan id: a prefetch only lands on the plan that started it (see the effect). */
    id: number;
    candidate: FlpBreakCandidate;
    context: FlpBreakContext;
    /** The prefetched opening board; `null` until it lands or when it failed. */
    prefetched: unknown;
    prefetchSettled: boolean;
}

export interface UseGameBreakReturn {
    phase: GameBreakPhase;
    /** The front card is the last before a break: render no card behind it. */
    due: boolean;
    /** The stack's hold for FlashCardSection's `gameBreak` prop. */
    stackHold: "due" | "title" | "skipping" | "growing" | "shrinking" | "results" | "active" | null;
    /** The decided break, from the moment it fell due until it ends. */
    planned: PlannedBreak | null;
    /** The finished run, for the break's card; null until the game reports one. */
    results: FlpBreakResults | null;
    /** True while Play waits for the prefetched board. */
    playPending: boolean;
    /** The game area is on screen: growing out of the card, playing, or falling away. */
    areaMounted: boolean;
    /** The game's Stage is (still) mounted — playing, or falling away after it. */
    stageMounted: boolean;
    /** Bumped each time the flp's tools should come back, for the return choreography. */
    returnNonce: number;
    /** Which return `returnNonce` asks for. */
    returnMotion: BreakReturnMotion;
    /** useWorkingLoop's `onDismissed` / `onUndone`. */
    noteDismissed: () => void;
    noteUndone: () => void;
    play: () => void;
    /** The circle finished growing over the screen: mount the game. */
    finishGrow: () => void;
    /** The game finished a run: close back onto the break's card, now showing `results`. */
    finishRun: (results: FlpBreakResults) => void;
    /** The circle finished closing: the results card is live. */
    finishShrink: () => void;
    /** Skip, the results card's swipe, or a game with no run to report: start the exit. */
    beginLeave: () => void;
    /** The exit animation finished: the break is over, the counter starts over. */
    finishLeave: () => void;
    /**
     * No break in progress (a Deck Tower visit ended). The counter is KEPT — it resumes
     * where the visit left it, or one card before the break if the visit left mid-break.
     */
    reset: () => void;
}

/**
 * useGameBreak — the flp game break's counter and phase machine
 * (docs/FLP_GAME_BREAKS.md § 1–4). Owns no UI: `GameBreakArea` renders it, and
 * FlashcardsLearnPage wires it to the working loop and the card stack.
 *
 * The break is a POSITION in the card sequence, not an element of `workingLoop` (§ 1):
 * the loop, its refills and its dedupe guard never see it. `cardsSinceBreak` counts
 * dismisses (undo takes one back); at BREAK_INTERVAL − 1 the front card is the last
 * before the break, and the dismiss of that card opens the break.
 *
 * Layer: feature hook (features/flashcards). Reads the games engine through
 * `src/games/flpBreak` only (features → games, never the reverse).
 */
export function useGameBreak(args: {
    /** The signed-in user, for the persisted count's key; no user → nothing persists. */
    userId: string | number | null | undefined;
    world: FlpWorld;
    language: Language;
    workingLoop: readonly VocabEntry[];
    /** Suppress breaks entirely (e.g. while the card editor is open). */
    disabled?: boolean;
    /**
     * A tester's pinned candidate key (forcedBreak.ts): a visit opens on a break of this
     * game with no card swiped, and every next card is one too, instead of every
     * BREAK_INTERVAL cards a random one. Ignored when it is not a candidate here
     * (docs/FLP_GAME_BREAKS.md § 10).
     */
    forcedKey?: string | null;
}): UseGameBreakReturn {
    const { userId, world, language, workingLoop, disabled = false, forcedKey = null } = args;

    // The count toward the next break PERSISTS (breakProgressStore, § 1 "The count
    // persists"): it opens at the stored figure for this (user, language, world).
    const readStoredProgress = () =>
        userId == null ? 0 : readBreakProgress(userId, language, world, BREAK_INTERVAL);
    const [cardsSinceBreak, setCardsSinceBreak] = useState(readStoredProgress);
    // A different user / language / world is a different count: swap it in DURING render
    // (React's "adjust state when a prop changes" pattern), so the persist effect below
    // never writes the old count under the new key.
    const progressKey = userId == null ? null : `${userId}:${language}:${world}`;
    const [loadedProgressKey, setLoadedProgressKey] = useState(progressKey);
    if (loadedProgressKey !== progressKey) {
        setLoadedProgressKey(progressKey);
        setCardsSinceBreak(readStoredProgress());
    }
    const [phase, setPhase] = useState<GameBreakPhase>("cards");
    const [planned, setPlanned] = useState<PlannedBreak | null>(null);
    const [results, setResults] = useState<FlpBreakResults | null>(null);
    const [playRequested, setPlayRequested] = useState(false);
    // No game could deal a board for this break (§ 4): it is off, until the next card.
    const [abandoned, setAbandoned] = useState(false);
    const [returnNonce, setReturnNonce] = useState(0);
    const [returnMotion, setReturnMotion] = useState<BreakReturnMotion>("full");
    // The previous break's (game, mode), so the next one differs when it can (§ 3).
    const previousKeyRef = useRef<string | null>(null);
    // A pinned visit's opening break (§ 10) is spent: it has shown, or a card was swiped first.
    const forcedOpeningSpentRef = useRef(false);
    // Source of PlannedBreak.id.
    const planIdRef = useRef(0);
    // The plan whose prefetch Play gave up waiting on (PLAY_WAIT_TIMEOUT_MS); its late
    // result, if one ever comes, is dropped. Plan ids only grow, so one slot is enough.
    const prefetchGaveUpRef = useRef<number | null>(null);
    // False after unmount, so a prefetch landing after the learner left sets no state.
    const mountedRef = useRef(true);
    // Read by a prefetch landing outside React: is its plan still the live one, and is the
    // learner already looking at the break's card?
    const liveRef = useRef<{ planId: number | null; phase: GameBreakPhase }>({ planId: null, phase: "cards" });
    liveRef.current = { planId: planned?.id ?? null, phase };
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // Derived from the registry — enabled, language-gated, on this bar, with an adapter.
    const candidates = useMemo(() => flpBreakCandidatesFor(world, language), [world, language]);
    const forced = useMemo(() => candidates.find((c) => c.key === forcedKey) ?? null, [candidates, forcedKey]);

    // Persist on every change, in the form the next session resumes from — so a closed
    // tab or a killed app loses nothing. Not while a tester's pin is honoured (§ 10): a
    // pinned session breaks on every card and would wipe the learner's real count.
    const progressToSave = progressToResume(cardsSinceBreak, phase);
    useEffect(() => {
        if (userId == null || forced !== null) return;
        writeBreakProgress(userId, language, world, progressToSave);
    }, [userId, language, world, forced, progressToSave]);

    // DUE: the front card is the last before the break. Gated on there being a game to
    // offer and on the loop not winding down (a 1-card loop is about to run dry; § 1).
    const due = phase === "cards"
        && !disabled
        && !abandoned
        && candidates.length > 0
        && workingLoop.length >= 2
        // Modulo, so a break skipped for being disabled (the editor was open) or for a
        // winding-down loop comes round again a full interval later instead of never.
        && (forced !== null || cardsSinceBreak % BREAK_INTERVAL === BREAK_INTERVAL - 1);

    // Decide the break the moment it falls due, and prefetch its board while the last
    // card is still being studied — so Play has no spinner (§ 1). The seed is the loop
    // AS IT STANDS NOW; the server decides which of those cards can take the game's
    // marks (§ 4).
    //
    // Keyed on `due` only: `workingLoop` changes identity on every refill, and
    // re-planning on one would swap the game under the learner's thumb.
    // FOCUS MODE (docs/FOCUS_MODE.md § 5): a focused break draws from outside today's set
    // and then from what is left of it (§ 4a); a game needing more cards than those two
    // hold is SKIPPED. Read once per due break; undefined until read, null when focus is
    // off. A failed read means "not focused": never lose a break to a network error.
    const [focusBreakCards, setFocusBreakCards] = useState<number | null | undefined>(undefined);
    useEffect(() => {
        if (!due) {
            setFocusBreakCards(undefined);
            return;
        }
        let cancelled = false;
        fetchFocusStatus()
            .then((status) => {
                const own = status.worlds[world];
                if (!cancelled) setFocusBreakCards(own?.on ? own.breakCards ?? 0 : null);
            })
            .catch(() => !cancelled && setFocusBreakCards(null));
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [due]);
    const focusRead = focusBreakCards !== undefined;

    useEffect(() => {
        if (!due || planned || !focusRead) return;
        // A tester's pin narrows the pool to its one game (§ 10); the focus rule still holds.
        const pool = forced ? [forced] : candidates;
        // Only games a focused break's cards can fill; none → the break is skipped (§ 5).
        const context: FlpBreakContext = {
            language,
            world,
            seedIds: workingLoop.map((card) => card.id),
        };
        const breakMinimum = (c: FlpBreakCandidate) =>
            flpBreakGameFor(c.game.gameId)?.focusMinimum?.(context) ?? focusGameMinimum(c.game.gameId);
        const playable = focusBreakCards == null
            ? pool
            : pool.filter((c) => focusBreakCards >= breakMinimum(c));
        startPlan(playable, context);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [due, focusRead]);

    /**
     * Decide on one of `pool` and prefetch its board. False when there is nothing to pick.
     *
     * A board the server could not deal (`FlpBreakGame.isPlayable`) moves on to another
     * game, so the learner never taps Play into a dead end (§ 4). With none left the break
     * is off: before the swipe, the next card simply follows; with the break's card
     * already up, it leaves as Skip does.
     */
    function startPlan(pool: readonly FlpBreakCandidate[], context: FlpBreakContext): boolean {
        const candidate = pickBreakCandidate(pool, previousKeyRef.current);
        const adapter = candidate ? flpBreakGameFor(candidate.game.gameId) : null;
        if (!candidate || !adapter) return false;
        const id = ++planIdRef.current;
        setPlanned({ id, candidate, context, prefetched: null, prefetchSettled: false });
        // The game's code too, not just its board: without this the first break of each
        // game waited on its lazy chunk behind a spinner after the grow. Fire-and-forget —
        // a failed preload just leaves the Stage's own Suspense load to retry.
        adapter.Stage.preload().catch(() => undefined);
        // NOT cancelled by this effect's cleanup. The cleanup runs the moment `due` flips
        // false — which is exactly what dismissing the due card does (phase → title) —
        // so tying the result to it dropped every prefetch still in flight at the swipe,
        // leaving `prefetchSettled` false forever and Play disabled (fixed 2026-10-18).
        // A result is discarded only when its plan was REPLACED (undo off the due card,
        // or a StrictMode re-run) — matched by id — or the page has unmounted.
        const settle = (prefetched: unknown) => {
            if (!mountedRef.current || prefetchGaveUpRef.current === id) return;
            setPlanned((p) => (p && p.id === id ? { ...p, prefetched, prefetchSettled: true } : p));
        };
        adapter.prefetch(candidate, context)
            .then((board) => {
                // Play already gave up on this prefetch and may have opened the game.
                if (prefetchGaveUpRef.current === id) return;
                if (adapter.isPlayable?.(board) !== false) {
                    settle(board);
                    return;
                }
                if (!mountedRef.current || liveRef.current.planId !== id) return;
                if (startPlan(pool.filter((c) => c.key !== candidate.key), context)) return;
                setPlayRequested(false);
                if (liveRef.current.phase === "title") {
                    setPhase("skipping");
                    setReturnMotion("tools");
                    setReturnNonce((n) => n + 1);
                } else {
                    setAbandoned(true);
                    setPlanned(null);
                }
            })
            .catch((err) => {
                // Non-fatal: the Stage fetches its own opening board instead.
                console.error("[GameBreak] prefetch failed:", err);
                settle(null);
            });
        return true;
    }

    // A PINNED visit starts on the break's card, zero cards in (§ 10). The break's card
    // needs only the plan, not the prefetched board: Play already waits for that. The next
    // card is under it, as on every title card, so Skip lands on it. Once per visit
    // (`forcedOpeningSpentRef`, cleared only by `reset`): a second opening after a break
    // would make Skip loop on the title card forever, with no card ever reachable. Not
    // gated on the counter being 0: it persists across visits (§ 1), so a visit can open
    // with any count.
    useEffect(() => {
        if (!due || !planned || forced === null) return;
        if (forcedOpeningSpentRef.current) return;
        forcedOpeningSpentRef.current = true;
        setPhase("title");
    }, [due, planned, forced]);

    // Undo can take the session back off the "due" card (counter 14 → 13): drop the plan,
    // so the break is re-decided — with a fresh seed — when it falls due again.
    useEffect(() => {
        if (phase === "cards" && !due && planned) setPlanned(null);
    }, [phase, due, planned]);

    const noteDismissed = useCallback(() => {
        forcedOpeningSpentRef.current = true;
        setCardsSinceBreak((n) => n + 1);
        setAbandoned(false);
        // The dismiss of the due card opens the break. Read from the render that
        // dispatched it — `due` cannot change between the swipe and this call.
        if (due && planned) setPhase("title");
    }, [due, planned]);

    const noteUndone = useCallback(() => {
        setCardsSinceBreak((n) => Math.max(0, n - 1));
        setAbandoned(false);
        // Undo on the title card brings card 15 back and cancels the break (§ 2) — the
        // plan is kept (the card is due again), and the page plays the return so the
        // word tools and More Info come back with it. Undo is locked once the game is
        // playing, so only the title phase lands here.
        if (phase === "title") {
            setPhase("cards");
            setReturnMotion("tools");
            setReturnNonce((n) => n + 1);
        }
    }, [phase]);

    // Play waits for the prefetch to settle (it may already have); then mounts the game.
    const play = useCallback(() => setPlayRequested(true), []);
    useEffect(() => {
        if (playRequested && phase === "title" && planned?.prefetchSettled) {
            setPlayRequested(false);
            setPhase("growing");
        }
    }, [playRequested, phase, planned?.prefetchSettled]);

    // Play must never stay disabled: a prefetch still unsettled PLAY_WAIT_TIMEOUT_MS after
    // the tap is given up (see the constant). Play is re-enabled rather than the game
    // opened outright, so a learner who waited that long chooses again — and with the plan
    // now settled, that next tap goes straight in. Timed from the tap, per plan: a plan
    // replaced mid-wait (an unplayable board moved on to another game) restarts the clock.
    const plannedId = planned?.id ?? null;
    const prefetchSettled = planned?.prefetchSettled ?? false;
    useEffect(() => {
        if (!playRequested || plannedId === null || prefetchSettled) return;
        const timer = window.setTimeout(() => {
            prefetchGaveUpRef.current = plannedId;
            console.warn("[GameBreak] prefetch still pending after Play; the Stage will deal its own board");
            setPlayRequested(false);
            setPlanned((p) => (p && p.id === plannedId && !p.prefetchSettled ? { ...p, prefetched: null, prefetchSettled: true } : p));
        }, PLAY_WAIT_TIMEOUT_MS);
        return () => window.clearTimeout(timer);
    }, [playRequested, plannedId, prefetchSettled]);

    const finishGrow = useCallback(() => {
        setPhase((p) => (p === "growing" ? "playing" : p));
    }, []);

    const finishRun = useCallback((run: FlpBreakResults) => {
        setResults(run);
        setPhase((p) => (p === "playing" ? "shrinking" : p));
    }, []);

    const finishShrink = useCallback(() => {
        setPhase((p) => (p === "shrinking" ? "results" : p));
    }, []);

    const beginLeave = useCallback(() => {
        setPlayRequested(false);
        if (phase === "title" || phase === "results") {
            // Skip, or the results card swiped off: the tools return WITH the card's
            // fly-off — the next card is already there.
            setPhase("skipping");
            setReturnMotion("tools");
            setReturnNonce((n) => n + 1);
        } else if (phase === "playing" || phase === "growing") {
            // `growing`: Leave is on screen from the grow's first frame (GameBreakChrome),
            // before any Stage exists. It cancels the break as a no-run exit does: the
            // area falls away, the half-grown circle with it (GameBreakArea).
            setPhase("leaving");
        }
    }, [phase]);

    const finishLeave = useCallback(() => {
        // Only the game's exit still owes a return; Skip played its own in `beginLeave`.
        if (phase === "leaving") {
            setReturnMotion("full");
            setReturnNonce((n) => n + 1);
        }
        previousKeyRef.current = planned?.candidate.key ?? previousKeyRef.current;
        setPlanned(null);
        setResults(null);
        // Played or skipped, the next break is BREAK_INTERVAL cards away (§ 1).
        setCardsSinceBreak(0);
        setPhase("cards");
    }, [planned, phase]);

    /**
     * End the visit's break state — a Deck Tower visit ended and the session was parked
     * (FlpTowerHost `parked`), so a pin opens the next visit again. The COUNT carries on
     * (§ 1 "The count persists"): it resumes where the visit left it, and a break left
     * mid-way (`MID_BREAK_PHASES`) resumes one card before it, so the break is re-planned
     * — possibly as another game — on the next visit's first card. Under a tester's pin
     * the count goes back to the stored, pre-pin figure. The return choreography still
     * plays (unseen, the session is hidden) so the word tools are back for the next visit.
     */
    const reset = useCallback(() => {
        forcedOpeningSpentRef.current = false;
        setPlayRequested(false);
        setAbandoned(false);
        setPlanned(null);
        setResults(null);
        setCardsSinceBreak(forced !== null ? readStoredProgress() : progressToResume(cardsSinceBreak, phase));
        if (phase !== "cards") setReturnNonce((n) => n + 1);
        setPhase("cards");
        // eslint-disable-next-line react-hooks/exhaustive-deps -- readStoredProgress reads userId/language/world, listed here
    }, [phase, cardsSinceBreak, forced, userId, language, world]);

    const stackHold: UseGameBreakReturn["stackHold"] =
        phase === "cards" ? (due ? "due" : null)
        : phase === "title" || phase === "skipping" || phase === "growing" || phase === "shrinking" || phase === "results" ? phase
        : "active";

    return {
        phase,
        due,
        stackHold,
        planned,
        results,
        playPending: playRequested && !planned?.prefetchSettled,
        areaMounted: phase === "growing" || phase === "playing" || phase === "shrinking" || phase === "leaving",
        stageMounted: phase === "playing" || phase === "shrinking" || phase === "leaving",
        returnNonce,
        returnMotion,
        noteDismissed,
        noteUndone,
        play,
        finishGrow,
        finishRun,
        finishShrink,
        beginLeave,
        finishLeave,
        reset,
    };
}
