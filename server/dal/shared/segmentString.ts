import { DictionaryEntry, ParticleClassifierEntry, DefinitionCluster, BreakdownMap } from '../../types/index.js';
import { ddt } from '../../utils/definitions.js';
import { numberedToTonedPinyin, readingSyllableCount } from '../../utils/pinyinTones.js';

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
  frequencyScore?: number | null;
  wordForms?: Record<string, string>;  // AI-generated English conjugation map (e.g. {past: "ran", present: "runs"})
  definitionClusters?: DefinitionCluster[] | null;  // Orthogonal sense clusters (zh; migration 90) — used to resolve a segment's dd from its tagged sense (senseDict)
  // Per-component-character sense tags for THIS word (backfill-breakdown-senses.js) —
  // the same map the flashcard breakdown tab renders. Drives single-character drill
  // rungs so a drill-down and the bt agree on which sense a character carries here.
  // See buildDrillRungs and docs/SEGMENT_DRILL_DOWN.md.
  breakdown?: BreakdownMap | null;
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
 * Longest token the segmenter will ever match: `getAllSubstrings` stops generating
 * candidates here, and `segmentWithDict`'s length tiers start here (`Math.min(4, ...)`).
 * Consequence for callers: a dictionary lookup driven by these candidates can only tell
 * you about headwords of at most this many characters — anything longer (zh has thousands
 * of 5+ char idioms) must be looked up explicitly. See
 * DictionaryDAL.segmentLongDefinitionTexts, which does exactly that for whole runs.
 */
export const SEGMENTATION_MAX_TOKEN_CHARS = 4;

/**
 * Generate all candidate substrings of a Chinese string, from longest to shortest.
 * Used to batch-lookup dictionary entries in a single DB call.
 *
 * @param str - The Chinese string to extract substrings from
 * @param maxLen - Maximum substring length to consider (default 4)
 * @returns Deduplicated array of candidate substrings
 */
