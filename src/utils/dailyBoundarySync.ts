/**
 * Daily boundary sync utilities
 * Handles syncing work points before daily reset to prevent data loss
 * Now includes streak checking and penalty application
 */

import { syncWorkPoints, type WorkPointsSyncResponse } from './workPointsSync';
import { 
  calculatePointsFromMilliseconds, 
  type WorkPointsStorage,
  getTodayDateString,
  getYesterdayDateString,
  isConsecutiveDay
} from './workPointsStorage';
import { STREAK_CONFIG } from '../constants';

/**
 * Check streak status and apply penalties if needed
 */
export function checkStreakAndApplyPenalty(data: WorkPointsStorage): {
  updatedData: WorkPointsStorage;
  streakResult: {
    streakMaintained: boolean;
    streakLost: boolean;
    penaltyApplied: boolean;
    penaltyAmount?: number;
  };
} {
  const yesterdayDateStr = getYesterdayDateString();
  const todayDateStr = getTodayDateString();
  
  // Calculate points earned yesterday
  const yesterdayPoints = calculatePointsFromMilliseconds(data.millisecondsAccumulated);
  
  // Check if user hit the streak retention threshold yesterday
  const streakMaintained = yesterdayPoints >= STREAK_CONFIG.RETENTION_POINTS;
  
  let updatedData = { ...data };
  let streakResult = {
    streakMaintained,
    streakLost: false,
    penaltyApplied: false,
    penaltyAmount: undefined as number | undefined
  };
  
  if (streakMaintained) {
    // User maintained streak - increment or start streak
    if (!data.lastStreakDate || data.currentStreak === 0) {
      // Starting new streak
      updatedData.currentStreak = 1;
      updatedData.lastStreakDate = yesterdayDateStr;
      console.log(`[STREAK] 🔥 Started new streak! Current: ${updatedData.currentStreak}`);
    } else if (isConsecutiveDay(data.lastStreakDate, yesterdayDateStr)) {
      // Continuing existing streak
      updatedData.currentStreak = data.currentStreak + 1;
      updatedData.lastStreakDate = yesterdayDateStr;
      console.log(`[STREAK] 🔥 Streak continued! Current: ${updatedData.currentStreak}`);
      
      // Update longest streak if needed
      if (updatedData.currentStreak > data.longestStreak) {
        updatedData.longestStreak = updatedData.currentStreak;
        console.log(`[STREAK] 🏆 New personal best streak: ${updatedData.longestStreak}`);
      }
    } else {
      // Gap in streak - restart
      updatedData.currentStreak = 1;
      updatedData.lastStreakDate = yesterdayDateStr;
      console.log(`[STREAK] 🔥 Restarted streak after gap! Current: ${updatedData.currentStreak}`);
    }
  } else if (data.currentStreak > 0) {
    // User failed to maintain streak and had an active streak - apply penalty
    const penaltyAmount = Math.floor(data.totalWorkPoints * (STREAK_CONFIG.PENALTY_PERCENT / 100));
    updatedData.totalWorkPoints = Math.max(0, data.totalWorkPoints - penaltyAmount);
    updatedData.currentStreak = 0;
    updatedData.lastStreakDate = '';
    
    streakResult.streakLost = true;
    streakResult.penaltyApplied = penaltyAmount > 0;
    streakResult.penaltyAmount = penaltyAmount;
    
    console.log(`[STREAK] 💔 Streak lost! Applied ${STREAK_CONFIG.PENALTY_PERCENT}% penalty: -${penaltyAmount} points (${data.totalWorkPoints} → ${updatedData.totalWorkPoints})`);
  } else {
    // User failed to maintain streak but had no existing streak - keep at 0
    updatedData.currentStreak = 0;
    updatedData.lastStreakDate = '';
    console.log(`[STREAK] ⭕ No streak to maintain - staying at 0 (earned ${yesterdayPoints} points, needed ${STREAK_CONFIG.RETENTION_POINTS})`);
  }
  
  return { updatedData, streakResult };
}

/**
 * Check if daily reset is needed and perform sync before reset
 * Now includes streak checking and penalty application
 */
export async function checkAndSyncDailyReset(
  userId: string,
  data: WorkPointsStorage
): Promise<{ 
  shouldReset: boolean; 
  syncResult?: WorkPointsSyncResponse;
  streakResult?: {
    streakMaintained: boolean;
    streakLost: boolean;
    penaltyApplied: boolean;
    penaltyAmount?: number;
  };
  updatedData?: WorkPointsStorage;
}> {
  const lastActivityDate = new Date(data.lastActivity).toDateString();
  const today = new Date().toDateString();

  console.log("checking for daily reset", { lastActivityDate, today });

  if (lastActivityDate !== today) {
    // Different day detected - check streak and apply penalties first
    const { updatedData, streakResult } = checkStreakAndApplyPenalty(data);
    
    // Then sync if there's accumulated work
    if (data.millisecondsAccumulated > 0) {
      const workPoints = calculatePointsFromMilliseconds(data.millisecondsAccumulated);
      const yesterdayDate = new Date(data.lastActivity).toISOString().split('T')[0];
      
      console.log(`[DAILY-BOUNDARY-SYNC] 📅 Daily reset detected, syncing ${workPoints} points for ${yesterdayDate}`);
      
      try {
        const syncResult = await syncWorkPoints(yesterdayDate, workPoints);
        
        if (syncResult.success) {
          console.log(`[DAILY-BOUNDARY-SYNC] ✅ Daily boundary sync successful for ${yesterdayDate}`);
        } else {
          console.warn(`[DAILY-BOUNDARY-SYNC] ⚠️ Daily boundary sync failed for ${yesterdayDate}:`, syncResult.message);
        }
        
        return { shouldReset: true, syncResult, streakResult, updatedData };
      } catch (error) {
        console.error(`[DAILY-BOUNDARY-SYNC] ❌ Daily boundary sync error for ${yesterdayDate}:`, error);
        
        const errorResult: WorkPointsSyncResponse = {
          success: false,
          message: `Daily sync error: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
        
        // Still reset even if sync fails to prevent stuck state
        return { shouldReset: true, syncResult: errorResult, streakResult, updatedData };
      }
    } else {
      // No work points to sync, but still check streak
      console.log(`[DAILY-BOUNDARY-SYNC] 📅 Daily reset detected, no work points to sync`);
      return { shouldReset: true, streakResult, updatedData };
    }
  }
  
  // Same day, no reset needed
  return { shouldReset: false };
}
