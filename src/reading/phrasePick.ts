/**
 * PHRASE PICK — which two words of a selected phrase the split-screen rdb shows
 * (docs/READER_SEGMENTATION.md § "Phrase stepping"; docs/USER_DOCUMENT_FEATURE_SUMMARY.md
 * § "Split-screen keycap").
 *
 * The split keycap has room for two entries. A phrase of exactly two words shows both
 * (owner's call 2026-11-23: no filtering at 2). From three words up, the two KEPT are the
 * highest-ranked, by this ladder (owner's ladder 2026-11-23, lowest priority first):
 *
 *   no det row / no part of speech   (the half would have nothing to show)
 *   particle → numeral → classifier
 *   interjection → onomatopoeia → conjunction → preposition → pronoun   (the misc tier;
 *        prepositions over conjunctions per the owner, pronoun on top of the tier)
 *   everything else — the content words (noun, verb, adjective, adverb, other)
 *
 * Ties go to the HARDER word — higher `difficulty` (1–6), the one the learner most likely
 * wants to review — then the rarer one (lower `frequencyScore`), then the earlier word.
 * The two winners are returned in TEXT order, so the left half is the earlier word.
 *
 * Layer: pure client util (src/reading). Depended on by useReadingKeycap.tsx.
 * Tests: src/__tests__/phraseChunking.test.ts (§ pickPhraseWords).
 */
import type { DictionaryEntry } from "../types";
import type { SegmentSpan } from "./documentSegmentation";
import { wordRole, type WordRole } from "./wordRoles";

/** A phrase word with the entry the keycap would show for it (null = none). */
export interface PhraseWord {
    span: SegmentSpan;
    entry: DictionaryEntry | null;
}

// Higher = kept first. Roles not listed are content words (CONTENT_RANK).
const ROLE_RANK: Partial<Record<WordRole, number>> = {
    particle: 1,
    numeral: 2,
    classifier: 3,
    interjection: 4,
    onomatopoeia: 5,
    conjunction: 6,
    preposition: 7,
    pronoun: 8,
};
const CONTENT_RANK = 9;
// No entry, or an entry the backfill has not given a part of speech yet.
const UNKNOWN_RANK = 0;

function rankOf(word: PhraseWord): number {
    const role = wordRole(word.span.text, word.entry);
    if (!word.entry || !role) return UNKNOWN_RANK;
    return ROLE_RANK[role] ?? CONTENT_RANK;
}

/** The (at most) two words the split keycap shows, in text order. See the header. */
export function pickPhraseWords(words: PhraseWord[]): PhraseWord[] {
    if (words.length <= 2) return words;
    const ranked = words
        .map((word, index) => ({ word, index, rank: rankOf(word) }))
        .sort((a, b) =>
            b.rank - a.rank
            || (b.word.entry?.difficulty ?? 0) - (a.word.entry?.difficulty ?? 0)
            // Rarer first; an unscored word counts as the most common (5) so it never wins on rarity.
            || (a.word.entry?.frequencyScore ?? 5) - (b.word.entry?.frequencyScore ?? 5)
            || a.index - b.index);
    return ranked.slice(0, 2).sort((a, b) => a.index - b.index).map((r) => r.word);
}
