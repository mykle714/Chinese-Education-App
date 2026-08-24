import type { DefinitionCluster, LongDefinitionPart, VocabEntry } from '../types';
import { numberedToTonedPinyin, readingSyllableCount } from './textUtils';

/**
 * Strip all parenthetical substrings from a definition string for display.
 * Does not mutate the underlying database value.
 * e.g. "to go (informal); to leave (a place)" → "to go; to leave"
 * Nesting-aware: "a waiter (literally, one who runs (fast))" → "a waiter".
 */
export function stripParentheses(text: string): string {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    // A '(' at any depth opens/deepens an aside; a ')' closes one. Tracking depth
    // (rather than the old /\s*\([^)]*\)/g) is what makes NESTED asides work: the
    // regex stopped at the FIRST ')', so 的's gloss — which nests a parenthetical
    // inside a quoted example — leaked its tail onto the flashcard.
    // Eat any whitespace already emitted before the aside, reproducing the old
    // regex's leading `\s*` — without this, "to go (informal); to leave" would
    // render "to go ; to leave" and "[+de (particle)]" would render "[+de ]".
    if (ch === '(') { if (depth === 0) out = out.replace(/\s+$/, ''); depth++; continue; }
    // An unmatched ')' (depth already 0) is dropped rather than kept: a lone close
    // paren is never displayable text, and it is exactly what 加 used to render.
    if (ch === ')') { if (depth > 0) depth--; continue; }
    if (depth === 0) out += ch;
  }
  return out.trim();
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
 * The short grammatical tag for ONE sense — "v", "n · m", "adj" — or null when the
 * cluster carries neither pos nor gender.
 *
 * This is how a Spanish sense identifies itself in a list, now that a word's POS/gender
 * variants are clusters inside one entry rather than separate det rows (migration 123).
 * It replaces the old `PosBadge`, which could only say "this card is the (v) one" because
 * each POS *was* its own card; the tag instead labels each sense where the learner is
 * actually choosing between them (the flp sense picker).
 *
 * Chinese clusters carry a `pos` too, so this is not es-only — but zh senses are
 * distinguished by `reading` in the picker, so the tag is redundant there and callers
 * generally show it only when a cluster has no reading.
 */
