import type { PoolClient } from 'pg';
import type { MasteryBarId } from '../../contracts/wire.js';
import { CategoryPromotion, CategoryPromotionInput } from '../../types/velocity.js';

/**
 * Data-access contract for `category_promotions` (migration 137) — the append-only
 * log of utcm band promotions that velocity is derived from.
 *
 * "Velocity" everywhere below means: the SUM of `bandsClimbed` over the last 7 days
 * (a sliding window ending now, NOT the Sunday-04:00 week boundary that wins and
 * community votes use — velocity is a rolling rate, so a fixed boundary would make
 * it collapse to near-zero every Sunday morning).
 *
 * See docs/VELOCITY.md.
 */
export interface ICategoryPromotionDAL {
  /**
   * Append one promotion. `client` is optional so the caller can enlist the insert
   * in an existing transaction (the mark handler runs its own connection).
   */
  recordPromotion(input: CategoryPromotionInput, client?: PoolClient): Promise<CategoryPromotion>;

  /**
   * Delete every promotion logged for one specific mark. Called by
   * undoLastMark so undoing a mark also undoes the velocity it earned.
   * Returns the number of rows removed. Takes the undo transaction's client.
   */
  deleteForMark(vocabEntryId: number, markTimestamp: string, client?: PoolClient): Promise<number>;

  /**
   * Band-steps climbed per language inside the velocity window, for one user,
   * counting only promotions in `bars` — the mastery bars the account is pursuing
   * (migration 143). Languages with no promotions are absent from the map.
   *
   * Defaults to core-only so a caller that forgets the argument under-reports rather
   * than crediting a learner for a skill they never opted into.
   */
  getVelocityByLanguage(
    userId: string,
    windowDays: number,
    bars?: MasteryBarId[]
  ): Promise<Map<string, number>>;
}
