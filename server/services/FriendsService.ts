import type { PoolClient } from 'pg';
import { dbManager } from '../dal/base/DatabaseManager.js';
import { IFriendshipDAL } from '../dal/interfaces/IFriendshipDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { ICategoryPromotionDAL } from '../dal/interfaces/ICategoryPromotionDAL.js';
import { IUserLanguagesDAL } from '../dal/interfaces/IUserLanguagesDAL.js';
import { ValidationError, NotFoundError, DuplicateError } from '../types/dal.js';
import { VELOCITY_WINDOW_DAYS } from '../types/velocity.js';
import { activeBars } from '../utils/masteryCompute.js';
import type {
  FriendSummary,
  FriendRequestSummary,
  FriendLeaderboardEntry,
  FriendLeaderboardResponse,
  SendFriendRequestResponse,
} from '../types/friends.js';

/** A `users.id` is a v4 UUID; anything else can't be an account and is rejected before we query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one thing the friend graph needs from Study Challenge: end the pair's
 * in-flight challenges when they unfriend (docs/STUDY_CHALLENGE.md § 6).
 *
 * A one-method interface rather than the whole StudyChallengeService, so the
 * dependency points one way and this file learns nothing about challenges beyond
 * "there is something to clean up". OPTIONAL in the constructor so a test — and the
 * existing friends test suite — can build a FriendsService without standing up the
 * challenge stack.
 */
export interface UnfriendChallengeResolver {
  resolveForUnfriend(userA: string, userB: string, client?: PoolClient): Promise<void>;
}

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
    private userDAL: IUserDAL,
    private categoryPromotionDAL: ICategoryPromotionDAL,
    private userLanguagesDAL: IUserLanguagesDAL,
    /** Optional — see UnfriendChallengeResolver. Omitted, unfriending just deletes the edge. */
    private challengeResolver?: UnfriendChallengeResolver
  ) {}

  /** The viewer's accepted friends. */
  async listFriends(userId: string): Promise<FriendSummary[]> {
    return this.friendshipDAL.listFriends(userId);
  }

  /**
   * The friends leaderboard: the viewer and their friends, ranked by VELOCITY.
   *
   * THE SCOPING RULE — every person is scored in **their own** selected language,
   * not the viewer's. The alternative (score everyone in the viewer's language)
   * renders a friend who studies only Spanish as a permanent 0 on a Chinese
   * viewer's board, which reads as "this person does nothing" rather than "we
   * study different things". Each row therefore carries its `language`, and the
   * client shows that language's flag so the comparison stays honest.
   *
   * Velocity for one person = Σ band-steps in the window over that person's OWN
   * active bars (`activeBars` on their goal flags, migration 143) in that language.
   * `netMinutes` is the same language's net wallet, so headline and subtitle never
   * describe different tracks.
   *
   * Three batched reads, no per-friend query — the whole board is O(1) round trips.
   */
  async getLeaderboard(userId: string): Promise<FriendLeaderboardResponse> {
    if (!userId) throw new ValidationError('User ID is required');

    const friends = await this.friendshipDAL.listFriends(userId);

    // The viewer is ranked among their friends, so they are part of every lookup.
    const userIds = [userId, ...friends.map((friend) => friend.userId)];

    const [profiles, buckets, netPointsByUser] = await Promise.all([
      this.userDAL.findScoringProfilesByIds(userIds),
      this.categoryPromotionDAL.getVelocityBuckets(userIds, VELOCITY_WINDOW_DAYS),
      this.userLanguagesDAL.getNetPointsForUsers(userIds),
    ]);

    // Index the flat bucket rows by user so the per-person sum below is a scan of
    // that person's own buckets rather than of the whole board's.
    const bucketsByUser = new Map<string, typeof buckets>();
    for (const bucket of buckets) {
      const list = bucketsByUser.get(bucket.userId);
      if (list) list.push(bucket);
      else bucketsByUser.set(bucket.userId, [bucket]);
    }

    const entries: FriendLeaderboardEntry[] = profiles.map((profile) => {
      // A brand-new account may not have picked a language yet; 'zh' is the app's
      // default everywhere else (VelocityController does the same).
      const language = profile.selectedLanguage || 'zh';
      const bars = new Set<string>(
        activeBars({ reading: profile.readingGoal, writing: profile.writingGoal })
      );

      const velocity = (bucketsByUser.get(profile.userId) ?? []).reduce(
        (sum, bucket) =>
          bucket.language === language && bars.has(bucket.bar)
            ? sum + bucket.bandsClimbed
            : sum,
        0
      );

      return {
        userId: profile.userId,
        name: profile.name,
        email: profile.email,
        avatarIconId: profile.avatarIconId,
        language,
        velocity,
        netMinutes: netPointsByUser.get(profile.userId)?.get(language) ?? 0,
        rank: 0,
        isCurrentUser: profile.userId === userId,
      };
    });

    // Velocity first (that is what the board ranks), net minutes as the tiebreaker
    // — between two learners at the same recent rate, the one who has put in more
    // total study stands higher. Display name last so the order is TOTAL and the
    // list cannot shuffle between refreshes for two identical rows.
    entries.sort((a, b) => {
      if (b.velocity !== a.velocity) return b.velocity - a.velocity;
      if (b.netMinutes !== a.netMinutes) return b.netMinutes - a.netMinutes;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });
    entries.forEach((entry, index) => { entry.rank = index + 1; });

    return { entries, windowDays: VELOCITY_WINDOW_DAYS };
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

  /**
   * Unfriend. Symmetric: either side may do it, and it deletes the single shared row.
   *
   * ⚠️ IT ALSO ENDS ANY IN-FLIGHT STUDY CHALLENGE between the pair, in the SAME
   * TRANSACTION (docs/STUDY_CHALLENGE.md § 6, Q41). Unfriending withdraws you from
   * everything shared with that person, and a challenge is not an exception carved
   * out of that — so there must be no window in which a challenge outlives the
   * friendship it depended on.
   *
   * The unfriend is NEVER BLOCKED by an active challenge: it is a social-safety
   * action and must always succeed on the first tap. The knowingly-accepted cost is
   * that this is a rage-quit button — a player who is losing can unfriend to erase
   * the result. It resolves to `no_contest` rather than a forfeit win for the other
   * player, so the escape genuinely works; the mitigation is social, not technical
   * (you had to be friends to be challenged, and re-friending is a visible request
   * the other person must accept).
   *
   * Marks and words already earned STAY — the cards are the player's own, in the
   * `library` bucket, and were never challenge state. A RESOLVED challenge is
   * likewise untouched: its history entry and its crown survive, because the record
   * is of something that actually happened.
   */
  async removeFriend(userId: string, friendUserId: string): Promise<void> {
    if (!friendUserId || !UUID_RE.test(friendUserId)) {
      throw new ValidationError('Invalid user ID');
    }
    const existing = await this.friendshipDAL.findBetween(userId, friendUserId);
    if (!existing || existing.status !== 'accepted') {
      throw new NotFoundError('You are not friends with this user');
    }

    await dbManager.executeInTransaction(async (tx) => {
      const client = tx.getClient();
      // Challenges first, then the edge. Either order is correct inside one
      // transaction; this order means that if the hook throws, the friendship is
      // still intact and the user can retry — rather than the reverse, which would
      // leave them unfriended with a challenge to clean up by hand.
      await this.challengeResolver?.resolveForUnfriend(userId, friendUserId, client);
      await this.friendshipDAL.deleteBetween(userId, friendUserId, client);
    });
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
