import type { MarkType, TypedMarkHistory } from '../contracts/wire.js';
import {
  COOLDOWN_MS_BY_CATEGORY,
  cooldownRemainingMs,
  lastCorrectMarkTimestamp,
  readyMarkTypes,
} from '../contracts/cooldown.js';

/**
 * Card queue ranking — "which of these rested cards has been waiting longest?"
 *
 * LAYER: pure module. No database, no clock of its own (callers pass `now`), no
 * service state. Every function is a function of its arguments.
 *
 * ── WHY THIS EXISTS SEPARATELY ───────────────────────────────────────────────
 * This was five private methods on OnDeckVocabService, where it served the flp alone.
 * Memory Map needs the SAME queue discipline on a DIFFERENT track: the flp ranks by
 * readiness on recognition+production and bands by the core utcm category, while
 * Memory Map is a reading drill whose membership rule is the reading track. Copying
 * the logic would have left two implementations of "longest-waiting first, never-marked
 * last" to drift apart — and the second copy would have been the one nobody remembered
 * to fix. See docs/MEMORY_MAP_GAME.md § 13.1.
 *
 * The two axes a caller chooses are:
 *   • `markTypes`     — which tracks count as "ready". flp: recognition + production.
 *                       Memory Map: reading alone.
 *   • window category — which cooldown DURATION applies. flp: the card's core
 *                       (whole-card) category, because the loop shows two mark types
 *                       on one card. Games: the per-type category of the single track
 *                       they exercise. See docs/MASTERY_REWORK.md § Per-type cooldown.
 *
 * Behaviour is otherwise identical for every caller, which is the point.
 */

/** The minimum a card must carry to be ranked. Callers pass their own richer rows. */
export interface RankableCard {
  typedMarkHistory?: TypedMarkHistory;
}

/**
 * The cooldown table and its per-type predicates now live in
 * `../contracts/cooldown.js` — the cdp displays the remaining cooldown under each
 * mastery bar, and the client may not import a server service. Re-exported here so
 * every existing `from './cardQueueRanking.js'` import keeps working.
 */
export {
  COOLDOWN_MS_BY_CATEGORY,
  lastCorrectMarkTimestamp,
  cooldownRemainingMs,
  isTypeOnCooldown,
  readyMarkTypes,
} from '../contracts/cooldown.js';

/**
 * The card's ARRIVAL TIME in the queue: the moment it FIRST became reviewable, as
 * epoch ms. Cards are served longest-waiting first, so this is the sort key.
 *
 * Per ready type the card came off cooldown at `lastCorrect + window`; we take the
 * MIN across the ready types, because a card has been waiting since the EARLIEST of
 * them. MIN rather than MAX is what makes this a queue: a card whose recognition track
 * has been ready for ten days is ten days overdue, even if its production track only
 * rested yesterday.
 *
 * Tracks with no correct mark are SKIPPED rather than counted as ready-since-forever.
 * Counting them would score -Infinity for any partially-marked card and drag it into
 * the never-marked tail, which is wrong — the learner HAS gotten that card right, just
 * in one track. -Infinity is returned only when NO ready track carries a correct mark,
 * and that is exactly this module's definition of "never marked".
 */
export function queueArrivalAt(
  typedMarkHistory: TypedMarkHistory | undefined,
  readyTypes: readonly MarkType[],
  windowCategory: string | null | undefined
): number {
  const window = COOLDOWN_MS_BY_CATEGORY[windowCategory ?? ''] ?? 0;
  let readyAt = Infinity;
  for (const type of readyTypes) {
    const lastCorrect = lastCorrectMarkTimestamp(typedMarkHistory, type);
    if (lastCorrect === null) continue; // no correct mark in this track — see above
    readyAt = Math.min(readyAt, lastCorrect + window);
  }
  return readyAt === Infinity ? -Infinity : readyAt;
}

/** One ranked card, with the tracks that made it eligible. */
export interface RankedCard<T> {
  card: T;
  readyTypes: MarkType[];
  readyAt: number;
}

