import type { DictionaryEntry } from "../../types";
import type { EnglishDictionaryMatch } from "../../api/dictionary";

/**
 * englishTranslation.ts — the Reader's English → Chinese keycap lookup, pure helpers
 * (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "English words").
 *
 * An English word in a Chinese document is a selectable span like any other
 * (documentSegmentation.ts → pushNonHanSpans). It has no det row of its own, so the keycap
 * shows the Chinese word it translates to instead, looked up through the det senses
 * (DictionaryDAL → findCompleteEnglishMatches: a sense that IS the word).
 *
 *   - `englishLookupKeys` — the word plus naive stripped-ending forms ("running" → running,
 *     runn, run, …). Every key is looked up, because the gloss itself may carry the ending
 *     ("students" has its own entry) as easily as the stem ("run").
 *   - `pickBestEnglishMatch` — one match per word across its keys, compared naively:
 *     commoner entry, then earlier sense, then the less-stripped key, then easier entry.
 *   - `ENGLISH_GRAMMAR_WORDS` — function words that are never looked up ("the", "of", "is"):
 *     their best "translation" is noise (的 / 之 / 是), so the keycap stays empty for them.
 *
 * Pure: no React, no I/O. Depended on by useEnglishTranslations.ts (fetch + lookup).
 */

/** A whole ASCII English word, with internal apostrophes ("don't", "teacher's"). */
const ENGLISH_WORD_REGEX = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const WHOLE_ENGLISH_WORD_REGEX = /^[A-Za-z]+(?:['’][A-Za-z]+)*$/;

/**
 * Function words skipped outright: articles, prepositions, conjunctions, auxiliaries /
 * copulas, the infinitive "to", and contraction pieces. Pronouns and "not" are NOT here —
 * they translate cleanly (me → 我, not → 不).
 */
export const ENGLISH_GRAMMAR_WORDS: ReadonlySet<string> = new Set([
    // articles / determiners
    "a", "an", "the", "this", "that", "these", "those",
    // prepositions
    "of", "to", "in", "on", "at", "by", "for", "with", "from", "as", "into", "onto", "upon",
    "about", "over", "under", "off", "out", "up", "down", "than", "via", "per",
    // conjunctions
    "and", "or", "but", "nor", "so", "yet", "if", "because", "while", "though", "although",
    "whether", "which",
    // auxiliaries / copulas / modals
    "is", "am", "are", "was", "were", "be", "been", "being",
    "do", "does", "did", "has", "have", "had",
    "will", "would", "shall", "should", "can", "could", "may", "might", "must",
    // contraction pieces Intl.Segmenter can leave standalone
    "s", "t", "ll", "re", "ve", "d", "m",
]);

/** Shortest stem a stripped key may leave ("bus" → "bu" is still allowed; "is" → "i" is not). */
const MIN_STEM_LENGTH = 2;

/** True when `text` is one whole English word (the keycap's English path applies). */
export function isEnglishWord(text: string): boolean {
    return WHOLE_ENGLISH_WORD_REGEX.test(text);
}

/** Every distinct English word in `content`, lowercased (grammar words included; keys skip them). */
export function documentEnglishWords(content: string): string[] {
    const words = new Set<string>();
    for (const match of content.matchAll(ENGLISH_WORD_REGEX)) words.add(match[0].toLowerCase());
    return Array.from(words);
}

/** A stem ending in a doubled consonant ("runn", "stopp", "bigg") → the single form too. */
function withUndoubled(stem: string, out: string[]): void {
    out.push(stem);
    const n = stem.length;
    if (n >= 3 && stem[n - 1] === stem[n - 2] && !/[aeiou]/.test(stem[n - 1])) out.push(stem.slice(0, -1));
}

/**
 * The lookup keys for one word, most literal first: the word itself (possessive "'s"
 * dropped), then naive stripped-ending forms. Over-generates on purpose — a nonsense stem
 * ("bus" → "bu") just finds no gloss, and the literal key outranks a stem on ties
 * (pickBestEnglishMatch). A stem that is itself a grammar word ("bed" → "be") is dropped.
 * Empty for a grammar word or a non-English selection.
 */
export function englishLookupKeys(word: string): string[] {
    if (!isEnglishWord(word)) return [];
    let base = word.toLowerCase().replace(/’/g, "'");
    if (base.endsWith("'s")) base = base.slice(0, -2);
    // Any other apostrophe ("don't", "we'll") is a contraction: nothing to translate.
    if (base.includes("'") || ENGLISH_GRAMMAR_WORDS.has(base)) return [];

    const candidates: string[] = [base];
    const strip = (suffix: string, replacement = "") => {
        if (!base.endsWith(suffix)) return null;
        const stem = base.slice(0, base.length - suffix.length) + replacement;
        return stem.length >= MIN_STEM_LENGTH ? stem : null;
    };
    const push = (stem: string | null, undouble = false) => {
        if (!stem) return;
        if (undouble) withUndoubled(stem, candidates);
        else candidates.push(stem);
    };

    // Plurals / 3rd person: studies → study, boxes → box, cats → cat ("glass" keeps its s).
    push(strip("ies", "y"));
    push(strip("es"));
    if (!base.endsWith("ss")) push(strip("s"));
    // Past: studied → study, liked → like, walked → walk, stopped → stop.
    push(strip("ied", "y"));
    push(strip("d"));
    push(strip("ed"), true);
    // Progressive: making → make, walking → walk, running → run.
    push(strip("ing", "e"));
    push(strip("ing"), true);
    // Adverbs: happily → happy, quickly → quick.
    push(strip("ily", "y"));
    push(strip("ly"));
    // Comparative / superlative: nicer → nice, faster → fast, bigger → big (and -est).
    push(strip("r"));
    push(strip("er"), true);
    push(strip("st"));
    push(strip("est"), true);

    return Array.from(new Set(candidates.filter((key, index) =>
        // The word itself always stays (a one-letter "I" → 我); stems need MIN_STEM_LENGTH.
        index === 0 || (key.length >= MIN_STEM_LENGTH && !ENGLISH_GRAMMAR_WORDS.has(key)))));
}

/** Higher is better; unscored (not-yet-enriched) rows rank below every scored one. */
const frequencyOf = (entry: DictionaryEntry) => entry.frequencyScore ?? -1;
const difficultyOf = (entry: DictionaryEntry) => entry.difficulty ?? Number.MAX_SAFE_INTEGER;

/**
 * The one entry to show for a word, chosen naively across its keys' matches (owner's call
 * 2026-11-17): the commonest entry; then the one whose matching sense comes earliest; then
 * the less-stripped key ("news" → 新闻 over "new" → 新); then the easier entry. Null when no
 * key matched.
 */
export function pickBestEnglishMatch(
    keys: string[],
    matchesByKey: ReadonlyMap<string, EnglishDictionaryMatch>,
): DictionaryEntry | null {
    let best: { match: EnglishDictionaryMatch; keyIndex: number } | null = null;
    keys.forEach((key, keyIndex) => {
        const match = matchesByKey.get(key);
        if (!match) return;
        if (!best) { best = { match, keyIndex }; return; }
        const a = match.entry, b = best.match.entry;
        const better =
            frequencyOf(a) !== frequencyOf(b) ? frequencyOf(a) > frequencyOf(b)
            : match.senseOrdinal !== best.match.senseOrdinal ? match.senseOrdinal < best.match.senseOrdinal
            : keyIndex !== best.keyIndex ? keyIndex < best.keyIndex
            : difficultyOf(a) < difficultyOf(b);
        if (better) best = { match, keyIndex };
    });
    return (best as { match: EnglishDictionaryMatch } | null)?.match.entry ?? null;
}
