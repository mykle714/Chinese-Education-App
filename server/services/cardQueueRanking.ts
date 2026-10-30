import type { MasteryWorldId, TypedMarkHistory } from '../contracts/wire.js';
import { barCooldownRemainingMs, barReadyAt } from '../contracts/cooldown.js';
import { WORLD_MARK_TYPES } from '../contracts/mastery.js';

/**
 * Card queue ranking — "which of these rested cards should come next?"
 *
 * LAYER: pure module. No database, no clock of its own (callers pass `now`), no
 * service state. Every function is a function of its arguments.
 *
 * ── WHY THIS EXISTS SEPARATELY ───────────────────────────────────────────────
 * This was five private methods on OnDeckVocabService, where it served the flp alone.
 * Memory Map needs the SAME queue discipline on a DIFFERENT clock: the flp ranks on
 * the know (core) clock, while Memory Map is a reading drill ranked on the reading
 * clock. Copying the logic would have left two implementations of "longest-waiting
 * first, never-marked last" to drift apart. See docs/MEMORY_MAP_GAME.md § 13.1.
 *
 * The one axis a caller chooses is the BAR whose clock gates the queue — flp: `core`
 * (the know clock, shared by recognition and production since 2026-09-25); Memory
 * Map: `reading`. Clock and window both come from `contracts/cooldown.ts`, so a
 * caller can no longer pick a window that disagrees with the one the mark-time gate
 * enforces. See docs/MASTERY_REWORK.md § 6.
 *
 * Behaviour is otherwise identical for every caller, which is the point — the flp
 * (deal + refill), focus mode's daily set and Memory Map all share the two-tier queue
 * below (recent: longest-waiting first; stale: easiest first).
 */

/** The minimum a card must carry to be ranked. Callers pass their own richer rows. */
export interface RankableCard {
  typedMarkHistory?: TypedMarkHistory;
  /** Computed writing mastery (migration 170); sets the WRITING bar's window. */
  writingMastery?: number | null;
  /**
   * det `difficulty` band, 1 (easiest) .. 6 — the stale tier's ease key on the core
   * and reading bars. Absent/NULL sorts after every known band.
   */
  difficulty?: number | null;
  /**
   * det `maxCharStrokeCount` (migration 179; zh only) — the stale tier's ease key on
   * the WRITING bar, where "easy" means few strokes. Absent/NULL sorts last.
   */
  maxCharStrokeCount?: number | null;
  /** `'provisional'` marks a LENT card; the stale tier serves own cards first. */
  starterPackBucket?: string | null;
}

/**
 * The cooldown table and its predicates live in `../contracts/cooldown.js` — the cdp
 * displays the remaining cooldown under each mastery bar, and the client may not
 * import a server service. Re-exported here so server callers have one import site.
 */
export {
  COOLDOWN_MS_BY_CATEGORY,
  lastCorrectMarkTimestamp,
  lastCorrectOnBar,
  barReadyAt,
  barCooldownRemainingMs,
  isBarOnCooldown,
  isMarkOnCooldown,
} from '../contracts/cooldown.js';

/**
 * How far back a mark keeps a card in the queue's RECENT tier: 30 days. A card whose
 * newest mark on the bar (right or wrong) is older than this — or that has none —
 * falls to the STALE tier, which is ordered easiest first rather than by arrival.
 * Decided 2026-10-28; see rankCardQueue.
 */
export const RECENT_MARK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Newest mark of ANY outcome (right or wrong) across every track of `bar`, as epoch
 * ms, or null when the bar holds none. This is the RECENT-tier test, deliberately
 * wider than `lastCorrectOnBar` (the clock): a card the learner got wrong last week
 * is being worked on, even though it never started a cooldown.
 *
 * `viaWord` marks are skipped for the same reason `lastCorrectMarkTimestamp` skips
 * them: a character mark fanned out from a word's writing result is not an attempt
 * at the character card itself (migration 170).
 */
export function lastMarkOnBar(
  typedMarkHistory: TypedMarkHistory | undefined,
  world: MasteryWorldId
): number | null {
  let latest: number | null = null;
  for (const type of WORLD_MARK_TYPES[world]) {
    const track = typedMarkHistory?.[type];
    if (!Array.isArray(track)) continue;
    for (const mark of track) {
      if (!mark?.timestamp || mark.viaWord) continue;
      const ts = new Date(mark.timestamp).getTime();
      if (Number.isNaN(ts)) continue;
      if (latest === null || ts > latest) latest = ts;
    }
  }
  return latest;
}

/**
 * The card's ARRIVAL TIME in the queue: the moment it became available again, as
 * epoch ms. Cards in the recent tier are served longest-waiting first, so this is
 * their sort key.
 *
 *   - a correct mark on the bar → the moment its clock released it
 *     (`lastCorrectOnBar + window`, i.e. `barReadyAt`);
 *   - only WRONG marks → the newest of those: a card with no correct mark has no
 *     cooldown, so it was back in the queue the moment it was last answered;
 *   - no mark at all → -Infinity ("never marked"). Such a card is always in the
 *     stale tier, which does not read this value.
 *
 * For the know clock "a correct mark" means on EITHER track; a card right on just
 * one of recognition/production queues by that mark.
 */
