import type { PersonalBestRecord } from '../../contracts/personalBests.js';

/**
 * Data-access contract for `game_personal_bests` (migration 171): one row per
 * (userId, language, game, mode). Holds no comparison rule of its own beyond the
 * conditional write it is told to make — which direction is "better" is
 * PersonalBestService's call (server/contracts/personalBests.ts).
 */
export interface IPersonalBestDAL {
  /** All of a user's bests for one language, optionally narrowed to one game. */
  listForUser(userId: string, language: string, game?: string): Promise<PersonalBestRecord[]>;

  /** The current best for one (game, mode), or null. */
  findOne(userId: string, language: string, game: string, mode: string): Promise<PersonalBestRecord | null>;

  /**
   * Insert, or overwrite only when `value` is better in `direction`. Atomic (one
   * statement), so two runs finishing together cannot both "win". Returns the row as it
   * stands afterwards.
   */
  upsertIfBetter(
    userId: string,
    language: string,
    game: string,
    mode: string,
    value: number,
    direction: 'lower' | 'higher'
  ): Promise<PersonalBestRecord>;
}
