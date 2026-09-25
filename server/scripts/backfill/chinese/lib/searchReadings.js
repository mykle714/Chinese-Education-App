/**
 * searchReadings — every reading a zh headword can be searched under.
 *
 * LAYER: data-enrichment (backfill) library. Pure — no I/O.
 *
 * det has ONE row per headword (unique `word1`), but a heteronym has several readings:
 * 行 is xíng / háng / héng, 了 is le / liǎo / liào. `pronunciation` / `numberedPinyin` hold
 * only the PRIMARY one, and pinyin search used to match only those two columns — so 行 was
 * unfindable as "xing" while its column said háng, and 了 is still unfindable as "liao".
 * `searchReadings` (migration 165) holds the rest, and `DictionaryDAL.searchByWord1` ORs its
 * pinyin regexes against it (docs/DICTIONARY_NUMBERED_PINYIN_SEARCH.md).
 *
 * FORMAT: every distinct reading in BOTH column forms, pipe-separated, toned forms first:
 *     行 → "xíng|háng|héng|xing2|hang2|heng2"
 * The two halves exist because search has two pinyin regexes — the accent-agnostic one that
 * `pronunciation` answers and the numbered one that `numberedPinyin` answers — and each can
 * then run against this column unchanged, with `(^|\|)` in place of `^`. A toned form can
 * never be mistaken for a numbered one (one carries a diacritic or no digit, the other a
 * digit), so interleaving them in one string costs nothing.
 *
 * NULL when the headword has only one reading — the primary columns already cover it, and
 * leaving 113k single-reading rows NULL keeps the column (and every search's scan of it) small.
 *
 * SOURCES, unioned: the headword's CC-CEDICT readings (only those capture the ~950 heteronyms
 * that were never sense-clustered), its sense clusters' `reading`s, its primary columns
 * (old AND new, when a caller is changing them — so a repair never makes a word unfindable
 * under the reading it used to be listed as), and whatever the row already carries in
 * `searchReadings` (so a later cluster rewrite, which has no CEDICT at hand, only ever ADDS).
 *
 * The file also owns the PRIMARY-reading rule (`defaultPrimaryForms`), because the two always
 * move together: re-pointing the primary is only safe when the old primary is folded into
 * `searchReadings` in the same write.
 *
 * Referenced by: scripts/backfill/chinese/backfill-search-readings.js,
 * scripts/backfill/chinese/backfill-cluster-definitions.js,
 * docs/DICTIONARY_NUMBERED_PINYIN_SEARCH.md.
 */

import { numberedReadingToColumnForms, toNumberedPinyin } from './cedictPinyin.js';
// TS import — both consumers run under tsx (see their usage lines).
import { resolveDefaultPronunciation } from '../../../../utils/definitions.js';

/** Split an existing `searchReadings` value back into its NUMBERED readings. */
function numberedFromExisting(searchReadings) {
  if (typeof searchReadings !== 'string' || !searchReadings) return [];
  // The numbered half is ASCII-only; a toned form always carries a diacritic or is identical
  // to its numbered twin (a neutral-only reading such as "de"), so ASCII-only == numbered.
  return searchReadings.split('|').filter(r => /^[a-z0-9 ]+$/.test(r));
}

/**
 * Build the `searchReadings` value for one row.
 *
 * @param {object} sources
 * @param {string[]} [sources.cedictReadings]   raw CEDICT pinyin for this headword ("Xing2", "nu:3")
 * @param {Array<{reading?: string}>|null} [sources.clusters]  `definitionClusters`
 * @param {Array<string|null|undefined>} [sources.primaryNumbered]  `numberedPinyin` value(s) — pass
 *   both the old and the new one when the caller is changing the primary reading
 * @param {string|null} [sources.existing]      the row's current `searchReadings`
 * @returns {string|null}
 */
export function buildSearchReadings({ cedictReadings = [], clusters = null, primaryNumbered = [], existing = null }) {
  // CEDICT and cluster readings put a digit on every syllable, so a digit-less token there is
  // a Latin letter, not pinyin (see numberedReadingToColumnForms). det's own columns — and the
  // numbered half of an existing value, which came from them — write neutral digit-less.
  const toneDigited = [...cedictReadings, ...(Array.isArray(clusters) ? clusters.map(c => c?.reading) : [])];
  const columnStyle = [...primaryNumbered, ...numberedFromExisting(existing)];

  // Keyed by the NUMBERED form: that is the identity of a reading ("de5" from a cluster and
  // "de" from the column are the same reading once both go through the column chain).
  const byNumbered = new Map();
  const add = (reading, requireToneDigits) => {
    const forms = numberedReadingToColumnForms(reading, { requireToneDigits });
    if (forms && !byNumbered.has(forms.numberedPinyin)) byNumbered.set(forms.numberedPinyin, forms);
  };
  toneDigited.forEach(r => add(r, true));
  columnStyle.forEach(r => add(r, false));
  if (byNumbered.size <= 1) return null;

  const all = [...byNumbered.values()];
  const parts = [...all.map(f => f.pronunciation), ...all.map(f => f.numberedPinyin)];
  return [...new Set(parts)].join('|');
}

/**
 * The det primary columns (pronunciation / numberedPinyin / tone) re-pointed at the entry's
 * DEFAULT sense, or null when they already say it (or there is no cluster reading to use).
 *
 * "Default sense" = `resolveDefaultPronunciation` (server/utils/definitions.ts): the
 * highest-frequencyScore cluster among ALL clusters, particles included, a tie going to the
 * earlier one in array order. Deliberately NOT the card resolver, which skips gloss-less
 * particle clusters and would re-point 了 from `le` to `liǎo`. Going through the server
 * resolver (rather than re-implementing the pick) keeps the column identical to what an
 * untagged sentence segment renders.
 *
 * @param {{ pronunciation: string|null, numberedPinyin: string|null, definitionClusters: any }} row
 * @returns {{ pronunciation: string, numberedPinyin: string, tone: string } | null}
 */
export function defaultPrimaryForms(row) {
  const toned = resolveDefaultPronunciation({
    pronunciation: row.pronunciation,
    definitionClusters: row.definitionClusters,
  });
  if (!toned || toned === row.pronunciation) return null;
  const forms = numberedReadingToColumnForms(toNumberedPinyin(toned));
  if (!forms || forms.numberedPinyin === row.numberedPinyin) return null;
  return forms;
}
