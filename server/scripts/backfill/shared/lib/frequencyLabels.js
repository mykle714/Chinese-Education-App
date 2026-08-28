/**
 * Human-readable band labels for the 1–5 `frequencyScore` scale.
 *
 * LAYER: shared constant for the data-enrichment (backfill) layer.
 *
 * Language-neutral on purpose — the RUBRIC (with its per-language example words)
 * is language-specific and lives with each scorer, but the band names are the same
 * scale in every language, so they live here instead of being duplicated:
 *   - scripts/backfill/chinese/lib/frequencyScore.js  (re-exported as SCORE_LABELS)
 *   - scripts/backfill/spanish/backfill-frequency-score.js
 * Both print these in their end-of-run distribution summary.
 *
 * The scale measures how much a word would STAND OUT if a friend said it in casual
 * conversation. The top two bands are separated by frequency (everyday vs. common
 * when the topic comes up); the bottom three by strangeness (unremarkable / odd but
 * forgivable / would stop the conversation).
 *
 * ⚠ These labels are not display strings only — the Spanish clusterer builds its
 * scoring rubric directly from this object (spanish/backfill-cluster-definitions.js),
 * so editing a label edits that prompt. Bump that script's SCRIPT_VERSION when you do.
 *
 * History: a register scale until migration 122, then a frequency-of-occurrence scale,
 * then re-pointed on 2026-08-28 at conversational commonality (bands 4+5 merged, the
 * old band 1 split into 1 and 2). See docs/DEFINITION_MAPPING.md.
 */
export const FREQUENCY_SCORE_LABELS = {
  1: 'Would stop the conversation',
  2: 'Odd but forgivable',
  3: 'Unremarkable',
  4: 'Common when topical',
  5: 'Everyday',
};
