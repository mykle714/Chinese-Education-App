import { useEffect, useSyncExternalStore } from "react";

/**
 * hintPawnVisit — the hint pawn's state that outlives one flp session but not one Deck
 * Tower VISIT (docs/HINT_PAWN.md § "Dismissing" and § "The lines").
 *
 *   dismissed   the learner swiped the pawn away. It stays away for the rest of the visit:
 *               across parking and re-diving, in every world (the sessions are separate
 *               FlashcardsLearnPage mounts, so this cannot be component state). Leaving td,
 *               or reloading, brings it back.
 *   bags        one shuffle bag PER HINT KIND (owner's call 2026-11-08: lines in random
 *               order): the line indices not yet said this round, in a random order. Each
 *               hint shown takes one; when it runs out it is reshuffled, so every line is
 *               said once per round and no line repeats back to back across a reshuffle.
 *               Per kind, so the used-in lines and the wrong-streak hints keep separate
 *               rounds. Visit-scoped, so a new session continues the round instead of
 *               starting a fresh one. The tap "ouch" lines have a bag of their own too,
 *               under `OUCH_LINE_BAG` (pawnHintLines.ts), beside the hint kinds'.
 *
 * Layer: feature store (features/flashcards). A module-level store, like forcedBreak.ts,
 * because the writer (a session's HintPawn) and the scope owner (DeckTowerPage) are in
 * different trees. DeckTowerPage calls `useHintPawnVisit()` once, which starts a fresh
 * visit on mount; the store is NOT reset on unmount, so a session still fading out cannot
 * read a half-reset state.
 *
 * Depended on by: hintPawn/HintPawn.tsx (reads + writes), deckTower/DeckTowerPage.tsx
 * (`useHintPawnVisit`).
 */

/** One hint kind's shuffle bag. */
interface LineBag {
    /** Line indices left this round, taken from the end. */
    bag: number[];
    /** How many lines the bag was dealt for (a changed collection re-deals it). */
    lineCount: number;
    /** The index said last, so a reshuffle never puts it first. -1 = none yet. */
    lastLine: number;
}

interface VisitState {
    dismissed: boolean;
    /** Keyed by hint kind (`PawnHint["kind"]`), plus `OUCH_LINE_BAG` for the tap lines. */
    bags: Record<string, LineBag>;
}

const FRESH_VISIT: VisitState = { dismissed: false, bags: {} };
const EMPTY_BAG: LineBag = { bag: [], lineCount: 0, lastLine: -1 };
let state: VisitState = FRESH_VISIT;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function emit(next: VisitState): void {
    state = next;
    listeners.forEach((listener) => listener());
}

/** The learner swiped the pawn away: hidden in every world until the visit ends. */
export function dismissHintPawn(): void {
    if (!state.dismissed) emit({ ...state, dismissed: true });
}

/**
 * A fresh round of `lineCount` indices in random order (Fisher–Yates), arranged so that
 * the first one TAKEN (the array's end) is not `avoid` — no line twice in a row across
 * rounds. `random` is injectable for tests.
 */
export function dealLineBag(lineCount: number, avoid: number, random: () => number = Math.random): number[] {
    const bag = Array.from({ length: lineCount }, (_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag.length > 1 && bag[bag.length - 1] === avoid) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    return bag;
}

/**
 * The position (in `bag`) of the next index to take: the last eligible one, skipping
 * `avoid` while another eligible index is left. -1 when nothing in the bag is eligible.
 */
function pickPosition(bag: number[], isEligible: (index: number) => boolean, avoid: number): number {
    let fallback = -1;
    for (let pos = bag.length - 1; pos >= 0; pos--) {
        if (!isEligible(bag[pos])) continue;
        if (bag[pos] !== avoid) return pos;
        if (fallback === -1) fallback = pos;
    }
    return fallback;
}

/**
 * Take the next line index (0-based, out of `lineCount`) from `kind`'s shuffle bag, dealing
 * a new round when it is empty. Not a subscribed value: the caller freezes the index it took
 * onto the hint it is showing.
 *
 * `isEligible` filters the collection per card (the wrong-streak hints have conditions,
 * e.g. the breakdown hint needs a multi-character card). The bag is always dealt over the
 * WHOLE collection and an ineligible index is skipped, not removed, so it stays in the round
 * for a later card it does fit. A round with nothing eligible left is re-dealt; its skipped
 * leftovers are dropped with it, since every line this card can use has been said.
 * Returns 0 when no line is eligible at all (callers keep one unconditional line).
 */
export function takeHintLineIndex(
    kind: string,
    lineCount: number,
    isEligible: (index: number) => boolean = () => true,
): number {
    const current = state.bags[kind] ?? EMPTY_BAG;
    let bag = current.lineCount === lineCount ? current.bag : [];
    let pos = pickPosition(bag, isEligible, current.lastLine);
    if (pos === -1) {
        bag = dealLineBag(lineCount, current.lastLine);
        pos = pickPosition(bag, isEligible, current.lastLine);
        if (pos === -1) return 0;
    }
    const index = bag[pos];
    const nextBag: LineBag = { bag: bag.filter((_, i) => i !== pos), lineCount, lastLine: index };
    state = { ...state, bags: { ...state.bags, [kind]: nextBag } };
    return index;
}

/** Whether the pawn was swiped away this visit. */
export function useHintPawnDismissed(): boolean {
    return useSyncExternalStore(subscribe, () => state.dismissed);
}

/** Called once by DeckTowerPage: a new td visit brings the pawn back and deals the lines afresh. */
export function useHintPawnVisit(): void {
    useEffect(() => {
        emit(FRESH_VISIT);
    }, []);
}
