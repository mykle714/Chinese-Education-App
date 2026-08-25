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
  // one is permanently out of the penalty system, and so is the night-market
  // entitlement derived from it. Hard-coded in the cron SQL; keep in sync.
  // Does NOT apply to the author dev tool (adjustMinutesForAuthor), which stays a
  // raw test signal. See docs/STREAK_EXPIRATION_CRON.md § Checkpoints.
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
 * Every game slug the app recognises — the whitelist for `/api/games/:gameId/*`.
 *
 * `gameprogress` is keyed `(userId, gameId)` and `gameId` arrives as a raw path
 * segment, so without this list a caller can mint an unbounded number of save rows
 * on their own account simply by varying the slug. The table is not the point; the
 * point is that "which games exist" is a fixed, known set and an endpoint that
 * accepts anything else is accepting garbage.
 *
 * Mirrors the client registry (`src/games/registry.ts` → `GAMES`). Adding a game
 * means adding its slug here — the 404 is the reminder.
 */
export const KNOWN_GAME_IDS = [
  'bubble-match',
  'word-search',
  'match-speed',
  'speed-reading',
  'hydra-bubbles',
  'memory-map',
] as const;

export function isKnownGameId(value: unknown): value is (typeof KNOWN_GAME_IDS)[number] {
  return typeof value === 'string' && (KNOWN_GAME_IDS as readonly string[]).includes(value);
}
