// Work Points Storage Interface
export interface WorkPointsStorage {
  millisecondsAccumulated: number; // Total active time in milliseconds (daily, resets)
  totalWorkPoints: number; // Lifetime accumulated work points (persists)
  lastActivity: string; // ISO timestamp of last activity
  currentStreak: number; // Current consecutive days streak
  longestStreak: number; // Personal best streak
  lastStreakDate: string; // Last date streak was maintained (YYYY-MM-DD format)
}

const STORAGE_KEY_PREFIX = 'workPoints_';

export const getWorkPointsStorageKey = (userId: string): string => {
  return `${STORAGE_KEY_PREFIX}${userId}`;
};

const checkDailyReset = async (
  data: WorkPointsStorage, 
  userId: string,
  onDailyBoundarySync?: (workPoints: number, date: string) => Promise<boolean>
): Promise<WorkPointsStorage> => {
  const lastActivityDate = new Date(data.lastActivity).toDateString();
  const today = new Date().toDateString();
  
  if (lastActivityDate !== today) {
    // Calculate daily points to add to total
    const dailyPoints = calculatePointsFromMilliseconds(data.millisecondsAccumulated);
    const newTotalWorkPoints = (data.totalWorkPoints || 0) + dailyPoints;
    
    // Different day detected - sync before reset to prevent data loss
    if (data.millisecondsAccumulated > 0 && onDailyBoundarySync) {
      const yesterdayDate = new Date(data.lastActivity).toISOString().split('T')[0];
      
      console.log(`[WORK-POINTS-STORAGE] 📅 Daily reset detected, adding ${dailyPoints} points to total (${data.totalWorkPoints || 0} → ${newTotalWorkPoints}) for ${yesterdayDate}`);
      
      try {
        const syncSuccess = await onDailyBoundarySync(dailyPoints, yesterdayDate);
        
        if (syncSuccess) {
          console.log(`[WORK-POINTS-STORAGE] ✅ Daily boundary sync completed, safe to reset`);
        } else {
          console.warn(`[WORK-POINTS-STORAGE] ⚠️ Daily boundary sync failed, but resetting anyway to prevent stuck state`);
        }
      } catch (error) {
        console.error(`[WORK-POINTS-STORAGE] ❌ Daily boundary sync error:`, error);
        // Continue with reset even if sync fails to prevent stuck state
      }
    } else if (dailyPoints > 0) {
      console.log(`[WORK-POINTS-STORAGE] 📅 Daily reset detected, adding ${dailyPoints} points to total (${data.totalWorkPoints || 0} → ${newTotalWorkPoints}) locally`);
    }
    
    // Reset daily points but preserve total after adding daily points to it
    return {
      millisecondsAccumulated: 0,
      totalWorkPoints: newTotalWorkPoints,
      lastActivity: new Date().toISOString(),
      currentStreak: data.currentStreak || 0,
      longestStreak: data.longestStreak || 0,
      lastStreakDate: data.lastStreakDate || ''
    };
  }
  
  return data; // Same day, no reset needed
};

export const loadWorkPointsData = async (
  userId: string,
  onDailyBoundarySync?: (workPoints: number, date: string) => Promise<boolean>
): Promise<WorkPointsStorage> => {
  const key = getWorkPointsStorageKey(userId);
  const stored = localStorage.getItem(key);
  
  if (!stored) {
    return {
      millisecondsAccumulated: 0,
      totalWorkPoints: 0,
      lastActivity: new Date().toISOString(),
      currentStreak: 0,
      longestStreak: 0,
      lastStreakDate: ''
    };
  }
  
  try {
    const data = JSON.parse(stored) as WorkPointsStorage;
    
    // Check for daily reset using lastActivity date (with sync-before-reset)
    return await checkDailyReset(data, userId, onDailyBoundarySync);
  } catch (error) {
    console.error('Error parsing work points data:', error);
    // Return fresh data if parsing fails
    return {
      millisecondsAccumulated: 0,
      totalWorkPoints: 0,
      lastActivity: new Date().toISOString(),
      currentStreak: 0,
      longestStreak: 0,
      lastStreakDate: ''
    };
  }
};

// Synchronous version for backward compatibility (without daily boundary sync)
export const loadWorkPointsDataSync = (userId: string): WorkPointsStorage => {
  const key = getWorkPointsStorageKey(userId);
  const stored = localStorage.getItem(key);
  
  if (!stored) {
    return {
      millisecondsAccumulated: 0,
      totalWorkPoints: 0,
      lastActivity: new Date().toISOString(),
      currentStreak: 0,
      longestStreak: 0,
      lastStreakDate: ''
    };
  }
  
  try {
    const data = JSON.parse(stored) as WorkPointsStorage;
    
    // Handle backward compatibility - add totalWorkPoints if missing
    if (typeof data.totalWorkPoints === 'undefined') {
      data.totalWorkPoints = 0;
    }
    
    // Simple daily reset without sync (legacy behavior)
    const lastActivityDate = new Date(data.lastActivity).toDateString();
    const today = new Date().toDateString();
    
    if (lastActivityDate !== today) {
      // Add daily points to total before resetting (local only, no sync)
      const dailyPoints = calculatePointsFromMilliseconds(data.millisecondsAccumulated);
      const newTotalWorkPoints = (data.totalWorkPoints || 0) + dailyPoints;
      
      return {
        millisecondsAccumulated: 0,
        totalWorkPoints: newTotalWorkPoints,
        lastActivity: new Date().toISOString(),
        currentStreak: data.currentStreak || 0,
        longestStreak: data.longestStreak || 0,
        lastStreakDate: data.lastStreakDate || ''
      };
    }
    
    return data;
  } catch (error) {
    console.error('Error parsing work points data:', error);
    return {
      millisecondsAccumulated: 0,
      totalWorkPoints: 0,
      lastActivity: new Date().toISOString(),
      currentStreak: 0,
      longestStreak: 0,
      lastStreakDate: ''
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

// Utility function to calculate points from milliseconds
export const calculatePointsFromMilliseconds = (milliseconds: number): number => {
  return Math.floor(milliseconds / 30000); // 30 seconds = 1 point
};

// Streak Utility Functions
export const getTodayDateString = (): string => {
  return new Date().toISOString().split('T')[0];
};

export const getYesterdayDateString = (): string => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
};

export const isConsecutiveDay = (lastStreakDate: string, targetDate: string): boolean => {
  if (!lastStreakDate) return false;
  
  const lastDate = new Date(lastStreakDate);
  const target = new Date(targetDate);
  const diffTime = target.getTime() - lastDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays === 1;
};

export const addBackwardCompatibilityToStorageData = (data: any): WorkPointsStorage => {
  return {
    millisecondsAccumulated: data.millisecondsAccumulated || 0,
    totalWorkPoints: data.totalWorkPoints || 0,
    lastActivity: data.lastActivity || new Date().toISOString(),
    currentStreak: data.currentStreak || 0,
    longestStreak: data.longestStreak || 0,
    lastStreakDate: data.lastStreakDate || ''
  };
};
