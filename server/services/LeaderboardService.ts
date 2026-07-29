import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IUserMinutePointsDAL } from '../dal/interfaces/IUserMinutePointsDAL.js';
import { IUserLanguagePointsDAL } from '../dal/interfaces/IUserLanguagePointsDAL.js';
import { IWinsDAL } from '../dal/interfaces/IWinsDAL.js';
import { LeaderboardEntry, LeaderboardResponse } from '../types/leaderboard.js';
import { ValidationError } from '../types/dal.js';

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
      // Roster = identity + isPublic only (points no longer live on `users`); we mask streak for
      // non-public ones below. Totals come from one grouped query over user_language_points, so
      // the join stays O(1) queries rather than O(users).
      const [roster, totalsByUser] = await Promise.all([
        this.userDAL.getLeaderboardRoster(),
        this.userLanguagePointsDAL.getTotalsForAllUsers(),
      ]);

      if (roster.length === 0) {
        return { success: true, data: [], totalUsers: 0 };
      }

      // For "today" / "yesterday" minute totals we use the server's UTC-day notion.
      // The leaderboard rendering doesn't need to be 4 AM-bounded — that's a streak concern.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split('T')[0];

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      // Weekly-achievement counts for every user in a single grouped query
      // (avoids an N+1 lookup inside the per-user loop below). "This week" = the
      // distinct (game, level) wins since each user's local week boundary.
      const weeklyAchievementCounts = await this.winsDAL.getWeeklyCountsByUser();

      const leaderboardEntries: LeaderboardEntry[] = [];

      for (const user of roster) {
        // Today's/yesterday's minutes stay summed ACROSS languages — this is a
        // "how active were you" figure, not a per-track streak concern.
        const todaysMinutes = await this.userMinutePointsDAL.getMinutesForDate(user.userId, todayStr);
        const yesterdaysMinutes = await this.userMinutePointsDAL.getMinutesForDate(user.userId, yesterdayStr);

        // A user with no user_language_points rows has never studied anything; treat as zeroes
        // rather than skipping, so the isPublic-filter below stays the single exclusion rule.
        const totals = totalsByUser.get(user.userId);

        leaderboardEntries.push({
          userId: user.userId,
          email: user.email,
          name: user.name,
          accumulativeMinutePoints: totals?.totalMinutePoints ?? 0,
          // Hide streak from non-public users. Best = MAX across the user's languages.
          currentStreak: user.isPublic ? (totals?.bestStreak ?? 0) : null,
          todaysMinutes,
          yesterdaysMinutes,
          weeklyAchievements: weeklyAchievementCounts.get(user.userId) ?? 0,
          avatarIconId: user.avatarIconId,
          rank: 0,
        });
      }

      // Hide users with no accumulated points from the leaderboard entirely.
      // Done before sorting/ranking so rank numbers, totalUsers, and pagination
      // all reflect only the users actually shown.
      const rankedEntries = leaderboardEntries.filter(
        (entry) => entry.accumulativeMinutePoints > 0
      );

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
