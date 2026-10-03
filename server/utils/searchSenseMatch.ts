/**
 * Search-sense matching — which of a dictionary hit's senses the search term actually hit.
 *
 * LAYER: pure utility (no I/O). Called by the service layer
 * (`server/services/DictionaryService.ts` → `searchDictionary`) after the DAL query, and its
 * query parser is shared with the DAL's ranking SQL
 * (`server/dal/implementations/DictionaryDAL.ts` → `searchByWord1`).
 *
 * WHY. A search row is displayed by its DEFAULT sense (`resolveDefaultPronunciation`), but it can
 * qualify through any of its readings or glosses. 吗 qualifies for "ma2" through its rare 吗啡
 * reading má, then rendered as the particle "ma" — the row looked like a wrong answer. When the
 * term hits a sense OTHER than the default, `resolveMatchedSense` names it, and the client row
 * (`src/utils/definitionUtils.ts` → `resolveSearchRowView`) shows that sense's pinyin with its
 * glosses leading the list; the cdp link carries it too, so the detail page opens on it.
 *
 * RULES (decided 2026-10-03):
 *   1. Pinyin first. If the term parses as pinyin and the default sense's reading matches it,
 *      nothing changes. Otherwise the best non-default sense whose reading matches wins.
 *   2. English second — consulted only when no pinyin sense was chosen. Same shape: the
 *      default sense's glosses matching means nothing changes; otherwise the best matching
 *      non-default sense wins.
 *   "Best" = a COMPLETE match over a prefix/partial one, then higher cluster
 *   `frequencyScore`, then array order (the same stable tiebreak `defaultSenseCluster` uses).
 *
 * Depended on by: docs/DICTIONARY_NUMBERED_PINYIN_SEARCH.md § "Sense matching",
 * docs/DEFINITION_CLUSTERS.md.
 */

import type { DefinitionCluster } from '../types/index.js';
import { readingSyllableCount } from './pinyinTones.js';

/** One query syllable: its toneless base (ü spelled `v`, as the det columns spell it) and an optional tone (5 = neutral). */
export interface PinyinQuerySyllable {
  base: string;
  /** 1–4, 5 for neutral, or null for "any tone" (the learner typed no tone). */
  tone: number | null;
}

// Tone-marked vowel → [plain vowel, tone]. ü spells as `v` to match the det columns.
const MARKED_VOWELS: Record<string, [string, number]> = {
  ā: ['a', 1], á: ['a', 2], ǎ: ['a', 3], à: ['a', 4],
  ē: ['e', 1], é: ['e', 2], ě: ['e', 3], è: ['e', 4],
  ī: ['i', 1], í: ['i', 2], ǐ: ['i', 3], ì: ['i', 4],
  ō: ['o', 1], ó: ['o', 2], ǒ: ['o', 3], ò: ['o', 4],
  ū: ['u', 1], ú: ['u', 2], ǔ: ['u', 3], ù: ['u', 4],
  ǖ: ['v', 1], ǘ: ['v', 2], ǚ: ['v', 3], ǜ: ['v', 4],
};

/**
 * Parse a search term as space-separated pinyin syllables — numbered ("ma2", "ma5"/"ma0" =
 * neutral), tone-marked ("má") or toneless ("ma" = any tone). Returns null when any token is
 * not syllable-shaped (letters plus at most one tone mark OR one trailing digit).
 *
 * Deliberately does NOT check that a base is a real pinyin syllable: the result is only ever
 * compared against real readings, so an English word like "hello" simply matches nothing. That
 * also means callers must never use it to decide WHETHER a row qualifies (the DAL's WHERE keeps
 * its own stricter rule); it only orders and labels rows that already did.
 */
export function parsePinyinQuery(term: string): PinyinQuerySyllable[] | null {
  const tokens = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const syllables: PinyinQuerySyllable[] = [];
  for (const raw of tokens) {
    let token = raw.replace(/u:/g, 'v').replace(/ü/g, 'v');
    let markedTone: number | null = null;
    let letters = '';
    for (const ch of token) {
      const marked = MARKED_VOWELS[ch];
      if (marked) {
        if (markedTone !== null) return null; // two tone marks in one syllable
        markedTone = marked[1];
        letters += marked[0];
      } else {
        letters += ch;
      }
    }
    token = letters;
    const match = /^([a-z]+)([0-5])?$/.exec(token);
    if (!match) return null;
    const [, base, digit] = match;
    if (digit !== undefined && markedTone !== null) return null; // "má2" — mark AND digit
    const tone = markedTone ?? (digit === undefined ? null : digit === '0' ? 5 : Number(digit));
    syllables.push({ base, tone });
  }
  return syllables;
}

/**
 * The parsed query in the token spelling the DAL's `buildTokenPinyinPattern` takes
 * ("ma2", "ma5" for neutral, bare "ma" for any tone).
 */
export function pinyinQueryTokens(syllables: PinyinQuerySyllable[]): string[] {
  return syllables.map(s => (s.tone === null ? s.base : `${s.base}${s.tone}`));
}

/**
 * Parse a NUMBERED reading — a cluster `reading` ("me5", "nv3") or the `numberedPinyin` column
 * (neutral written with no digit) — into syllables with neutral normalized to 5. Null when it
 * is not numbered pinyin.
 */