export function getAllSubstrings(str: string, maxLen: number = SEGMENTATION_MAX_TOKEN_CHARS): string[] {
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
        frequencyScore: entry.frequencyScore ?? null,
        // Carry overrides through so the enrichment loop can apply them verbatim
        ...(esOverride?.pronunciation != null && { overridePronunciation: esOverride.pronunciation }),
        ...(esOverride?.definition != null && { overrideDefinition: esOverride.definition }),
        ...(entry.wordForms != null && { wordForms: entry.wordForms }),
        ...(entry.definitionClusters != null && { definitionClusters: entry.definitionClusters }),
        ...(entry.breakdown != null && { breakdown: entry.breakdown }),
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
 * evaluated and the one with the highest frequencyScore is chosen (null treated as 0).
 * Tiebreak: later position in the string wins (higher startIdx).
 * The winner is extracted, then left/right remainders are recursively segmented.
 * Falls back to individual characters when no dictionary match exists at any length.
 *
 * ⚠️ CLIENT PORT: the Reader runs a client-side port of this core
 * (src/features/reader/documentSegmentation.ts, docs/READER_SEGMENTATION.md —
 * without the priority/classifier passes). If you change the scoring or
 * tie-break rules here, mirror them there.
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
  // length-tier and frequencyScore logic below.
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

  // Try each length tier longest-first; within a tier, pick highest frequencyScore
  // (null = 0), tiebreaking on later position (higher startIdx = more specific context)
  for (let length = Math.min(4, chars.length); length >= 1; length--) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let startIdx = 0; startIdx <= chars.length - length; startIdx++) {
      const substring = chars.slice(startIdx, startIdx + length).join('');
      if (!dictMap.has(substring)) continue;
      // Skip multi-char tokens listed in matchException — single chars are never excluded
      if (length > 1 && excludeTokens?.has(substring)) continue;

      const score = dictMap.get(substring)!.frequencyScore ?? 0;
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
 * example sentences use all of it; long-definition uses pronunciation+definition.
 */
export interface RenderedSegmentMeta {
  pronunciation?: string;
  definition?: string;
  particleOrClassifier?: { type: 'particle' | 'classifier'; definition: string };
  wordForms?: Record<string, string>;
  /**
   * Narrower det headwords contained inside this segment, driving tap-to-drill
   * (docs/SEGMENT_DRILL_DOWN.md). Longest-first. Empty/absent for single characters
   * and for segments no shorter headword sits inside.
   */
  drill?: SegmentDrillRung[];
}

/**
 * One rung of a segment's tap-to-drill chain: a det headword that is a STRICT
 * substring of the segment, at a known character offset inside it.
 *
 * Why this can be shipped for free: every enrichment path already batch-loads a det
 * row for EVERY <=4-char substring of the text (`getAllSubstrings` -> `buildDictMap`),
 * because that is how the greedy segmenter picks its winners. Until now everything
 * that lost the segmentation was discarded; a rung is simply one of those losers,
 * kept. So there is no extra query, no stored column and no backfill behind this —
 * `segmentMetadata` is built at read time.
 *
 * Referenced by:
 *   - src/utils/segmentDrill.ts (the client-side rung picker)
 *   - src/components/SegmentedSentenceDisplay.tsx (est + long definition)
 *   - docs/SEGMENT_DRILL_DOWN.md
 */
export interface SegmentDrillRung {
  /** The sub-word, verbatim. Always a det headword and strictly shorter than its parent. */
  text: string;
  /** Character offset of `text` within the parent segment (0-based, code-point indexed). */
  offset: number;
  /**
   * The gloss the popup shows for this rung. Always present — a rung that resolved no
   * definition is DROPPED rather than shipped, because the popup only renders when it has
   * text, and a blank popup would read as a broken tap rather than as the end of the chain.
   */
  definition: string;
  /** Tone-marked pinyin, when the entry has one. Used to narrate the rung on select. */
  pronunciation?: string;
}

/**
 * Resolve ONE token's popup gloss + pinyin from a sense label, applying the app's
 * single priority order. Extracted because two callers need the identical rule:
 * `buildSegmentMetadata` (a top-level segment, labelled by the example-sentence tagging
 * pass via `senseDict`) and `buildDrillRungs` (a single-character rung, labelled by the
 * parent word's `breakdown`). Before the extraction the tagged-cluster resolution existed
 * only inside buildSegmentMetadata, and a drill rung would have had to re-implement it.
 *
 * Definition priority: manual override > the tagged cluster's lead gloss (ddt) >
 * `staleGloss` > translation-context match against the flat definitions.
 * Pronunciation priority: manual override > the tagged cluster's own `reading`
 * (tone-converted and syllable-count-guarded by `senseReading`) > `stalePronunciation` >
 * the entry-level column.
 *
 * `staleGloss`/`stalePronunciation` are the values the BREAKDOWN stores alongside its
 * sense label. They sit BELOW the live cluster resolution deliberately: the label is the
 * source of truth (it survives re-clustering), while the stored gloss is a snapshot that
 * `backfill-dictionary-breakdown.js` can clobber and that goes stale when a character's
 * glosses are later reordered — see docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md § 5b. They
 * are still worth having as the rung's last sense-aware answer before the generic
 * fallback.
 *
 * @param meta - the token's own dictionary metadata (from buildDictMap)
 * @param text - the token, used only to guard the cluster reading's syllable alignment
 * @param senseLabel - the cluster label this token carries in context, if any
 * @param translatedContext - the English translation, for the generic fallback match
 */
function resolveSenseView(
  meta: SegmentMeta,
  text: string,
  senseLabel: string | null | undefined,
  translatedContext: string | null,
  stale?: { gloss?: string; pronunciation?: string }
): { definition?: string; pronunciation?: string } {
  const matchedCluster = senseLabel && meta.definitionClusters
    ? meta.definitionClusters.find(c => c.sense === senseLabel)
    : undefined;

  // ddt can be "" when the cluster's lead gloss is purely parenthetical (e.g. a
  // particle's "(grammatical particle …)"); `|| undefined` lets that empty result fall
  // through to the next source instead of blanking the definition.
  const clusterDd = matchedCluster ? ddt(matchedCluster) || undefined : undefined;
  const definition = meta.overrideDefinition
    ?? clusterDd
    ?? stale?.gloss
    ?? pickDefinitionForTranslatedSentence(meta, translatedContext);

  const pronunciation = meta.overridePronunciation
    ?? senseReading(matchedCluster?.reading, text)
    ?? stale?.pronunciation
    ?? meta.pronunciation;

  return {
    ...(definition ? { definition } : {}),
    ...(pronunciation ? { pronunciation } : {}),
  };
}

/**
 * Build a segment's tap-to-drill chain: every det headword strictly inside `segment`,
 * ordered LONGEST-FIRST (which is also the order the client walks them in).
 *
 * Every offset is emitted separately, not just every distinct string: a repeated
 * character (人人, 走走) drills to the half the player actually tapped, which is only
 * decidable with the offset.
 *
 * Definitions here are NOT sense-tagged. The example-sentence tagging pass labels the
 * senses of the top-level segments only, so a rung falls back to the same
 * translation-context match un-tagged segments use. That is the right level of effort:
 * a rung is a "what is this piece?" answer, not the card's dd.
 *
 * @param segment - the parent segment (a GSA winner, or a stored tagging-pass token)
 * @param dictMap - the same pre-built lookup the segmenter ran on (from buildDictMap)
 * @param opts.excludeTokens - matchException tokens (from buildExcludeSet); skipped for
 *   multi-char rungs exactly as `segmentWithDict` skips them, so a token the dictionary
 *   says is not a real word here cannot come back as a drill rung. Single characters are
 *   never excluded, mirroring the segmenter.
 * @param opts.translatedContext - the English translation, for definition matching.
 */
export function buildDrillRungs(
  segment: string,
  dictMap: Map<string, SegmentMeta>,
  opts?: { excludeTokens?: Set<string>; translatedContext?: string | null }
): SegmentDrillRung[] {
  const chars = [...segment];
  if (chars.length < 2) return [];

  const { excludeTokens, translatedContext = null } = opts ?? {};
  const rungs: SegmentDrillRung[] = [];
  // The PARENT word's per-character sense tags — the same map the flashcard breakdown tab
  // (bt) renders. A single-character rung is glossed from this rather than from the
  // character's own lead sense, so drilling 银行 → 行 says "row/business" (háng), which is
  // what the breakdown says, instead of the standalone "to walk". Multi-character rungs
  // get no such answer: `breakdown` is keyed by CHARACTER only.
  const parentBreakdown = dictMap.get(segment)?.breakdown ?? undefined;

  // Cap at the segmenter's own window: dictMap only ever holds <=4-char substrings, so
  // longer slices of an over-length segment could never resolve anyway.
  const maxLength = Math.min(SEGMENTATION_MAX_TOKEN_CHARS, chars.length - 1);
  for (let length = maxLength; length >= 1; length--) {
    for (let offset = 0; offset + length <= chars.length; offset++) {
      const text = chars.slice(offset, offset + length).join('');
      const meta = dictMap.get(text);
      if (!meta) continue;
      if (length > 1 && excludeTokens?.has(text)) continue;

      // Single characters resolve through the parent's breakdown sense; longer rungs have
      // no breakdown entry, so they fall through resolveSenseView's generic path.
      const bd = length === 1 ? parentBreakdown?.[text] : undefined;
      const { definition, pronunciation } = resolveSenseView(
        meta,
        text,
        bd?.sense,
        translatedContext,
        bd ? { gloss: bd.definition, pronunciation: bd.pronunciation } : undefined
      );
      if (!definition) continue; // see SegmentDrillRung.definition — no gloss, no rung

      rungs.push({ text, offset, definition, ...(pronunciation ? { pronunciation } : {}) });
    }
  }

  return rungs;
}

/**
 * A tagged sense cluster's `reading` rendered as this segment's pronunciation, or
 * undefined when it can't safely stand in for the entry-level one.
 *
 * Two guards, both about not corrupting the cpcd pinyin row:
 *  - **syllable count must equal the segment's character count.** cpcd pairs syllables to
 *    characters positionally (`SegmentedSentenceDisplay` only renders per-char pinyin when
 *    `syllables.length === segmentLength`), so a cluster whose reading lost or gained a
 *    syllable — a clusterer slip, or an erhua/bound-form reading — would shift every
 *    syllable one character to the left. Better to keep the entry-level reading, which the
 *    pinyin backfills guarantee is aligned.
 *  - **CJK-only segments.** Punctuation and Latin runs never carry a reading.
 *
 * The card-level twin of this rule is `resolveDisplayPronunciation`
 * (`server/utils/definitions.ts` / `src/utils/definitionUtils.ts`), which resolves the same
 * per-sense reading from the learner's `selectedSense` instead of from a sentence's tag; it
 * compares against the `pronunciation` column's syllable count for the same reason.
 */
function senseReading(reading: string | null | undefined, segment: string): string | undefined {
  if (!reading?.trim()) return undefined;
  const chars = [...segment];
  if (!chars.every(ch => HAS_HAN.test(ch))) return undefined;
  if (readingSyllableCount(reading) !== chars.length) return undefined;
  return numberedToTonedPinyin(reading);
}

/**
 * Build the segment→metadata map shared by every Chinese enrichment path
 * (example sentences, long definition).
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
 *   definitionClusters, that cluster supplies BOTH halves of the segment's popup: the
 *   definition (dd) is ddt(matchedCluster) instead of the translation string-match fallback,
 *   and the pronunciation is the cluster's own `reading` (tone-marked) instead of the
 *   entry-level one — so a heteronym is read as the sense the sentence actually uses.
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
    excludeTokens?: Set<string>;
  }
): Record<string, RenderedSegmentMeta> {
  const { pacMap, partOfSpeechDict, translatedContext = null, includeWordForms = false, senseDict, excludeTokens } = opts ?? {};
  const result: Record<string, RenderedSegmentMeta> = {};

  for (const seg of segments) {
    const segMeta = dictMap.get(seg);
    const pacEntries = pacMap?.get(seg);
    // Tap-to-drill rungs (docs/SEGMENT_DRILL_DOWN.md). Computed BEFORE the
    // "is there any data for this segment" gate below, because a segment can have no det
    // row of its own and still contain shorter headwords — a stored tagging-pass token the
    // dictionary never had, for instance. That segment still deserves a drill chain.
    const drill = buildDrillRungs(seg, dictMap, { excludeTokens, translatedContext });

    // Only emit an entry when there's at least one data source for the segment.
    if (!segMeta && !pacEntries?.length && drill.length === 0) continue;

    const entry: RenderedSegmentMeta = {};
    if (drill.length > 0) entry.drill = drill;

    if (segMeta) {
      // The sense this segment carries HERE, as tagged by the example-sentence tagging
      // pass, drives BOTH halves of the popup — so a heteronym reads as the same sense in
      // its gloss and its pinyin (会 in the "to reckon accounts" sense is kuài, not the
      // entry-level huì; heteronyms are a hard cluster boundary, see
      // docs/DEFINITION_CLUSTERS.md). The full priority order, and why the drill rungs
      // share it, is documented on resolveSenseView.
      const { definition, pronunciation } = resolveSenseView(
        segMeta,
        seg,
        senseDict?.[seg],
        translatedContext
      );
      if (pronunciation) entry.pronunciation = pronunciation;
      if (definition) entry.definition = definition;
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
