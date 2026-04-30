// Minute Points related TypeScript type definitions

export interface UserMinutePoints {
  userId: string;
  streakDate: string;     // YYYY-MM-DD — 4 AM-local-bounded day label
  minutesEarned: number;
  penaltyMinutes: number;
  lastSyncTimestamp: Date;
  updatedAt: Date;
}

export interface UserMinutePointsCreateData {
  userId: string;
  streakDate: string;
  minutesEarned: number;
}

// API Request/Response types
//
// All client requests pass a timestamp + IANA timezone. The server resolves
// these to a streakDate (the 4 AM-bounded local day) at request time.

export interface MinutePointsIncrementRequest {
  timestamp: string; // ISO-8601 — client-supplied "now"
  tz: string;        // IANA timezone, e.g. "America/Los_Angeles"
}

export interface MinutePointsNewDayRequest {
  timestamp: string;
  tz: string;
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
