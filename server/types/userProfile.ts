/**
 * Wire types for the User Profile page (docs/USER_PROFILE_PAGE.md).
 *
 * A profile is a READ-ONLY, cross-cutting view of one account assembled from data
 * five other features already own — identity (`users`), the friend edge
 * (`friendships`), velocity (`category_promotions`), the wallet (`user_languages`),
 * band counts (the vet tables) and card designs (vet `iconLayout`). It introduces NO
 * storage of its own: there is no `profiles` table and no new column anywhere.
 *
 * Depended on by:
 *   server/dal/interfaces/IUserDAL.ts        (findPublicProfileById)
 *   server/services/UserProfileService.ts
 *   server/controllers/UserProfileController.ts
 *   src/api/userProfile.ts                   (client mirror — keep the two in step)
 */
import type { MasteryBarId } from '../contracts/wire.js';

/**
 * The viewer's relationship to the profiled account. Drives which single friend-action
 * button the page's top bar shows, so it is deliberately ONE closed enum rather than
 * a bag of booleans the client would have to prioritise itself.
 *
 *   self             — the viewer's own profile; no action, no block control.
 *   friends          — Remove friend, plus the challenge-block toggle.
 *   request_sent     — the viewer already asked; the button revokes.
 *   request_received — they asked the viewer; the button accepts.
 *   none             — strangers; the button sends a request.
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
  /** Account opt-ins, rendered as the two goal badges. */
  readingGoal: boolean;
  writingGoal: boolean;
  /** Account creation date, for the "learning since" line. */
  createdAt: string;
}

/**
 * One language's study stats for the profiled account.
 *
 * ⚠️ Scoped to THAT PERSON'S language, never the viewer's. A Chinese viewer looking at
 * a Spanish learner reads Spanish numbers, exactly as the friends leaderboard does
 * (docs/FRIENDS_FEATURE.md § Leaderboard); scoring them in the viewer's language would
 * report a dedicated account as four zeros.
 */
export interface ProfileLanguageStats {
  /** The language these figures describe — the client renders its flag beside them. */
  language: string;
  /** True for the account's currently selected language, which sorts first. */
  isSelected: boolean;
  /** Band-steps climbed in the velocity window, counting only bars they pursue. */
  velocity: number;
  /** NET minute-point wallet for this language (penalty-debited, floored at 0). */
  netMinutes: number;
  /** Sorted-card counts per utcm band, keyed by band label. Provisional cards excluded. */
  bandCounts: Record<string, number>;
}

/**
 * The profiled account's study stats — ONE PANEL PER LANGUAGE they are learning.
 *
 * ── ORDER AND MEMBERSHIP ARE SERVER-OWNED ─────────────────────────────────────
 * `languages` arrives in render order and needs no client sort: the account's SELECTED
 * language first (whatever its balance, including zero — it is what the header says
 * they are studying, so a profile that omitted it would contradict itself), then every
 * other language by `netMinutes` descending. Languages with a **zero** balance other
 * than the selected one are dropped entirely: a `user_languages` row is created the
 * moment somebody so much as switches languages to look around, so an untouched row is
 * a language they are not learning, and drawing an empty panel for it would misreport
 * a focused learner as a dabbler.
 *
 * `velocityWindowDays` and `activeBars` sit OUTSIDE the array because they are
 * account-wide: the window is a constant, and the reading/writing goals are per-account
 * opt-ins (`users.readingGoal` / `writingGoal`), not per-language ones.
 */
export interface ProfileStats {
  /** The velocity window's length, so the client can label it without hard-coding 7. */
  velocityWindowDays: number;
  /** Which mastery bars their goals make active — the badges' source of truth. */
  activeBars: MasteryBarId[];
  /** Selected language first, then the rest by `netMinutes` desc. Never empty. */
  languages: ProfileLanguageStats[];
}

/**
 * Whether the pair's Study Challenge opt-out is set, from the viewer's side
 * (docs/STUDY_CHALLENGE.md § 1). Null when the two are not friends: the flags live
 * ON the friendship row, so a non-friend has no block to show and no way to set one.
 */
export interface ProfileChallengeBlock {
  /** The viewer's own half of the per-pair opt-out — the only half they may set. */
  viewerBlocked: boolean;
}

/** GET /api/users/:userId/profile */
export interface UserProfileResponse {
  identity: ProfileIdentity;
  stats: ProfileStats;
  relationship: ProfileRelationship;
  /**
   * The `friendships` row id, present only for `request_sent` / `request_received`
   * — those two actions address the REQUEST, not the user.
   */
  requestId: string | null;
  /** ISO timestamp of the accept, for the "friends since" line. Null unless friends. */
  friendsSince: string | null;
  /** Null unless `relationship === 'friends'` (the flags live on the friendship row). */
  challengeBlock: ProfileChallengeBlock | null;
}
