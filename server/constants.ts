/**
 * Server-side constants for work points and streak configuration
 * These can be overridden via environment variables
 */

export const STREAK_CONFIG = {
  RETENTION_POINTS: parseInt(process.env.STREAK_RETENTION_POINTS || '5'),
  PENALTY_PERCENT: parseInt(process.env.STREAK_PENALTY_PERCENT || '10'),
  DAILY_PENALTY_POINTS: parseInt(process.env.DAILY_PENALTY_POINTS || '10'),
};

export const WORK_POINTS_CONFIG = {
  MILLISECONDS_PER_POINT: 60000, // 60 seconds = 1 point
};
