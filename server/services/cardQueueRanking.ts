import type { MasteryBarId, TypedMarkHistory } from '../contracts/wire.js';
import { barCooldownRemainingMs, barReadyAt } from '../contracts/cooldown.js';

/**
 * Card queue ranking — "which of these rested cards has been waiting longest?"
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
 * Behaviour is otherwise identical for every caller, which is the point.
 */

/** The minimum a card must carry to be ranked. Callers pass their own richer rows. */
export interface RankableCard {
  typedMarkHistory?: TypedMarkHistory;
  /** Computed writing mastery (migration 170); sets the WRITING bar's window. */
  writingMastery?: number | null;
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
 * The card's ARRIVAL TIME in the queue: the moment its clock last released it, as
 * epoch ms (`lastCorrectOnBar + window`). Cards are served longest-waiting first, so
 * this is the sort key.
 *
 * -Infinity when the bar holds no correct mark at all — this module's definition of
 * "never marked". For the know clock that means neither recognition nor production
 * has ever been answered correctly; a card right on just ONE track has history and
 * queues by it.
 */
export function queueArrivalAt(
  typedMarkHistory: TypedMarkHistory | undefined,
  bar: MasteryBarId,
  writingMastery?: number | null
): number {
  return barReadyAt(typedMarkHistory, bar, writingMastery) ?? -Infinity;
}

/** One ranked card, with the moment it became ready. */
export interface RankedCard<T> {
  card: T;
  readyAt: number;
}

/**
 * The rested subset of `cards` (the bar's clock has run out), ordered AS A QUEUE:
 * longest-waiting first.
 *
 * TWO TIERS, and the second is the reason this can't be a plain ascending sort:
 *
 *   1. cards with review history, by arrival time ASC — the card that came off
 *      cooldown earliest is served first;
 *   2. never-marked cards (no correct mark on the bar) — always LAST, however long
 *      they have technically been "available".
 *
 * A never-marked card scores -Infinity, which an ascending sort would put at the
 * FRONT, so the tier is compared before the timestamp. Brand-new sorts and lent
 * provisional cards are therefore reached only once genuinely rested cards run out.
 *
 * Ties (notably the whole never-marked tail) keep the caller's incoming order —
 * `Array.prototype.sort` is stable — so the caller's own SQL ORDER BY is the final
 * tiebreak.
 */
export function rankCardQueue<T extends RankableCard>(
  cards: T[],
  now: number,
  options: {
    /** The bar whose clock gates this queue. */
    bar: MasteryBarId;
  }
): RankedCard<T>[] {
  const scored: RankedCard<T>[] = [];

  for (const card of cards) {
    if (barCooldownRemainingMs(card.typedMarkHistory, options.bar, now, card.writingMastery) > 0) continue;
    scored.push({ card, readyAt: queueArrivalAt(card.typedMarkHistory, options.bar, card.writingMastery) });
  }

  scored.sort((a, b) => {
    // Tier first: never-marked cards sink below every card with history.
    const aNever = a.readyAt === -Infinity;
    const bNever = b.readyAt === -Infinity;
    if (aNever !== bNever) return aNever ? 1 : -1;
    // Within a tier, oldest arrival first. Equal (including the whole never-marked
    // tail at -Infinity) returns 0 to keep the stable incoming order — subtracting
    // would yield NaN for -Infinity - -Infinity and leave the sort undefined.
    return a.readyAt === b.readyAt ? 0 : a.readyAt - b.readyAt;
  });

  return scored;
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
    bar: MasteryBarId;
  }
): T[] {
  const scored: Array<{ card: T; remainingMs: number }> = [];

  for (const card of cards) {
    const remainingMs = barCooldownRemainingMs(card.typedMarkHistory, options.bar, now, card.writingMastery);
    if (remainingMs === 0) continue; // rested — rankCardQueue's business, not ours
    scored.push({ card, remainingMs });
  }

  // Stable sort, so cards with equal remaining time keep the caller's SQL ordering.
  scored.sort((a, b) => a.remainingMs - b.remainingMs);
  return scored.map(({ card }) => card);
}
