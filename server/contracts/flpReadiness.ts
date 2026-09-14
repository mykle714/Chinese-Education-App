import type { FlpForeignTrack, MarkType, TypedMarkHistory } from './wire.js';
import { flpMarkTypes } from './wire.js';
import { computeCoreCategory } from './mastery.js';
import { cooldownRemainingMs } from './cooldown.js';

/**
 * flpReadiness — "how many of these cards could an flp session actually serve me
 * right now?", per utcm band.
 *
 * ── Why this is not `vocabSort`'s cooldown key ────────────────────────────────
 * Both measure rest, and they deliberately measure it DIFFERENTLY, because they answer
 * different questions:
 *
 *   • `vocabSort`'s `cooldownKey` orders the card grid. It takes the MAXIMUM remaining
 *     across a bar's tracks, windowed by each track's own PER-TYPE category — the
 *     track's own clock, which is what the cdp prints under each mastery bar.
 *   • This module predicts an flp POOL. The flp serves a card as soon as ONE of its two
 *     tracks has rested, so the card's remaining time is the MINIMUM across those
 *     tracks; and the flp widens every window to the card's CORE category, because one
 *     flp card shows two mark types at once.
 *
 * The second set of conventions is not a choice made here — it is `rankFlpEligible`'s
 * eligibility test (`server/services/OnDeckVocabService.ts`), restated so the figure on
 * the fdp's study hand cannot claim cards the flp would not deal.
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
  typedMarkHistory: TypedMarkHistory | undefined;
}

/**
 * Milliseconds until this card could next appear in an flp session; 0 when it is ready
 * now.
 *
 * MINIMUM across the session's two tracks, not maximum: the flp deals a card when
 * EITHER of its faces is markable, so the card is held back only until the sooner of
 * the two rests. `cooldownRemainingMs` already returns 0 for a track with no correct
 * mark, so a never-studied card reads ready — which it is.
 */
export function flpCooldownRemainingMs(
  typedMarkHistory: TypedMarkHistory | undefined,
  foreignTrack: FlpForeignTrack,
  now: number
): number {
  // The flp's window is the card's CORE category, not the per-type one — see the
  // module docblock. `flpWindowCategory` on the server makes the same choice.
  const windowCategory = computeCoreCategory(typedMarkHistory);

  let soonest = Infinity;
  for (const type of flpMarkTypes(foreignTrack) as readonly MarkType[]) {
    const remaining = cooldownRemainingMs(typedMarkHistory, type, now, windowCategory);
    if (remaining < soonest) soonest = remaining;
  }
  // `flpMarkTypes` always yields two tracks, so Infinity is unreachable; treating it
  // as ready keeps the permissive failure direction the cooldown contract chose (a
  // card that cannot be evaluated stays visible rather than vanishing from a pool).
  return Number.isFinite(soonest) ? soonest : 0;
}

/** Whether an flp session could deal this card right now. */
export function isFlpReady(
  typedMarkHistory: TypedMarkHistory | undefined,
  foreignTrack: FlpForeignTrack,
  now: number
): boolean {
  return flpCooldownRemainingMs(typedMarkHistory, foreignTrack, now) === 0;
}

/**
 * Ready-card counts keyed by CORE utcm band — the shape `categoryCounts` uses, so the
 * two are interchangeable at the call site and a caller can swap a band-total figure for
 * a ready figure without reshaping anything around it.
 *
 * Every band is present (0 rather than absent), so a caller may index it directly.
 */
export function flpReadyCountsByBand(
  entries: readonly FlpReadinessCard[],
  foreignTrack: FlpForeignTrack,
  now: number
): Record<string, number> {
  const counts: Record<string, number> = {
    Unfamiliar: 0,
    Target: 0,
    Comfortable: 0,
    Mastered: 0,
  };
  for (const entry of entries) {
    if (!isFlpReady(entry.typedMarkHistory, foreignTrack, now)) continue;
    const band = computeCoreCategory(entry.typedMarkHistory);
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
  foreignTrack: FlpForeignTrack,
  now: number
): number | null {
  let soonest = Infinity;
  for (const entry of entries) {
    if (!bands.includes(computeCoreCategory(entry.typedMarkHistory))) continue;
    const remaining = flpCooldownRemainingMs(entry.typedMarkHistory, foreignTrack, now);
    // 0 means this card is ready, so there is nothing to count down to.
    if (remaining > 0 && remaining < soonest) soonest = remaining;
  }
  return Number.isFinite(soonest) ? soonest : null;
}
