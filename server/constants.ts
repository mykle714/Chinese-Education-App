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
