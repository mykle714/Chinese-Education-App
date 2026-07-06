/**
 * Server-side constants for minute points and streak configuration.
 * Overridable via environment variables.
 */

export const STREAK_CONFIG = {
  RETENTION_MINUTES: parseInt(process.env.STREAK_RETENTION_MINUTES || '3'),
  DAILY_PENALTY_MINUTES: parseInt(process.env.DAILY_PENALTY_MINUTES || '10'),
};

export const MINUTE_POINTS_CONFIG = {
  MILLISECONDS_PER_POINT: 60000, // 60 seconds = 1 minute point
};

// Abuse limit on the dictionary AI-fallback ("AI" pill). Max COMPLETED model calls a
// single user may make per local streak-day; over this, POST /api/dictionary/ai-entry
// returns HTTP 429. Cache hits don't count. See docs/DICTIONARY_AI_FALLBACK_SEARCH.md
// and dictionary_ai_usage (migration 99).
export const DICTIONARY_AI_DAILY_LIMIT = parseInt(process.env.DICTIONARY_AI_DAILY_LIMIT || '10');
