/**
 * WORD ROLES — the one part of speech the Reader's phrase stepping reads for a word
 * (docs/READER_SEGMENTATION.md § "Phrase stepping").
 *
 * A det row's `partsOfSpeech` lists EVERY part of speech the word can take, most common
 * first: 多 is [adjective, adverb, numeral], 了 is [particle, verb, adjective]. Two
 * consumers need a single answer per word:
 *   - the phrase rules (phraseChunking.ts → `chunkPhrases`), e.g. "a degree adverb then an
 *     ADJECTIVE";
 *   - the split-screen rdb's pick-2 ranking (phrasePick.ts → `pickPhraseWords`), which
 *     drops particles before numbers before measure words, and so on.
 * Both read the LEAD entry (`partsOfSpeech[0]`). Matching on "lists X anywhere" would
 * treat 多 as a number and 一 as an adjective.
 *
 * ── ROLE_OVERRIDES ─────────────────────────────────────────────────────────────────
 * Some closed-class function words lead with a role they rarely play in running text:
 * 在 leads with "verb" (它在桌子上 is far rarer than 我在家), 给 and 比 with "verb", 得 / 过
 * with "verb", 地 with "noun". Ranked on the lead POS, 在 would count as a content verb and
 * beat the noun beside it. This short map pins those words to their usual reading-text
 * role. Kept deliberately tiny and closed-class (the language does not add new function
 * words); everything else comes from det.
 * ⚠️ Owner sign-off pending (2026-11-23): proposed as a fix for the lead-POS gap; delete
 * the map if declined and the lead POS is used as is.
 *
 * Layer: pure client util (src/reading). Depended on by phraseChunking.ts, phrasePick.ts.
 */
import type { DictionaryEntry } from "../types";

/** The roles the phrase rules and the pick ranking distinguish. */
export type WordRole =
    | "particle"
    | "numeral"
    | "classifier"
    | "interjection"
    | "onomatopoeia"
    | "conjunction"
    | "preposition"
    | "pronoun"
    | "adverb"
    | "adjective"
    | "verb"
    | "noun"
    | "other";

/** See the header: the multi-role function words, pinned to their usual role in running text. */
const ROLE_OVERRIDES: ReadonlyMap<string, WordRole> = new Map<string, WordRole>([
    ["在", "preposition"],
    ["给", "preposition"],
    ["比", "preposition"],
    ["对", "preposition"],
    ["跟", "preposition"],
    // Leads with "verb" (to hold) after its 2026-11-24 enrichment; in running text it is
    // nearly always the disposal marker (把书放下).
    ["把", "preposition"],
    ["和", "conjunction"],
    ["得", "particle"],
    ["地", "particle"],
    ["过", "particle"],
    ["着", "particle"],
    ["了", "particle"],
]);

const KNOWN_ROLES: ReadonlySet<string> = new Set<WordRole>([
    "particle", "numeral", "classifier", "interjection", "onomatopoeia", "conjunction",
    "preposition", "pronoun", "adverb", "adjective", "verb", "noun",
]);

/**
 * A word's role: the override, else its det row's LEAD part of speech, else null (no det
 * row, or a row the backfill has not reached yet — `partsOfSpeech` is NULL on almost every
 * non-discoverable row). An unlisted part of speech ("prefix", "idiom", …) is "other".
 */
export function wordRole(word: string, entry: DictionaryEntry | null | undefined): WordRole | null {
    const pinned = ROLE_OVERRIDES.get(word);
    if (pinned) return pinned;
    const lead = entry?.partsOfSpeech?.[0];
    if (!lead) return null;
    const normalized = lead.trim().toLowerCase();
    return KNOWN_ROLES.has(normalized) ? (normalized as WordRole) : "other";
}

/**
 * word1 → the det row the keycap shows for it: the FIRST row whose word1 matches, the same
 * pick as textSelection.ts → `findDictionaryMatch`, so a word's role always comes from the
 * entry the learner sees. (word2 aliases are skipped: roles are a Chinese-headword concern.)
 */
export function buildEntryByWord(dictionaryCards: DictionaryEntry[]): Map<string, DictionaryEntry> {
    const map = new Map<string, DictionaryEntry>();
    for (const entry of dictionaryCards) {
        if (!map.has(entry.word1)) map.set(entry.word1, entry);
    }
    return map;
}
