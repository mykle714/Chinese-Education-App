/**
 * Word Search — the **No Pinyin** hint ladder's reveal units.
 *
 * LAYER: pure client-side view logic for the word search game. No React, no state,
 * no I/O — the direct counterpart of `pinyinUnits.ts`, which does the same job for
 * the Pinyin board.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE CURRENCY
 *
 * The hint meter's normal reveal is a hangman-style pinyin spell-out — precisely the
 * thing the No Pinyin board exists to hide. So that board spends a different currency:
 * a character's SUB-CHARACTER VISUAL PARTS (`PlacedWord.charComponents`, from
 * dictionaryentries_zh.components, migration 125).
 *
 * The player is looking at a grid full of characters, so revealing 木 means "hunt for a
 * character containing 木" — a shape-matching nudge rather than a sound one. Components
 * arrive ordered MOST-COMMON-FIRST, so successive reveals escalate: the first is shared
 * by hundreds of characters and barely narrows the scan, the last is nearly identifying.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PER-CHARACTER LADDER
 *
 * Each character contributes `max(components.length, 1)` reveals. Every part is shown in
 * turn EXCEPT the last: revealing a character's final part would leave the player staring
 * at a complete parts list that is just a spelled-out version of the answer, so that last
 * step skips straight to THE CHARACTER ITSELF, replacing the accumulated glyphs outright:
 *
 *   想 (components 木 目 心)
 *     _  →  木_  →  木目_  →  想
 *
 * An ATOMIC character (人, 口, 木 — `components` is []) contributes exactly 1 reveal,
 * its character step, because it has no parts to give:
 *
 *   人  →  _  →  人
 *
 * A SINGLE-component character (parts 木) likewise contributes 1 reveal: its only part is
 * also its last, so the ladder goes straight to the character and 木 is never shown alone.
 *
 * Reveals are distributed in TWO PHASES, each round-robin across characters (matching
 * the pinyin row's `distributeRevealTiers`: every character's 1st part is spent before
 * any character's 2nd, so a word opens up evenly instead of solving left-to-right):
 *
 *   PHASE 1 — every character's NON-FINAL parts. Nobody gets their answer while any
 *             character still has a part left to give, so the cheap shape-nudges are
 *             exhausted board-wide before the ladder starts handing out answers.
 *   PHASE 2 — the final step of each character, which reveals THE CHARACTER ITSELF.
 *
 * So 银行 (钅+ 艮 / atomic) spends 钅 before revealing either character, and 想相人
 * shows 木 目 / 木 before any of the three collapses to its character.
 *
 * Once every character is revealed the word is fully spelled out, and `WordSearchPage`'s
 * `useHint` advances to the existing yellow grid-location reveal exactly as it does when
 * pinyin runs out — the ladder tail is shared between the two modes.
 *
 * Depended on by: WordSearchHintRow.tsx, WordSearchPage.tsx.
 * Documented in: docs/WORD_SEARCH_GAME.md §5a.
 */
import { HINT_REMAINDER_MARK } from "./constants";

/**
 * Placeholder shown for a character that is not yet fully revealed — the SAME
 * one-character "there's more" dash the pinyin mask uses, so both boards speak
 * the same visual language (see `HINT_REMAINDER_MARK`).
 */
export const COMPONENT_BLANK = HINT_REMAINDER_MARK;

/**
 * Per-character components for a word, tolerating boards saved before
 * `charComponents` existed (and any length drift against the character count).
 */
export function wordToComponentUnits(entryKey: string, charComponents?: string[][]): string[][] {
    return [...entryKey].map((_, i) => charComponents?.[i] ?? []);
}

/**
 * How many reveals one character's ladder holds: one per component, with the LAST
 * component's step replaced by the character reveal — so the count is just the part
 * count, floored at 1 so an atomic (or single-part) character still has its one
 * character-reveal step.
 */
function ladderCapacity(parts: string[]): number {
    return Math.max(parts.length, 1);
}

/**
 * Total reveals a word offers: the sum of its characters' ladders. Always >= the
 * character count, so even an all-atomic word (人人) still has a ladder.
 */
export function countComponentUnits(entryKey: string, charComponents?: string[][]): number {
    return wordToComponentUnits(entryKey, charComponents).reduce(
        (total, parts) => total + ladderCapacity(parts),
        0
    );
}

/**
 * How many part-reveals one character's ladder holds BEFORE its character step: every
 * component except the last (whose step is spent on the character itself). Atomic and
 * single-part characters have none — they go straight to their character step.
 */
function partialCapacity(parts: string[]): number {
    return Math.max(parts.length - 1, 0);
}

/**
 * How many reveals each character has received, distributing `revealCount` across
 * characters in two round-robin phases: first every character's non-final parts, then
 * the character-reveal steps. A character whose current phase is already exhausted is
 * skipped without consuming a reveal, so leftover reveals flow to the characters that
 * still have something to show.
 *
 * Mirrors `distributeRevealTiers` in WordSearchHintRow.tsx (the pinyin equivalent),
 * with the extra phase split so no character is answered while parts remain elsewhere.
 */
export function distributeComponentReveals(unitsPerChar: string[][], revealCount: number): number[] {
    const revealed = unitsPerChar.map(() => 0);
    const partials = unitsPerChar.map(partialCapacity);
    const maxTiers = partials.reduce((max, n) => Math.max(max, n), 0);

    let remaining = revealCount;

    // Phase 1: spend every character's non-final parts, one tier at a time.
    for (let tier = 0; tier < maxTiers && remaining > 0; tier++) {
        for (let i = 0; i < unitsPerChar.length && remaining > 0; i++) {
            if (partials[i] > tier) {
                revealed[i] = tier + 1;
                remaining--;
            }
        }
    }

    // Phase 2: only once no parts are left anywhere does the ladder start revealing
    // characters, left to right (each character's final step costs exactly one reveal).
    for (let i = 0; i < unitsPerChar.length && remaining > 0; i++) {
        revealed[i] = ladderCapacity(unitsPerChar[i]);
        remaining--;
    }

    return revealed;
}

/** What to display for one character of the hinted word. */
export interface CharacterReveal {
    /** True once the character itself is showing — `text` is then the character. */
    isCharacter: boolean;
    /** Revealed glyphs in a line, or the character, or the blank placeholder. */
    text: string;
}

/**
 * Build the display for each character of the hinted word: the components revealed so
 * far run together in a line, followed by `COMPONENT_BLANK` while anything is still
 * hidden. The step that would have revealed the LAST component instead REPLACES the
 * accumulated glyphs with the character itself — the parts have done their job by then,
 * and the answer is what matters.
 */
export function buildComponentReveals(
    entryKey: string,
    charComponents: string[][] | undefined,
    revealCount: number
): CharacterReveal[] {
    const chars = [...entryKey];
    const unitsPerChar = wordToComponentUnits(entryKey, charComponents);
    const revealedPerChar = distributeComponentReveals(unitsPerChar, revealCount);

    return chars.map((char, i) => {
        const parts = unitsPerChar[i];
        const revealed = revealedPerChar[i];
        // The character step REPLACES the last component's step, so it lands as soon as
        // the ladder is spent — never leaving a fully-listed set of parts on screen.
        if (revealed >= ladderCapacity(parts)) return { isCharacter: true, text: char };
        return {
            isCharacter: false,
            text: `${parts.slice(0, revealed).join("")}${COMPONENT_BLANK}`,
        };
    });
}
