import { WORK_POINTS_CONFIG } from '../constants';

// Work Points Storage Interface — streak is server-authoritative and not stored here
export interface WorkPointsStorage {
  todaysWorkPointsMilli: number; // Total active time in milliseconds (daily, resets each day)
  totalWorkPoints: number;       // Lifetime accumulated work points (used as fallback if server unavailable)
  lastActivity: string;          // ISO timestamp of last activity
}

const STORAGE_KEY_PREFIX = 'workPoints_';

export const getWorkPointsStorageKey = (userId: string): string => {
  return `${STORAGE_KEY_PREFIX}${userId}`;
};

export const loadWorkPointsDataSync = (userId: string): WorkPointsStorage => {
  const key = getWorkPointsStorageKey(userId);
  const stored = localStorage.getItem(key);

  if (!stored) {
    return {
      todaysWorkPointsMilli: 0,
      totalWorkPoints: 0,
      lastActivity: new Date().toISOString()
    };
  }

  try {
    const data = JSON.parse(stored) as WorkPointsStorage;

    if (typeof data.totalWorkPoints === 'undefined') {
      data.totalWorkPoints = 0;
    }

    return data;
  } catch {
    return {
      todaysWorkPointsMilli: 0,
      totalWorkPoints: 0,
      lastActivity: new Date().toISOString()
    };
  }
};

export const saveWorkPointsData = (userId: string, data: WorkPointsStorage): void => {
  const key = getWorkPointsStorageKey(userId);
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving work points data:', error);
  }
};

export const clearWorkPointsData = (userId: string): void => {
  const key = getWorkPointsStorageKey(userId);
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Error clearing work points data:', error);
  }
};

export const calculatePointsFromMilliseconds = (milliseconds: number): number => {
  return Math.floor(milliseconds / WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT);
};

export const getTodayDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getYesterdayDateString = (): string => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = (yesterday.getMonth() + 1).toString().padStart(2, '0');
  const day = yesterday.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};