/**
 * The rested subset of `cards` (≥1 of `markTypes` off cooldown), ordered AS A QUEUE:
 * longest-waiting first.
 *
 * TWO TIERS, and the second is the reason this can't be a plain ascending sort:
 *
 *   1. cards with review history, by arrival time ASC — the card that came off
 *      cooldown earliest is served first;
 *   2. never-marked cards (no correct mark in any ready track) — always LAST, however
 *      long they have technically been "available".
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
    /** Tracks that count as "ready" for this surface. */
    markTypes: readonly MarkType[];
    /** The utcm category whose cooldown window applies, per card. */
    windowCategoryOf: (card: T) => string | null | undefined;
  }
): RankedCard<T>[] {
  const scored: RankedCard<T>[] = [];

  for (const card of cards) {
    const windowCategory = options.windowCategoryOf(card);
    const ready = readyMarkTypes(card.typedMarkHistory, now, options.markTypes, windowCategory);
    if (ready.length === 0) continue;
    scored.push({
      card,
      readyTypes: ready,
      readyAt: queueArrivalAt(card.typedMarkHistory, ready, windowCategory),
    });
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
 * The COOLED complement of `rankCardQueue`: the cards with NO ready track, ordered
 * nearest-to-ready first.
 *
 * ── WHY A SURFACE EVER WANTS THIS ────────────────────────────────────────────
 * Lending is a last resort, not a substitute for the learner's own deck
 * (docs/PROVISIONAL_CARDS.md § 4b). When a round cannot be filled from rested cards
 * it re-serves RESTING ones before it mints anything: a card the learner chose,
 * shown again early, beats a word they have never seen. The cost is that a mark
 * fired at a still-cooling card is dropped by the guard at `POST /api/flashcards/mark`
 * — the round plays, but those cards earn nothing. That is the accepted trade, and it
 * is the same one the game pools' `cooled` tier has always made; this function exists
 * so the flp can make it too (it previously had no cooled tier at all and simply
 * returned short).
 *
 * ORDERING. Least remaining cooldown first — the card closest to genuinely being due.
 * A card whose window expires in a minute is a far more honest thing to show than one
 * marked correctly thirty seconds ago. Remaining time is the MIN across `markTypes`,
 * mirroring `queueArrivalAt`'s MIN: the card is due as soon as its EARLIEST track is.
 *
 * Never-marked cards cannot appear here — with no correct mark, `cooldownRemainingMs`
 * is 0 for every track, so the card is rested and belongs to `rankCardQueue` instead.
 *
 * `readyTypes` is deliberately EMPTY on every returned card (that is what "cooled"
 * means), so callers must not use it to steer which face to show; the flp falls back
 * to its default face for these.
 */
export function rankCardQueueCooled<T extends RankableCard>(
  cards: T[],
  now: number,
  options: {
    markTypes: readonly MarkType[];
    windowCategoryOf: (card: T) => string | null | undefined;
  }
): T[] {
  const scored: Array<{ card: T; remainingMs: number }> = [];

  for (const card of cards) {
    const windowCategory = options.windowCategoryOf(card);
    const ready = readyMarkTypes(card.typedMarkHistory, now, options.markTypes, windowCategory);
    if (ready.length > 0) continue; // rested — rankCardQueue's business, not ours

    let remainingMs = Infinity;
    for (const type of options.markTypes) {
      remainingMs = Math.min(
        remainingMs,
        cooldownRemainingMs(card.typedMarkHistory, type, now, windowCategory)
      );
    }
    // Unreachable in practice (a card with no ready track has a positive remainder on
    // at least one), but a finite score keeps the sort total if `markTypes` is empty.
    if (!Number.isFinite(remainingMs)) remainingMs = 0;
    scored.push({ card, remainingMs });
  }

  // Stable sort, so cards with equal remaining time keep the caller's SQL ordering.
  scored.sort((a, b) => a.remainingMs - b.remainingMs);
  return scored.map(({ card }) => card);
}
