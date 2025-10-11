export const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'http://174.127.171.180:5000' 
  : 'http://localhost:5000';

export const FLASHCARD_CONTENT_UPDATE_DELAY = 300; // milliseconds - halfway through 600ms flip animation

// Default test user ID for development/testing
export const DEFAULT_TEST_USER_ID = 'test-user-id';

// Work Points Configuration
export const WORK_POINTS_ELIGIBLE_PAGES = [
  '/flashcards',
  '/reader'
];

export const WORK_POINTS_CONFIG = {
  MILLISECONDS_PER_POINT: 60000, // 60 seconds = 1 point
  ACTIVITY_WINDOW_MS: 10000, // 10 seconds activity window
  ACTIVITY_TIMEOUT_MS: 10000, // 10 seconds until marked inactive
  ANIMATION_DURATION_MS: 600, // Badge animation duration
};

// Streak Configuration
export const STREAK_CONFIG = {
  RETENTION_POINTS: parseInt(import.meta.env.VITE_STREAK_RETENTION_POINTS) || 5, // Points needed to retain streak
  PENALTY_PERCENT: parseInt(import.meta.env.VITE_STREAK_PENALTY_PERCENT) || 20, // Penalty percentage when streak is lost
};
