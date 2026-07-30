import { DistractorChar } from '../../contracts/wire.js';

/**
 * Data access for the Speed Reading game (docs/SPEED_READING_GAME.md).
 *
 * The game has NO authored corpus and no tables of its own: a round's wrong
 * option is a real character read out of the player's own library. This
 * interface therefore has exactly one method.
 *
 * It lives here rather than on the vocab DAL because it is a Speed-Reading-shaped
 * read — a library query exploded to single characters and annotated with
 * reading mastery — that no other surface wants.
 */
export interface ISpeedReadingDAL {
  /**
   * Distinct characters across the player's Learn Now (library) cards, each with
   * the difficulty band of its standalone dictionary entry and whether the
   * player has mastered its READING track.
   *
   * Reading-mastered characters are returned FLAGGED rather than filtered, since
   * they are the last rung of the client's fallback ladder.
   * `masteredReadingExcluded` counts them, for the shortfall report.
   */
  getLibraryDistractors(
    userId: string,
    language: string
  ): Promise<{ chars: DistractorChar[]; masteredReadingExcluded: number }>;
}
