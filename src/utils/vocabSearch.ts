import type { VocabEntry } from "../types";
import { hasChinese, tonedToNumberedPinyin } from "./textUtils";

// Client-side search over an already-loaded VocabEntry deck (e.g. the Mastered
// Cards page). It mirrors the query formats of the server-backed dictionary
// search bars (useDictionarySearch) without a network round trip, since the deck
// is fully in memory:
//
//   • CJK input ("健身")          → substring match on the word itself (entryKey).
//   • numbered pinyin ("jian4")   → match against the pronunciation converted to
//                                    numbered form (tone-exact).
//   • toneless pinyin ("jian")    → match against pronunciation with tones stripped.
//   • English ("fitness")         → substring match on the definition text.
//
// It is a best-effort client mirror, not a byte-for-byte reimplementation of the
// server's numbered-pinyin regex (buildNumberedPinyinPattern); it favors forgiving
// substring matching so a partial query still surfaces cards.

/** Pre-computed, lowercased search surfaces for one entry (built once per deck). */
interface EntrySearchIndex {
  entry: VocabEntry;
  word: string; // entryKey, lowercased
  definition: string; // definition (+ longDefinition), lowercased
  numberedPinyin: string; // "jian4 shen1"
  tonelessPinyin: string; // "jian shen"
}

const buildIndex = (entry: VocabEntry): EntrySearchIndex => {
  const numberedPinyin = tonedToNumberedPinyin((entry.pronunciation ?? "").toLowerCase());
  return {
    entry,
    word: (entry.entryKey ?? "").toLowerCase(),
    definition: `${entry.definition ?? ""} ${entry.longDefinition ?? ""}`.toLowerCase(),
    numberedPinyin,
    tonelessPinyin: numberedPinyin.replace(/[0-5]/g, ""),
  };
};

const indexMatches = (idx: EntrySearchIndex, query: string): boolean => {
  // CJK query targets the word only.
  if (hasChinese(query)) {
    return idx.word.includes(query);
  }

  // English definition match.
  if (idx.definition.includes(query)) return true;

  // Pinyin match. A digit in the query means the user typed numbered pinyin, so
  // compare tone-exact; otherwise ignore tones. Spaces are collapsed on both sides
  // so "jianshen" and "jian shen" both match "jian4 shen1".
  const collapse = (s: string) => s.replace(/\s+/g, "");
  if (/[0-5]/.test(query)) {
    return (
      idx.numberedPinyin.includes(query) ||
      collapse(idx.numberedPinyin).includes(collapse(query))
    );
  }
  return (
    idx.tonelessPinyin.includes(query) ||
    collapse(idx.tonelessPinyin).includes(collapse(query))
  );
};

/**
 * Filter a VocabEntry deck by a free-text query supporting the dictionary search
 * bar's formats (CJK / numbered pinyin / toneless pinyin / English). An empty or
 * whitespace-only query returns the deck unchanged.
 */
export const filterVocabEntries = (entries: VocabEntry[], rawQuery: string): VocabEntry[] => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return entries;
  return entries.filter((entry) => indexMatches(buildIndex(entry), query));
};
