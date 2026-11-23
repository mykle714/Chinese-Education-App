import type { VocabEntry } from "../../../../types";
import type { FlpWorld } from "../../../../../server/contracts/studyMode";
import { DECK_REVIEW_LINES, WRONG_STREAK_LINES, type WrongStreakCondition } from "./pawnHintLines";
import { WORLD_MARK_TYPES } from "../../../../../server/contracts/mastery";
import type { TypedMarkHistory } from "../../../../../server/contracts/wire";
import { getBreakdownItems } from "../../../../utils/breakdownUtils";

/**
 * pawnHints — WHAT the hint pawn has to say about the card on top, as plain data
 * (docs/HINT_PAWN.md § "Hints"). HintPawn.tsx decides when and how it is said;
 * PawnHintBody.tsx draws a hint's body by its `kind`.
 *
 * A hint is a discriminated union so each world can add its own kind without touching
 * the pawn: add a variant here, its entry in `PAWN_BUBBLE_VARIANT`, a case in
 * `pawnHintFor`, and a case in PawnHintBody.
 * Main (core) and reading have `wrong-streak`, a study tip shown only on a card whose last
 * `WRONG_STREAK_LENGTH` marks in the world were all wrong. Writing has no card hint of its
 * own: its used-in hint was dropped on 2026-11-22, when the writing card started naming
 * the words its character comes from itself (WritingSourceWords.tsx). Every world
 * also has `deck-review`, a session-level line said on a dive's first card when most of the
 * deck is review (Comfortable + Mastered); it outranks the card's own hint. A card with
 * no hint returns null and the pawn says nothing (it is mounted in every world, owner's
 * call 2026-11-08).
 *
 * Layer: flp page logic (client). Pure.
 *
 * Depended on by: FlashcardsLearnPage.tsx (`pawnHintFor`), hintPawn/HintPawn.tsx,
 * hintPawn/PawnHintBody.tsx, src/__tests__/wrongStreakHint.test.ts.
 */

interface PawnHintBase {
    /**
     * Identity of this hint. A new key pops the old bubble and grows a new one, with the
     * next line. Carries the card id, so the same words on the next card still read as a
     * fresh hint.
     */
    key: string;
    /** The kind's whole line collection (pawnHintLines.ts); also its shuffle bag's size. */
    lines: readonly string[];
    /**
     * Which of `lines` fit this card, index for index. Absent = all of them. The bag skips
     * an ineligible line rather than dropping it (hintPawnVisit.ts → `takeHintLineIndex`).
     */
    eligible?: readonly boolean[];
}

/**
 * Main and reading's wrong-streak hint: the learner keeps getting this card wrong, so the
 * pawn suggests a way to study it (WRONG_STREAK_LINES). Just a line, no extra content.
 */
export interface WrongStreakPawnHint extends PawnHintBase {
    kind: "wrong-streak";
}

/**
 * Every world's deck-review hint (owner, 2026-11-21): most of the deck this dive studies is
 * Comfortable + Mastered cards, so the pawn reassures the learner (DECK_REVIEW_LINES). Said
 * on the dive's first card only, and ahead of that card's own hint. Just a line.
 */
export interface DeckReviewPawnHint extends PawnHintBase {
    kind: "deck-review";
}

export type PawnHint = WrongStreakPawnHint | DeckReviewPawnHint;

/**
 * The two dialogue-box variants (owner, 2026-11-08; docs/HINT_PAWN.md § "Bubble variants").
 * PawnHintBody lays the bubble out by variant, not by kind:
 *
 *   text   the line alone. It wraps, and the dismiss cue sits beside it in the bottom-right.
 *   cpcd   the line, then a row of cpcd words. The line NEVER wraps (one line, ellipsis as
 *          a safety net), so the words below it are never pushed off the bubble's bottom;
 *          the dismiss cue sits in the words' row, taking its width from the words rather
 *          than from the line. Every line of a cpcd kind must fit on one line
 *          (pawnHintLines.ts → `CPCD_LINE_MAX_CHARS`). No kind uses it today (the
 *          writing world's used-in hint, its one user, was removed 2026-11-22).
 */
export type PawnBubbleVariant = "text" | "cpcd";

/**
 * Each hint kind's dialogue-box variant. A Record, so a new kind must pick one before it
 * type-checks.
 */
export const PAWN_BUBBLE_VARIANT: Record<PawnHint["kind"], PawnBubbleVariant> = {
    "wrong-streak": "text",
    "deck-review": "text",
};

/**
 * The bands that count as REVIEW for the deck-review hint. Bands not listed here
 * (Unfamiliar, Target) are the learning side.
 */
