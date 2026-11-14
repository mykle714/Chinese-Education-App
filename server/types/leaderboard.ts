// Leaderboard related TypeScript type definitions

export interface LeaderboardEntry {
  userId: string;
  /** The public handle (migration 188). The board no longer ships emails (docs/LOGIN_REWORK.md Q20). */
  username: string;
  name: string | null;
  accumulativeMinutePoints: number;
  // Every account is public since `isPublic` was removed (docs/LOGIN_REWORK.md Q7).
  currentStreak: number;
  todaysMinutes: number;
  yesterdaysMinutes: number;
  // How many weekly achievements this user has earned in the current week.
  weeklyAchievements: number;
  // icons8 id of the user's chosen avatar (null when they haven't picked one).
  avatarIconId: string | null;
  rank: number;
  isCurrentUser?: boolean;
}

export interface LeaderboardResponse {
  success: boolean;
  data: LeaderboardEntry[];
  totalUsers: number;
  currentUserRank?: number;
}
