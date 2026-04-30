import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IUserMinutePointsDAL } from '../dal/interfaces/IUserMinutePointsDAL.js';
import { LeaderboardEntry, LeaderboardResponse } from '../types/leaderboard.js';
import { ValidationError } from '../types/dal.js';

/**
 * Leaderboard Service.
 *
 * Note: streak is hidden (null) for users with isPublic = false. This is the only
 * field gated on isPublic — totals and minutes are still public.
 */
export class LeaderboardService {
  constructor(
    private userDAL: IUserDAL,
    private userMinutePointsDAL: IUserMinutePointsDAL
  ) {}

  async getLeaderboard(): Promise<LeaderboardResponse> {
    try {
      // Returns ALL users plus their isPublic flag; we mask streak for non-public ones below.
      const usersWithPoints = await this.userDAL.getPublicUsersWithTotalPoints();

      if (usersWithPoints.length === 0) {
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

      const leaderboardEntries: LeaderboardEntry[] = [];

      for (const user of usersWithPoints) {
        const todaysMinutes = await this.userMinutePointsDAL.getMinutesForDate(user.userId, todayStr);
        const yesterdaysMinutes = await this.userMinutePointsDAL.getMinutesForDate(user.userId, yesterdayStr);

        leaderboardEntries.push({
          userId: user.userId,
          email: user.email,
          name: user.name,
          accumulativeMinutePoints: user.totalMinutePoints,
          // Hide streak from non-public users.
          currentStreak: user.isPublic ? user.currentStreak : null,
          todaysMinutes,
          yesterdaysMinutes,
          rank: 0,
        });
      }

      // Sort by yesterday's minutes (desc), tiebreaker = total minute points.
      leaderboardEntries.sort((a, b) => {
        if (b.yesterdaysMinutes !== a.yesterdaysMinutes) {
          return b.yesterdaysMinutes - a.yesterdaysMinutes;
        }
        return b.accumulativeMinutePoints - a.accumulativeMinutePoints;
      });

      leaderboardEntries.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      return {
        success: true,
        data: leaderboardEntries,
        totalUsers: leaderboardEntries.length,
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
