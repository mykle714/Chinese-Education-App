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
 * The scale measures how often a word comes up in everyday CONVERSATION — not how
 * casual/formal it sounds. It was a register scale until migration 122; see that
 * migration and docs/DEFINITION_MAPPING.md for the rationale.
 */
export const FREQUENCY_SCORE_LABELS = {
  1: 'Almost never spoken',
  2: 'Uncommon in speech',
  3: 'Moderately common',
  4: 'Common',
  5: 'Constant in daily speech',
};
