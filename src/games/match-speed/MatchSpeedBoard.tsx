import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import type { Language, VocabEntry } from "../../types";
import MatchSpeedCard from "./MatchSpeedCard";
import type { BoardCard, CardPair, CardVisualState, Slot } from "./types";
import {
    CARD_ASPECT,
    COL_GAP_PX,
    FADE_IN_MAX_DELAY_MS,
    POP_DURATION_MS,
    REFILL_TICK_MS,
    ROWS,
    ROW_GAP_PX,
    WRONG_FEEDBACK_MS,
} from "./constants";

interface MatchSpeedBoardProps {
    language: Language;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** Draw up to `count` pairs from the page's buffer. May return fewer (or none)
     *  when the buffer is starved; the board leaves those slots empty for the next
     *  tick rather than stalling. */
    drawPairs: (count: number) => CardPair[];
    /** Fired after each refill tick so the page can top the buffer back up. */
    onRefilled: () => void;
    /** A correct match: score it and mark the entry correct. */
    onMatch: (entry: VocabEntry) => void;
    /** A wrong attempt, always reported with the FOREIGN card's entry. */
    onMiss: (entry: VocabEntry) => void;
    /** Freezes the refill tick and switches taps to no-stakes cleanup behavior. */
    cleanupMode: boolean;
    /** While true the board renders but ignores taps and never refills (the 3·2·1
     *  countdown, so the opening board is readable but not yet playable). */
    frozen: boolean;
    /** Speak a foreign word on tap (autoplay enabled), else undefined. */
    onSpeak?: (entry: VocabEntry) => void;
}

/** Both columns of slots, mutated as one atomic unit (see the state comment). */
interface Board {
    foreign: Slot[];
    english: Slot[];
}

/** Indices of the empty slots in a column. */
function emptyIndices(slots: Slot[]): number[] {
    return slots.reduce<number[]>((acc, slot, i) => (slot === null ? [...acc, i] : acc), []);
}

/** Fisher-Yates. Used to scatter a refill batch across the vacated rows. */
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Match Speed — the 2 × ROWS board: slot state, tap/selection rules, and the
 * global refill tick.
 *
 * Layer: feature component. It owns board state only; scoring, marks, the run
 * clock, and the card supply all live on the page and arrive as props.
 *
 * MODELED AS TWO FIXED SLOT ARRAYS, not a list of live cards. That is what makes
 * "new cards drop into the vacated rows, surviving cards never move" fall out for
 * free, and it keeps React keys stable so a surviving card's DOM node is never
 * re-created mid-tap.
 *
 * The board can never hold a half-pair: cards leave ONLY as a matched pair (both
 * members pop together) and a wrong attempt removes nothing, so the left column's
 * empty count always equals the right's and a refill can always place whole pairs.
 * That invariant is what lets the fill logic be trivial — it is asserted in dev
 * below rather than silently assumed.
 *
 * See docs/MATCH_SPEED_GAME.md § Board model and § The 2-second refill tick.
 */
