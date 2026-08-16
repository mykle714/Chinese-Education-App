/**
 * Wire + row types for the friend graph (`friendships`, migration 138).
 *
 * See docs/FRIENDS_FEATURE.md. Depended on by:
 *   server/dal/interfaces/IFriendshipDAL.ts
 *   server/dal/implementations/FriendshipDAL.ts
 *   server/services/FriendsService.ts
 *   server/controllers/FriendsController.ts
 *   src/api/friends.ts (client mirror — keep the two in step)
 */

/**
 * A friendship row's lifecycle. There is no 'declined': declining deletes the row
 * (migration 138 header), so an edge is either awaiting an answer or is a
 * friendship.
 */
export type FriendshipStatus = 'pending' | 'accepted';

/** A raw `friendships` row. */
export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: string;
  /** When the addressee accepted; null while pending. */
  respondedAt: string | null;
}

/**
 * One accepted friend, from the viewer's point of view — the OTHER user's public
 * identity plus when the two became friends. `userId` is always the other person,
 * never the viewer, regardless of who originally sent the request.
 */
export interface FriendSummary {
  userId: string;
  name: string | null;
  email: string;
  avatarIconId: string | null;
  /** ISO timestamp of the accept. */
  friendsSince: string | null;
}

/**
 * One row of the friends leaderboard — a friend (or the viewer) ranked by VELOCITY.
 *
 * Velocity here is the same number the Account page shows (utcm band-steps climbed
 * in the last 7 days, counting only the bars that account pursues — see
 * server/types/velocity.ts), scored in **that person's own selected language**, not
 * the viewer's. A Spanish learner is therefore never shown as a zero on a Chinese
 * viewer's board; `language` says which track the two numbers describe, and the
 * client renders its flag beside them.
 *
 * `netMinutes` is that same language's NET wallet
 * (`user_languages.totalMinutePoints`) — penalty-debited and floored at 0,
 * NOT the monotonic `lifetimeMinutesEarned`. Kept in the same language as velocity
 * so the headline and the subtitle never describe different study tracks.
 */
export interface FriendLeaderboardEntry {
  userId: string;
  name: string | null;
  email: string;
  avatarIconId: string | null;
  /** The person's selected language — the scope of BOTH numbers below. */
  language: string;
  /** Band-steps climbed in `language` over the velocity window. */
  velocity: number;
  /** Net minute-point wallet for `language`. */
  netMinutes: number;
  /** 1-based position after sorting; ties share nothing — the sort is total. */
  rank: number;
  /** True on the viewer's own row, so the client can highlight it. */
  isCurrentUser: boolean;
}

/** GET /api/friends/leaderboard. `windowDays` labels the velocity window client-side. */
export interface FriendLeaderboardResponse {
  entries: FriendLeaderboardEntry[];
  windowDays: number;
}

/** Which way a pending request points, relative to the viewer. */
export type RequestDirection = 'incoming' | 'outgoing';

/**
 * One pending request, from the viewer's point of view. `userId`/`name`/etc. are
 * the OTHER party — the sender for an incoming request, the recipient for an
 * outgoing one — so both list screens can render the same row component.
 */
export interface FriendRequestSummary {
  /** The `friendships` row id — what accept / decline / revoke address. */
  requestId: string;
  direction: RequestDirection;
  userId: string;
  name: string | null;
  email: string;
  avatarIconId: string | null;
  /** ISO timestamp the request was sent. */
  requestedAt: string;
}

/** POST /api/friends/requests body. */
export interface SendFriendRequestBody {
  /** The target account's `users.id` (UUID) — the app's only friend handle today. */
  userId?: string;
}

/**
 * POST /api/friends/requests response. `status` distinguishes an ordinary new
 * request from the crossing-requests case, where the target had already sent the
 * caller one and the two are now friends outright (see FriendsService.sendRequest).
 */
export interface SendFriendRequestResponse {
  status: 'requested' | 'auto-accepted';
  request: FriendRequestSummary | null;
  friend: FriendSummary | null;
}
