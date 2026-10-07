/**
 * cooldown.ts — the review cooldown, shared by server and client.
 *
 * This used to live entirely in `server/services/cardQueueRanking.ts`, which is a
 * server module the client may not import (docs/FRONTEND_LAYERING.md). The cdp
 * DISPLAYS the remaining cooldown under each mastery bar, so the table and the
 * "is this card resting?" predicate had to become a contract — exactly the move
 * `contracts/mastery.ts` made for the pbh formula. `cardQueueRanking` re-exports
 * these, so every server import has one definition to reach.
 *
 * ── ONE CLOCK PER BAR (the "know" merge, 2026-09-25) ─────────────────────────
 * The cooldown clock used to run per MARK TYPE, so recognition and production rested
 * independently. They now share ONE clock — the **know** clock, i.e. the core bar's —
 * started by the newest correct mark on EITHER track. Reading and writing are
 * single-track bars, so their clocks are unchanged. The window DURATION is the bar's
 * own utcm band (`barCategory`): core band for know, the track's band for
 * reading/writing. See docs/MASTERY_REWORK.md § 6.
 *
 * Every caller asks the question per BAR (or per mark type, which resolves to its bar
 * through `barForMarkType`); there is deliberately no per-track entry point left, so no
 * surface can accidentally time recognition on its own clock again.
 *
 * Contract rules (same as wire.ts): no enums, no Node or DOM globals, and no relative
 * VALUE imports besides sibling contract modules (as `flpReadiness.ts` already does);
 * callers pass `now` rather than the module reading a clock.
 *
 * Referenced by docs/MASTERY_REWORK.md § 6 and § 7.
 */
import type { MarkType, MasteryBarId, TypedMarkHistory } from './wire.js';
import { BAR_MARK_TYPES, barCategory, barForMarkType } from './mastery.js';

/**
 * Per-category cooldown after a correct mark: a card marked correct recently should
 * not come back until its window elapses. Shorter windows for weaker categories, so a
 * struggling card gets more repetition.
 */
export const COOLDOWN_MS_BY_CATEGORY: Record<string, number> = {
  Unfamiliar: 5 * 60 * 1000,             // 5 minutes
  Target: 12 * 60 * 60 * 1000,           // 12 hours
  Comfortable: 14 * 24 * 60 * 60 * 1000, // 14 days
  Mastered: 180 * 24 * 60 * 60 * 1000,   // 6 months (180 days)
};

/**
 * Newest correct-mark timestamp within ONE track, or null when that track holds no
 * valid correct mark. A building block for `lastCorrectOnBar` — a track on its own no
 * longer has a clock.
 */
export function lastCorrectMarkTimestamp(
  typedMarkHistory: TypedMarkHistory | undefined,
  type: MarkType
): number | null {
  const track = typedMarkHistory?.[type];
  if (!Array.isArray(track)) return null;

  let latest: number | null = null;
  for (const mark of track) {
    if (!mark?.isCorrect || !mark.timestamp) continue;
    // A character mark fanned out from a word's writing result never restarts the
    // character's own clock (migration 170, docs/WRITING_PRACTICE_REWORK.md § 3a).
    if (mark.viaWord) continue;
    const ts = new Date(mark.timestamp).getTime();
    if (Number.isNaN(ts)) continue;
    if (latest === null || ts > latest) latest = ts;
  }
  return latest;
}

/**
 * Newest correct mark across EVERY track of `bar` — the moment that bar's clock last
 * started. For core this is the newer of recognition/production, which is the whole
 * of the know merge: a correct mark on either track rests both.
 */
export function lastCorrectOnBar(
  typedMarkHistory: TypedMarkHistory | undefined,
  bar: MasteryBarId
): number | null {
  let latest: number | null = null;
  for (const type of BAR_MARK_TYPES[bar]) {
    const ts = lastCorrectMarkTimestamp(typedMarkHistory, type);
    if (ts !== null && (latest === null || ts > latest)) latest = ts;
  }
  return latest;
}

/**
 * The instant `bar`'s clock releases the card (epoch ms), or null when the bar holds
 * no correct mark and so has never been rested. Window = the bar's own band.
 *
 * Exposed separately from the remaining-ms form because the queue ranking sorts on
 * WHEN a card became ready, not on how long is left (which is 0 for every ready card).
 */
export function barReadyAt(
  typedMarkHistory: TypedMarkHistory | undefined,
  bar: MasteryBarId,
  /**
   * The card's computed writing mastery (`VocabEntryBase.writingMastery`). A
   * multi-character word's writing CLOCK is its own (clock-only) track, but its window
   * is the band of its AVERAGED mastery — so pass it for any writing question.
   */
  writingMastery?: number | null
): number | null {
  const lastCorrect = lastCorrectOnBar(typedMarkHistory, bar);
  if (lastCorrect === null) return null;
  const window = COOLDOWN_MS_BY_CATEGORY[barCategory(typedMarkHistory, bar, writingMastery)] ?? 0;
  return lastCorrect + window;
}

/** Milliseconds left on `bar`'s clock; 0 when it is ready (or has never been marked). */
export function barCooldownRemainingMs(
  typedMarkHistory: TypedMarkHistory | undefined,
  bar: MasteryBarId,
  now: number,
  writingMastery?: number | null
): number {
  const readyAt = barReadyAt(typedMarkHistory, bar, writingMastery);
  return readyAt === null ? 0 : Math.max(0, readyAt - now);
}

/** Whether `bar`'s clock is still running. */
export function isBarOnCooldown(
  typedMarkHistory: TypedMarkHistory | undefined,
  bar: MasteryBarId,
  now: number,
  writingMastery?: number | null
): boolean {
  return barCooldownRemainingMs(typedMarkHistory, bar, now, writingMastery) > 0;
}

/**
 * Whether a mark of `type` would land on a still-cooling clock — the mark-time gate's
 * question. A recognition mark and a production mark ask the SAME clock (know).
 */
export function isMarkOnCooldown(
  typedMarkHistory: TypedMarkHistory | undefined,
  type: MarkType,
  now: number,
  writingMastery?: number | null
): boolean {
  return isBarOnCooldown(typedMarkHistory, barForMarkType(type), now, writingMastery);
}
