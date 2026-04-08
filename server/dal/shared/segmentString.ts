import { DictionaryEntry } from '../../types/index.js';

/**
 * Metadata entry for a dictionary-matched segment (word or character).
 */
export interface SegmentMeta {
  pronunciation?: string;
  definition?: string;
  shortDefinition?: string | null;
  definitions?: string[];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandDefinitionCandidates(definition: string): string[] {
  const raw = definition.trim();
  if (!raw) return [];

  const parts = raw.split(';').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return [raw];
  return parts.map(part => part.replace(/ \([^)]+\)$/, '').trim()).filter(Boolean);
}

/**
 * Choose the best definition for a segment by matching dictionary definitions
 * against a translated sentence. If no match is found, fall back to shortDefinition.
 */
export function pickDefinitionForTranslatedSentence(
  meta: SegmentMeta,
  translatedSentence?: string | null
): string | undefined {
  const fallback = meta.definitions?.[0] ?? meta.definition;
  const definitions = meta.definitions ?? [];

  if (!translatedSentence || definitions.length === 0) {
    return fallback ?? undefined;
  }

  const normalizedTranslation = normalizeText(translatedSentence);
  if (!normalizedTranslation) {
    return fallback ?? undefined;
  }

  for (const definition of definitions) {
    for (const candidate of expandDefinitionCandidates(definition)) {
      const normalizedCandidate = normalizeText(candidate);
      if (!normalizedCandidate) continue;
      if (normalizedTranslation.includes(normalizedCandidate)) {
        return candidate;
      }
    }
  }

  return fallback ?? undefined;
}

/**
 * Generate all candidate substrings of a Chinese string, from longest to shortest.
 * Used to batch-lookup dictionary entries in a single DB call.
 *
 * @param str - The Chinese string to extract substrings from
 * @param maxLen - Maximum substring length to consider (default 4)
 * @returns Deduplicated array of candidate substrings
 */
export function getAllSubstrings(str: string, maxLen: number = 4): string[] {
  const chars = [...str];
  const seen = new Set<string>();

  for (let length = Math.min(maxLen, chars.length); length >= 1; length--) {
    for (let i = 0; i <= chars.length - length; i++) {
      seen.add(chars.slice(i, i + length).join(''));
    }
  }

  return [...seen];
}

/**
 * Build a lookup map from dictionary entries, keyed by word1.
 * First entry for each word1 wins (preserves pronunciation + definitions).
 *
 * @param dictEntries - Array of DictionaryEntry rows from the DAL
 * @returns Map keyed by word1 with pronunciation and definition
 */
export function buildDictMap(dictEntries: DictionaryEntry[]): Map<string, SegmentMeta> {
  const map = new Map<string, SegmentMeta>();

  for (const entry of dictEntries) {
    if (!map.has(entry.word1)) {
      const definitions = Array.isArray(entry.definitions)
        ? entry.definitions
        : [entry.definitions as unknown as string];
      const fallbackDefinition = definitions[0];
      map.set(entry.word1, {
        pronunciation: entry.pronunciation || '',
        definition: entry.shortDefinition ?? fallbackDefinition,
        shortDefinition: entry.shortDefinition ?? fallbackDefinition ?? null,
        definitions,
      });
    }
  }

  return map;
}

/**
 * Collect all matchException tokens from a batch of dictionary entries into a
 * single exclusion set. Pass the result to segmentWithDict to globally suppress
 * those tokens from being matched during segmentation.
 *
 * @param dictEntries - Array of DictionaryEntry rows from the DAL
 * @returns Set of token strings that should be skipped during GSA matching
 */
export function buildExcludeSet(dictEntries: DictionaryEntry[]): Set<string> {
  const excluded = new Set<string>();
  for (const entry of dictEntries) {
    if (Array.isArray(entry.matchException)) {
      for (const token of entry.matchException) {
        excluded.add(token);
      }
    }
  }
  return excluded;
}

/**
 * Greedy longest-match segmentation of a Chinese string using a pre-fetched dictionary map.
 * Tries substring lengths 4→3→2→1, scanning left-to-right at each length tier.
 * The first match found is extracted, then left/right remainders are recursively segmented.
 * Falls back to individual characters when no dictionary match exists.
 *
 * @param str - The Chinese string to segment
 * @param dictMap - Pre-built lookup map (from buildDictMap)
 * @param excludeTokens - Optional set of multi-char tokens to skip (from buildExcludeSet).
 *   Single-char tokens are never excluded — they serve as the last-resort fallback.
 * @returns Array of segments (each segment is 1-4 characters)
 */
export function segmentWithDict(
  str: string,
  dictMap: Map<string, SegmentMeta>,
  excludeTokens?: Set<string>
): string[] {
  if (!str) return [];

  const chars = [...str];

  // Try longest substrings first (greedy), scanning left-to-right at each length
  for (let length = Math.min(4, chars.length); length >= 1; length--) {
    for (let startIdx = 0; startIdx <= chars.length - length; startIdx++) {
      const substring = chars.slice(startIdx, startIdx + length).join('');
      if (dictMap.has(substring)) {
        // Skip multi-char tokens listed in matchException — single chars are never excluded
        if (length > 1 && excludeTokens?.has(substring)) continue;

        const left = chars.slice(0, startIdx).join('');
        const right = chars.slice(startIdx + length).join('');
        return [
          ...segmentWithDict(left, dictMap, excludeTokens),
          substring,
          ...segmentWithDict(right, dictMap, excludeTokens),
        ];
      }
    }
  }

  // No match at any length — return individual characters as fallback
  return chars;
}
