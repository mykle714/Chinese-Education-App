import type { IPersonalBestDAL } from '../dal/interfaces/IPersonalBestDAL.js';
import { ValidationError } from '../types/dal.js';
import {
  PERSONAL_BEST_GAMES,
  beatsPersonalBest,
  isPersonalBestGame,
  type PersonalBestRecord,
  type SubmitPersonalBestResponse,
} from '../contracts/personalBests.js';

/** Longest accepted mode key (column is VARCHAR(32)). */
const MAX_MODE_LENGTH = 32;

/**
 * PersonalBestService — "did this run beat my best?" (docs/WRITING_PRACTICE_REWORK.md § 2a).
 *
 * LAYER: service. Owns the game allow-list and the better-than rule (both from
 * server/contracts/personalBests.ts); the DAL owns the SQL, including the atomic
 * conditional upsert that keeps two simultaneous finishes from both claiming the best.
 */
export class PersonalBestService {
  constructor(private personalBestDAL: IPersonalBestDAL) {}

  async list(userId: string, language: string, game?: string): Promise<PersonalBestRecord[]> {
    if (game !== undefined && !isPersonalBestGame(game)) throw new ValidationError('Unknown game');
    return this.personalBestDAL.listForUser(userId, language, game);
  }

  async submit(
    userId: string,
    language: string,
    game: unknown,
    mode: unknown,
    value: unknown
  ): Promise<SubmitPersonalBestResponse> {
    if (!isPersonalBestGame(game)) throw new ValidationError('game does not keep a personal best');
    const modeKey = typeof mode === 'string' || typeof mode === 'number' ? String(mode).trim() : '';
    if (!modeKey || modeKey.length > MAX_MODE_LENGTH) throw new ValidationError('mode is required');
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 2_147_483_647) throw new ValidationError('value must be a non-negative number');
    const rounded = Math.round(n);

    const before = await this.personalBestDAL.findOne(userId, language, game, modeKey);
    const previousValue = before ? before.bestValue : null;
    const best = await this.personalBestDAL.upsertIfBetter(
      userId, language, game, modeKey, rounded, PERSONAL_BEST_GAMES[game].direction
    );
    // New best iff this run's value is now stored and it beat what was there.
    const isNewBest = best.bestValue === rounded && beatsPersonalBest(game, rounded, previousValue);
    return { best, isNewBest, previousValue };
  }
}