export function senseGrammarTag(
  cluster: Pick<DefinitionCluster, 'pos' | 'gender'>,
): string | null {
  const parts = [
    cluster.pos?.filter(Boolean).join('/') || null,
    cluster.gender || null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The entry's DISPLAYABLE definition clusters sorted highest-frequency first (nulls last),
 * so index 0 is always the starred/default sense. Returns null when the entry has no real
 * choice to offer (unclustered, or fewer than two displayable clusters) — the caller then
 * falls back to the flat `definitions[0]` dd, exactly as before the clustering feature.
 *
 * A cluster whose lead gloss is ENTIRELY parenthetical — the grammatical-particle senses
 * 上来 "(verb complement indicating success)", 了 "(completed action marker)", 在 "(used
 * before a verb to indicate an action in progress)" — has an empty `ddt` and carries no
 * displayable English, so it is not a sense the learner can meaningfully pick. Such clusters
 * are dropped BEFORE the `< 2` gate, so they neither render as a blank picker row nor leave a
 * word like 上来 showing a one-item dropdown.
 *
 * The drop is scoped to the PICKER/dd path deliberately: label-addressed reads (a segment's
 * tagged sense, a breakdown char's gloss) still see every cluster and apply their own
 * empty-gloss fallback — see `resolveSenseGloss` in server/utils/definitions.ts.
 *
 * Single source of truth for the sense picker's ordering: EnglishBlock renders from this,
 * and the persistence layer resolves `selectedSense` labels against the SAME order. See
 * docs/DEFINITION_CLUSTERS.md.
 */
export function sortedSenseClusters(
  entry: Pick<VocabEntry, 'definitionClusters'>,
): DefinitionCluster[] | null {
  const clusters = entry.definitionClusters;
  if (!clusters) return null;
  const displayable = clusters.filter((c) => ddt(c) !== '');
  if (displayable.length < 2) return null;
  return displayable.sort((a, b) => (b.frequencyScore ?? -1) - (a.frequencyScore ?? -1));
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

/**
 * The inverse of `resolveSelectedSenseIndex`: the `selectedSense` LABEL to persist for a
 * pick at `index` in `sortedSenseClusters(entry)`.
 *
 * Index 0 is the default/starred sense and is stored as NULL, so a card the learner never
 * re-pointed keeps a clean NULL row (migration 99's semantics) and automatically follows
 * any future re-scoring of which sense is the most common one.
 *
 * Shared by every sense picker host — the flp card face (FlashCardSection), the cdp
 * (VocabCardDetailPage) and the eip header (FlashcardsLearnPage / SortCardsPage) — so the
 * index→label conversion can't drift between them. See docs/DEFINITION_CLUSTERS.md.
 */
export function senseLabelForIndex(
  entry: Pick<VocabEntry, 'definitionClusters'>,
  index: number,
): string | null {
  if (index === 0) return null;
  return sortedSenseClusters(entry)?.[index]?.sense ?? null;
}

/**
 * **The dd resolver — the single source of truth for an entry's display definition.**
 *
 * Every surface that shows "this word's English meaning" for a *saved* card must go
 * through this function, NOT `stripParentheses(entry.definition)`: `entry.definition`
 * is det's `definitions[0]`, which ignores the learner's per-card sense pick
 * (`vet.selectedSense`, migration 99) and can therefore show a completely different
 * meaning than the flashcard face does for the same word.
 *
 * Resolution order:
 *   1. clustered entry (≥2 `definitionClusters`) → `ddt` of the chosen cluster
 *      (the persisted `selectedSense` label → sorted index, or `senseIndexOverride`
 *      for a pick made this session that hasn't been persisted/refetched yet);
 *   2. unclustered / single-cluster entry, or a cluster with no usable gloss →
 *      the legacy dd, `stripParentheses(definitions[0])`.
 *
 * det-only entries (dictionary search rows, discover cards) carry no `selectedSense`,
 * so they resolve to the default/starred sense — identical to the pre-clustering dd.
 *
 * See docs/DEFINITION_MAPPING.md (form #3) and docs/DEFINITION_CLUSTERS.md.
 */
export function resolveDisplayDefinition(
  entry: Pick<VocabEntry, 'definition' | 'definitionClusters' | 'selectedSense'>,
  senseIndexOverride?: number,
): string {
  const legacyDd = stripParentheses(entry.definition ?? '');
  const sorted = sortedSenseClusters(entry);
  if (!sorted) return legacyDd;
  const index = senseIndexOverride ?? resolveSelectedSenseIndex(entry);
  // A cluster with an empty gloss list would render a blank card face, so fall back
  // to the flat dd rather than showing nothing.
  return ddt(sorted[index] ?? sorted[0]) || legacyDd;
}

/**
 * The cluster whose `reading` supplies the entry's DISPLAY pinyin. Split out of
 * `resolveDisplayPronunciation` because pinyin and dd resolve through DIFFERENT gates —
 * see the asymmetry note on `resolveDisplayPronunciation`.
 *
 * Two paths, in order:
 *   1. **The picker's list** (`sortedSenseClusters`, ≥2 displayable clusters). The reading
 *      must belong to the sense whose English is on screen, and `senseIndexOverride` is an
 *      index INTO this exact list — resolving against any other ordering would silently pair
 *      one sense's gloss with another sense's tones.
 *   2. **No picker** (unclustered, or fewer than two displayable clusters). There is no
 *      chosen sense to agree with — the dd side is showing the flat `definitions[0]` — so
 *      this returns the entry's PRIMARY reading: the highest-frequency cluster, preferring
 *      one that carries displayable English. That preference matters for the handful of
 *      entries holding a real sense plus a gloss-less grammatical-particle sense, where the
 *      particle cluster must not donate its reading to the real gloss's card.
 *      `senseIndexOverride` is deliberately ignored here: with no picker rendered, there is
 *      no index a caller could have meaningfully chosen.
 *
 * Mirrored by `readingCluster` in server/utils/definitions.ts — keep the two in step.
 */
function readingCluster(
  entry: Pick<VocabEntry, 'definitionClusters' | 'selectedSense'>,
  senseIndexOverride?: number,
): DefinitionCluster | null {
  const clusters = entry.definitionClusters;
  if (!Array.isArray(clusters) || clusters.length === 0) return null;

  const sorted = sortedSenseClusters(entry);
  if (sorted) {
    const index = senseIndexOverride ?? resolveSelectedSenseIndex(entry);
    return sorted[index] ?? sorted[0] ?? null;
  }

  const displayable = clusters.filter((c) => ddt(c) !== '');
  const pool = displayable.length > 0 ? displayable : clusters;
  return [...pool].sort((a, b) => (b.frequencyScore ?? -1) - (a.frequencyScore ?? -1))[0] ?? null;
}

/**
 * **The display-pinyin resolver — the pronunciation twin of `resolveDisplayDefinition`.**
 *
 * A heteronym's reading belongs to its SENSE, not to the word: 过去 is `guò qù` for "the
 * past" but `guò qu` for the directional suffix, 会 is `huì` for "can" and `kuài` for "to
 * reckon accounts". The entry-level `pronunciation` column can only carry one of those, so
 * any surface that shows a sense-resolved definition must resolve its pinyin the same way —
 * otherwise the card prints one sense's English over another sense's tones.
 *
 * Resolution: the sense pick comes from `readingCluster` (below), which agrees with
 * `resolveDisplayDefinition` on WHICH sense is showing whenever a sense picker exists, and
 * otherwise falls through to the entry's primary reading. The chosen cluster's `reading` is
 * converted from the stored numbered form to the tone-marked form the rest of the app
 * renders (`hui4 ji4` → `huì jì`). Falls back to the entry-level `pronunciation` column
 * whenever no cluster reading is available — an unclustered entry (the ~110k
 * non-discoverable det rows) or a Spanish cluster, whose `reading` is always null since es
 * senses are separated by pos/gender.
 *
 * **Why this does NOT share `resolveDisplayDefinition`'s `< 2` displayable-cluster gate.**
 * The two fields have different fallbacks. dd falls back to `definitions[0]`, a CURATED
 * artifact — a hand-ordered lead gloss that is often the better string, so bailing to it
 * when there is no sense to choose is a real editorial choice. Pinyin has no second
 * artifact: `pronunciation`/`numberedPinyin` is the same fact stored twice, and the column
 * is the UNREVIEWED copy. backfill-cluster-definitions.js seeds the model with the column
 * as "primary reading", instructs it to override for genuine heteronyms, and writes back
 * ONLY `definitionClusters` — so the column is upstream-of-review by construction and drifts
 * in one direction forever (重点 kept `chong2 dian3` in the column long after its clusters
 * were corrected to `zhong4 dian3`). Gating pinyin on `< 2` would pin the ~74% of
 * discoverable entries that are single-cluster to that unreviewed copy.
 *
 * Guard: a reading whose syllable count disagrees with the entry's own `pronunciation` is
 * rejected in favor of the column. cpcd zips syllables to characters positionally, so a
 * mis-shaped cluster reading (a clusterer bug, or a reading written for only part of the
 * word) would silently shift every character's pinyin one column over.
 *
 * See docs/DEFINITION_CLUSTERS.md.
 */
export function resolveDisplayPronunciation(
  entry: Pick<VocabEntry, 'pronunciation' | 'definitionClusters' | 'selectedSense'>,
  senseIndexOverride?: number,
): string | null {
  const columnPinyin = entry.pronunciation ?? null;
  const reading = readingCluster(entry, senseIndexOverride)?.reading;
  if (!reading) return columnPinyin;
  const toned = numberedToTonedPinyin(reading);
  if (!toned) return columnPinyin;
  if (columnPinyin && readingSyllableCount(toned) !== readingSyllableCount(columnPinyin)) {
    return columnPinyin;
  }
  return toned;
}

/**
 * **The commonality resolver — the sense-aware twin of `resolveDisplayDefinition`, for
 * the 1–5 conversation-frequency score the eip/cdp show as "Commonality".**
 *
 * A word-level `frequencyScore` is a lie for a polyseme: 干 "to do" comes up constantly
 * (5) while 干 "shield" is effectively never spoken (1). Each cluster is therefore scored
 * independently (docs/DEFINITION_CLUSTERS.md), and the meta-strip chip must show the score
 * of the sense the card is actually on — otherwise the number contradicts the definition
 * printed directly above it.
 *
 * Resolution order mirrors `resolveDisplayDefinition` exactly, so the two never disagree
 * about which sense is showing:
 *   1. clustered entry (≥2 displayable `definitionClusters`) whose chosen cluster carries a
 *      score → that cluster's `frequencyScore`, tagged with its `sense` label;
 *   2. otherwise → the entry-level `frequencyScore`, with a null label.
 *
 * `senseLabel` is what tells the caller which of the two it got: non-null means the number
 * is per-sense, which decides both the validation target (`senseFrequencyScore` +
 * `senseLabel`, migration 139) and which approval flag applies. See
 * docs/DATA_VALIDATION_SYSTEM.md.
 */
export function resolveCommonality(
  entry: Pick<VocabEntry, 'frequencyScore' | 'frequencyScoreApproved' | 'definitionClusters' | 'selectedSense' | 'approvedSenseFrequencyLabels'>,
  senseIndexOverride?: number,
): { score: number | null; senseLabel: string | null; approved: boolean } {
  const sorted = sortedSenseClusters(entry);
  if (sorted) {
    const index = senseIndexOverride ?? resolveSelectedSenseIndex(entry);
    const cluster = sorted[index] ?? sorted[0];
    // A cluster whose scoring pass failed (frequencyScore null) has nothing to show, so
    // fall through to the entry-level number rather than rendering an empty meter.
    if (cluster?.frequencyScore != null) {
      return {
        score: cluster.frequencyScore,
        senseLabel: cluster.sense,
        approved: !!entry.approvedSenseFrequencyLabels?.includes(cluster.sense),
      };
    }
  }
  return {
    score: entry.frequencyScore ?? null,
    senseLabel: null,
    approved: !!entry.frequencyScoreApproved,
  };
}

/**
 * **The long-definition resolver — the sense-aware twin of `resolveDisplayDefinition`.**
 *
 * `longDefinition` is stored one definition PER SENSE (zh, docs/DEFINITION_CLUSTERS.md)
 * and the eip/cdp show only the sense the card is on. The server ships every sense in
 * `longDefinitionSenses` (each with its own cpcd `parts`) precisely so this pick can
 * follow the sense picker, which is optimistic and triggers no refetch — resolving it
 * server-side alone would leave the panel on the previous sense's text.
 *
 * A sense used in more than one grammatical role stores one definition PER PART OF SPEECH
 * (坏 adjective = the state "it is broken", verb = the event "it breaks down"), so all of
 * the chosen sense's entries are shown, as `"<pos>: …"` blocks separated by a blank line —
 * the same shape the old per-POS join produced, so the renderer is unchanged. A sense with
 * one part of speech renders bare.
 *
 * Resolution order:
 *   1. the entries whose label matches the card's chosen cluster (`senseIndexOverride` for
 *      a pick made this session, else the persisted `selectedSense`, else the
 *      default/starred sense) — same pick `resolveDisplayDefinition` makes, so the
 *      extended definition always describes the gloss shown above it;
 *   2. the entries sharing `longDefinitionSenses[0]`'s label — the backfill writes
 *      default-sense-first;
 *   3. the flat `longDefinition` / `longDefinitionParts` (es, legacy per-POS rows, and
 *      any payload that doesn't carry the senses).
 *
 * See docs/DEFINITION_MAPPING.md (form #5).
 */
export function resolveLongDefinitionForSense(
  entry: Pick<VocabEntry, 'definitionClusters' | 'selectedSense' | 'longDefinition' | 'longDefinitionParts' | 'longDefinitionSenses'>,
  senseIndexOverride?: number,
): { longDefinition: string | null; longDefinitionParts: LongDefinitionPart[] | null } {
  const flat = {
    longDefinition: entry.longDefinition ?? null,
    longDefinitionParts: entry.longDefinitionParts ?? null,
  };
  const senses = entry.longDefinitionSenses;
  if (!senses?.length) return flat;

  const sorted = sortedSenseClusters(entry);
  const index = senseIndexOverride ?? resolveSelectedSenseIndex(entry);
  const label = sorted?.[index]?.sense ?? sorted?.[0]?.sense;
  // A label that matches no stored sense means the entry was re-clustered since the last
  // longDefinition run — fall back to the default sense rather than showing nothing.
  const matched = label ? senses.filter((s) => s.sense === label) : [];
  const chosen = matched.length > 0 ? matched : senses.filter((s) => s.sense === senses[0].sense);
  if (chosen.length === 0) return flat;

  if (chosen.length === 1) {
    return { longDefinition: chosen[0].definition, longDefinitionParts: chosen[0].parts ?? null };
  }

  // Multi-POS sense: label each block and separate with a blank line, in both the plain text
  // and the parts stream. The parts path must mirror the text exactly — the renderer picks
  // parts when present — so the labels/separators are spliced in as `text` parts around each
  // block's own parts (falling back to a bare text part when a block wasn't segmented).
  const longDefinition = chosen
    .map((s) => (s.pos ? `${s.pos}: ${s.definition}` : s.definition))
    .join('\n\n');
  const longDefinitionParts: LongDefinitionPart[] = [];
  chosen.forEach((s, i) => {
    if (i > 0) longDefinitionParts.push({ type: 'text', value: '\n\n' });
    if (s.pos) longDefinitionParts.push({ type: 'text', value: `${s.pos}: ` });
    longDefinitionParts.push(...(s.parts?.length ? s.parts : [{ type: 'text' as const, value: s.definition }]));
  });
  return { longDefinition, longDefinitionParts };
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

/**
 * True when an entry has anything for the Synonyms / Related Words section to show.
 *
 * Lives here rather than beside the component (SynonymsRelatedSection) because both
 * of that section's hosts gate on it BEFORE deciding whether to draw a container —
 * the cdp's `SectionCard` and the eip definition tab's ruled block would otherwise be
 * empty boxes. See docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md.
 */
export function hasSynonymsOrRelated(entry: { synonyms?: string[] | null; relatedWords?: unknown[] | null } | null | undefined): boolean {
  return (entry?.synonyms?.length ?? 0) > 0 || (entry?.relatedWords?.length ?? 0) > 0;
}
