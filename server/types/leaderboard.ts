// Leaderboard related TypeScript type definitions

export interface LeaderboardEntry {
  userId: string;
  email: string;
  name: string;
  totalWorkPoints: number;
  currentStreak: number;
  todaysPoints: number;
  yesterdaysPoints: number;
  rank: number;
  isCurrentUser?: boolean; // Will be set on frontend
}

export interface LeaderboardResponse {
  success: boolean;
  data: LeaderboardEntry[];
  totalUsers: number;
  currentUserRank?: number;
}

// Internal type for database queries
export interface UserLeaderboardData {
  userId: string;
  email: string;
  name: string;
  totalWorkPoints: number;
}

export interface UserDailyPoints {
  userId: string;
  date: string;
  totalPoints: number; // Sum of all devices for that day
}

export interface UserStreakData {
  userId: string;
  currentStreak: number;
  longestStreak: number;
}
