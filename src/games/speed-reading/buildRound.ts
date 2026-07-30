import type { DistractorChar, VocabEntry } from "../../types";
import type { Round, RoundOption } from "./types";

/**
 * Round construction — turn a vocab entry into two word options, one right and
 * one wrong.
 *
 * ── THE ONE-CHARACTER INVARIANT ──────────────────────────────────────────────
 * The two options differ in exactly one character position; every other position
 * is identical. For 你好 the options are 你好 vs 你妤, never 你好 vs 明白. This
 * is a correctness requirement, not a style choice:
 *
 *   • Word length would otherwise leak the answer. If the prompt's pinyin is two
 *     syllables and one option is a one-character word, the round is over before
 *     the player has read anything.
 *   • It makes the pinyin meaningful: the player must map it onto a specific
 *     character position, which is the reading skill being tested.
 *
 * For single-character words this collapses to "the whole option is the wrong
 * character", which is the same thing.
 *
 * See docs/SPEED_READING_GAME.md § The one-character invariant.
 */

/** CJK Unified Ideographs — the only characters we can render. */
function isCjk(ch: string): boolean {
    const cp = ch.codePointAt(0) ?? 0;
    return cp >= 0x4e00 && cp <= 0x9fff;
}

/** Split a headword into renderable characters, dropping anything non-CJK. */
export function wordCharacters(entryKey: string): string[] {
    return [...(entryKey ?? "")].filter(isCjk);
}

function randInt(rng: () => number, n: number): number {
    return Math.floor(rng() * n);
}

/**
 * Assemble the two options and randomize their on-screen order.
 *
 * The wrong option is the word with ONE position replaced by a different real
 * character, which produces a same-length option and upholds the invariant.
 */
function assemble(
    entry: VocabEntry,
    chars: string[],
    swapIndex: number,
    wrongChar: string,
    rng: () => number
): Round {
    const correct: RoundOption = { chars, isCorrect: true };
    const wrong: RoundOption = {
        chars: chars.map((c, i) => (i === swapIndex ? wrongChar : c)),
        isCorrect: false,
    };
    // Randomize which button is correct, per round.
    const options: [RoundOption, RoundOption] = rng() < 0.5 ? [correct, wrong] : [wrong, correct];
    return { entry, swapIndex, options };
}

/**
 * Build the next round for a card, or null when the card is unplayable (the
 * caller then drops it and pulls the next from the queue).
 *
 * The wrong option replaces one character with a REAL, different character taken
 * from the player's own library.
 *
 * ── The fallback ladder ──────────────────────────────────────────────────────
 * The constraints are PREFERENCES, dropped in order until a candidate exists:
 *   1. same difficulty band (1–6, = HSK level), reading not mastered
 *   2. any difficulty band, reading not mastered
 *   3. any library character at all (reading-mastered included)
 *   4. no candidate → return null; the caller skips the card
 *
 * Only rung 4 is a real failure, and it needs a library so small that the
 * 20-card entry gate has already blocked entry.
 *
 * `rng` is injected rather than calling Math.random directly so a round can be
 * reproduced in a test.
 */
export function buildRound(
    entry: VocabEntry,
    distractors: DistractorChar[],
    rng: () => number = Math.random
): Round | null {
    const chars = wordCharacters(entry.entryKey);
    // A headword with no CJK characters cannot be rendered as a glyph at all.
    if (chars.length === 0) return null;
    if (distractors.length === 0) return null;

    const swapIndex = randInt(rng, chars.length);
    const target = chars[swapIndex];
    const inWord = new Set(chars);
    // A distractor must not be any character already in the word — otherwise the
    // "wrong" option can be a real rearrangement, or even the same word.
    const usable = distractors.filter((d) => !inWord.has(d.char));
    if (usable.length === 0) return null;

    // Difficulty band of the character being replaced, if the pool knows it.
    const targetBand = distractors.find((d) => d.char === target)?.difficultyBand ?? null;

    const rungs: DistractorChar[][] = [
        targetBand === null ? [] : usable.filter((d) => !d.readingMastered && d.difficultyBand === targetBand),
        usable.filter((d) => !d.readingMastered),
        usable,
    ];
    const pool = rungs.find((r) => r.length > 0);
    if (!pool) return null;

    const wrongChar = pool[randInt(rng, pool.length)].char;
    return assemble(entry, chars, swapIndex, wrongChar, rng);
}