export function queueArrivalAt(
  typedMarkHistory: TypedMarkHistory | undefined,
  world: MasteryWorldId,
  writingMastery?: number | null
): number {
  return barReadyAt(typedMarkHistory, world, writingMastery)
    ?? lastMarkOnBar(typedMarkHistory, world)
    ?? -Infinity;
}

/** One ranked card, with the moment it became ready. */
export interface RankedCard<T> {
  card: T;
  readyAt: number;
}

/** Ascending comparison where null/undefined sorts after every number. */
function compareNullsLast(a: number | null | undefined, b: number | null | undefined): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  return a - b;
}

/**
 * The stale tier's ease key for one card on `world`: stroke count of the hardest
 * character for the WRITING bar (how hard it is to write), the det difficulty band
 * for core and reading.
 */
function easeKey(card: RankableCard, world: MasteryWorldId): number | null | undefined {
  return world === 'writing' ? card.maxCharStrokeCount : card.difficulty;
}

/**
 * The rested subset of `cards` (the bar's clock has run out), ordered AS A QUEUE in
 * TWO TIERS:
 *
 *   1. RECENT — the card carries a mark on the bar (right or wrong) within the last
 *      RECENT_MARK_WINDOW_MS (30 days). Ordered by arrival time ASC
 *      (`queueArrivalAt`): the card waiting longest is served first. These are the
 *      words the learner is actively working, so the cooldown queue still governs.
 *   2. STALE — no mark on the bar in that window, including never-marked cards. Ordered
 *      the learner's OWN cards before LENT ones (`starterPackBucket = 'provisional'`),
 *      then EASIEST FIRST: `maxCharStrokeCount` on the writing bar, `difficulty` on
 *      core/reading, unknown values last. Arrival order means little here — for a
 *      Mastered card (180-day window) every rested card is stale — so re-entry starts
 *      with the words most likely to come back.
 *
 * Own-before-lent used to be the caller's SQL ORDER BY; it is explicit now because the
 * ease sort would otherwise let a lent HSK 1 word beat the learner's own HSK 3 word.
 *
 * Ties keep the caller's incoming order — `Array.prototype.sort` is stable — so the
 * caller's own SQL ORDER BY (newest first) is the final tiebreak.
 */
export function rankCardQueue<T extends RankableCard>(
  cards: T[],
  now: number,
  options: {
    /** The bar whose clock gates this queue. */
    world: MasteryWorldId;
  }
): RankedCard<T>[] {
  const { world } = options;
  const recent: RankedCard<T>[] = [];
  const stale: RankedCard<T>[] = [];
  const recentSince = now - RECENT_MARK_WINDOW_MS;

  for (const card of cards) {
    if (barCooldownRemainingMs(card.typedMarkHistory, world, now, card.writingMastery) > 0) continue;
    const ranked = { card, readyAt: queueArrivalAt(card.typedMarkHistory, world, card.writingMastery) };
    const lastMark = lastMarkOnBar(card.typedMarkHistory, world);
    (lastMark !== null && lastMark >= recentSince ? recent : stale).push(ranked);
  }

  // A recent card always has a mark, so readyAt is finite and subtraction is safe.
  recent.sort((a, b) => a.readyAt - b.readyAt);

  stale.sort((a, b) => {
    const aLent = a.card.starterPackBucket === 'provisional';
    const bLent = b.card.starterPackBucket === 'provisional';
    if (aLent !== bLent) return aLent ? 1 : -1;
    return compareNullsLast(easeKey(a.card, world), easeKey(b.card, world));
  });

  return [...recent, ...stale];
}

/**
 * The COOLED complement of `rankCardQueue`: the cards whose clock is still running,
 * ordered nearest-to-ready first.
 *
 * ── WHY A SURFACE EVER WANTS THIS ────────────────────────────────────────────
 * Lending is a last resort, not a substitute for the learner's own deck
 * (docs/PROVISIONAL_CARDS.md § 4b). When a round cannot be filled from rested cards
 * it re-serves RESTING ones before it mints anything: a card the learner chose,
 * shown again early, beats a word they have never seen. The cost is that a mark
 * fired at a still-cooling card is dropped by the guard at `POST /api/flashcards/mark`
 * — the round plays, but those cards earn nothing. That is the accepted trade, and it
 * is the same one the game pools' `cooled` tier has always made.
 *
 * ORDERING. Least remaining cooldown first — the card closest to genuinely being due.
 *
 * Never-marked cards cannot appear here — with no correct mark the clock reads 0, so
 * the card is rested and belongs to `rankCardQueue` instead.
 */
export function rankCardQueueCooled<T extends RankableCard>(
  cards: T[],
  now: number,
  options: {
    world: MasteryWorldId;
  }
): T[] {
  const scored: Array<{ card: T; remainingMs: number }> = [];

  for (const card of cards) {
    const remainingMs = barCooldownRemainingMs(card.typedMarkHistory, options.world, now, card.writingMastery);
    if (remainingMs === 0) continue; // rested — rankCardQueue's business, not ours
    scored.push({ card, remainingMs });
  }

  // Stable sort, so cards with equal remaining time keep the caller's SQL ordering.
  scored.sort((a, b) => a.remainingMs - b.remainingMs);
  return scored.map(({ card }) => card);
}
