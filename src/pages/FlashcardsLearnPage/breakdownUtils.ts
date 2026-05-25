import type { VocabEntry, BreakdownItem } from "./types";

// Builds the per-character breakdown rows for the EIP breakdown tab from a
// VocabEntry-shaped object. Characters not present in the breakdown map are
// filtered out (e.g. punctuation, repeated characters with no entry).
export function getBreakdownItems(entry: VocabEntry | null | undefined): BreakdownItem[] {
    if (!entry || !entry.breakdown) return [];
    const breakdown = entry.breakdown;
    const allChars = [...entry.entryKey];
    const pinyinParts = entry.pronunciation ? entry.pronunciation.split(' ') : [];
    return allChars
        .map((char, index) => ({
            character: char,
            pinyin: pinyinParts[index] ?? '',
            definition: breakdown[char]?.definition ?? '',
        }))
        .filter(item => item.character in breakdown);
}
