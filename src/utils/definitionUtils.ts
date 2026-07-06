import type { DefinitionCluster, VocabEntry } from '../types';

/**
 * Strip all parenthetical substrings from a definition string for display.
 * Does not mutate the underlying database value.
 * e.g. "to go (informal); to leave (a place)" → "to go; to leave"
 */
export function stripParentheses(text: string): string {
  return text.replace(/\s*\([^)]*\)/g, '').trim();
}

/**
 * Display Definition Transformation (ddt) — the per-cluster analog of dd
 * (`definitions[0]`, stripped of parentheticals). A cluster's `glosses` are
 * already ordered prototypical→vernacular within the sense (backfill Stage B),
 * so the lead gloss is the cluster's own "definitions[0]". Used by the flp
 * sense-picker dropdown (EnglishBlock) to render each `DefinitionCluster` as a
 * single display string. See docs/DEFINITION_CLUSTERS.md.
 */
export function ddt(cluster: { glosses: string[] }): string {
  return stripParentheses(cluster.glosses[0] ?? '');
}

/**
 * The entry's definition clusters sorted highest-vernacular-register first (nulls last),
 * so index 0 is always the starred/default sense. Returns null when the entry has no real
 * choice to offer (unclustered or a single cluster) — the caller then falls back to the flat
 * `definitions[0]` dd, exactly as before the clustering feature.
 *
 * Single source of truth for the sense picker's ordering: EnglishBlock renders from this,
 * and the persistence layer resolves `selectedSense` labels against the SAME order. See
 * docs/DEFINITION_CLUSTERS.md.
 */
export function sortedSenseClusters(
  entry: Pick<VocabEntry, 'definitionClusters'>,
): DefinitionCluster[] | null {
  const clusters = entry.definitionClusters;
  if (!clusters || clusters.length < 2) return null;
  return [...clusters].sort((a, b) => (b.vernacularScore ?? -1) - (a.vernacularScore ?? -1));
}

/**
 * Resolve an entry's persisted `selectedSense` (a cluster `sense` LABEL, migration 99) to an
 * index into `sortedSenseClusters`. A label is stored instead of an index because it's stable
 * across re-clustering/re-scoring; if the label no longer matches any cluster (the entry was
 * re-clustered), or there's no persisted choice, this falls back to the default/starred sense
 * (index 0). det-fallback entries (dictionary cdp) carry no `selectedSense`, so they always
 * resolve to 0 here. See docs/DEFINITION_CLUSTERS.md.
 */
export function resolveSelectedSenseIndex(
  entry: Pick<VocabEntry, 'definitionClusters' | 'selectedSense'>,
): number {
  const sorted = sortedSenseClusters(entry);
  if (!sorted) return 0;
  const label = entry.selectedSense;
  if (!label) return 0;
  const idx = sorted.findIndex((c) => c.sense === label);
  return idx >= 0 ? idx : 0;
}

// Ordered leading-phrase strips applied (after stripParentheses) to turn a card's
// English definition into an icons8 *search* term. Verb infinitives / copulas search
// far better without their leading particle: "to understand" -> "understand",
// "to be hungry" -> "hungry". Add new strip rules to this list so every caller stays
// in sync — DO NOT inline a strip regex at a call site.
const ICON_SEARCH_LEADING_STRIPS: RegExp[] = [
  /^to\s+be\s+/i,   // copular infinitive ("to be hungry")
  /^to\s+/i,        // plain infinitive ("to understand")
];

/**
 * Build the default icons8 search term for an entry from its English definition.
 *
 * The input is the entry's display definition (det `definitions[0]`); we apply the
 * same `stripParentheses` the card's EnglishBlock uses so the search matches what the
 * learner actually sees, then the leading-phrase strips above. Returns "" for a
 * missing/empty definition.
 *
 * Single source of truth for the picker pre-fill AND the prefetch/cache warm
 * (docs/CARD_ICON_LAYOUT.md). Pure string transform — no DB, no locale dependence.
 */
export function iconSearchTerm(definition: string | null | undefined): string {
  let term = stripParentheses(definition ?? '');
  for (const re of ICON_SEARCH_LEADING_STRIPS) term = term.replace(re, '');
  return term.trim();
}
