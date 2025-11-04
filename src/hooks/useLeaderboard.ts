import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../constants';

export interface LeaderboardEntry {
  userId: string;
  email: string;
  name: string;
  accumulativeWorkPoints: number;
  currentStreak: number;
  todaysPoints: number;
  yesterdaysPoints: number;
  rank: number;
  isCurrentUser?: boolean;
}

export interface LeaderboardData {
  success: boolean;
  data: LeaderboardEntry[];
  totalUsers: number;
  currentUserRank?: number;
}

export interface UseLeaderboardOptions {
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

export const useLeaderboard = (options: UseLeaderboardOptions = {}) => {
  const {
    limit,
    autoRefresh = false,
    refreshInterval = 30000 // 30 seconds
  } = options;

  const [leaderboardData, setLeaderboardData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Build API URL
      let url = `${API_BASE_URL}/api/leaderboard`;
      if (limit && limit > 0) {
        url += `?limit=${limit}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include', // Include cookies for authentication
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required. Please log in.');
        }
        if (response.status === 403) {
          throw new Error('Access denied. Insufficient permissions.');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Server error: ${response.status}`);
      }

      const data: LeaderboardData = await response.json();
      setLeaderboardData(data);
      setLastFetchTime(new Date());
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load leaderboard';
      setError(errorMessage);
      setLeaderboardData(null);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // Manually refresh the leaderboard
  const refresh = useCallback(() => {
    return fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Initial fetch
  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || refreshInterval <= 0) {
      return;
    }

    const intervalId = setInterval(() => {
      fetchLeaderboard();
    }, refreshInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [autoRefresh, refreshInterval, fetchLeaderboard]);

  // Helper functions
  const getCurrentUserEntry = useCallback((): LeaderboardEntry | null => {
    if (!leaderboardData?.data) {
      return null;
    }
    return leaderboardData.data.find(entry => entry.isCurrentUser) || null;
  }, [leaderboardData]);

  const getTopUsers = useCallback((count: number = 3): LeaderboardEntry[] => {
    if (!leaderboardData?.data) {
      return [];
    }
    return leaderboardData.data.slice(0, count);
  }, [leaderboardData]);

  const getUserByRank = useCallback((rank: number): LeaderboardEntry | null => {
    if (!leaderboardData?.data) {
      return null;
    }
    return leaderboardData.data.find(entry => entry.rank === rank) || null;
  }, [leaderboardData]);

  return {
    // Data
    leaderboardData,
    entries: leaderboardData?.data || [],
    totalUsers: leaderboardData?.totalUsers || 0,
    currentUserRank: leaderboardData?.currentUserRank,
    
    // State
    loading,
    error,
    lastFetchTime,
    
    // Actions
    refresh,
    
    // Helper functions
    getCurrentUserEntry,
    getTopUsers,
    getUserByRank,
    
    // Computed values
    isEmpty: !loading && (!leaderboardData?.data || leaderboardData.data.length === 0),
    hasData: !loading && leaderboardData?.data && leaderboardData.data.length > 0,
  };
};
