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
