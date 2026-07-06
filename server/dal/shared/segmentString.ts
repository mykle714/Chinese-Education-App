import { DictionaryEntry, ParticleClassifierEntry, DefinitionCluster } from '../../types/index.js';
import { ddt } from '../../utils/definitions.js';

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
  wordForms?: Record<string, string>;  // AI-generated English conjugation map (e.g. {past: "ran", present: "runs"})
  definitionClusters?: DefinitionCluster[] | null;  // Orthogonal sense clusters (zh; migration 90) — used to resolve a segment's dd from its tagged sense (senseDict)
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
  return parts
    .map(part => part.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Choose the best definition for a segment by matching dictionary definitions
 * against a translated sentence. If no match is found, fall back to the first definition.
 *
 * Match rules:
 *  - Word-boundary aware: a candidate must align with whitespace boundaries in the
 *    normalized translation. This prevents short glosses like "to" from matching
 *    inside unrelated words like "tomorrow".
 *  - Longest match wins: when multiple candidates match, prefer the one with the
 *    most normalized characters (e.g. "to give" beats "to"). Definition order is
 *    the tiebreaker, so earlier/preferred glosses still win at equal length.
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

  // Pad with spaces so ` candidate ` substring checks act as word boundaries
  // (normalizeText already collapses non-letter/number runs to single spaces).
  const paddedTranslation = ` ${normalizedTranslation} `;

  let best: { candidate: string; length: number; definitionIndex: number } | undefined;

  definitions.forEach((definition, definitionIndex) => {
    for (const candidate of expandDefinitionCandidates(definition)) {
      const normalizedCandidate = normalizeText(candidate);
      if (!normalizedCandidate) continue;
      if (!paddedTranslation.includes(` ${normalizedCandidate} `)) continue;

      const length = normalizedCandidate.length;
      if (
        !best ||
        length > best.length ||
        (length === best.length && definitionIndex < best.definitionIndex)
      ) {
        best = { candidate, length, definitionIndex };
      }
    }
  });

  return best?.candidate ?? fallback ?? undefined;
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
        ...(entry.wordForms != null && { wordForms: entry.wordForms }),
        ...(entry.definitionClusters != null && { definitionClusters: entry.definitionClusters }),
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

/**
 * Rendered metadata for one segment, keyed by segment string in the maps returned
 * from buildSegmentMetadata. Superset of every per-segment field the client renders:
 * example sentences use all of it; expansion/long-definition use pronunciation+definition.
 */
export interface RenderedSegmentMeta {
  pronunciation?: string;
  definition?: string;
  particleOrClassifier?: { type: 'particle' | 'classifier'; definition: string };
  wordForms?: Record<string, string>;
}

/**
 * Build the segment→metadata map shared by every Chinese enrichment path
 * (example sentences, expansion, long definition).
 *
 * Given an already-computed segment list and a pre-fetched dictionary map, resolve
 * each segment's pronunciation + best definition (override-aware, context-matched via
 * pickDefinitionForTranslatedSentence) and, when enabled, its particle/classifier
 * annotation and AI wordForms. Segmentation itself stays at the call site because each
 * path seeds segmentWithDict differently (priority headword, classifier boundaries);
 * only this per-segment build was duplicated.
 *
 * @param segments - GSA segments to annotate (from segmentWithDict)
 * @param dictMap - Pre-built dictionary lookup (from buildDictMap)
 * @param opts.pacMap - Particle/classifier annotations (from fetchParticlesAndClassifiers)
 * @param opts.partOfSpeechDict - Sentence's AI POS tags; gates particle/classifier display
 * @param opts.translatedContext - English translation used to context-match definitions
 * @param opts.includeWordForms - When true, attach segMeta.wordForms (example sentences only)
 * @param opts.senseDict - Per-segment sense labels (from the example-sentence tagging pass,
 *   backfill-example-sentences.js). When a segment's label matches one of that segment's own
 *   definitionClusters, the segment's definition (dd) is resolved as ddt(matchedCluster) —
 *   the cluster's stripped lead gloss — instead of the translation string-match fallback.
 */
export function buildSegmentMetadata(
  segments: string[],
  dictMap: Map<string, SegmentMeta>,
  opts?: {
    pacMap?: Map<string, ParticleClassifierEntry[]>;
    partOfSpeechDict?: Record<string, string>;
    translatedContext?: string | null;
    includeWordForms?: boolean;
    senseDict?: Record<string, string>;
  }
): Record<string, RenderedSegmentMeta> {
  const { pacMap, partOfSpeechDict, translatedContext = null, includeWordForms = false, senseDict } = opts ?? {};
  const result: Record<string, RenderedSegmentMeta> = {};

  for (const seg of segments) {
    const segMeta = dictMap.get(seg);
    const pacEntries = pacMap?.get(seg);

    // Only emit an entry when there's at least one data source for the segment.
    if (!segMeta && !pacEntries?.length) continue;

    const entry: RenderedSegmentMeta = {};

    if (segMeta) {
      // Verbatim overrides win; otherwise fall back to stored pronunciation.
      const pronunciation = segMeta.overridePronunciation ?? segMeta.pronunciation;
      if (pronunciation) entry.pronunciation = pronunciation;
      // Definition resolution priority:
      //   1. manual override (verbatim),
      //   2. the segment's TAGGED sense → ddt(matching cluster) — the cluster's own
      //      stripped lead gloss (the sense the tagging pass says this segment carries here),
      //   3. translation string-match against the flat definitions (legacy fallback, and the
      //      only path for un-tagged/un-clustered segments).
      const senseLabel = senseDict?.[seg];
      const matchedCluster = senseLabel && segMeta.definitionClusters
        ? segMeta.definitionClusters.find(c => c.sense === senseLabel)
        : undefined;
      // ddt can be "" when the cluster's lead gloss is purely parenthetical (e.g. a
      // particle's "(grammatical particle …)"); `|| undefined` lets that empty result
      // fall through to the string-match fallback instead of blanking the definition.
      const clusterDd = matchedCluster ? ddt(matchedCluster) || undefined : undefined;
      const bestDefinition = segMeta.overrideDefinition
        ?? clusterDd
        ?? pickDefinitionForTranslatedSentence(segMeta, translatedContext);
      if (bestDefinition) entry.definition = bestDefinition;
      if (includeWordForms && segMeta.wordForms) entry.wordForms = segMeta.wordForms;
    }

    // Attach particle/classifier annotation only when the source sentence's AI POS dict
    // confirms this token is used as a particle/classifier here (prevents e.g. 把 always
    // showing its grammatical label). Particle preferred over classifier when both exist.
    if (pacEntries?.length && partOfSpeechDict) {
      const posTag = partOfSpeechDict[seg];
      if (posTag === 'particle' || posTag === 'classifier') {
        const particle = pacEntries.find(e => e.type === 'particle');
        const classifier = pacEntries.find(e => e.type === 'classifier');
        const preferred = particle ?? classifier;
        if (preferred) {
          entry.particleOrClassifier = { type: preferred.type, definition: preferred.definition };
        }
      }
    }

    result[seg] = entry;
  }

  return result;
}

// A maximal run of CJK characters: Han ideographs plus CJK symbols/punctuation
// (　-〿, e.g. 、。《》) and fullwidth forms (＀-￯). Keeping adjacent
// CJK punctuation inside the run lets an embedded Chinese clause render as one cpcd
// block instead of fragmenting around every comma.
const FOREIGN_RUN_REGEX = /[\p{Script=Han}　-〿＀-￯]+/gu;
const HAS_HAN = /\p{Script=Han}/u;

export interface TextRun {
  type: 'text' | 'han';
  value: string;
}

/**
 * Split mixed English + Chinese prose into ordered runs. A 'han' run is a maximal CJK
 * stretch containing at least one Han character (rendered as cpcd downstream); everything
 * else — including CJK-punctuation-only stretches — folds into 'text' runs. Adjacent text
 * runs are merged so the result strictly alternates text/han.
 */
export function splitHanRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = runs[runs.length - 1];
    if (last && last.type === 'text') last.value += value;
    else runs.push({ type: 'text', value });
  };

  let lastIndex = 0;
  for (const match of text.matchAll(FOREIGN_RUN_REGEX)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) pushText(text.slice(lastIndex, idx));
    if (HAS_HAN.test(match[0])) runs.push({ type: 'han', value: match[0] });
    else pushText(match[0]); // punctuation-only run carries no lookup value → treat as text
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) pushText(text.slice(lastIndex));

  return runs;
}
