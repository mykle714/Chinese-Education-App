import { IFriendshipDAL } from '../dal/interfaces/IFriendshipDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { ValidationError, NotFoundError, DuplicateError } from '../types/dal.js';
import type {
  FriendSummary,
  FriendRequestSummary,
  SendFriendRequestResponse,
} from '../types/friends.js';

/** A `users.id` is a v4 UUID; anything else can't be an account and is rejected before we query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Friend-graph policy (docs/FRIENDS_FEATURE.md).
 *
 * LAYER: service. Owns every rule about who may do what to a `friendships` row;
 * writes no SQL and touches no Express types (docs/BACKEND_LAYERING.md §2).
 *
 * The rules, in one place:
 *   • You send a request BY USER ID — the app has no username, so the id pasted
 *     from a friend's Friends screen is the handle.
 *   • Crossing requests auto-accept. If B requests A while A's request to B is
 *     still pending, the honest outcome is "you are now friends", not a second
 *     pending row (which the pair index forbids anyway) and not an error the user
 *     cannot act on.
 *   • Only the addressee may accept or decline; only the requester may revoke.
 *     Both are enforced against the row, not against the client's claim.
 *   • Declining DELETES. The requester is never told they were declined, and the
 *     pair may try again later.
 */
export class FriendsService {
  constructor(
    private friendshipDAL: IFriendshipDAL,
    private userDAL: IUserDAL
  ) {}

  /** The viewer's accepted friends. */
  async listFriends(userId: string): Promise<FriendSummary[]> {
    return this.friendshipDAL.listFriends(userId);
  }

  /** Pending requests awaiting the viewer's answer. */
  async listIncomingRequests(userId: string): Promise<FriendRequestSummary[]> {
    return this.friendshipDAL.listPendingRequests(userId, 'incoming');
  }

  /** Pending requests the viewer sent and can revoke. */
  async listOutgoingRequests(userId: string): Promise<FriendRequestSummary[]> {
    return this.friendshipDAL.listPendingRequests(userId, 'outgoing');
  }

  /**
   * Send a friend request to `targetUserId`.
   *
   * Returns `auto-accepted` (with the new friend) when the target had already
   * requested the caller — see the crossing-requests rule above.
   */
  async sendRequest(userId: string, targetUserId: unknown): Promise<SendFriendRequestResponse> {
    if (typeof targetUserId !== 'string' || !UUID_RE.test(targetUserId.trim())) {
      throw new ValidationError('Enter a valid user ID');
    }
    const targetId = targetUserId.trim().toLowerCase();

    if (targetId === userId.toLowerCase()) {
      throw new ValidationError('You cannot send a friend request to yourself');
    }

    const target = await this.userDAL.findById(targetId);
    if (!target) throw new NotFoundError('No account with that user ID');

    // One probe covers all three "already connected" cases, in either direction.
    const existing = await this.friendshipDAL.findBetween(userId, targetId);
    if (existing) {
      if (existing.status === 'accepted') {
        throw new DuplicateError('You are already friends with this user');
      }
      // Their request to me is pending → accepting is what the user actually means.
      if (existing.addresseeId === userId) {
        const accepted = await this.friendshipDAL.acceptRequest(existing.id);
        return {
          status: 'auto-accepted',
          request: null,
          friend: {
            userId: target.id,
            name: target.name ?? null,
            email: target.email,
            avatarIconId: target.avatarIconId ?? null,
            friendsSince: accepted?.respondedAt ?? null,
          },
        };
      }
      throw new DuplicateError('You already have a pending request to this user');
    }

    const created = await this.friendshipDAL.createRequest(userId, targetId);
    return {
      status: 'requested',
      request: {
        requestId: created.id,
        direction: 'outgoing',
        userId: target.id,
        name: target.name ?? null,
        email: target.email,
        avatarIconId: target.avatarIconId ?? null,
        requestedAt: created.createdAt,
      },
      friend: null,
    };
  }

  /**
   * Accept a pending request addressed to the caller. Returns the new friend.
   *
   * Ownership is checked against the stored row: a caller who guesses another
   * user's request id gets 404, not someone else's friendship.
   */
  async acceptRequest(userId: string, requestId: string): Promise<FriendSummary> {
    const row = await this.requirePendingRow(requestId);
    if (row.addresseeId !== userId) {
      throw new NotFoundError('Friend request not found');
    }

    const accepted = await this.friendshipDAL.acceptRequest(requestId);
    if (!accepted) throw new NotFoundError('Friend request not found');

    // The other party is the requester here, by definition of an incoming request.
    const other = await this.userDAL.findById(accepted.requesterId);
    return {
      userId: accepted.requesterId,
      name: other?.name ?? null,
      email: other?.email ?? '',
      avatarIconId: other?.avatarIconId ?? null,
      friendsSince: accepted.respondedAt,
    };
  }

  /**
   * Remove a pending request — decline it (caller is the addressee) or revoke it
   * (caller is the requester). Both delete the row, so there is one code path.
   */
  async deleteRequest(userId: string, requestId: string): Promise<void> {
    const row = await this.requirePendingRow(requestId);
    if (row.addresseeId !== userId && row.requesterId !== userId) {
      // Not a party to this request — do not confirm it exists.
      throw new NotFoundError('Friend request not found');
    }
    await this.friendshipDAL.deleteById(requestId);
  }

  /** Unfriend. Symmetric: either side may do it, and it deletes the single shared row. */
  async removeFriend(userId: string, friendUserId: string): Promise<void> {
    if (!friendUserId || !UUID_RE.test(friendUserId)) {
      throw new ValidationError('Invalid user ID');
    }
    const existing = await this.friendshipDAL.findBetween(userId, friendUserId);
    if (!existing || existing.status !== 'accepted') {
      throw new NotFoundError('You are not friends with this user');
    }
    await this.friendshipDAL.deleteBetween(userId, friendUserId);
  }

  /** Load a request row, rejecting a missing id, a bad id, or an already-accepted row. */
  private async requirePendingRow(requestId: string) {
    if (!requestId || !UUID_RE.test(requestId)) {
      throw new ValidationError('Invalid request ID');
    }
    const row = await this.friendshipDAL.findById(requestId);
    // An accepted row is not a request any more; treating it as one would let
    // "decline" quietly unfriend someone.
    if (!row || row.status !== 'pending') {
      throw new NotFoundError('Friend request not found');
    }
    return row;
  }
}
