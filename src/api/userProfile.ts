/**
 * userProfile.ts — the client's typed calls against /api/users/:userId/*.
 *
 * Mirrors server/types/userProfile.ts; keep the two in step. See
 * docs/USER_PROFILE_PAGE.md.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 none of these take a `token`: they go through
 * src/api/http.ts, which resolves the Authorization header at call time.
 *
 * ⚠️ EVERY NUMBER ON A PROFILE IS IN THAT PERSON'S OWN LANGUAGE, never the viewer's
 * (`identity.language` names it). Do not re-label these with the viewer's language
 * flag — a Chinese learner viewing a Spanish learner is reading Spanish numbers, and
 * saying otherwise is simply wrong.
 */
import { apiGet, withFallback } from './http';
import type { CommunityDesign } from '../types';

/**
 * The viewer's relationship to the profiled account — one closed enum, so the page's
 * top bar draws exactly one friend action and never has to prioritise competing
 * booleans.
 */
export type ProfileRelationship =
  | 'self'
  | 'friends'
  | 'request_sent'
  | 'request_received'
  | 'none';

/** One account's public identity, as the profile header renders it. */
export interface ProfileIdentity {
  userId: string;
  name: string | null;
  email: string;
  avatarIconId: string | null;
  /** The language THIS person is studying — the scope of every stat below. */
  language: string;
  readingGoal: boolean;
  writingGoal: boolean;
  createdAt: string;
}

/** One language's study stats for the profiled account. */
export interface ProfileLanguageStats {
  /** The language these figures describe — the panel renders its flag. */
  language: string;
  /** True for the account's currently selected language, which sorts first. */
  isSelected: boolean;
  velocity: number;
  netMinutes: number;
  /** Sorted-card counts per utcm band, keyed by band label. */
  bandCounts: Record<string, number>;
}

/**
 * The profiled account's study stats — ONE PANEL PER LANGUAGE they are learning.
 *
 * `languages` arrives in RENDER ORDER and must not be re-sorted client-side: selected
 * language first, then the rest by `netMinutes` descending, with zero-balance languages
 * already dropped by the server. `velocityWindowDays` and `activeBars` sit outside the
 * array because they are account-wide, not per-language.
 */
export interface ProfileStats {
  velocityWindowDays: number;
  /** Which mastery bars their goals make active. */
  activeBars: string[];
  /** Selected language first, then by `netMinutes` desc. Never empty. */
  languages: ProfileLanguageStats[];
}

/** The viewer's half of the per-pair Study Challenge opt-out. Null unless friends. */
export interface ProfileChallengeBlock {
  viewerBlocked: boolean;
}

export interface UserProfile {
  identity: ProfileIdentity;
  stats: ProfileStats;
  relationship: ProfileRelationship;
  /** Present only for `request_sent` / `request_received` — those act on the REQUEST. */
  requestId: string | null;
  friendsSince: string | null;
  challengeBlock: ProfileChallengeBlock | null;
}

/** One account's profile, as seen by the signed-in viewer. */
export function fetchUserProfile(userId: string): Promise<UserProfile> {
  return withFallback(
    apiGet<UserProfile>(`/api/users/${encodeURIComponent(userId)}/profile`),
    'Could not load that profile',
  );
}

/**
 * One keyset page of that account's card designs, in THEIR language.
 *
 * `after` is the previous page's last `entryKey`; omit it for the first page. A page
 * shorter than `limit` means the list is exhausted — there is no `hasMore` flag to
 * keep in step with the rows.
 */
export function fetchUserDesigns(
  userId: string,
  after: string | null,
  limit: number,
): Promise<CommunityDesign[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (after) params.set('after', after);
  return withFallback(
    apiGet<CommunityDesign[]>(`/api/users/${encodeURIComponent(userId)}/designs?${params}`),
    'Could not load their card designs',
  );
}
