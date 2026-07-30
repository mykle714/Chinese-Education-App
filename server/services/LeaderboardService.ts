import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IUserMinutePointsDAL } from '../dal/interfaces/IUserMinutePointsDAL.js';
import { IUserLanguagePointsDAL } from '../dal/interfaces/IUserLanguagePointsDAL.js';
import { IWinsDAL } from '../dal/interfaces/IWinsDAL.js';
import { LeaderboardEntry, LeaderboardResponse } from '../types/leaderboard.js';
import { ValidationError } from '../types/dal.js';
import { addDaysToDateString } from '../utils/streakDate.js';

/**
 * Leaderboard Service.
 *
 * DELIBERATELY GLOBAL, unlike the rest of the minute-points domain. Wallets and
 * streaks are per-language since migration 130 (docs/PER_LANGUAGE_STREAKS.md), but
 * the board stays a single cross-language ranking:
 *   • rank on the SUM of each user's per-language wallets;
 *   • show the MAX of their per-language streaks ("best streak").
 * Splitting the board per language would fragment an already-small user base, and
 * a learner's standing should reflect all the study they did, not just one track.
 *
 * Note: streak is hidden (null) for users with isPublic = false. This is the only
 * field gated on isPublic — totals and minutes are still public.
 */
export class LeaderboardService {
  constructor(
    private userDAL: IUserDAL,
    private userMinutePointsDAL: IUserMinutePointsDAL,
    private userLanguagePointsDAL: IUserLanguagePointsDAL,
    private winsDAL: IWinsDAL
  ) {}

  async getLeaderboard(): Promise<LeaderboardResponse> {
    try {
      // Roster = identity + isPublic only; since migration 130 the points no longer live on
      // `users`, so the wallet/streak totals come from a second grouped query over
      // user_language_points. Two queries, both O(1) in the number of users — never
      // getAllProgress() in a per-user loop. We mask streak for non-public users below.
      const [roster, totalsByUser] = await Promise.all([
        this.userDAL.getLeaderboardRoster(),
        this.userLanguagePointsDAL.getTotalsForAllUsers(),
      ]);

      if (roster.length === 0) {
        return { success: true, data: [], totalUsers: 0 };
      }

      // Hide users with no accumulated points from the leaderboard entirely.
      // Filtering FIRST (it used to happen after the per-user minute lookups) means
      // the minutes query below only covers users who will actually be rendered.
      // A user with no user_language_points row has never studied, so absent == 0 points
      // and they drop out here — the same outcome the old `totalMinutePoints > 0` had.
      const rankedUsers = roster.filter(
        (user) => (totalsByUser.get(user.userId)?.totalMinutePoints ?? 0) > 0
      );

      if (rankedUsers.length === 0) {
        return { success: true, data: [], totalUsers: 0 };
      }

      // For "today" / "yesterday" minute totals we use the server's own calendar day.
      // The leaderboard rendering doesn't need to be 4 AM-bounded — that's a streak
      // concern — but the label must still be built from LOCAL date parts. The previous
      // `setHours(0,0,0,0)` + `toISOString()` pairing mixed the two: it snapped to local
      // midnight and then re-read that instant in UTC, which lands on the previous day
      // for any server at a positive UTC offset. `streakDateOf` formats in a named tz,
      // and `addDaysToDateString` steps the label as a string, so neither can drift.
      // 'en-CA' formats as YYYY-MM-DD, which is exactly the streakDate label format,
      // and formatting (rather than instant-arithmetic) keeps it in the server's tz.
      // Not streakDateOf(): that applies the 4 AM shift, which is deliberately not
      // wanted here. addDaysToDateString steps the label as a string, so the
      // today→yesterday step cannot drift across a DST boundary.
      const todayStr = new Intl.DateTimeFormat('en-CA').format(new Date());
      const yesterdayStr = addDaysToDateString(todayStr, -1);

      // Both remaining lookups are single grouped queries keyed by user — no per-user
      // round trips. "This week" = the distinct (game, level) wins since each user's
      // local week boundary. See docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 1.
      const [weeklyAchievementCounts, minutesByUser] = await Promise.all([
        this.winsDAL.getWeeklyCountsByUser(),
        this.userMinutePointsDAL.getMinutesForDatesByUser(
          rankedUsers.map((user) => user.userId),
          [todayStr, yesterdayStr]
        ),
      ]);

      const rankedEntries: LeaderboardEntry[] = rankedUsers.map((user) => {
        // Absent (user, date) pairs mean "no minutes recorded" — see the DAL's note.
        const userMinutes = minutesByUser.get(user.userId);
        // Non-null by construction: rankedUsers only kept users with a positive total,
        // which requires a row. The ?? 0 keeps the types honest without a non-null assertion.
        const totals = totalsByUser.get(user.userId);
        return {
          userId: user.userId,
          email: user.email,
          name: user.name,
          // Σ of the user's per-language wallets (see the class note on why the board is global).
          accumulativeMinutePoints: totals?.totalMinutePoints ?? 0,
          // Hide streak from non-public users. Best = MAX across the user's languages.
          currentStreak: user.isPublic ? (totals?.bestStreak ?? 0) : null,
          todaysMinutes: userMinutes?.get(todayStr) ?? 0,
          yesterdaysMinutes: userMinutes?.get(yesterdayStr) ?? 0,
          weeklyAchievements: weeklyAchievementCounts.get(user.userId) ?? 0,
          avatarIconId: user.avatarIconId,
          rank: 0,
        };
      });

      // Sort by yesterday's minutes (desc), tiebreaker = total minute points.
      rankedEntries.sort((a, b) => {
        if (b.yesterdaysMinutes !== a.yesterdaysMinutes) {
          return b.yesterdaysMinutes - a.yesterdaysMinutes;
        }
        return b.accumulativeMinutePoints - a.accumulativeMinutePoints;
      });

      rankedEntries.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      return {
        success: true,
        data: rankedEntries,
        totalUsers: rankedEntries.length,
      };
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      throw new Error('Failed to retrieve leaderboard data');
    }
  }

  async getLeaderboardWithCurrentUser(currentUserId: string): Promise<LeaderboardResponse> {
    if (!currentUserId) {
      throw new ValidationError('Current user ID is required');
    }

    const leaderboard = await this.getLeaderboard();

    let currentUserRank: number | undefined;
    leaderboard.data = leaderboard.data.map((entry) => {
      if (entry.userId === currentUserId) {
        entry.isCurrentUser = true;
        currentUserRank = entry.rank;
      }
      return entry;
    });

    return { ...leaderboard, currentUserRank };
  }

  async getTopUsers(limit: number = 10): Promise<LeaderboardResponse> {
    if (limit <= 0) {
      throw new ValidationError('Limit must be greater than 0');
    }
    const full = await this.getLeaderboard();
    return { ...full, data: full.data.slice(0, limit) };
  }

  async getLeaderboardPage(page: number = 1, pageSize: number = 10): Promise<LeaderboardResponse & {
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  }> {
    if (page <= 0) throw new ValidationError('Page must be greater than 0');
    if (pageSize <= 0) throw new ValidationError('Page size must be greater than 0');

    const full = await this.getLeaderboard();
    const totalUsers = full.totalUsers;
    const totalPages = Math.ceil(totalUsers / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;

    return {
      success: true,
      data: full.data.slice(startIndex, endIndex),
      totalUsers,
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };
  }
}
