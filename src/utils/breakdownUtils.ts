import type { VocabEntry } from '../types';
import { resolveDisplayPronunciation } from './definitionUtils';

// Shared domain logic (utility layer) for building per-character breakdown rows.
// Used by both the flashcard Extra Info Card (EIP breakdown tab) and the Vocab
// Card Detail page, so it lives here rather than under a single page folder.

// Minimal structural shape this helper needs. Kept independent of any specific
// VocabEntry interface so callers using different VocabEntry definitions (the
// flashcards page vs. src/types) can both pass their entry without a type clash.
interface BreakdownEntryLike {
    entryKey: string;
    pronunciation?: string | null;
    // Optional so a caller without clusters still type-checks; when present, the headword's
    // pinyin is the sense-resolved reading (resolveDisplayPronunciation), not the raw column.
    definitionClusters?: VocabEntry['definitionClusters'];
    selectedSense?: VocabEntry['selectedSense'];
    breakdown?: Record<string, { definition: string; pronunciation?: string }> | null;
}

export interface BreakdownItem {
    character: string;
    pinyin: string;
    definition: string;
}

// Builds the per-character breakdown rows from an entry-like object. Characters
// not present in the breakdown map are filtered out (e.g. punctuation, repeated
// characters with no entry).
//
// Each character's pinyin is derived from the entry's sense-resolved pronunciation
// (the chosen sense — `senseIndexOverride`, else the persisted `selectedSense` — else the
// highest-frequencyScore cluster; the raw column only when unclustered), aligned
// by character position — the breakdown map itself often stores only definitions
// (no per-character pronunciation). Falls back to any pronunciation stored on the
// breakdown entry when the headword pronunciation is shorter than the word.
export function getBreakdownItems(
    entry: BreakdownEntryLike | null | undefined,
    senseIndexOverride?: number,
): BreakdownItem[] {
    if (!entry || !entry.breakdown) return [];
    const breakdown = entry.breakdown;
    const allChars = [...entry.entryKey];
    const headwordPinyin = resolveDisplayPronunciation(entry, senseIndexOverride);
    const pinyinParts = headwordPinyin ? headwordPinyin.split(' ') : [];
    return allChars
        .map((char, index) => ({
            character: char,
            pinyin: pinyinParts[index] ?? breakdown[char]?.pronunciation ?? '',
            definition: breakdown[char]?.definition ?? '',
        }))
        .filter(item => item.character in breakdown);
}
