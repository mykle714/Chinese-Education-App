import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IFriendshipDAL } from '../dal/interfaces/IFriendshipDAL.js';
import { ICategoryPromotionDAL } from '../dal/interfaces/ICategoryPromotionDAL.js';
import { IUserLanguagesDAL } from '../dal/interfaces/IUserLanguagesDAL.js';
import { ICommunityLayoutDAL } from '../dal/interfaces/ICommunityLayoutDAL.js';
import { OnDeckVocabService } from './OnDeckVocabService.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import { VELOCITY_WINDOW_DAYS } from '../types/velocity.js';
import { activeBars } from '../utils/masteryCompute.js';
import type { MasteryBarId } from '../contracts/wire.js';
import type { CommunityDesign } from '../types/community.js';
import type {
  UserProfileResponse,
  ProfileRelationship,
  ProfileLanguageStats,
} from '../types/userProfile.js';

/** A `users.id` is a v4 UUID; anything else can't be an account and is rejected before we query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The four utcm bands, in ascending mastery order — the band-count row on the profile. */
const BANDS = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered'];

/** Page size ceiling for the design list, so a client cannot ask for the whole table. */
const MAX_DESIGN_PAGE = 30;

/**
 * User profile page policy (docs/USER_PROFILE_PAGE.md).
 *
 * LAYER: service. Owns NO storage — a profile is a COMPOSITION of five features that
 * each already own their data, and this service's whole job is to assemble one
 * account's public view and decide what the viewer's relationship to it permits. It
 * writes no SQL (docs/BACKEND_LAYERING.md § 2) and touches no Express types.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────────────
 * EVERY STAT IS SCOPED TO A LANGUAGE OF THE PROFILED PERSON'S, never the viewer's.
 * This is the same rule the friends leaderboard follows (docs/FRIENDS_FEATURE.md
 * § Leaderboard) and it exists because the alternative misreports real learners:
 * scoring a Spanish learner in a Chinese viewer's language renders a dedicated account
 * as four zeros and an empty design list.
 *
 * The stats are returned as ONE PANEL PER LANGUAGE the account is learning (selected
 * first, then by wallet descending, zero-balance languages dropped — see
 * `ProfileStats`). The DESIGN list is not: it stays in the selected language alone,
 * because it is a scrolling feed and interleaving languages inside one keyset page
 * would give the cursor two orderings to satisfy.
 *
 * ── VISIBILITY ────────────────────────────────────────────────────────────────
 * A profile is visible in full to ANY signed-in user, friend or not. That is a
 * deliberate product decision, not an oversight: the numbers here (velocity, wallet,
 * band counts, designs) are already visible to friends and, for designs, to the whole
 * Community page. If that ever changes, this service is the single place to gate it —
 * the controller and the client read whatever it returns.
 */
export class UserProfileService {
  constructor(
    private userDAL: IUserDAL,
    private friendshipDAL: IFriendshipDAL,
    private categoryPromotionDAL: ICategoryPromotionDAL,
    private userLanguagesDAL: IUserLanguagesDAL,
    private communityLayoutDAL: ICommunityLayoutDAL,
    // Band counts come from the service that owns them rather than a second copy of
    // its query. getCategoryCounts is already the one definition of "a sorted card in
    // band X" (it excludes provisional cards and bands on the core bar); duplicating
    // that SQL here is exactly how the decks page and this page would drift apart.
    private onDeckVocabService: OnDeckVocabService,
  ) {}

