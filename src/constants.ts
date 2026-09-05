export const API_BASE_URL = import.meta.env.MODE === 'production'
  ? ''
  : 'http://localhost:5000';

export const FLASHCARD_CONTENT_UPDATE_DELAY = 300; // ms — halfway through the 600ms flip animation

// Default test user ID for development/testing
export const DEFAULT_TEST_USER_ID = 'test-user-id';

// Minute Points Configuration
// Matched as path prefixes (see useMinutePoints) so parameterized child routes
// like `/discover/sort/:language` are covered automatically.
// Pages that accrue minute points, matched as PATH PREFIXES (the page itself and
// everything under it). Only STUDY surfaces belong here — a screen where the learner
// is working through cards, text or a game board. Browsing and menu screens
// deliberately do not accrue: the hubs (Home, Discover, Games, Decks & Cards),
// deck/collection lists and the mastery centers. They still show the header flame, in
// its grey idle state, which is the honest answer to "am I earning right now?" — see
// MinutePointsFireBadge / PageHeader.
//
// ── The card detail pages and the whole dictionary ARE study surfaces (2026-09-04) ──
// `/flashcards/card` (the saved-card cdp) and `/dictionary` (the search page AND the
// read-only dictionary cdp under it) accrue. A cdp is where a learner reads the
// definition, the breakdown, the example sentences and the comparison of a word — the
// same reading the eip does on the flp, which has always earned. Looking a word up and
// reading what comes back is studying; the line this list draws is study vs. NAVIGATION,
// and neither is a place you merely pick from a list.
//
// `/dictionary` is deliberately a PREFIX covering both of its routes (`/dictionary` and
// `/dictionary/card/:word`) — unlike `/flashcards`, whose descendants are browse screens
// and which therefore sits in the EXACT list below. Add a browse-shaped route under
// `/dictionary` and this prefix would wrongly admit it.
//
// This is also what makes the COMPARE sheet earn. Compare has no route of its own
// (docs/WORD_COMPARE_FEATURE.md — it is a panel raised over the page you are on), so it
// cannot be listed here; it earns because every surface that can open it now accrues —
// the flp, the scp, and both cdps. Anything that later hosts the compare sheet from a
// non-earning page would break that, so keep the two lists in step.
//
// Accrual still requires INTERACTION (`useActivityDetection`, 15s window): a cdp or a
// search page is easy to leave open, so neither is in MINUTE_POINTS_AUTO_ACTIVE_PAGES.
//
// ⚠️ NOT '/flashcards' — that prefix would re-admit every browsing screen under it
// (/flashcards/decks, /flashcards/deck/:id, /flashcards/collection/*,
// /flashcards/reading|writing). `/flashcards/card` is now listed on its own, which is
// the point of naming the study surfaces one at a time rather than the parent. The legacy desktop
// flashcards page at exactly '/flashcards' IS a study surface and is listed in
// MINUTE_POINTS_ELIGIBLE_EXACT_PAGES below instead.
export const MINUTE_POINTS_ELIGIBLE_PAGES = [
  '/flashcards/learn',
  '/flashcards/card',
  '/dictionary',
  '/reader',
  '/discover/sort',
  '/games/bubble-match',
  '/games/word-search',
  '/games/match-speed',
  '/games/speed-reading',
  '/games/memory-map',
  '/games/hydra-bubbles'
];

// Eligible pages matched EXACTLY, with no descendants. For a study surface whose path
// is a parent of unrelated browsing routes — currently only the legacy desktop
// flashcards page, whose children under /flashcards are all browse screens.
export const MINUTE_POINTS_ELIGIBLE_EXACT_PAGES = [
  '/flashcards'
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
  // takes the whole remaining balance. Keep in sync with server/constants.ts and
  // database/cron/expire-stale-streaks.sql.
  PENALTY_SCHEDULE_MINUTES: [3, 15, 30, 60, 90, 120],
  // Mirror of server STREAK_CONFIG.CHECKPOINT_MINUTES. No penalty may take the NET
  // balance below the highest multiple of 1440 (24 h) at or under it; below the
  // first checkpoint a balance can still reach 0.
  CHECKPOINT_MINUTES: 1440,
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
