import type { UsedInItem, VocabEntry } from "../../../../types";
import type { FlpWorld } from "../../../../../server/contracts/studyMode";
import { previewShowsWholeCharacter } from "../../../../components/handwriting/levelBehavior";
import { modeOfLevel, writingLevelForMastery } from "../../../../../server/contracts/writingLevels";
import { USED_IN_LINES, WRONG_STREAK_LINES, type WrongStreakCondition } from "./pawnHintLines";
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
 * Writing has `used-in`; main (core) and reading have `wrong-streak`, a study tip shown only
 * on a card whose last `WRONG_STREAK_LENGTH` marks in the world were all wrong. A card with
 * no hint returns null and the pawn says nothing (it is mounted in every world, owner's
 * call 2026-11-08).
 *
 * Layer: flp page logic (client). Pure.
 *
 * Depended on by: FlashcardsLearnPage.tsx (`pawnHintFor`), hintPawn/HintPawn.tsx,
 * hintPawn/PawnHintBody.tsx, src/__tests__/wrongStreakHint.test.ts.
 */

/** Most used-in words shown — matches the server's writingUsedIn limit (decided 2026-10-04). */
const MAX_USED_IN_WORDS = 2;

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
 * The writing world's used-in hint (moved here from the card-edge bubbles,
 * WritingUsedInBubbles, deleted 2026-11-08): words that contain the card's character.
 */
export interface UsedInPawnHint extends PawnHintBase {
    kind: "used-in";
    items: UsedInItem[];
    /**
     * The card's character, drawn as ? wherever it appears in a word — or undefined at
     * levels 1–3 (Snap / Trace / Step Through), whose card front already previews the
     * whole character, so masking it would hide nothing (decided 2026-10-04).
     */
    maskChar: string | undefined;
}

/**
 * Main and reading's wrong-streak hint: the learner keeps getting this card wrong, so the
 * pawn suggests a way to study it (WRONG_STREAK_LINES). Just a line, no extra content.
 */
export interface WrongStreakPawnHint extends PawnHintBase {
    kind: "wrong-streak";
}

export type PawnHint = UsedInPawnHint | WrongStreakPawnHint;

/**
 * The two dialogue-box variants (owner, 2026-11-08; docs/HINT_PAWN.md § "Bubble variants").
 * PawnHintBody lays the bubble out by variant, not by kind:
 *
 *   text   the line alone. It wraps, and the dismiss cue sits beside it in the bottom-right.
 *   cpcd   the line, then a row of cpcd words. The line NEVER wraps (one line, ellipsis as
 *          a safety net), so the words below it are never pushed off the bubble's bottom;
 *          the dismiss cue sits in the words' row, taking its width from the words rather
 *          than from the line. Every line of a cpcd kind must fit on one line
 *          (pawnHintLines.ts → `CPCD_LINE_MAX_CHARS`).
 */
export type PawnBubbleVariant = "text" | "cpcd";

/**
 * Each hint kind's dialogue-box variant. A Record, so a new kind must pick one before it
 * type-checks.
 */
export const PAWN_BUBBLE_VARIANT: Record<PawnHint["kind"], PawnBubbleVariant> = {
    "used-in": "cpcd",
    "wrong-streak": "text",
};

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
 * The writing card's used-in hint, or null when it has no words.
 *
 * Data: `entry.writingUsedIn` (OnDeckVocabService.enrichMultipleWithUsedIn, writing bar only, from
 * VocabEntryDAL.findWritingUsedInForCharacters) — the learner's sorted words first, then
 * dictionary words at frequencyScore 4–5; single-character zh cards only.
 */
function usedInHint(entry: VocabEntry): UsedInPawnHint | null {
    const items = (entry.writingUsedIn ?? []).slice(0, MAX_USED_IN_WORDS);
    if (items.length === 0) return null;
    const level = writingLevelForMastery(entry.writingMastery ?? 0);
    return {
        kind: "used-in",
        key: `used-in|${entry.id}`,
        lines: USED_IN_LINES,
        items,
        maskChar: previewShowsWholeCharacter(modeOfLevel(level)) ? undefined : entry.entryKey,
    };
}

/** The hint for the front card in `world`, or null when the pawn has nothing to say. */
export function pawnHintFor(world: FlpWorld, entry: VocabEntry | null): PawnHint | null {
    if (!entry) return null;
    switch (world) {
        case "writing":
            return usedInHint(entry);
        case "core":
        case "reading":
            return wrongStreakHint(world, entry);
    }
}
