import { MINUTE_POINTS_CONFIG } from '../constants';

// Server is authoritative for streak + total. We only persist today's accumulating
// timer locally so it survives a tab refresh.
export interface MinutePointsStorage {
  todaysMinutePointsMilli: number; // Milliseconds of active time accumulated today
  totalMinutePoints: number;       // Lifetime fallback when the server is unreachable
  lastActivity: string;            // ISO timestamp of last activity
}

const STORAGE_KEY_PREFIX = 'minutePoints_';

// Storage is scoped by (userId, language) so the per-language fire badge shows
// the correct today-count when the user switches their selected language.
export const getMinutePointsStorageKey = (userId: string, language: string): string => {
  return `${STORAGE_KEY_PREFIX}${userId}_${language}`;
};

export const loadMinutePointsDataSync = (userId: string, language: string): MinutePointsStorage => {
  const key = getMinutePointsStorageKey(userId, language);
  const stored = localStorage.getItem(key);

  if (!stored) {
    return {
      todaysMinutePointsMilli: 0,
      totalMinutePoints: 0,
      lastActivity: new Date().toISOString()
    };
  }

  try {
    const data = JSON.parse(stored) as MinutePointsStorage;
    if (typeof data.totalMinutePoints === 'undefined') {
      data.totalMinutePoints = 0;
    }
    return data;
  } catch {
    return {
      todaysMinutePointsMilli: 0,
      totalMinutePoints: 0,
      lastActivity: new Date().toISOString()
    };
  }
};

export const saveMinutePointsData = (userId: string, language: string, data: MinutePointsStorage): void => {
  const key = getMinutePointsStorageKey(userId, language);
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving minute points data:', error);
  }
};

export const clearMinutePointsData = (userId: string, language: string): void => {
  const key = getMinutePointsStorageKey(userId, language);
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Error clearing minute points data:', error);
  }
};

export const calculatePointsFromMilliseconds = (milliseconds: number): number => {
  return Math.floor(milliseconds / MINUTE_POINTS_CONFIG.MILLISECONDS_PER_POINT);
};