  /**
   * One account's profile, as seen by `viewerUserId`.
   *
   * Throws NotFoundError for an unknown id — deliberately the same answer a
   * malformed id gets, so this endpoint cannot be used to enumerate which UUIDs are
   * real accounts.
   */
  async getProfile(viewerUserId: string, targetUserId: string): Promise<UserProfileResponse> {
    if (!viewerUserId) throw new ValidationError('User ID is required');
    if (!UUID_RE.test((targetUserId ?? '').trim())) {
      throw new NotFoundError('User not found');
    }
    const targetId = targetUserId.trim().toLowerCase();

    const identity = await this.userDAL.findPublicProfileById(targetId);
    if (!identity) throw new NotFoundError('User not found');

    // A brand-new account may not have picked a language yet; 'zh' is the app's
    // default everywhere else (VelocityController and FriendsService do the same).
    const language = identity.selectedLanguage || 'zh';
    const bars = activeBars({
      reading: identity.readingGoal,
      writing: identity.writingGoal,
    }) as MasteryBarId[];

    // Three independent reads — issued together rather than stacked. The friendship
    // read is included here (not awaited first) because nothing above depends on it:
    // the stats are identical whether or not the two are friends.
    const [friendship, velocityByLanguage, netPoints] = await Promise.all([
      this.friendshipDAL.findBetween(viewerUserId, targetId),
      this.categoryPromotionDAL.getVelocityByLanguage(targetId, VELOCITY_WINDOW_DAYS, bars),
      this.userLanguagesDAL.getNetPointsForUsers([targetId]),
    ]);

    // Which languages get a panel. `getNetPointsForUsers` doubles as the "which
    // languages does this account have" read — a `user_languages` row IS the record of
    // having studied one — which is why the wallet is fetched before the band counts
    // rather than beside them. That costs one extra round trip; the alternative is
    // counting bands for every language in the app and throwing most of it away.
    const walletByLanguage = netPoints.get(targetId) ?? new Map<string, number>();
    const panelLanguages = [
      // The selected language ALWAYS leads, even at a zero balance: the header says
      // they are studying it, and a profile that then showed no panel for it would
      // contradict itself on the same screen.
      language,
      ...[...walletByLanguage.entries()]
        .filter(([lang, minutes]) => lang !== language && minutes > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([lang]) => lang),
    ];

    // One band-count read per panel, in parallel. Bounded by the number of languages
    // the ACCOUNT has actually touched, not by the number the app supports.
    const bandCountsPerLanguage = await Promise.all(
      panelLanguages.map((lang) => this.onDeckVocabService.getCategoryCounts(targetId, lang, BANDS)),
    );

    const languageStats: ProfileLanguageStats[] = panelLanguages.map((lang, i) => ({
      language: lang,
      isSelected: lang === language,
      velocity: velocityByLanguage.get(lang) ?? 0,
      netMinutes: walletByLanguage.get(lang) ?? 0,
      bandCounts: bandCountsPerLanguage[i],
    }));

    // Relationship. `self` is checked first and short-circuits: a user cannot be
    // their own friend, so any row found for (viewer, viewer) would be nonsense.
    let relationship: ProfileRelationship;
    let requestId: string | null = null;
    if (viewerUserId.toLowerCase() === targetId) {
      relationship = 'self';
    } else if (!friendship) {
      relationship = 'none';
    } else if (friendship.status === 'accepted') {
      relationship = 'friends';
    } else {
      // Pending: which way it points decides which button the client draws.
      relationship = friendship.requesterId === viewerUserId ? 'request_sent' : 'request_received';
      requestId = friendship.id;
    }

    // The block flags live ON the friendship row, so a non-friend has neither a
    // block to show nor anywhere to store one. Null rather than `false` so the
    // client renders no control at all rather than an unset toggle it cannot honour.
    const challengeBlock =
      relationship === 'friends' && friendship
        ? {
            viewerBlocked:
              friendship.requesterId === viewerUserId
                ? !!friendship.requesterChallengesBlocked
                : !!friendship.addresseeChallengesBlocked,
          }
        : null;

    return {
      identity: {
        userId: identity.userId,
        name: identity.name,
        email: identity.email,
        avatarIconId: identity.avatarIconId,
        language,
        readingGoal: identity.readingGoal,
        writingGoal: identity.writingGoal,
        createdAt: identity.createdAt ?? '',
      },
      stats: {
        velocityWindowDays: VELOCITY_WINDOW_DAYS,
        activeBars: bars,
        languages: languageStats,
      },
      relationship,
      requestId,
      friendsSince: friendship?.status === 'accepted' ? friendship.respondedAt : null,
      challengeBlock,
    };
  }

  /**
   * One page of the profiled account's card designs, in the profiled account's own
   * language. `after` is the previous page's last `entryKey`; omit it for page one.
   *
   * A page shorter than `limit` means the list is exhausted — there is no separate
   * "hasMore" flag to keep in step with the rows.
   */
  async listDesigns(
    viewerUserId: string,
    targetUserId: string,
    after: string | null,
    limit: number,
  ): Promise<CommunityDesign[]> {
    if (!viewerUserId) throw new ValidationError('User ID is required');
    if (!UUID_RE.test((targetUserId ?? '').trim())) {
      throw new NotFoundError('User not found');
    }
    const targetId = targetUserId.trim().toLowerCase();

    // The list is in THEIR language, so it needs their account — one extra read, but
    // the alternative (trusting a `?language=` from the client) would let a caller
    // ask for a language the profile header never showed.
    const identity = await this.userDAL.findPublicProfileById(targetId);
    if (!identity) throw new NotFoundError('User not found');

    const take = Math.min(Math.max(1, Math.floor(limit) || 1), MAX_DESIGN_PAGE);
    return this.communityLayoutDAL.getDesignsByOwner(
      viewerUserId,
      targetId,
      identity.selectedLanguage || 'zh',
      after || null,
      take,
    );
  }
}
