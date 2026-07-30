// Minute Points related TypeScript type definitions

export interface UserMinutePoints {
  userId: string;
  streakDate: string;     // YYYY-MM-DD — 4 AM-local-bounded day label
  language: string;       // language the minute was earned studying (zh/ja/ko/vi/es)
  minutesEarned: number;
  penaltyMinutes: number;
  lastSyncTimestamp: Date;
  updatedAt: Date;
}

export interface UserMinutePointsCreateData {
  userId: string;
  streakDate: string;
  language: string;
  minutesEarned: number;
}

// API Request/Response types
//
// All client requests pass a timestamp + IANA timezone. The server resolves
// these to a streakDate (the 4 AM-bounded local day) at request time.

export interface MinutePointsIncrementRequest {
  timestamp: string;  // ISO-8601 — client-supplied "now"
  tz: string;         // IANA timezone, e.g. "America/Los_Angeles"
  // Language the minute was actually accrued studying. The client is the source
  // of truth for attribution (it drove the timer and the badge). Optional so an
  // old client mid-deploy still works; the server falls back to selectedLanguage.
  language?: string;
}

// Calendar response

export interface CalendarDay {
  date: string;            // YYYY-MM-DD streak day label
  minutesEarned: number;
  penaltyMinutes: number;
  streakMaintained: boolean;
}

export interface CalendarResponse {
  yearMonth: string;       // YYYY-MM
  days: CalendarDay[];
  userFirstActivityDate: string | null;
}

/**
 * Per-(user, language) minute-points counters and streak state
 * (`user_language_minute_totals`, migration 134). Every figure here is scoped to
 * ONE language: a user studying zh and es has two independent balances, two
 * streaks, and two penalty schedules.
 *
 * Invariant: `lifetimeMinutesEarned >= netMinutePoints` — gross is monotonic and
 * penalties lower net only.
 */
export interface UserLanguageTotals {
  userId: string;
  language: string;
  netMinutePoints: number;       // NET: earns up, penalties down, floored at 0. Drives this language's unlocks.
  lifetimeMinutesEarned: number; // GROSS: monotonic lifetime earned for this language.
  currentStreak: number;         // Consecutive qualifying days for this language.
  lastStreakDate: string | null; // YYYY-MM-DD — last day this language alone hit RETENTION_MINUTES.
  lastPenaltyDate: string | null;// YYYY-MM-DD — per-language idempotency guard for the hourly cron.
}