const MatchSpeedBoard: React.FC<MatchSpeedBoardProps> = ({
    language,
    showPinyin,
    showPinyinColor,
    drawPairs,
    onRefilled,
    onMatch,
    onMiss,
    cleanupMode,
    frozen,
    onSpeak,
}) => {
    // BOTH columns live in ONE state object on purpose. Every mutation the board
    // makes (refill, pop-out removal, marking a pair as exiting) touches both
    // columns at once and must be atomic — two separate useStates would need one
    // updater to read the other's committed value, which is only reachable by
    // nesting setState calls inside an updater (a side effect React re-runs under
    // StrictMode). One object, one updater, no cross-reads.
    const [board, setBoard] = useState<Board>(() => ({
        foreign: Array(ROWS).fill(null),
        english: Array(ROWS).fill(null),
    }));
    const { foreign: foreignSlots, english: englishSlots } = board;

    // Ref mirror of `board`, kept in lockstep by `updateBoard` below.
    //
    // Every board mutation needs to know what it actually did (did the refill place
    // anything? was that pair still present?) in the same statement that applies it
    // — a `setBoard(prev => …)` updater can't answer that, because React runs it
    // later and, under StrictMode, twice. Computing against the ref makes each
    // mutation synchronous and single-shot, which is what lets the refill fire its
    // buffer top-up exactly once, for exactly the number of pairs it consumed.
    const boardRef = useRef<Board>(board);

    /** Apply a pure board transform: compute from the ref, commit to both. */
    const updateBoard = useCallback((fn: (prev: Board) => Board): Board => {
        const next = fn(boardRef.current);
        boardRef.current = next;
        setBoard(next);
        return next;
    }, []);
    // ---- Card sizing --------------------------------------------------------
    // Cards are locked to CARD_ASPECT (2:1). CSS alone can't satisfy a fixed ratio
    // against BOTH a width and a height constraint — `aspect-ratio` derives the
    // second dimension from the first, and a max-* clamp on the derived side
    // silently breaks the ratio rather than re-deriving it. So the board measures
    // its own box and picks the one card height that fits in both directions;
    // whichever axis is tighter wins, and the grid is centered in the slack.
    const gridElRef = useRef<HTMLDivElement | null>(null);
    const [cardHeight, setCardHeight] = useState<number | null>(null);
    useLayoutEffect(() => {
        const el = gridElRef.current;
        if (!el) return;
        const measure = () => {
            // clientWidth/Height, not getBoundingClientRect: this element carries no
            // padding or border, and these ignore any transform an entry animation
            // on an ancestor might be mid-way through applying.
            const fromHeight = (el.clientHeight - (ROWS - 1) * ROW_GAP_PX) / ROWS;
            const fromWidth = (el.clientWidth - COL_GAP_PX) / 2 / CARD_ASPECT;
            setCardHeight(Math.max(0, Math.min(fromHeight, fromWidth)));
        };
        measure();
        // Re-measure on rotation, keyboard, or the leaf page's slide-in settling.
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    const cardWidth = cardHeight === null ? 0 : cardHeight * CARD_ASPECT;

    /** The currently selected card's id, or null. */
    const [selectedId, setSelectedId] = useState<string | null>(null);
    /** Card ids flashing red from a wrong attempt. */
    const [wrongIds, setWrongIds] = useState<string[]>([]);
    /** Cleanup mode only: the partner card being highlighted light green. */
    const [hintedId, setHintedId] = useState<string | null>(null);

    // Timers owned by this component, cleared on unmount so a pop/flash callback
    // can never fire into an unmounted tree (or into the NEXT run after a replay).
    const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const later = useCallback((fn: () => void, ms: number) => {
        const id = setTimeout(fn, ms);
        timeoutsRef.current.push(id);
    }, []);
    useEffect(
        () => () => {
            timeoutsRef.current.forEach(clearTimeout);
            timeoutsRef.current = [];
        },
        []
    );

    // Props read by the interval callback. Held in refs so the interval can be
    // started ONCE and never torn down mid-run: re-creating it on every render
    // would restart the 2s cadence continuously and the board would refill on a
    // schedule the player can't feel.
    const drawPairsRef = useRef(drawPairs);
    const onRefilledRef = useRef(onRefilled);
    useEffect(() => {
        drawPairsRef.current = drawPairs;
        onRefilledRef.current = onRefilled;
    });

    /**
     * One refill tick: fill every empty slot with fresh pairs.
     *
     * Placement is independently random per column — a pair's foreign card lands
     * in a random empty LEFT slot and its english card in a random empty RIGHT
     * slot — so vertical alignment never hints at which cards pair up.
     */
    const refill = useCallback(() => {
        // How many pairs this tick actually placed. Set inside the transform and
        // read straight after it, which is sound because updateBoard is synchronous.
        let placed = 0;

        updateBoard((prev) => {
            const foreignHoles = emptyIndices(prev.foreign);
            const englishHoles = emptyIndices(prev.english);

            if (import.meta.env.DEV && foreignHoles.length !== englishHoles.length) {
                // The half-pair invariant broke. Refilling would place cards whose
                // partner isn't on the board, so surface it loudly in dev rather
                // than letting the board quietly become unwinnable.
                console.error(
                    `[MatchSpeed] slot invariant violated: ${foreignHoles.length} foreign holes vs ${englishHoles.length} english holes`
                );
            }

            const count = Math.min(foreignHoles.length, englishHoles.length);
            if (count === 0) return prev;

            const pairs = drawPairsRef.current(count);
            if (pairs.length === 0) return prev;
            placed = pairs.length;

            // Scatter the batch across the vacated rows independently per column,
            // so a pair's two rows are uncorrelated.
            const foreignTargets = shuffle(foreignHoles).slice(0, pairs.length);
            const englishTargets = shuffle(englishHoles).slice(0, pairs.length);

            const nextForeign = [...prev.foreign];
            const nextEnglish = [...prev.english];
            pairs.forEach((pair, i) => {
                // Both members share one stagger delay so a pair fades in together
                // — two halves of the same pair arriving 400ms apart would read as
                // two unrelated cards.
                const fadeDelayMs = Math.random() * FADE_IN_MAX_DELAY_MS;
                const base = { pairId: pair.pairId, entry: pair.entry, fadeDelayMs, exiting: false };
                nextForeign[foreignTargets[i]] = { ...base, id: `${pair.pairId}-foreign`, side: "foreign" };
                nextEnglish[englishTargets[i]] = { ...base, id: `${pair.pairId}-english`, side: "english" };
            });
            return { foreign: nextForeign, english: nextEnglish };
        });

        // TEMPORARY DIAGNOSTIC (dev only) — timestamps each refill so a dead tap can
        // be correlated against the tick that supposedly caused it. Remove with the
        // TAP/POINTERDOWN probes.
        if (import.meta.env.DEV) {
            const ids = (slots: Slot[]) => slots.map((s) => s?.id ?? "—").join(" | ");
            console.log(
                `[MatchSpeed] REFILL placed=${placed}\n  foreign: ${ids(boardRef.current.foreign)}\n  english: ${ids(boardRef.current.english)}`
            );
        }

        // Fire the buffer top-up for what this tick consumed. NEVER awaited — the
        // tick must not be able to stall on the network.
        if (placed > 0) onRefilledRef.current();
    }, [updateBoard]);

    // Prime the opening board immediately on mount, so the player has something to
    // read during the countdown rather than watching an empty grid for 2 seconds.
    useEffect(() => {
        refill();
    }, [refill]);

    // THE global refill interval — one timer for the whole board, started once.
    // Deliberately NOT per-hole: a pair matched right after a tick leaves a hole
    // for nearly 2s, which is the game's pacing pressure. Stopped while frozen
    // (countdown) or in cleanup (the run is over; the board only drains).
    useEffect(() => {
        if (frozen || cleanupMode) return;
        const id = setInterval(refill, REFILL_TICK_MS);
        return () => clearInterval(id);
    }, [frozen, cleanupMode, refill]);

    /** Remove a matched pair from both columns once its pop animation finishes,
     *  leaving two holes for the next refill tick. */
    const removePair = useCallback(
        (pairId: string) => {
            const clear = (slots: Slot[]) => slots.map((s) => (s?.pairId === pairId ? null : s));
            updateBoard((prev) => ({ foreign: clear(prev.foreign), english: clear(prev.english) }));
        },
        [updateBoard]
    );

    /** Flag both members of a pair as exiting so they play the pop together. */
    const markPairExiting = useCallback(
        (pairId: string) => {
            const flag = (slots: Slot[]) =>
                slots.map((s) => (s?.pairId === pairId ? { ...s, exiting: true } : s));
            updateBoard((prev) => ({ foreign: flag(prev.foreign), english: flag(prev.english) }));
        },
        [updateBoard]
    );

    /** Look a card up by id across both columns. */
    const findCard = useCallback(
        (id: string): BoardCard | null =>
            [...foreignSlots, ...englishSlots].find((s) => s?.id === id) ?? null,
        [foreignSlots, englishSlots]
    );

    const handleTap = useCallback(
        (card: BoardCard) => {
            // TEMPORARY DIAGNOSTIC (dev only) — chasing "cards visible but taps do
            // nothing during a refill". Logs that the click actually reached the
            // handler and, if it no-ops, exactly which guard ate it. Remove once the
            // cause is found. Pair with the pointerdown probe in MatchSpeedCard: a
            // pointerdown with no matching TAP line means the click never fired.
            if (import.meta.env.DEV) {
                console.log(
                    `[MatchSpeed] TAP ${card.id} frozen=${frozen} exiting=${card.exiting} cleanup=${cleanupMode} selected=${selectedId}`
                );
            }
            if (frozen) return; // countdown: the board is readable but not live
            if (card.exiting) return; // already popping out

            // Speak the word on any foreign-card tap (autoplay only).
            if (card.side === "foreign") onSpeak?.(card.entry);

            // ---- Cleanup mode: a no-stakes study surface -----------------------
            // Tapping a card highlights its partner light green; tapping the
            // partner clears the pair. No marks, no score, no refill.
            if (cleanupMode) {
                if (selectedId === card.id) {
                    setSelectedId(null);
                    setHintedId(null);
                    return;
                }
                const selected = selectedId ? findCard(selectedId) : null;
                if (selected && selected.side !== card.side && selected.pairId === card.pairId) {
                    markPairExiting(card.pairId);
                    later(() => removePair(card.pairId), POP_DURATION_MS);
                    setSelectedId(null);
                    setHintedId(null);
                    return;
                }
                setSelectedId(card.id);
                // Reveal the partner rather than punishing the miss — cleanup is
                // for studying the words the run left behind.
                const partner = [...foreignSlots, ...englishSlots].find(
                    (s) => s?.pairId === card.pairId && s.id !== card.id
                );
                setHintedId(partner?.id ?? null);
                return;
            }

            // ---- Live play -----------------------------------------------------
            // Tapping the selected card deselects it.
            if (selectedId === card.id) {
                setSelectedId(null);
                return;
            }
            const selected = selectedId ? findCard(selectedId) : null;

            // Nothing selected, or a tap in the SAME column: same-column cards can
            // never be a pair, so this is never an attempt — it just moves the
            // selection. Making it an attempt would spend a wrong mark on a tap
            // the player couldn't possibly have meant as a guess.
            if (!selected || selected.side === card.side) {
                setSelectedId(card.id);
                return;
            }

            // Opposite column → this is a match attempt.
            const foreignEntry = (selected.side === "foreign" ? selected : card).entry;
            if (selected.pairId === card.pairId) {
                onMatch(foreignEntry);
                markPairExiting(card.pairId);
                later(() => removePair(card.pairId), POP_DURATION_MS);
                setSelectedId(null);
                return;
            }

            // Wrong. Both flash red and deselect, and the FOREIGN card takes the
            // incorrect mark — this is a recognition drill, so the failure is
            // "didn't know what the foreign word means". Marking the english card
            // too would penalize a word the player may know perfectly well.
            // The board stays live throughout the flash; taps are not swallowed.
            onMiss(foreignEntry);
            const flashing = [selected.id, card.id];
            setWrongIds(flashing);
            setSelectedId(null);
            later(
                () => setWrongIds((prev) => prev.filter((id) => !flashing.includes(id))),
                WRONG_FEEDBACK_MS
            );
        },
        [
            frozen,
            cleanupMode,
            selectedId,
            findCard,
            foreignSlots,
            englishSlots,
            markPairExiting,
            removePair,
            later,
            onMatch,
            onMiss,
            onSpeak,
        ]
    );

    /** Resolve one card's visual state; the card component renders it and nothing more. */
    const visualState = (card: BoardCard): CardVisualState => {
        // SELECTION OUTRANKS THE WRONG FLASH, and that order is load-bearing.
        // The `wrong` style overrides background, border AND the selection lift, so
        // with the old precedence a card re-tapped during its own 400ms flash was
        // genuinely selected but drew as an ordinary card — no border, no lift, no
        // acknowledgement. The player reads that as the board being locked during
        // the flash-fade, which is the one thing this game promises never happens
        // (docs/MATCH_SPEED_GAME.md § Selection is never locked). A player who has
        // moved on to their next guess is owed feedback about THAT guess, not a
        // replay of the mistake they already know about.
        if (card.id === selectedId) return "selected";
        if (wrongIds.includes(card.id)) return "wrong";
        if (cleanupMode && card.id === hintedId) return "partner-hint";
        return "idle";
    };

    const renderColumn = (slots: Slot[], side: "foreign" | "english") => (
        <Box
            className={`match-speed__column match-speed__column--${side}`}
            sx={{
                display: "flex",
                flexDirection: "column",
                gap: `${ROW_GAP_PX}px`,
                // Width comes from the measured card size, not from a flex share, so
                // every card is the same 2:1 rectangle. See the sizing block above.
                width: `${cardWidth}px`,
            }}
        >
            {slots.map((slot, row) => (
                <Box
                    key={`${side}-${row}`}
                    className="match-speed__cell"
                    // Height is fixed per cell rather than shared via 1fr: an empty
                    // slot must hold its row open, or surviving cards would slide
                    // around whenever a pair pops.
                    sx={{ height: `${cardHeight ?? 0}px`, width: "100%", display: "flex" }}
                >
                    {slot && (
                        <MatchSpeedCard
                            // Keyed by card id, not row: a surviving card keeps its
                            // DOM node (and its in-flight animation) when the board
                            // around it refills.
                            key={slot.id}
                            card={slot}
                            state={visualState(slot)}
                            language={language}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            onTap={handleTap}
                        />
                    )}
                </Box>
            ))}
        </Box>
    );

    return (
        // Outer box owns the padding; the inner one is the measured box (so the
        // padding can't be double-counted into the card size).
        <Box
            className="match-speed__board"
            sx={{
                flex: 1,
                minHeight: 0,
                px: 1.5,
                py: 1.5,
                // Taps only — the board never scrolls (project-wide default).
                touchAction: "none",
            }}
        >
            <Box
                ref={gridElRef}
                className="match-speed__grid"
                sx={{
                    height: "100%",
                    width: "100%",
                    display: "flex",
                    gap: `${COL_GAP_PX}px`,
                    // Centered in whatever slack the tighter axis left over.
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {/* Rendered only once measured — a pre-measure paint would flash
                    zero-height cards and restart every card's fade-in. */}
                {cardHeight !== null && (
                    <>
                        {renderColumn(foreignSlots, "foreign")}
                        {renderColumn(englishSlots, "english")}
                    </>
                )}
            </Box>
        </Box>
    );
};

export default MatchSpeedBoard;
