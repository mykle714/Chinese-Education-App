import { DictionaryEntry } from '../../types/index.js';

/**
 * Metadata entry for a dictionary-matched segment (word or character).
 */
export interface SegmentMeta {
  pronunciation?: string;
  definition?: string;
  definitions?: string[];
  // Verbatim overrides from exampleSentenceDefinitionPronunciationOverride — bypass context-matching when set
  overridePronunciation?: string;
  overrideDefinition?: string;
  vernacularScore?: number | null;
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
 * against a translated sentence. If no match is found, fall back to the first definition.
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
      const esOverride = entry.exampleSentenceDefinitionPronunciationOverride;
      map.set(entry.word1, {
        pronunciation: entry.pronunciation || '',
        definition: fallbackDefinition,
        definitions,
        vernacularScore: entry.vernacularScore ?? null,
        // Carry overrides through so the enrichment loop can apply them verbatim
        ...(esOverride?.pronunciation != null && { overridePronunciation: esOverride.pronunciation }),
        ...(esOverride?.definition != null && { overrideDefinition: esOverride.definition }),
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
 * Best-score segmentation of a Chinese string using a pre-fetched dictionary map.
 * Tries substring lengths 4→1. At each length tier, all matching substrings are
 * evaluated and the one with the highest vernacularScore is chosen (null treated as 0).
 * Tiebreak: later position in the string wins (higher startIdx).
 * The winner is extracted, then left/right remainders are recursively segmented.
 * Falls back to individual characters when no dictionary match exists at any length.
 *
 * @param str - The Chinese string to segment
 * @param dictMap - Pre-built lookup map (from buildDictMap)
 * @param excludeTokens - Optional set of multi-char tokens to skip (from buildExcludeSet).
 *   Single-char tokens are never excluded — they serve as the last-resort fallback.
 * @param prioritySegments - Optional ordered list of segments to prefer. When any
 *   candidate substring appears in this list, it bypasses length-tier and score
 *   checks. Earlier in the array = higher priority. Ties on priority index break
 *   on later position (higher startIdx).
 * @param classifierTokens - Optional set of tokens (typically single characters)
 *   tagged as classifiers in the source sentence's partOfSpeechDict. Acts as a
 *   forced-boundary pre-split: any occurrence is extracted as its own segment
 *   so the post-segmentation flow can attach its classifier annotation.
 *   Runs after the priority pass and before the main length-tier loop.
 * @returns Array of segments (each segment is 1-4 characters)
 */
export function segmentWithDict(
  str: string,
  dictMap: Map<string, SegmentMeta>,
  excludeTokens?: Set<string>,
  prioritySegments?: string[],
  classifierTokens?: Set<string>
): string[] {
  if (!str) return [];

  const chars = [...str];

  // Priority pass: if any candidate substring (at any length/position) appears in
  // prioritySegments, the front-most listed one wins outright — bypassing the
  // length-tier and vernacularScore logic below.
  if (prioritySegments && prioritySegments.length > 0) {
    let bestPriorityRank = Infinity;
    let bestPriorityIdx = -1;
    let bestPriorityLen = 0;

    for (let length = Math.min(4, chars.length); length >= 1; length--) {
      for (let startIdx = 0; startIdx <= chars.length - length; startIdx++) {
        const substring = chars.slice(startIdx, startIdx + length).join('');
        if (!dictMap.has(substring)) continue;
        if (length > 1 && excludeTokens?.has(substring)) continue;

        const rank = prioritySegments.indexOf(substring);
        if (rank === -1) continue;

        if (
          rank < bestPriorityRank ||
          (rank === bestPriorityRank && startIdx > bestPriorityIdx)
        ) {
          bestPriorityRank = rank;
          bestPriorityIdx = startIdx;
          bestPriorityLen = length;
        }
      }
    }

    if (bestPriorityIdx !== -1) {
      const winner = chars.slice(bestPriorityIdx, bestPriorityIdx + bestPriorityLen).join('');
      const left = chars.slice(0, bestPriorityIdx).join('');
      const right = chars.slice(bestPriorityIdx + bestPriorityLen).join('');
      return [
        ...segmentWithDict(left, dictMap, excludeTokens, prioritySegments, classifierTokens),
        winner,
        ...segmentWithDict(right, dictMap, excludeTokens, prioritySegments, classifierTokens),
      ];
    }
  }

  // Classifier pre-split: any token tagged as 'classifier' in the source sentence's
  // partOfSpeechDict becomes a forced segment boundary. Scan left-to-right at lengths
  // 4→1 and split on the first hit so the post-segmentation flow can attach the
  // classifier annotation reliably (previously these chars could be swallowed by
  // a longer GSA match). Recursive calls re-enter this pass, so multiple classifiers
  // in one sentence are all extracted in left-to-right order.
  if (classifierTokens && classifierTokens.size > 0) {
    for (let startIdx = 0; startIdx < chars.length; startIdx++) {
      for (
        let length = Math.min(4, chars.length - startIdx);
        length >= 1;
        length--
      ) {
        const substring = chars.slice(startIdx, startIdx + length).join('');
        if (!classifierTokens.has(substring)) continue;
        if (length > 1 && excludeTokens?.has(substring)) continue;

        const left = chars.slice(0, startIdx).join('');
        const right = chars.slice(startIdx + length).join('');
        return [
          ...segmentWithDict(left, dictMap, excludeTokens, prioritySegments, classifierTokens),
          substring,
          ...segmentWithDict(right, dictMap, excludeTokens, prioritySegments, classifierTokens),
        ];
      }
    }
  }

  // Try each length tier longest-first; within a tier, pick highest vernacularScore
  // (null = 0), tiebreaking on later position (higher startIdx = more specific context)
  for (let length = Math.min(4, chars.length); length >= 1; length--) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let startIdx = 0; startIdx <= chars.length - length; startIdx++) {
      const substring = chars.slice(startIdx, startIdx + length).join('');
      if (!dictMap.has(substring)) continue;
      // Skip multi-char tokens listed in matchException — single chars are never excluded
      if (length > 1 && excludeTokens?.has(substring)) continue;

      const score = dictMap.get(substring)!.vernacularScore ?? 0;
      if (score > bestScore || (score === bestScore && startIdx > bestIdx)) {
        bestScore = score;
        bestIdx = startIdx;
      }
    }

    if (bestIdx !== -1) {
      const winner = chars.slice(bestIdx, bestIdx + length).join('');
      const left = chars.slice(0, bestIdx).join('');
      const right = chars.slice(bestIdx + length).join('');
      return [
        ...segmentWithDict(left, dictMap, excludeTokens, prioritySegments, classifierTokens),
        winner,
        ...segmentWithDict(right, dictMap, excludeTokens, prioritySegments, classifierTokens),
      ];
    }
  }

  // No match at any length — return individual characters as fallback
  return chars;
}
