import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "../../../../types";
import type { VocabEntry } from "../../types";
import type { CollectionRef } from "../../collectionRef";
import type { FlpWorld, StudyMode } from "../../../../../server/contracts/studyMode";
import { focusGameMinimum } from "../../../../../server/contracts/focusMode";
import { fetchFocusStatus } from "../../../../api/focusMode";
import {
    flpBreakCandidatesFor,
    flpBreakGameFor,
    pickBreakCandidate,
    type FlpBreakCandidate,
    type FlpBreakContext,
} from "../../../../games/flpBreak";

/** Cards per break: the 10th card is the last before a game (docs/FLP_GAME_BREAKS.md § 1). */
export const BREAK_INTERVAL = 10;

/**
 * Where the session is relative to a break.
 *   cards    — studying; a break may be DUE (the front card is the last before it).
 *   title    — the break's card is the top card of the stack (Skip / Play).
 *   skipping — Skip: the break's card is flying off, the next card already under it.
 *   growing  — Play: the card is growing into the game's panel.
 *   playing  — the game's Stage is mounted; its own results card ends with "Back to cards".
 *   leaving  — the game area is sliding away; the stack is still hidden behind it.
 */
export type GameBreakPhase = "cards" | "title" | "skipping" | "growing" | "playing" | "leaving";

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
    stackHold: "due" | "title" | "skipping" | "active" | null;
    /** The decided break, from the moment it fell due until it ends. */
    planned: PlannedBreak | null;
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
    /** The card finished growing into the game's panel: mount the game. */
    finishGrow: () => void;
    /** Skip, or the results card's "Back to cards": start the exit. */
    beginLeave: () => void;
    /** The exit animation finished: the break is over, the counter starts over. */
    finishLeave: () => void;
    /** Counter back to 0, no break in progress (a Deck Tower visit ended). */
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
    world: FlpWorld;
    language: Language;
    studyMode: StudyMode | null;
    collection: CollectionRef | null;
    workingLoop: readonly VocabEntry[];
    /** Suppress breaks entirely (e.g. while the card editor is open). */
    disabled?: boolean;
    /**
     * A tester's pinned candidate key (forcedBreak.ts): every next card is a break of this
     * game, instead of every BREAK_INTERVAL cards a random one. Ignored when it is not a
     * candidate here (docs/FLP_GAME_BREAKS.md § 10).
     */
    forcedKey?: string | null;
}): UseGameBreakReturn {
    const { world, language, studyMode, collection, workingLoop, disabled = false, forcedKey = null } = args;

    const [cardsSinceBreak, setCardsSinceBreak] = useState(0);
    const [phase, setPhase] = useState<GameBreakPhase>("cards");
    const [planned, setPlanned] = useState<PlannedBreak | null>(null);
    const [playRequested, setPlayRequested] = useState(false);
    const [returnNonce, setReturnNonce] = useState(0);
    const [returnMotion, setReturnMotion] = useState<BreakReturnMotion>("full");
    // The previous break's (game, mode), so the next one differs when it can (§ 3).
    const previousKeyRef = useRef<string | null>(null);
    // Source of PlannedBreak.id.
    const planIdRef = useRef(0);
    // False after unmount, so a prefetch landing after the learner left sets no state.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // Derived from the registry — enabled, language-gated, on this bar, with an adapter.
    const candidates = useMemo(() => flpBreakCandidatesFor(world, language), [world, language]);
    const forced = useMemo(() => candidates.find((c) => c.key === forcedKey) ?? null, [candidates, forcedKey]);

    // DUE: the front card is the last before the break. Gated on there being a game to
    // offer and on the loop not winding down (a 1-card loop is about to run dry; § 1).
    const due = phase === "cards"
        && !disabled
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
    // FOCUS MODE (docs/FOCUS_MODE.md § 5): in a focused world a break whose game needs more
    // of today's cards than are left is SKIPPED. Read once per due break; undefined until
    // read, null when focus does not apply (off, or a deck/collection session — a
    // hand-picked set ignores focus). A failed read means "not focused": never lose a
    // break to a network error.
    const [focusRemaining, setFocusRemaining] = useState<number | null | undefined>(undefined);
    useEffect(() => {
        if (!due) {
            setFocusRemaining(undefined);
            return;
        }
        if (collection) {
            setFocusRemaining(null);
            return;
        }
        let cancelled = false;
        fetchFocusStatus()
            .then((status) => {
                const own = status.worlds[world];
                if (!cancelled) setFocusRemaining(own?.on ? own.remaining ?? 0 : null);
            })
            .catch(() => !cancelled && setFocusRemaining(null));
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [due]);
    const focusRead = focusRemaining !== undefined;

    useEffect(() => {
        if (!due || planned || !focusRead) return;
        // A tester's pin narrows the pool to its one game (§ 10); the focus rule still holds.
        const pool = forced ? [forced] : candidates;
        // Only games today's focus set can fill; none → the break is skipped (§ 5).
        const playable = focusRemaining == null
            ? pool
            : pool.filter((c) => focusRemaining >= focusGameMinimum(c.game.gameId));
        const candidate = pickBreakCandidate(playable, previousKeyRef.current);
        const adapter = candidate ? flpBreakGameFor(candidate.game.gameId) : null;
        if (!candidate || !adapter) return;
        const context: FlpBreakContext = {
            language,
            world,
            studyMode,
            collection,
            seedIds: workingLoop.map((card) => card.id),
        };
        const id = ++planIdRef.current;
        setPlanned({ id, candidate, context, prefetched: null, prefetchSettled: false });
        // NOT cancelled by this effect's cleanup. The cleanup runs the moment `due` flips
        // false — which is exactly what dismissing the due card does (phase → title) —
        // so tying the result to it dropped every prefetch still in flight at the swipe,
        // leaving `prefetchSettled` false forever and Play disabled (fixed 2026-10-18).
        // A result is discarded only when its plan was REPLACED (undo off the due card,
        // or a StrictMode re-run) — matched by id — or the page has unmounted.
        const settle = (prefetched: unknown) => {
            if (!mountedRef.current) return;
            setPlanned((p) => (p && p.id === id ? { ...p, prefetched, prefetchSettled: true } : p));
        };
        adapter.prefetch(candidate, context)
            .then(settle)
            .catch((err) => {
                // Non-fatal: the Stage fetches its own opening board instead.
                console.error("[GameBreak] prefetch failed:", err);
                settle(null);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [due, focusRead]);

    // Undo can take the session back off the "due" card (counter 9 → 8): drop the plan,
    // so the break is re-decided — with a fresh seed — when it falls due again.
    useEffect(() => {
        if (phase === "cards" && !due && planned) setPlanned(null);
    }, [phase, due, planned]);

    const noteDismissed = useCallback(() => {
        setCardsSinceBreak((n) => n + 1);
        // The dismiss of the due card opens the break. Read from the render that
        // dispatched it — `due` cannot change between the swipe and this call.
        if (due && planned) setPhase("title");
    }, [due, planned]);

    const noteUndone = useCallback(() => {
        setCardsSinceBreak((n) => Math.max(0, n - 1));
        // Undo on the title card brings card 10 back and cancels the break (§ 2) — the
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

    const finishGrow = useCallback(() => {
        setPhase((p) => (p === "growing" ? "playing" : p));
    }, []);

    const beginLeave = useCallback(() => {
        setPlayRequested(false);
        if (phase === "title") {
            // Skip: the tools return WITH the card's fly-off — the next card is already there.
            setPhase("skipping");
            setReturnMotion("tools");
            setReturnNonce((n) => n + 1);
        } else if (phase === "playing") {
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
        // Played or skipped, the next break is BREAK_INTERVAL cards away (§ 1).
        setCardsSinceBreak(0);
        setPhase("cards");
    }, [planned, phase]);

    /**
     * Start the counter over with no break in progress — a Deck Tower visit ended and the
     * session was parked (FlpTowerHost `parked`), so the next visit counts its own
     * BREAK_INTERVAL. A break left mid-way is dropped; the return choreography still
     * plays (unseen, the session is hidden) so the word tools are back for the next visit.
     */
    const reset = useCallback(() => {
        setPlayRequested(false);
        setPlanned(null);
        setCardsSinceBreak(0);
        if (phase !== "cards") setReturnNonce((n) => n + 1);
        setPhase("cards");
    }, [phase]);

    const stackHold: UseGameBreakReturn["stackHold"] =
        phase === "cards" ? (due ? "due" : null)
        : phase === "title" || phase === "skipping" ? phase
        : "active";

    return {
        phase,
        due,
        stackHold,
        planned,
        playPending: playRequested && !planned?.prefetchSettled,
        areaMounted: phase === "growing" || phase === "playing" || phase === "leaving",
        stageMounted: phase === "playing" || phase === "leaving",
        returnNonce,
        returnMotion,
        noteDismissed,
        noteUndone,
        play,
        finishGrow,
        beginLeave,
        finishLeave,
        reset,
    };
}
