import { Request, Response } from 'express';
import { LeaderboardService } from '../services/LeaderboardService.js';
import { userDAL, userWorkPointsDAL } from '../dal/setup.js';

/**
 * Leaderboard Controller
 * Handles HTTP requests for leaderboard operations
 */
export class LeaderboardController {
  private leaderboardService: LeaderboardService;

  constructor() {
    this.leaderboardService = new LeaderboardService(
      userDAL,
      userWorkPointsDAL
    );
  }

  /**
   * GET /api/leaderboard
   * Get leaderboard data
   */
  getLeaderboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, page, pageSize } = req.query;
      const currentUserId = req.user?.userId; // From auth middleware

      let leaderboardData;

      // Handle pagination
      if (page && pageSize) {
        const pageNum = parseInt(page as string);
        const pageSizeNum = parseInt(pageSize as string);
        
        if (isNaN(pageNum) || isNaN(pageSizeNum)) {
          res.status(400).json({
            success: false,
            message: 'Invalid page or pageSize parameters'
          });
          return;
        }

        leaderboardData = await this.leaderboardService.getLeaderboardPage(pageNum, pageSizeNum);
      }
      // Handle limit
      else if (limit) {
        const limitNum = parseInt(limit as string);
        
        if (isNaN(limitNum)) {
          res.status(400).json({
            success: false,
            message: 'Invalid limit parameter'
          });
          return;
        }

        leaderboardData = await this.leaderboardService.getTopUsers(limitNum);
      }
      // Full leaderboard with current user highlighted (if authenticated)
      else if (currentUserId) {
        leaderboardData = await this.leaderboardService.getLeaderboardWithCurrentUser(currentUserId);
      }
      // Basic full leaderboard
      else {
        leaderboardData = await this.leaderboardService.getLeaderboard();
      }

      res.json(leaderboardData);

    } catch (error) {
      console.error('Error in getLeaderboard:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve leaderboard data',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * GET /api/leaderboard/top/:limit
   * Get top N users from leaderboard
   */
  getTopUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = parseInt(req.params.limit);
      
      if (isNaN(limit) || limit <= 0) {
        res.status(400).json({
          success: false,
          message: 'Invalid limit parameter. Must be a positive number.'
        });
        return;
      }

      if (limit > 100) {
        res.status(400).json({
          success: false,
          message: 'Limit cannot exceed 100'
        });
        return;
      }

      const leaderboardData = await this.leaderboardService.getTopUsers(limit);
      res.json(leaderboardData);

    } catch (error) {
      console.error('Error in getTopUsers:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve top users data',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * GET /api/leaderboard/user/:userId
   * Get leaderboard with specific user highlighted
   */
  getLeaderboardForUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      
      if (!userId) {
        res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
        return;
      }

      const leaderboardData = await this.leaderboardService.getLeaderboardWithCurrentUser(userId);
      res.json(leaderboardData);

    } catch (error) {
      console.error('Error in getLeaderboardForUser:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve user leaderboard data',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

// Export a singleton instance
export const leaderboardController = new LeaderboardController();
