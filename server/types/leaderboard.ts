// Leaderboard related TypeScript type definitions

export interface LeaderboardEntry {
  userId: string;
  email: string;
  name: string;
  accumulativeMinutePoints: number;
  // null when the user is not public — streak is hidden from other viewers.
  currentStreak: number | null;
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
