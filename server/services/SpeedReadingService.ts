import { ISpeedReadingDAL } from '../dal/interfaces/ISpeedReadingDAL.js';
import { DistractorChar } from '../contracts/wire.js';
import { ValidationError } from '../types/dal.js';

/**
 * Speed Reading Service — business logic behind the Speed Reading game
 * (docs/SPEED_READING_GAME.md).
 *
 * LAYER: service. Owns policy; the DAL owns SQL. One responsibility: serve the
 * distractor pool — real characters from the player's own library — from which
 * the client builds each round's wrong option.
 */
export class SpeedReadingService {
  constructor(private speedReadingDAL: ISpeedReadingDAL) {}

  /**
   * The distractor pool: real characters the player already has in their
   * library, each flagged with whether its READING track is mastered.
   *
   * Returned whole and once per game — the pool does not shrink as the run
   * proceeds, so there is no top-up path. Every per-round decision (which
   * position to swap, the same-band preference, and the fallback ladder that
   * relaxes it) is made CLIENT-side in buildRound: those depend on the prompt
   * word currently on screen, and must not cost a round trip mid-run.
   */
  async getDistractors(
    userId: string,
    language: string
  ): Promise<{ chars: DistractorChar[]; masteredReadingExcluded: number }> {
    if (!userId) throw new ValidationError('userId is required');
    return this.speedReadingDAL.getLibraryDistractors(userId, language);
  }
}
