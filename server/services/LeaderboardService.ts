import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IUserWorkPointsDAL } from '../dal/interfaces/IUserWorkPointsDAL.js';
import { LeaderboardEntry, LeaderboardResponse } from '../types/leaderboard.js';
import { ValidationError } from '../types/dal.js';

/**
 * Leaderboard Service
 * Handles business logic for leaderboard operations
 */
export class LeaderboardService {
  constructor(
    private userDAL: IUserDAL,
    private userWorkPointsDAL: IUserWorkPointsDAL
  ) {}

  /**
   * Get complete leaderboard data (only public users)
   */
  async getLeaderboard(): Promise<LeaderboardResponse> {
    try {
      // Get only public users with their total work points
      const usersWithPoints = await this.userDAL.getPublicUsersWithTotalPoints();
      
      if (usersWithPoints.length === 0) {
        return {
          success: true,
          data: [],
          totalUsers: 0
        };
      }

      // Get today's and yesterday's dates
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split('T')[0];

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      // Prepare leaderboard entries
      const leaderboardEntries: LeaderboardEntry[] = [];

      for (let i = 0; i < usersWithPoints.length; i++) {
        const user = usersWithPoints[i];
        
        // Get streak data for this user
        const streakData = await this.userWorkPointsDAL.getUserStreakData(user.userId);
        
        // Get today's points
        const todaysPoints = await this.userWorkPointsDAL.getDailyPointsForUser(user.userId, todayStr);
        
        // Get yesterday's points
        const yesterdaysPoints = await this.userWorkPointsDAL.getDailyPointsForUser(user.userId, yesterdayStr);

        leaderboardEntries.push({
          userId: user.userId,
          email: user.email,
          name: user.name,
          accumulativeWorkPoints: user.totalWorkPoints,
          currentStreak: streakData.currentStreak,
          todaysPoints: todaysPoints,
          yesterdaysPoints: yesterdaysPoints,
          rank: 0 // Will be assigned after sorting
        });
      }

      // DEBUG: Log data before sorting
      console.log('🏆 [LEADERBOARD-DEBUG] Before sorting:', 
        leaderboardEntries.map(e => ({ email: e.email, yesterday: e.yesterdaysPoints, total: e.accumulativeWorkPoints }))
      );

      // Sort by yesterday's work points (descending), with total points as tiebreaker
      leaderboardEntries.sort((a, b) => {
        if (b.yesterdaysPoints !== a.yesterdaysPoints) {
          return b.yesterdaysPoints - a.yesterdaysPoints;
        }
        // Tiebreaker: use accumulative work points (descending)
        return b.accumulativeWorkPoints - a.accumulativeWorkPoints;
      });

      // DEBUG: Log data after sorting
      console.log('🏆 [LEADERBOARD-DEBUG] After sorting:', 
        leaderboardEntries.map(e => ({ rank: e.rank, email: e.email, yesterday: e.yesterdaysPoints, total: e.accumulativeWorkPoints }))
      );

      // Assign ranks based on sorted position
      leaderboardEntries.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      // DEBUG: Log final ranks
      console.log('🏆 [LEADERBOARD-DEBUG] Final ranks:', 
        leaderboardEntries.map(e => ({ rank: e.rank, email: e.email, yesterday: e.yesterdaysPoints }))
      );

      return {
        success: true,
        data: leaderboardEntries,
        totalUsers: leaderboardEntries.length
      };

    } catch (error) {
      console.error('Error getting leaderboard:', error);
      throw new Error('Failed to retrieve leaderboard data');
    }
  }

  /**
   * Get leaderboard with current user highlighted
   */
  async getLeaderboardWithCurrentUser(currentUserId: string): Promise<LeaderboardResponse> {
    if (!currentUserId) {
      throw new ValidationError('Current user ID is required');
    }

    const leaderboard = await this.getLeaderboard();
    
    // Find and mark the current user
    let currentUserRank: number | undefined;
    
    leaderboard.data = leaderboard.data.map(entry => {
      if (entry.userId === currentUserId) {
        entry.isCurrentUser = true;
        currentUserRank = entry.rank;
      }
      return entry;
    });

    return {
      ...leaderboard,
      currentUserRank
    };
  }

  /**
   * Get top N users from leaderboard
   */
  async getTopUsers(limit: number = 10): Promise<LeaderboardResponse> {
    if (limit <= 0) {
      throw new ValidationError('Limit must be greater than 0');
    }

    const fullLeaderboard = await this.getLeaderboard();
    
    return {
      ...fullLeaderboard,
      data: fullLeaderboard.data.slice(0, limit)
    };
  }

  /**
   * Get leaderboard page (with pagination)
   */
  async getLeaderboardPage(page: number = 1, pageSize: number = 10): Promise<LeaderboardResponse & {
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  }> {
    if (page <= 0) {
      throw new ValidationError('Page must be greater than 0');
    }
    if (pageSize <= 0) {
      throw new ValidationError('Page size must be greater than 0');
    }

    const fullLeaderboard = await this.getLeaderboard();
    const totalUsers = fullLeaderboard.totalUsers;
    const totalPages = Math.ceil(totalUsers / pageSize);
    
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    
    const paginatedData = fullLeaderboard.data.slice(startIndex, endIndex);

    return {
      success: true,
      data: paginatedData,
      totalUsers,
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    };
  }
}