function parseNumberedReading(reading: string | null | undefined): PinyinQuerySyllable[] | null {
  if (!reading) return null;
  const out: PinyinQuerySyllable[] = [];
  for (const raw of reading.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const match = /^([a-z]+)([0-5])?$/.exec(raw.replace(/u:/g, 'v').replace(/ü/g, 'v'));
    if (!match) return null;
    const [, base, digit] = match;
    out.push({ base, tone: digit === undefined || digit === '0' ? 5 : Number(digit) });
  }
  return out.length > 0 ? out : null;
}

/** 0 = no match, 1 = the query is a leading run of the reading's syllables, 2 = the whole reading. */
function readingMatchStrength(query: PinyinQuerySyllable[], reading: PinyinQuerySyllable[] | null): 0 | 1 | 2 {
  if (!reading || query.length > reading.length) return 0;
  for (let i = 0; i < query.length; i++) {
    if (query[i].base !== reading[i].base) return 0;
    if (query[i].tone !== null && query[i].tone !== reading[i].tone) return 0;
  }
  return query.length === reading.length ? 2 : 1;
}

/**
 * The reading a cluster DISPLAYS, in numbered form — mirrors `clusterReadingOrColumn`
 * (server/utils/definitions.ts): the cluster's own reading unless it is missing or its
 * syllable count disagrees with the `pronunciation` column, in which case the column. So the
 * matcher judges the pinyin the learner would actually see on the row.
 */
function displayedNumberedReading(
  cluster: DefinitionCluster,
  entry: { pronunciation?: string | null; numberedPinyin?: string | null },
): PinyinQuerySyllable[] | null {
  const own = parseNumberedReading(cluster.reading);
  const column = entry.pronunciation ?? null;
  if (own && (!column || readingSyllableCount(column) === own.length)) return own;
  return parseNumberedReading(entry.numberedPinyin);
}

// The same parenthetical strip the DAL's gloss search applies (`STRIPPED_ALL_GLOSSES`).
const stripAsides = (text: string): string => text.replace(/\s*\([^)]*\)/g, '');
// The same leading markers the DAL's complete-English test ignores (`GLOSS_LEADING_MARKERS`).
const LEADING_MARKER = /^(?:to|the|an|a)\s+/;
const normalizeGloss = (text: string): string => stripAsides(text).trim().toLowerCase().replace(LEADING_MARKER, '');

/** 0 = no gloss contains the term as a whole word, 1 = one does, 2 = one IS the term (after normalization). */
function glossMatchStrength(cluster: DefinitionCluster, term: string): 0 | 1 | 2 {
  const glosses = Array.isArray(cluster.glosses) ? cluster.glosses.filter((g): g is string => typeof g === 'string') : [];
  const normalizedTerm = normalizeGloss(term);
  if (!normalizedTerm) return 0;
  // Each element is also split on '; ', as the DAL's `completeGlossMatch` does.
  if (glosses.some(g => g.split('; ').some(part => normalizeGloss(part) === normalizedTerm))) return 2;
  const escaped = term.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wholeWord = new RegExp(`\\b${escaped}\\b`, 'i');
  return glosses.some(g => wholeWord.test(stripAsides(g))) ? 1 : 0;
}

/**
 * Pick the best non-default cluster by `strength`, or null when the default already matches
 * (nothing to switch to) or no cluster matches at all.
 */
function pickMatchedCluster(
  clusters: DefinitionCluster[],
  defaultIndex: number,
  strength: (cluster: DefinitionCluster) => number,
): number | null {
  if (strength(clusters[defaultIndex]) > 0) return null;
  let best: { index: number; strength: number; frequency: number } | null = null;
  clusters.forEach((cluster, index) => {
    const s = strength(cluster);
    if (s === 0) return;
    const frequency = cluster.frequencyScore ?? -1;
    // Strictly-greater comparisons keep the EARLIER cluster on a tie (stable, like defaultSenseCluster).
    if (!best || s > best.strength || (s === best.strength && frequency > best.frequency)) {
      best = { index, strength: s, frequency };
    }
  });
  return best === null ? null : (best as { index: number }).index;
}

/**
 * The `sense` label of the cluster the search term hit, when that is NOT the entry's default
 * sense — or null (the row should render exactly as before). See the module header for rules.
 *
 * Entries with fewer than two clusters always return null: there is no other sense to show.
 */
export function resolveMatchedSense(
  entry: {
    pronunciation?: string | null;
    numberedPinyin?: string | null;
    definitionClusters?: DefinitionCluster[] | null;
  },
  term: string,
): string | null {
  const clusters = Array.isArray(entry.definitionClusters)
    ? entry.definitionClusters.filter((c): c is DefinitionCluster => !!c && typeof c === 'object')
    : [];
  if (clusters.length < 2) return null;

  // Default sense = highest frequencyScore, earliest on a tie (`defaultSenseCluster`).
  let defaultIndex = 0;
  clusters.forEach((c, i) => {
    if ((c.frequencyScore ?? -1) > (clusters[defaultIndex].frequencyScore ?? -1)) defaultIndex = i;
  });

  const query = parsePinyinQuery(term);
  if (query) {
    // The default reading matching ends the search: pinyin wins over English (rule 1), and the
    // row already shows what the learner typed.
    if (readingMatchStrength(query, displayedNumberedReading(clusters[defaultIndex], entry)) > 0) return null;
    const pinyinIndex = pickMatchedCluster(clusters, defaultIndex,
      c => readingMatchStrength(query, displayedNumberedReading(c, entry)));
    if (pinyinIndex !== null) return clusters[pinyinIndex].sense ?? null;
  }

  const englishIndex = pickMatchedCluster(clusters, defaultIndex, c => glossMatchStrength(c, term));
  return englishIndex === null ? null : clusters[englishIndex].sense ?? null;
}
