import type { PoolClient } from 'pg';
import type {
  Friendship,
  FriendSummary,
  FriendRequestSummary,
  RequestDirection,
} from '../../types/friends.js';

/**
 * Data-access contract for `friendships` (migration 138) — the friend graph.
 *
 * VIEWER-RELATIVE READS: every list method takes the viewer's id and returns the
 * OTHER user in each row. The table is symmetric for accepted rows, so callers
 * must never assume the viewer is the requester.
 *
 * NO POLICY HERE. Who may accept, what happens when two people request each other,
 * and whether a target account exists are all FriendsService's business. The DAL
 * only refuses input that would corrupt a row (missing ids, self-edges).
 *
 * See docs/FRIENDS_FEATURE.md.
 */
export interface IFriendshipDAL {
  /** One row by its id, or null. Used to authorize accept / decline / revoke. */
  findById(id: string, client?: PoolClient): Promise<Friendship | null>;

  /**
   * The row joining two users in either direction, or null. This is the
   * "are these two already connected?" probe — it deliberately ignores direction
   * because the unique index does too.
   */
  findBetween(userA: string, userB: string, client?: PoolClient): Promise<Friendship | null>;

  /** Insert a pending request. Throws DuplicateError if the pair already has a row. */
  createRequest(requesterId: string, addresseeId: string, client?: PoolClient): Promise<Friendship>;

  /**
   * Flip a pending row to 'accepted' and stamp `respondedAt`. Returns null if the
   * row is gone or was already accepted, so a double-tap is a no-op rather than a
   * second "you are now friends".
   */
  acceptRequest(id: string, client?: PoolClient): Promise<Friendship | null>;

  /** Delete one row by id. Returns true if a row went away. Used by decline and revoke. */
  deleteById(id: string, client?: PoolClient): Promise<boolean>;

  /** Delete the row joining two users, whichever direction it points. Unfriend. */
  deleteBetween(userA: string, userB: string, client?: PoolClient): Promise<boolean>;

  /**
   * Set or clear ONE endpoint's Study Challenge opt-out (migration 148,
   * docs/STUDY_CHALLENGE.md § 1).
   *
   * `endpoint` names which of the two flags to write, so a caller can only ever
   * touch the flag belonging to the side they are on — the service decides that by
   * comparing the caller's id to the row. Blocking is deliberately NOT disclosed to
   * the blocked friend, so there is no read here beyond the row itself.
   */
  setChallengesBlocked(
    id: string,
    endpoint: 'requester' | 'addressee',
    blocked: boolean,
    client?: PoolClient
  ): Promise<boolean>;

  /** The viewer's accepted friends, newest friendship first, joined to user identity. */
  listFriends(userId: string, client?: PoolClient): Promise<FriendSummary[]>;

  /**
   * The viewer's pending requests in one direction, newest first, joined to the
   * other party's identity.
   */
  listPendingRequests(
    userId: string,
    direction: RequestDirection,
    client?: PoolClient
  ): Promise<FriendRequestSummary[]>;
}
