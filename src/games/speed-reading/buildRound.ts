import type { DistractorChar, ExampleSentence, VocabEntry } from "../../types";
import type { Round, RoundOption, SentenceRound, WordRound } from "./types";

/**
 * Round construction — turn a vocab entry into two options, one right and one
 * wrong.
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
 * ── TWO KINDS OF ROUND ───────────────────────────────────────────────────────
 * `buildRound` builds the ordinary WORD round (two spellings of the headword).
 * `buildSentenceRound` builds the FINALE round (two spellings of one of the
 * entry's example sentences, differing at a character inside the headword). Both
 * pick their wrong character from the same pool through the same fallback
 * ladder — see `pickDistractor` — so the foil is equally fair in both.
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
 * Choose the character that replaces `target`, from the player's own library.
 *
 * ── The fallback ladder ──────────────────────────────────────────────────────
 * The constraints are PREFERENCES, dropped in order until a candidate exists:
 *   1. same difficulty band (1–6, = HSK level) as the target, reading not mastered
 *   2. any difficulty band, reading not mastered
 *   3. any library character at all (reading-mastered included)
 *   4. no candidate → null; the caller drops the card
 *
 * `exclude` is every character the caller must not pick — always at least the
 * characters of the word being altered, so the "wrong" option can never be a
 * rearrangement of the right one (or the same word again).
 *
 * Only rung 4 is a real failure, and it needs a library so small that provisional
 * cards have already topped the player up past it.
 */
function pickDistractor(
    target: string,
    exclude: Set<string>,
    distractors: DistractorChar[],
    rng: () => number
): string | null {
    const usable = distractors.filter((d) => !exclude.has(d.char));
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
    return pool[randInt(rng, pool.length)].char;
}

/**
 * Assemble the two options from one character sequence and randomize their
 * on-screen order. Shared by both round kinds: the sequence is a headword for a
 * word round and a whole sentence for a sentence round, but the substitution and
 * the shuffle are identical.
 */
function assembleOptions(
    chars: string[],
    swapIndex: number,
    wrongChar: string,
    rng: () => number
): [RoundOption, RoundOption] {
    const correct: RoundOption = { chars, isCorrect: true };
    const wrong: RoundOption = {
        chars: chars.map((c, i) => (i === swapIndex ? wrongChar : c)),
        isCorrect: false,
    };
    // Randomize which half is correct, per round.
    return rng() < 0.5 ? [correct, wrong] : [wrong, correct];
}

/**
 * Build the next WORD round for a card, or null when the card is unplayable (the
 * caller then drops it and pulls the next from the queue).
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
    const wrongChar = pickDistractor(chars[swapIndex], new Set(chars), distractors, rng);
    if (!wrongChar) return null;

    const round: WordRound = {
        kind: "word",
        entry,
        swapIndex,
        options: assembleOptions(chars, swapIndex, wrongChar, rng),
    };
    return round;
}

/**
 * Where the headword sits inside a sentence, as an index into the sentence's
 * CHARACTER ARRAY (not `String.indexOf`, whose UTF-16 offsets would be wrong the
 * moment a sentence contains a surrogate pair). -1 when the sentence does not
 * contain the word.
 */
function findWordStart(sentenceChars: string[], wordChars: string[]): number {
    if (wordChars.length === 0) return -1;
    outer: for (let i = 0; i + wordChars.length <= sentenceChars.length; i++) {
        for (let j = 0; j < wordChars.length; j++) {
            if (sentenceChars[i + j] !== wordChars[j]) continue outer;
        }
        return i;
    }
    return -1;
}

/**
 * The entry's example sentences that a sentence round can actually be built from:
 * the sentence must literally CONTAIN the headword, because the round works by
 * altering one character of the headword where it stands in the sentence.
 *
 * Exported because the queue reserves the finale's cards at LOAD time
 * (useSpeedReadingQueue) — the two sentence rounds are chosen before the run
 * starts, so they can never depend on what a mid-run top-up happens to return.
 */
export function usableSentences(entry: VocabEntry): ExampleSentence[] {
    const wordChars = wordCharacters(entry.entryKey ?? "");
    if (wordChars.length === 0) return [];
    return (entry.exampleSentences ?? []).filter(
        (s) => typeof s?.foreignText === "string"
            && findWordStart([...s.foreignText], wordChars) >= 0
    );
}

/** Whether this card can carry one of the run's sentence rounds. */
export function hasSentenceRound(entry: VocabEntry): boolean {
    return usableSentences(entry).length > 0;
}

/**
 * Build a SENTENCE round for a card, or null when the card cannot carry one
 * (no example sentence containing the headword, or an exhausted distractor
 * ladder).
 *
 * The two options are the same sentence twice, differing at ONE character
 * INSIDE the target word — so the surrounding context is identical on both
 * halves and the comparison is still a single-character reading decision, just
 * with more to scan. The distractor comes from the same pool and the same ladder
 * as a word round's.
 *
 * The wrong option is a sentence that reads plausibly but contains a
 * mis-written word; nothing else about it is claimed to be grammatical, which is
 * the same bargain the word rounds strike with 你妤.
 */
export function buildSentenceRound(
    entry: VocabEntry,
    distractors: DistractorChar[],
    rng: () => number = Math.random
): SentenceRound | null {
    if (distractors.length === 0) return null;
    const candidates = usableSentences(entry);
    if (candidates.length === 0) return null;

    const sentence = candidates[randInt(rng, candidates.length)];
    const sentenceChars = [...sentence.foreignText];
    const wordChars = wordCharacters(entry.entryKey);
    const wordStart = findWordStart(sentenceChars, wordChars);
    // usableSentences already guaranteed this, but the narrowing is cheap and a
    // future caller could hand us an unfiltered sentence.
    if (wordStart < 0) return null;

    // Only positions inside the HEADWORD are eligible, so the round keeps testing
    // the word the card is about rather than an incidental character of the
    // sentence.
    const offset = randInt(rng, wordChars.length);
    const swapIndex = wordStart + offset;
    // Excluded: the headword's own characters (a swap into one of them could
    // spell the same word back). Characters elsewhere in the sentence are fair
    // game — repeating one is not a leak.
    const wrongChar = pickDistractor(
        sentenceChars[swapIndex],
        new Set(wordChars),
        distractors,
        rng
    );
    if (!wrongChar) return null;

    return {
        kind: "sentence",
        entry,
        sentence,
        swapIndex,
        options: assembleOptions(sentenceChars, swapIndex, wrongChar, rng),
    };
}
