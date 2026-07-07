export const API_BASE_URL = import.meta.env.MODE === 'production'
  ? ''
  : 'http://localhost:5000';

export const FLASHCARD_CONTENT_UPDATE_DELAY = 300; // ms — halfway through the 600ms flip animation

// Default test user ID for development/testing
export const DEFAULT_TEST_USER_ID = 'test-user-id';

// Minute Points Configuration
// Matched as path prefixes (see useMinutePoints) so parameterized child routes
// like `/discover/sort/:language` are covered automatically.
export const MINUTE_POINTS_ELIGIBLE_PAGES = [
  '/flashcards',
  '/flashcards/learn',
  '/reader',
  '/discover/sort',
  '/games/bubble-match',
  '/games/word-search'
];

// Subset of eligible pages that should start accruing time on entry, WITHOUT
// waiting for the user's first interaction. Games are often studied passively
// for a few seconds (reading a word-search board / bubble field) before the
// first tap, so we mark the user active on mount. Non-game eligible pages
// (flashcards, reader) still require an interaction to start, which avoids
// farming minute points by merely opening a page and walking away.
export const MINUTE_POINTS_AUTO_ACTIVE_PAGES = [
  '/games'
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
  // Mirror of server STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES: escalating penalty
  // (minutes) by consecutive full days below the threshold; the 7th+ missed day
  // wipes the remaining balance. Keep in sync with server/constants.ts and
  // database/cron/expire-stale-streaks.sql.
  PENALTY_SCHEDULE_MINUTES: [3, 15, 30, 60, 90, 120],
};

// Vocabulary Search Configuration
export const VOCAB_SEARCH_CONFIG = {
  // Both 'entryKey' (the vocab word) and 'definition' (joined from det.definitions[0])
  // are searched server-side; the search query also unnests det.definitions so
  // any definition phrase can match.
  SEARCH_FIELDS: ['entryKey', 'definition'] as const,
  RESULT_LIMIT: 50,
  DEBOUNCE_DELAY: 400
};
