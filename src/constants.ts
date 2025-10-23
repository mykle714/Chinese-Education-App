export const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? '/api' 
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
  ACTIVITY_WINDOW_MS: 15000, // 15 seconds activity window
  ACTIVITY_TIMEOUT_MS: 15000, // 15 seconds until marked inactive
  ANIMATION_DURATION_MS: 600, // Badge animation duration
};

// Streak Configuration
export const STREAK_CONFIG = {
  RETENTION_POINTS: parseInt(import.meta.env.VITE_STREAK_RETENTION_POINTS) || 3, // Points needed to retain streak
  PENALTY_PERCENT: parseInt(import.meta.env.VITE_STREAK_PENALTY_PERCENT) || 10, // Penalty percentage when streak is lost
  DAILY_PENALTY_POINTS: parseInt(import.meta.env.VITE_DAILY_PENALTY_POINTS) || 10, // Fixed penalty points per missed day
};
