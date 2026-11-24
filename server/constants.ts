/**
 * Server-side constants for minute points and streak configuration.
 * Overridable via environment variables.
 */

export const STREAK_CONFIG = {
  RETENTION_MINUTES: parseInt(process.env.STREAK_RETENTION_MINUTES || '3'),
  // Escalating inactivity penalty by consecutive full days below the threshold.
  // Index 0 = 1st missed day (3 min), ... index 5 = 6th missed day (120 min).
  // The 7th+ missed day takes the whole remaining balance (no schedule entry).
  // This is the single documented source of truth; the values are hard-coded in
  // database/cron/expire-stale-streaks.sql and MUST be kept in sync with it.
  PENALTY_SCHEDULE_MINUTES: [3, 15, 30, 60, 90, 120],
  // Checkpoint interval for the NET balance (totalMinutePoints), in minute points.
  // 1440 = 24 h. No inactivity penalty -- including the tier-7 wipe -- may take a
  // balance below the highest multiple of this at or under it, so 1560 floors at
  // 1440 and 3300 floors at 2880. Checkpoints are ABSORBING: a balance resting on
  // one is permanently out of the penalty system. Hard-coded in the cron SQL; keep
  // in sync. See docs/STREAK_EXPIRATION_CRON.md § Checkpoints.
  CHECKPOINT_MINUTES: 1440,
};

export const MINUTE_POINTS_CONFIG = {
  MILLISECONDS_PER_POINT: 60000, // 60 seconds = 1 minute point
};

// Abuse limit on the dictionary AI-fallback ("AI" pill). Max COMPLETED model calls a
// single user may make per local streak-day; over this, POST /api/dictionary/aiEntry
// returns HTTP 429. Cache hits don't count. See docs/DICTIONARY_AI_FALLBACK_SEARCH.md
// and dictionary_ai_usage (migration 99).
export const DICTIONARY_AI_DAILY_LIMIT = parseInt(process.env.DICTIONARY_AI_DAILY_LIMIT || '10');

/**
 * Every game slug the app recognises. Its one job today is typing `GAME_FLAGS`
 * (server/contracts/featureFlags.ts → `GameFlagId`), so adding a game is a compile
 * error until the game is given a flag. (It was also the whitelist for the generic
 * `/api/games/:gameId/*` assets/progress routes, deleted 2026-11-23 with no caller.)
 *
 * Mirrors the client registry (`src/games/registry.ts` → `ALL_GAMES`).
 */
export const KNOWN_GAME_IDS = [
  'word-search',
  'match-speed',
  'speed-reading',
  'memory-map',
  // Played only as an flp game break since 2026-11-04 (docs/WRITING_PRACTICE_REWORK.md § 2).
  'writing-grid',
  // Stack scrambled stroke tiles back into characters (docs/SUPERPOSITION_GAME.md).
  'superposition',
] as const;
