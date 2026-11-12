/**
 * Orphaned sense labels in stored example sentences — detection + the free remap rule.
 *
 * LAYER: data-enrichment (backfill) utility layer. Pure functions, no I/O.
 *
 * WHY THIS EXISTS: an example sentence stores, per segment, the `sense` LABEL of the
 * segment's definitionClusters entry it was tagged with (`senseDict[seg]`, and per
 * occurrence `segmentOccurrenceTags[i].sense`). The read path resolves that label by EXACT
 * string match (segmentString.ts → resolveSenseView). Re-clustering a word renames its
 * labels, so every sentence tagged before the re-cluster silently loses the sense: the
 * popup gloss falls back to a translation-string match and the pinyin falls back to the
 * word's DEFAULT reading — which is wrong for a heteronym used in a minority reading
 * (地 rendered dì instead of de, 过 guò instead of guo). Measured 2026-11-11 on PPE: 85k of
 * 521k tags were orphaned.
 *
 * The remap rule (`deterministicRemap`) is the zero-cost first pass: it re-points a stale
 * label only when exactly one current label is unambiguously the same sense. Anything it
 * cannot decide is left for the model (reconcile-sentence-senses.js stages A/B).
 *
 * Referenced by: chinese/reconcile-sentence-senses.js, chinese/backfill-cluster-definitions.js
 * (rename carry-forward), docs/EXAMPLE_SENTENCES.md § "Stale sense labels".
 */

/** Lowercased letters only, parentheticals dropped: "Adverbial particle (-ly)" → "adverbialparticle". */
export const normalizeSenseLabel = (label) =>
  String(label ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '');

/** A label's "/", ";" or ","-separated alternatives, each normalized: "to use / employ" → ["touse", "employ"]. */
const labelAlternatives = (label) =>
  String(label ?? '').replace(/\(.*?\)/g, '').split(/[/;,]/).map(normalizeSenseLabel).filter(Boolean);

/**
 * The current cluster label a stale label unambiguously means, or null.
 *
 * Two rules, both requiring a UNIQUE match among the word's current clusters:
 *   1. normalized: equal after dropping parentheticals/punctuation/case
 *      ("you (informal)" → "you (singular)").
 *   2. alternative: the stale label equals one whole alternative of a current label, i.e.
 *      the cluster was BROADENED ("this" → "this / these").
 * Deliberately NOT a substring match: a stale label that SPANS several current clusters
 * means the old cluster was SPLIT ("completed-action / change-of-state particle" → two
 * clusters), so which one a given sentence meant needs the sentence — that is the model's
 * job. A plain substring rule also mis-fired on short labels (多 "more" → "and more / -plus").
 *
 * @param {string} staleLabel
 * @param {{sense: string}[]} clusters - the segment's CURRENT definitionClusters
 * @returns {string|null}
 */
export function deterministicRemap(staleLabel, clusters) {
  if (!Array.isArray(clusters) || clusters.length === 0) return null;
  const n = normalizeSenseLabel(staleLabel);
  if (!n) return null;
  const exact = clusters.filter(c => normalizeSenseLabel(c?.sense) === n);
  if (exact.length === 1) return exact[0].sense;
  if (exact.length > 1) return null;
  const broadened = clusters.filter(c => labelAlternatives(c?.sense).includes(n));
  return broadened.length === 1 ? broadened[0].sense : null;
}

/**
 * Every orphaned sense tag in one stored sentence.
 *
 * A tag is orphaned when its segment HAS clusters (so the label is supposed to resolve)
 * but none carries the label. Segments with no clusters are not orphans — their label
 * never resolved and the read path never expected it to.
 *
 * Returns one entry per stale SOURCE:
 *   { seg, label, source: 'senseDict' }                 — the string-keyed dict
 *   { seg, label, source: 'occurrence', index }         — segmentOccurrenceTags[index]
 *
 * @param {object} sentence - one element of exampleSentences
 * @param {(seg: string) => {sense: string}[] | null | undefined} clustersOf
 */
export function findOrphanedSenseTags(sentence, clustersOf) {
  const out = [];
  if (!sentence || typeof sentence !== 'object') return out;
  const isOrphan = (seg, label) => {
    if (typeof label !== 'string') return false;
    const clusters = clustersOf(seg);
    return Array.isArray(clusters) && clusters.length > 0 && !clusters.some(c => c?.sense === label);
  };
  if (sentence.senseDict && typeof sentence.senseDict === 'object') {
    for (const [seg, label] of Object.entries(sentence.senseDict)) {
      if (isOrphan(seg, label)) out.push({ seg, label, source: 'senseDict' });
    }
  }
  const segments = Array.isArray(sentence.segments) ? sentence.segments : [];
  if (sentence.segmentOccurrenceTags && typeof sentence.segmentOccurrenceTags === 'object') {
    for (const [i, tag] of Object.entries(sentence.segmentOccurrenceTags)) {
      const seg = segments[Number(i)];
      if (seg && isOrphan(seg, tag?.sense)) out.push({ seg, label: tag.sense, source: 'occurrence', index: Number(i) });
    }
  }
  return out;
}

/**
 * Replace one stale label in a sentence, IN PLACE. Touches only sources that still hold
 * exactly `staleLabel` (a concurrent writer may have re-tagged it meanwhile).
 * `newLabel === null` deletes the sense — the read path then renders exactly as it did
 * for the orphan (default reading), but the tag stops counting as orphaned.
 *
 * Also keeps the generation-level `sentence.sense` (the HEADWORD's demonstrated sense) in
 * step when the stale segment is the headword itself — a re-cluster of the host word
 * orphans that field too.
 *
 * @returns {number} how many sources changed
 */
export function replaceSenseLabel(sentence, { seg, label: staleLabel, source, index }, newLabel, headword) {
  let changed = 0;
  if (source === 'senseDict') {
    if (sentence.senseDict?.[seg] === staleLabel) {
      if (newLabel === null) delete sentence.senseDict[seg];
      else sentence.senseDict[seg] = newLabel;
      changed++;
    }
  } else {
    const tag = sentence.segmentOccurrenceTags?.[String(index)];
    if (tag && tag.sense === staleLabel && sentence.segments?.[index] === seg) {
      if (newLabel === null) delete tag.sense;
      else tag.sense = newLabel;
      changed++;
    }
  }
  if (changed && seg === headword && sentence.sense === staleLabel && newLabel !== null) sentence.sense = newLabel;
  return changed;
}
