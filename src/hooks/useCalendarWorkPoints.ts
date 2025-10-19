import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { API_BASE_URL } from '../constants';

// Calendar data types
export interface CalendarDayData {
  date: string; // YYYY-MM-DD
  workPointsEarned: number; // Points earned that day
  penaltyAmount: number; // Points lost due to penalty (0 if no penalty)
  streakMaintained: boolean; // Whether user met the daily threshold
  isToday: boolean; // If this is today's date
  hasData: boolean; // Whether user has started tracking by this date
}

export interface CalendarDataResponse {
  month: string; // YYYY-MM
  days: CalendarDayData[];
  userFirstActivityDate: string | null; // First date user had any activity (YYYY-MM-DD)
}

export interface UseCalendarWorkPointsReturn {
  calendarData: CalendarDataResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  fetchMonth: (month: string) => Promise<void>;
}

export const useCalendarWorkPoints = (initialMonth?: string): UseCalendarWorkPointsReturn => {
  const { user } = useAuth();
  const [calendarData, setCalendarData] = useState<CalendarDataResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get current month if no initial month provided
  const getCurrentMonth = useCallback(() => {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
  }, []);

  const fetchCalendarData = useCallback(async (month: string) => {
    if (!user?.id) {
      setError('User not authenticated');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`[CALENDAR-HOOK] 📅 Fetching calendar data for ${month}`);

      const response = await fetch(`${API_BASE_URL}/api/users/work-points/calendar/${month}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data: CalendarDataResponse = await response.json();
      
      // Client-side: Determine "today" and "isFuture" based on user's browser timezone
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
      
      // Update each day with client-side timezone-aware flags
      const updatedDays = data.days.map(day => {
        const isFutureDate = day.date > todayStr;
        const isBeforeFirstActivity = data.userFirstActivityDate ? day.date < data.userFirstActivityDate : true;
        
        return {
          ...day,
          isToday: day.date === todayStr,
          // Recalculate hasData to account for future dates in client timezone
          hasData: data.userFirstActivityDate 
            ? day.date >= data.userFirstActivityDate && day.date <= todayStr
            : false,
          // Clear penalties for future dates (based on client timezone)
          penaltyAmount: isFutureDate || isBeforeFirstActivity ? 0 : day.penaltyAmount
        };
      });
      
      setCalendarData({
        ...data,
        days: updatedDays
      });

      console.log(`[CALENDAR-HOOK] ✅ Calendar data loaded:`, {
        month: data.month,
        daysCount: data.days.length,
        firstActivityDate: data.userFirstActivityDate,
        activeDays: data.days.filter(day => day.workPointsEarned > 0).length,
        penaltyDays: data.days.filter(day => day.penaltyAmount > 0).length
      });

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error(`[CALENDAR-HOOK] ❌ Error fetching calendar data:`, errorMessage);
      setError(errorMessage);
      setCalendarData(null);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Fetch data for current month on mount
  useEffect(() => {
    if (user?.id) {
      const targetMonth = initialMonth || getCurrentMonth();
      fetchCalendarData(targetMonth);
    }
  }, [user?.id, initialMonth, getCurrentMonth, fetchCalendarData]);

  // Refetch current data
  const refetch = useCallback(async () => {
    if (calendarData?.month) {
      await fetchCalendarData(calendarData.month);
    } else {
      await fetchCalendarData(getCurrentMonth());
    }
  }, [calendarData?.month, fetchCalendarData, getCurrentMonth]);

  // Fetch specific month
  const fetchMonth = useCallback(async (month: string) => {
    await fetchCalendarData(month);
  }, [fetchCalendarData]);

  return {
    calendarData,
    isLoading,
    error,
    refetch,
    fetchMonth
  };
};
