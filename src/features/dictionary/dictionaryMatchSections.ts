/**
 * dictionaryMatchSections — splits the Dictionary page's plain-search results into labelled
 * sections by HOW they matched, in the owner's order (2026-10-29):
 *
 *   English “long”              a sense IS the term                       (meaning-exact)
 *   Pinyin “long”               the main or another reading IS the term   (word-exact,
 *                               reading-alternate; and every numbered-pinyin match, `word`)
 *   English starts with “long”  a sense leads with the term, whole word   (meaning-prefix)
 *   Pinyin starts with “long”   the reading / headword starts with it     (word-prefix)
 *   Other                       the term sits inside a sense              (meaning-partial)
 *
 * For es the word side is the Spanish headword, so "Pinyin" reads "Spanish".
 *
 * LAYER: client feature logic. Pure; no React.
 *
 * The server tags each `/search` row with its ranking bucket (`matchKind` —
 * `DictionaryMatchKind` in server/contracts/wire.ts) and returns rows in bucket order, which
 * IS the section order above. So a section is a RUN of consecutive rows whose kinds map to
 * it, and infinite scroll needs no extra care: the next page continues the last section or
 * opens the next one.
 *
 * Depended on by: DictionaryPage.tsx. Docs: docs/SHELF_REDESIGN.md § 7b "Match sections",
 * docs/DICTIONARY_NUMBERED_PINYIN_SEARCH.md § "Match kinds on the wire".
 */
import type { DictionaryEntry, DictionaryMatchKind, Language } from '../../types';

export type DictionaryMatchSectionKey = 'english-exact' | 'word-exact' | 'english-prefix' | 'word-prefix' | 'other';

/** Which section a row's match kind belongs to. */
const SECTION_OF_KIND: Record<DictionaryMatchKind, DictionaryMatchSectionKey> = {
    'meaning-exact': 'english-exact',
    'word-exact': 'word-exact',
    // "Also read" merges into the reading section — it still sorts after the main readings.
    'reading-alternate': 'word-exact',
    // Numbered pinyin ("ma2") is ranked without the ladder; all of it reads as pinyin.
    word: 'word-exact',
    'meaning-prefix': 'english-prefix',
    'word-prefix': 'word-prefix',
    'meaning-partial': 'other',
};

export interface DictionaryMatchSection {
    key: DictionaryMatchSectionKey;
    entries: DictionaryEntry[];
}

/** Consecutive rows of one section become one group. A row without a kind (an older server) counts as `word`. */
export function groupByMatchSection(entries: DictionaryEntry[]): DictionaryMatchSection[] {
    const sections: DictionaryMatchSection[] = [];
    for (const entry of entries) {
        const key = SECTION_OF_KIND[entry.matchKind ?? 'word'];
        const last = sections[sections.length - 1];
        if (last && last.key === key) last.entries.push(entry);
        else sections.push({ key, entries: [entry] });
    }
    return sections;
}

/** The overline over a section. zh's word side is pinyin (CJK input goes to segment mode); es's is the headword. */
export function matchSectionLabel(key: DictionaryMatchSectionKey, term: string, language: Language): string {
    const quoted = `“${term}”`;
    const wordSide = language === 'zh' ? 'Pinyin' : 'Spanish';
    switch (key) {
        case 'english-exact':
            return `English ${quoted}`;
        case 'word-exact':
            return `${wordSide} ${quoted}`;
        case 'english-prefix':
            return `English starts with ${quoted}`;
        case 'word-prefix':
            return `${wordSide} starts with ${quoted}`;
        case 'other':
            return 'Other';
    }
}
