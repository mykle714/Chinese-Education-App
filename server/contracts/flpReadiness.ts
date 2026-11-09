import type { TypedMarkHistory } from './wire.js';
import { barCategory } from './mastery.js';
import { barCooldownRemainingMs, barReadyAt } from './cooldown.js';
import type { FlpWorld } from './studyMode.js';

/**
 * flpReadiness — "how many of these cards could an flp session actually serve me
 * right now?", per utcm band.
 *
 * ── The know clock ────────────────────────────────────────────────────────────
 * Since the know merge (2026-09-25, docs/MASTERY_REWORK.md § 6) an flp card rests on
 * ONE clock — the core bar's, started by a correct recognition OR production mark and
 * windowed by the core band (`barCooldownRemainingMs(…, 'core', …)`). That is the same
 * number the cdp prints under the Know bar and the same test `rankFlpEligible`
 * (`server/services/OnDeckVocabService.ts`) applies, so the Deck Tower's Learning-deck
 * figure cannot claim cards the flp would not deal.
 *
 * ── Or the reading / writing clock ────────────────────────────────────────────
 * Every function takes the session's world (studyMode.ts), defaulting to core. The
 * READING flp (docs/READING_WRITING_CENTERS.md § Phase 4) bands and rests its cards on
 * the reading bar, so a caller asks with `world = 'reading'` and gets figures for
 * exactly the cards a reading session would deal. The WRITING flp does
 * the same on the writing bar — whose band and window come from the card's computed
 * `writingMastery` (the average over its characters, migration 170), so pass it.
 *
 * Isomorphic contract module (same rules as wire.ts): no relative VALUE imports besides
 * sibling contract modules, no enums, no Node or DOM globals; callers pass `now` rather
 * than the module reading a clock. Consumed directly by
 * `OnDeckVocabService.getFlpReadyCounts` (server) and re-exported by
 * `src/utils/flpReadiness.ts` (client) — one definition, so the tower figure and the flp's
 * own eligibility test cannot drift.
 *
 * ⚠️ Counts SORTED cards only. Every caller must feed it rows already filtered by
 * `vetSortedClause()` (docs/PROVISIONAL_CARDS.md) — so a figure never counts a card the
 * learner did not choose to keep.
 *
 * `nextFlpReadyMs` (the Review card's "next ready" countdown) was deleted 2026-11-04 with
 * the Review / Challenge study modes (docs/DEFERRED_WORK.md § 31).
 *
 * Referenced by docs/DECK_TOWER.md (the tower's ready counts, via `useFlpReadyCounts`;
 * `flpUpcomingReady` → § "Cooldown releases").
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
  world: FlpWorld = 'core',
  writingMastery?: number | null
): number {
  return barCooldownRemainingMs(typedMarkHistory, world, now, writingMastery);
}

/** Whether an flp session could deal this card right now. */
export function isFlpReady(
  typedMarkHistory: TypedMarkHistory | undefined,
  now: number,
  world: FlpWorld = 'core',
  writingMastery?: number | null
): boolean {
  return flpCooldownRemainingMs(typedMarkHistory, now, world, writingMastery) === 0;
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
  world: FlpWorld = 'core'
): Record<string, number> {
  const counts: Record<string, number> = {
    Unfamiliar: 0,
    Target: 0,
    Comfortable: 0,
    Mastered: 0,
  };
  for (const entry of entries) {
    if (!isFlpReady(entry.typedMarkHistory, now, world, entry.writingMastery)) continue;
    const band = barCategory(entry.typedMarkHistory, world, entry.writingMastery);
    counts[band] = (counts[band] ?? 0) + 1;
  }
  return counts;
}

/** How far ahead `flpUpcomingReady` looks: covers the Unfamiliar (5 min) and Target (12 h) rests. */
export const FLP_UPCOMING_HORIZON_MS = 24 * 60 * 60 * 1000;

/** One still-cooling card's release: when it comes off cooldown, and the band it lands in. */
export interface FlpUpcomingRelease {
  /** Epoch ms the card's clock releases it (`barReadyAt`). */
  readyAt: number;
  /** Its utcm band on the session bar. Bands move only on a mark, so this holds until then. */
  band: string;
}

/**
 * The cards that are cooling now and come off cooldown within `horizonMs`, soonest
 * first — the Deck Tower's release schedule (docs/DECK_TOWER.md § "Cooldown releases").
 * The client counts each one into `flpReadyCountsByBand`'s figures when its `readyAt`
 * passes, so the tower grows the moment a card is dealable, without a re-read.
 *
 * Sound because a card's release time and band are functions of its marks alone (the
 * window is its band's, `barReadyAt`), so the schedule stays true until the next mark;
 * every mark path re-reads the counts anyway.
 */
export function flpUpcomingReady(
  entries: readonly FlpReadinessCard[],
  now: number,
  world: FlpWorld = 'core',
  horizonMs: number = FLP_UPCOMING_HORIZON_MS
): FlpUpcomingRelease[] {
  const upcoming: FlpUpcomingRelease[] = [];
  for (const entry of entries) {
    const readyAt = barReadyAt(entry.typedMarkHistory, world, entry.writingMastery);
    if (readyAt === null || readyAt <= now || readyAt > now + horizonMs) continue;
    upcoming.push({ readyAt, band: barCategory(entry.typedMarkHistory, world, entry.writingMastery) });
  }
  return upcoming.sort((a, b) => a.readyAt - b.readyAt);
}
