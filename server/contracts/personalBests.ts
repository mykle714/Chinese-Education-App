/**
 * personalBests.ts — which games keep a personal best, and which way "better" points.
 *
 * One best per (user, language, game, mode) in `game_personal_bests` (migration 171,
 * docs/WRITING_PRACTICE_REWORK.md § 2a). The DIRECTION lives here rather than in a column
 * so a stored row can never disagree with its game:
 *   lower  — a time in ms (fastest wins)
 *   higher — a count (most wins)
 *
 * Deliberately absent: Bubble Match (its performance has a floor and a ceiling, so a best
 * would saturate) and Memory Map (no medals, no run result to compare).
 *
 * Pure data — no value imports — so the Node build and the client bundle both load it.
 * Referenced by: server/services/PersonalBestService.ts, src/api/personalBests.ts,
 * src/games/shared/usePersonalBest.ts.
 */

export type PersonalBestDirection = 'lower' | 'higher';

export const PERSONAL_BEST_GAMES = {
  /** Completion time per mode (pinyin / no-pinyin). */
  'word-search': { direction: 'lower', unit: 'ms' },
  /** Pairs matched per level. */
  'match-speed': { direction: 'higher', unit: 'count' },
  /** Total run time. */
  'speed-reading': { direction: 'lower', unit: 'ms' },
  /** Matches cleared in one endless run. */
  'hydra-bubbles': { direction: 'higher', unit: 'count' },
  /** Time to write all eight characters correctly. */
  'writing-grid': { direction: 'lower', unit: 'ms' },
} as const satisfies Record<string, { direction: PersonalBestDirection; unit: 'ms' | 'count' }>;

export type PersonalBestGame = keyof typeof PERSONAL_BEST_GAMES;

export function isPersonalBestGame(value: unknown): value is PersonalBestGame {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERSONAL_BEST_GAMES, value);
}

/** Whether `candidate` beats `current` for this game (any value beats no best). */
export function beatsPersonalBest(game: PersonalBestGame, candidate: number, current: number | null): boolean {
  if (current === null) return true;
  return PERSONAL_BEST_GAMES[game].direction === 'lower' ? candidate < current : candidate > current;
}

/** Wire shape: GET /api/users/me/personal-bests and the POST response. */
export interface PersonalBestRecord {
  game: string;
  mode: string;
  bestValue: number;
  achievedAt: string;
}

export interface SubmitPersonalBestResponse {
  /** The best after this run (this run's value when it is a new best). */
  best: PersonalBestRecord;
  /** True when this run set (or first created) the best. */
  isNewBest: boolean;
  /** The best before this run; null when there was none. */
  previousValue: number | null;
}
