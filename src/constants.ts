export const API_BASE_URL = import.meta.env.MODE === 'production'
  ? ''
  : 'http://localhost:5000';

export const FLASHCARD_CONTENT_UPDATE_DELAY = 300; // ms — halfway through the 600ms flip animation

// Default test user ID for development/testing
export const DEFAULT_TEST_USER_ID = 'test-user-id';

// Minute Points Configuration
export const MINUTE_POINTS_ELIGIBLE_PAGES = [
  '/flashcards',
  '/flashcards/learn',
  '/reader'
];

export const MINUTE_POINTS_CONFIG = {
  MILLISECONDS_PER_POINT: 60000, // 60 seconds = 1 minute point
  ACTIVITY_WINDOW_MS: 15000,
  ACTIVITY_TIMEOUT_MS: 15000,
  ANIMATION_DURATION_MS: 600,
};

// Streak Configuration
export const STREAK_CONFIG = {
  RETENTION_MINUTES: parseInt(import.meta.env.VITE_STREAK_RETENTION_MINUTES) || 3,
  DAILY_PENALTY_MINUTES: parseInt(import.meta.env.VITE_DAILY_PENALTY_MINUTES) || 10,
};

// Vocabulary Search Configuration
export const VOCAB_SEARCH_CONFIG = {
  SEARCH_FIELDS: ['entryKey', 'entryValue'] as const,
  RESULT_LIMIT: 50,
  DEBOUNCE_DELAY: 400
};
