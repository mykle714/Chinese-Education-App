import {
  ARENA_DIVISION_COUNT,
  ARENA_PROMOTE_COUNT,
  ARENA_RELEGATE_COUNT,
  ARENA_SIZE,
} from '../contracts/wire.js';

/**
 * Arena promotion / relegation zones — pure functions, no I/O
 * (docs/ARENA_FEATURE.md § 7).
 *
 * ── The zones are SCORE cutoffs, not rank cutoffs ────────────────────────────
 * Ranks are total: the board breaks a score tie by who reached the score first
 * (§ 4.2), so two members on the same minutes still get different rank numbers.
 * That tiebreak is fine for DISPLAY ORDER and unacceptable for CONSEQUENCE: it
 * would promote one of two identical weeks and hold the other purely on the
 * timestamp of a mark. So the ladder reads the SCORE at the boundary rank and
 * treats everyone holding it alike:
 *
 *   PROMOTION GROWS. `promoteAtOrAbove` is the score at rank ARENA_PROMOTE_COUNT.
 *     Anyone at or above it promotes, so a tie spanning the line pulls the whole
 *     tied group up and the promotion zone can exceed 5.
 *
 *   RELEGATION SHRINKS. `relegateBelow` is the score at the LAST SAFE rank
 *     (ARENA_SIZE - ARENA_RELEGATE_COUNT). Only a strictly lower score goes
 *     down, so a tie spanning the line keeps the whole tied group up and the
 *     relegation zone can be smaller than 5 — including empty.
 *
 * Both directions resolve a tie in the member's favour, which is the only
 * defensible way to split people whose weeks were literally identical. The cost
 * is that a division's population is no longer conserved week to week; that is
 * accepted, since divisions are not fixed-size pools (§ 7).
 *
 * PROMOTION WINS A COLLISION. On a flat enough board the grown promotion zone
 * can reach into the shrunk relegation zone (e.g. every member on the same
 * score). The promote test runs first, so such a member promotes.
 *
 * SYNTHETIC MEMBERS OCCUPY REAL RANKS, so a bot inside the promotion zone
 * consumes a promotion slot (§ 6.3, Q5). Promoting "the top 5 humans" instead
 * was rejected: it makes the displayed rank a lie, and it turns a bot-heavy
 * board into a free ride — which is exactly the board a struggling player is
 * most likely to be in. Growing the promotion zone for a tie does not change
 * that: a bot tied on the boundary score is promoted alongside the humans (it
 * goes nowhere, having no division of its own) rather than being skipped.
 *
 * ZERO NEVER PROMOTES. A score of 0 means the member did not study at all this
 * week, and at the top of every week EVERY member sits at 0 — without this guard
 * the tie rule would paint the whole opening board "promote" and, on a dead
 * board, actually promote it. A zero-score tie holds instead. Relegation needs
 * no such guard: nothing is strictly below 0.
 */

/**
 * The two score cutoffs for one board. `null` means that zone is empty for this
 * board (too few members to have a boundary rank at all).
 */
export interface ArenaZoneCutoffs {
  /** Promote at or above this score. */
  promoteAtOrAbove: number | null;
  /** Relegate strictly below this score. */
  relegateBelow: number | null;
}

/**
 * Derive the cutoffs from one board's scores IN RANK ORDER (index 0 = rank 1).
 *
 * The caller has already sorted; this function only reads the boundary
 * positions, so it stays valid for a closed board replayed from stored
 * finalRanks as well as a live one sorted on the fly.
 */
export function computeZoneCutoffs(scoresInRankOrder: number[]): ArenaZoneCutoffs {
  const n = scoresInRankOrder.length;

  // A board shorter than the promotion count has no boundary rank; everyone in
  // it is inside the zone, so the cutoff is simply the lowest score present.
  const promoteIndex = Math.min(ARENA_PROMOTE_COUNT, n) - 1;

  // Last rank that is safe from relegation. A board no longer than that rank
  // has no relegation zone at all.
  const lastSafeRank = ARENA_SIZE - ARENA_RELEGATE_COUNT;

  return {
    promoteAtOrAbove: promoteIndex >= 0 ? scoresInRankOrder[promoteIndex] : null,
    relegateBelow: n > lastSafeRank ? scoresInRankOrder[lastSafeRank - 1] : null,
  };
}

/**
 * Which side of the line a score sits on, given its board's cutoffs.
 *
 * Division clamps the ladder at both ends: the top division cannot promote and
 * division 1 cannot relegate.
 */
export function zoneForScore(
  score: number,
  division: number,
  cutoffs: ArenaZoneCutoffs,
): 'promote' | 'hold' | 'relegate' {
  const { promoteAtOrAbove, relegateBelow } = cutoffs;

  // Promotion is tested first so it wins a collision with the relegation zone.
  if (
    division < ARENA_DIVISION_COUNT &&
    promoteAtOrAbove != null &&
    score > 0 &&
    score >= promoteAtOrAbove
  ) {
    return 'promote';
  }
  if (division > 1 && relegateBelow != null && score < relegateBelow) return 'relegate';
  return 'hold';
}

/** -1 / 0 / +1 ladder move for a score — the same rule the board displays. */
export function divisionChangeForScore(
  score: number,
  division: number,
  cutoffs: ArenaZoneCutoffs,
): number {
  const zone = zoneForScore(score, division, cutoffs);
  return zone === 'promote' ? 1 : zone === 'relegate' ? -1 : 0;
}