const REVIEW_BANDS = ["Comfortable", "Mastered"] as const;
/** The four utcm bands the deck is made of (towerModes.ts → `TOWER_MODES.mix.bands`). */
const DECK_BANDS = ["Unfamiliar", "Target", "Comfortable", "Mastered"] as const;

/**
 * The smallest deck the deck-review line is said for, in ready cards across all four bands
 * (owner, 2026-11-21). A small deck that happens to be mostly review is not worth the line.
 */
export const DECK_REVIEW_MIN_CARDS = 40;

/**
 * Whether most of a deck is review cards: the deck holds at least `DECK_REVIEW_MIN_CARDS`
 * ready cards, and Comfortable + Mastered make up STRICTLY more than half of the four bands
 * (owner, 2026-11-21: "the majority"). `counts` is the world's off-cooldown cards per band —
 * useFlpReadyCounts' `counts`, the figure the Learning tower stands at (passed in as
 * `FlpTowerHost.readyBandCounts`).
 */
export function isReviewHeavyDeck(counts: Readonly<Record<string, number>> | undefined): boolean {
    if (!counts) return false;
    const sum = (bands: readonly string[]) => bands.reduce((total, band) => total + (counts[band] || 0), 0);
    const total = sum(DECK_BANDS);
    return total >= DECK_REVIEW_MIN_CARDS && sum(REVIEW_BANDS) * 2 > total;
}

/**
 * The deck-review hint for one dive. `diveKey` names the dive (useDeckReviewHint), so each
 * dive's line is a fresh bubble, and re-renders keep the same one.
 */
function deckReviewHint(diveKey: string): DeckReviewPawnHint {
    return { kind: "deck-review", key: `deck-review|${diveKey}`, lines: DECK_REVIEW_LINES };
}

/** How many newest marks in a row must be wrong for the wrong-streak hint (owner, 2026-11-08). */
export const WRONG_STREAK_LENGTH = 3;

/**
 * Whether the newest `WRONG_STREAK_LENGTH` marks of `world`'s tracks are all wrong.
 *
 * Main (core) has two tracks, recognition and production. They are merged by timestamp
 * (owner's call 2026-11-08), so a card failed on alternating faces still counts. A card with
 * fewer marks than the streak never qualifies. Writing's clock-only dummy marks are skipped:
 * they record no answer (ReviewMark.clockOnly, migration 170).
 */
export function hasWrongStreak(history: TypedMarkHistory | undefined, world: FlpWorld): boolean {
    if (!history) return false;
    const marks = WORLD_MARK_TYPES[world]
        .flatMap((type) => history[type] ?? [])
        .filter((mark) => !mark.clockOnly)
        // ISO-8601 strings, so Date.parse orders them; newest first.
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .slice(0, WRONG_STREAK_LENGTH);
    return marks.length === WRONG_STREAK_LENGTH && marks.every((mark) => !mark.isCorrect);
}

/** Whether `entry` meets a wrong-streak line's condition. */
function meetsCondition(entry: VocabEntry, condition: WrongStreakCondition): boolean {
    switch (condition) {
        case "breakdown":
            // Multi-character only (a single character's eip tab is "used in", not a
            // breakdown — infoCardTabAvailability.ts), and only with items to show.
            return [...entry.entryKey].length > 1 && getBreakdownItems(entry).length > 0;
        case "examples":
            return (entry.exampleSentences?.length ?? 0) > 0;
    }
}

/** The wrong-streak lines' text, in collection order (the mask in `eligible` lines up with it). */
const WRONG_STREAK_TEXT: readonly string[] = WRONG_STREAK_LINES.map((hint) => hint.line);

/** The front card's wrong-streak hint, or null when its last marks are not all wrong. */
function wrongStreakHint(world: FlpWorld, entry: VocabEntry): WrongStreakPawnHint | null {
    if (!hasWrongStreak(entry.typedMarkHistory, world)) return null;
    return {
        kind: "wrong-streak",
        key: `wrong-streak|${entry.id}`,
        lines: WRONG_STREAK_TEXT,
        eligible: WRONG_STREAK_LINES.map((hint) => !hint.requires || meetsCondition(entry, hint.requires)),
    };
}

/**
 * The hint for the front card in `world`, or null when the pawn has nothing to say.
 * `deckReviewKey` (useDeckReviewHint): set while the front card is a review-heavy dive's
 * first card, and then the deck-review line wins over the card's own hint.
 */
export function pawnHintFor(world: FlpWorld, entry: VocabEntry | null, deckReviewKey?: string | null): PawnHint | null {
    if (!entry) return null;
    if (deckReviewKey) return deckReviewHint(deckReviewKey);
    switch (world) {
        case "writing":
            // The card names its source words itself (WritingSourceWords.tsx).
            return null;
        case "core":
        case "reading":
            return wrongStreakHint(world, entry);
    }
}
