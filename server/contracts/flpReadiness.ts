import type { TypedMarkHistory } from './wire.js';
import { barCategory } from './mastery.js';
import { barCooldownRemainingMs } from './cooldown.js';
import type { FlpBar } from './studyMode.js';

/**
 * flpReadiness — "how many of these cards could an flp session actually serve me
 * right now?", per utcm band.
 *
 * ── The know clock ────────────────────────────────────────────────────────────
 * Since the know merge (2026-09-25, docs/MASTERY_REWORK.md § 6) an flp card rests on
 * ONE clock — the core bar's, started by a correct recognition OR production mark and
 * windowed by the core band (`barCooldownRemainingMs(…, 'core', …)`). That is the same
 * number the cdp prints under the Know bar and the same test `rankFlpEligible`
 * (`server/services/OnDeckVocabService.ts`) applies, so the figure on the fdp's study
 * hand cannot claim cards the flp would not deal.
 *
 * ── Or the reading / writing clock ────────────────────────────────────────────
 * Every function takes the session's BAR (studyMode.ts), defaulting to core. The
 * READING flp (docs/READING_WRITING_CENTERS.md § Phase 4) bands and rests its cards on
 * the reading bar, so the Reading Center's study hand asks with `bar = 'reading'` and
 * gets figures for exactly the cards a reading session would deal. The WRITING flp does
 * the same on the writing bar — whose band and window come from the card's computed
 * `writingMastery` (the average over its characters, migration 170), so pass it.
 *
 * Isomorphic contract module (same rules as wire.ts): no relative VALUE imports besides
 * sibling contract modules, no enums, no Node or DOM globals; callers pass `now` rather
 * than the module reading a clock. Consumed directly by
 * `OnDeckVocabService.getFlpReadyCounts` (server) and re-exported by
 * `src/utils/flpReadiness.ts` (client) — one definition, so the fdp figure and the flp's
 * own eligibility test cannot drift.
 *
 * ⚠️ Counts SORTED cards only. Every caller must feed it rows already filtered by
 * `vetSortedClause()` (docs/PROVISIONAL_CARDS.md) — so a figure never counts a card the
 * learner did not choose to keep.
 *
 * Referenced by docs/DECKS_FEATURE.md § "The card hand".
 */

/** The minimal shape every function here needs from a card row. */
export interface FlpReadinessCard {
  // Optional, not `T | undefined`: the client passes `VocabEntry`, whose history is an
  // optional property. Every function below already reads a missing history as
  // never-studied (ready), so accepting an absent key changes no behaviour.
  typedMarkHistory?: TypedMarkHistory;
  /** Computed writing mastery (migration 170) — required for the WRITING bar's band/window. */
  writingMastery?: number | null;
}

/**
 * Milliseconds until this card could next appear in an flp session; 0 when it is ready
 * now. The know clock — see the module docblock. A never-studied card reads ready,
 * which it is.
 */
export function flpCooldownRemainingMs(
  typedMarkHistory: TypedMarkHistory | undefined,
  now: number,
  bar: FlpBar = 'core',
  writingMastery?: number | null
): number {
  return barCooldownRemainingMs(typedMarkHistory, bar, now, writingMastery);
}

/** Whether an flp session could deal this card right now. */
export function isFlpReady(
  typedMarkHistory: TypedMarkHistory | undefined,
  now: number,
  bar: FlpBar = 'core',
  writingMastery?: number | null
): boolean {
  return flpCooldownRemainingMs(typedMarkHistory, now, bar, writingMastery) === 0;
}

/**
 * Ready-card counts keyed by the session bar's utcm band (CORE unless `bar` says otherwise) — the shape `categoryCounts` uses, so the
 * two are interchangeable at the call site and a caller can swap a band-total figure for
 * a ready figure without reshaping anything around it.
 *
 * Every band is present (0 rather than absent), so a caller may index it directly.
 */
export function flpReadyCountsByBand(
  entries: readonly FlpReadinessCard[],
  now: number,
  bar: FlpBar = 'core'
): Record<string, number> {
  const counts: Record<string, number> = {
    Unfamiliar: 0,
    Target: 0,
    Comfortable: 0,
    Mastered: 0,
  };
  for (const entry of entries) {
    if (!isFlpReady(entry.typedMarkHistory, now, bar, entry.writingMastery)) continue;
    const band = barCategory(entry.typedMarkHistory, bar, entry.writingMastery);
    counts[band] = (counts[band] ?? 0) + 1;
  }
  return counts;
}

/**
 * Time until the SOONEST card in `bands` becomes flp-ready, or null when none is
 * resting — either because one is already ready, or because the learner owns none at
 * all. The caller distinguishes those two by looking at the ready count itself; null
 * means only "there is no countdown worth showing".
 *
 * Drives the Review card's "everything is resting" message, which needs a *when*, not
 * just a *no*.
 */
export function nextFlpReadyMs(
  entries: readonly FlpReadinessCard[],
  bands: readonly string[],
  now: number,
  bar: FlpBar = 'core'
): number | null {
  let soonest = Infinity;
  for (const entry of entries) {
    if (!bands.includes(barCategory(entry.typedMarkHistory, bar, entry.writingMastery))) continue;
    const remaining = flpCooldownRemainingMs(entry.typedMarkHistory, now, bar, entry.writingMastery);
    // 0 means this card is ready, so there is nothing to count down to.
    if (remaining > 0 && remaining < soonest) soonest = remaining;
  }
  return Number.isFinite(soonest) ? soonest : null;
}
