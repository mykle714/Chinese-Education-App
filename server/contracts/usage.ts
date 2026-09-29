/**
 * usage.ts — the wire contract for the User Usage dashboard
 * (`GET /api/admin/usage`, docs/USAGE_DASHBOARD.md).
 *
 * Imported by BOTH halves: the server builds a `UsageDashboard`
 * (server/services/UsageDashboardService.ts) and the client renders one
 * (src/features/usageDashboard/UsageDashboardSection.tsx via src/api/usage.ts).
 *
 * Every date below is a `YYYY-MM-DD` calendar day. Minutes are bucketed by the
 * learner's own 04:00-local `streakDate` (the same day the streak uses); every other
 * event is bucketed by its UTC timestamp date. The two can disagree by a few hours at
 * the edges of a day, which is acceptable for an operator overview.
 */

/**
 * The selectable windows, in days. `0` means ALL TIME (since the first account was
 * created). Kept to a closed set so the server never runs an unbounded
 * caller-chosen range, and so the client's switch can be rendered from this list.
 */
export const USAGE_WINDOWS = [7, 30, 90, 0] as const;
export type UsageWindowDays = (typeof USAGE_WINDOWS)[number];
export const DEFAULT_USAGE_WINDOW: UsageWindowDays = 30;

/** One calendar day of the chart series. Days with no activity are present with zeros. */
export interface UsageDay {
  date: string;
  /** Distinct users who earned > 0 minute points that (streak) day. */
  activeUsers: number;
  /** Minute points earned that day, all users and languages. */
  minutes: number;
  /** Distinct users who held a live session that day (minted any access-refresh token). */
  appOpenUsers: number;
  /** Accounts created that day. */
  signups: number;
  /** Fresh sign-ins that day (a refresh token that did not replace an earlier one). */
  signIns: number;
}

/**
 * The rolling active-user counts. These are ALWAYS today-anchored 1 / 7 / 30-day
 * windows, independent of the selected window, so the headline never changes meaning
 * when the switch moves.
 */
export interface UsageHeadline {
  totalUsers: number;
  /** Studied (> 0 minutes) today. */
  dau: number;
  /** Studied at least once in the last 7 days. */
  wau: number;
  /** Studied at least once in the last 30 days. */
  mau: number;
}

/** Sums over the selected window. */
export interface UsageWindowTotals {
  /** Distinct users who studied at least once in the window. */
  activeUsers: number;
  minutes: number;
  /** Distinct users who opened the app at least once in the window. */
  appOpenUsers: number;
  signups: number;
  signIns: number;
}

export interface UsageLanguageRow {
  language: string;
  activeUsers: number;
  minutes: number;
}

/**
 * One feature's usage over the window. `key` is stable (it is the CSS modifier and the
 * React key); `label` is display copy.
 */
export interface UsageFeatureRow {
  key: 'cardsAdded' | 'gameWins' | 'writingPractice' | 'immersiveWorld' | 'aiDictionary';
  label: string;
  /** How many times it happened (cards added, wins, completions, runs, AI calls). */
  events: number;
  /** Distinct users behind those events. */
  users: number;
}

/** Game wins broken out per game over the window, most-won first. */
export interface UsageGameRow {
  game: string;
  wins: number;
  users: number;
}

export interface UsageDashboard {
  windowDays: UsageWindowDays;
  /** First day included in the window (inclusive). */
  since: string;
  /** Last day included (today, server calendar). */
  until: string;
  generatedAt: string;
  headline: UsageHeadline;
  totals: UsageWindowTotals;
  days: UsageDay[];
  languages: UsageLanguageRow[];
  features: UsageFeatureRow[];
  games: UsageGameRow[];
}
