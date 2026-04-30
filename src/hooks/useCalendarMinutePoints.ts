import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { API_BASE_URL } from '../constants';

// Calendar data types
export interface CalendarDayData {
  date: string;             // YYYY-MM-DD streak day label
  minutesEarned: number;
  penaltyMinutes: number;
  streakMaintained: boolean;
  isToday: boolean;
  hasData: boolean;         // Whether the user had started tracking by this date
}

export interface CalendarDataResponse {
  yearMonth: string;        // YYYY-MM
  days: CalendarDayData[];
  userFirstActivityDate: string | null;
}

export interface UseCalendarMinutePointsReturn {
  calendarData: CalendarDataResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  fetchMonth: (yearMonth: string) => Promise<void>;
}

interface ServerCalendarDay {
  date: string;
  minutesEarned: number;
  penaltyMinutes: number;
  streakMaintained: boolean;
}

interface ServerCalendarResponse {
  yearMonth: string;
  days: ServerCalendarDay[];
  userFirstActivityDate: string | null;
}

export const useCalendarMinutePoints = (initialYearMonth?: string): UseCalendarMinutePointsReturn => {
  const { user, token } = useAuth();
  const [calendarData, setCalendarData] = useState<CalendarDataResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getCurrentYearMonth = useCallback(() => {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
  }, []);

  const fetchCalendarData = useCallback(async (yearMonth: string) => {
    if (!user?.id) {
      setError('User not authenticated');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/users/minute-points/calendar/${yearMonth}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data: ServerCalendarResponse = await response.json();

      // Compute "today" / "isFuture" / "hasData" client-side using browser tz.
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
      const firstActivity = data.userFirstActivityDate;

      const updatedDays: CalendarDayData[] = data.days.map(day => {
        const isFutureDate = day.date > todayStr;
        const hasData = firstActivity ? day.date >= firstActivity && day.date <= todayStr : false;

        return {
          date: day.date,
          minutesEarned: day.minutesEarned,
          // Drop penalty display on future dates (client tz interpretation).
          penaltyMinutes: isFutureDate || !hasData ? 0 : day.penaltyMinutes,
          streakMaintained: day.streakMaintained,
          isToday: day.date === todayStr,
          hasData
        };
      });

      setCalendarData({
        yearMonth: data.yearMonth,
        days: updatedDays,
        userFirstActivityDate: firstActivity
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error(`[CALENDAR-HOOK] ❌ Error fetching calendar data:`, errorMessage);
      setError(errorMessage);
      setCalendarData(null);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, token]);

  useEffect(() => {
    if (user?.id) {
      const target = initialYearMonth || getCurrentYearMonth();
      fetchCalendarData(target);
    }
  }, [user?.id, initialYearMonth, getCurrentYearMonth, fetchCalendarData]);

  const refetch = useCallback(async () => {
    if (calendarData?.yearMonth) {
      await fetchCalendarData(calendarData.yearMonth);
    } else {
      await fetchCalendarData(getCurrentYearMonth());
    }
  }, [calendarData?.yearMonth, fetchCalendarData, getCurrentYearMonth]);

  const fetchMonth = useCallback(async (yearMonth: string) => {
    await fetchCalendarData(yearMonth);
  }, [fetchCalendarData]);

  return {
    calendarData,
    isLoading,
    error,
    refetch,
    fetchMonth
  };
};
