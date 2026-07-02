/**
 * Splits one tone-marked pinyin syllable into its phonetic "building block"
 * units — initial consonant, medial glide, and final — for the letter hint's
 * reveal granularity (see docs/WORD_SEARCH_GAME.md §5a). This mirrors how
 * Bopomofo (Zhuyin, 注音符號) segments a syllable, but renders each block as
 * plain pinyin text (with its original diacritics) rather than a Zhuyin
 * glyph — a "one unit at a time" hint reveals a meaningful phonetic chunk
 * instead of an arbitrary single Latin letter (e.g. "zh" is one initial sound
 * spelled with two letters, so it's revealed together, not "z" then "h").
 *
 * Input is one syllable at a time — `PlacedWord.pinyin` is already
 * space-separated per character (see types.ts), so callers split on
 * whitespace first (`pinyinSyllables`).
 */

const TWO_LETTER_INITIALS = ["zh", "ch", "sh"];
const SINGLE_LETTER_INITIALS = new Set([
    "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h",
    "j", "q", "x", "r", "z", "c", "s", "y", "w",
]);
/** i/u/ü (plain or tone-marked) — a final starting with one of these, with
 *  more letters after it, splits off that leading glide as its own unit
 *  (e.g. "iang" → "i" + "ang", "ué" → "u" + "é"). Pinyin's tone-placement
 *  convention marks the tone on the fuller vowel that follows a glide, not
 *  the glide itself, so this only needs to check the plain forms. */
const GLIDE_START = new Set(["i", "u", "ü"]);

/**
 * One tone-marked pinyin syllable (e.g. "xiǎng", "gōng") → its ordered units
 * (e.g. `["x","i","ǎng"]`, `["g","ong"]`). A syllable with no recognized
 * initial and no leading glide (e.g. "ān") comes back as a single unit.
 */
export function syllableToPinyinUnits(syllable: string): string[] {
    const lower = syllable.toLowerCase();
    let initial = "";
    let final = lower;
    for (const two of TWO_LETTER_INITIALS) {
        if (lower.startsWith(two)) {
            initial = two;
            final = lower.slice(2);
            break;
        }
    }
    if (!initial && SINGLE_LETTER_INITIALS.has(lower[0])) {
        initial = lower[0];
        final = lower.slice(1);
    }

    const units: string[] = [];
    if (initial) units.push(initial);
    if (final) {
        if (final.length > 1 && GLIDE_START.has(final[0])) {
            units.push(final[0], final.slice(1));
        } else {
            units.push(final);
        }
    }
    return units.length > 0 ? units : [syllable];
}

/** `PlacedWord.pinyin` is space-separated, one syllable per character. */
export function pinyinSyllables(pinyin: string): string[] {
    return pinyin.trim().split(/\s+/).filter(Boolean);
}

/** Every syllable's units, in character order — one array per character,
 *  matching the per-character "island" layout in WordSearchHintRow. */
export function wordToPinyinUnits(pinyin: string): string[][] {
    return pinyinSyllables(pinyin).map(syllableToPinyinUnits);
}

/** Total revealable units across the whole word — the hint's per-press cap. */
export function countPinyinUnits(pinyin: string): number {
    return wordToPinyinUnits(pinyin).reduce((sum, units) => sum + units.length, 0);
}
