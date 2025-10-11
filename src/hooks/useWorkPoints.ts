import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { 
  saveWorkPointsData, 
  clearWorkPointsData, 
  calculatePointsFromMilliseconds,
  type WorkPointsStorage,
  loadWorkPointsDataSync
} from '../utils/workPointsStorage';
import { WORK_POINTS_ELIGIBLE_PAGES, WORK_POINTS_CONFIG, STREAK_CONFIG } from '../constants';
import { useActivityDetection } from './useActivityDetection';
import { checkAndSyncDailyReset } from '../utils/dailyBoundarySync';
import { type WorkPointsSyncResponse } from '../utils/workPointsSync';

export interface UseWorkPointsReturn {
  currentPoints: number;
  totalWorkPoints: number;
  millisecondsAccumulated: number;
  isActive: boolean;
  isAnimating: boolean;
  isEligiblePage: boolean;
  isSyncing: boolean;
  lastSyncResult: WorkPointsSyncResponse | null;
  recordActivity: () => void;
  resetPoints: () => void;
  // Streak properties
  currentStreak: number;
  longestStreak: number;
  streakGoalProgress: number; // Progress toward daily streak goal (0-1)
  hasMetStreakGoalToday: boolean;
}

export const useWorkPoints = (): UseWorkPointsReturn => {
  const { user } = useAuth();
  const location = useLocation();
  
  // Core state
  const [millisecondsAccumulated, setMillisecondsAccumulated] = useState(0);
  const [totalWorkPoints, setTotalWorkPoints] = useState(0);
  const [lastActivity, setLastActivity] = useState<Date | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  
  // Streak state
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  
  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<WorkPointsSyncResponse | null>(null);
  
  // Refs for cleanup
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Derived state
  const currentPoints = calculatePointsFromMilliseconds(millisecondsAccumulated);
  const isEligiblePage = WORK_POINTS_ELIGIBLE_PAGES.includes(location.pathname);
  
  // Streak derived state
  const streakGoalProgress = Math.min(currentPoints / STREAK_CONFIG.RETENTION_POINTS, 1);
  const hasMetStreakGoalToday = currentPoints >= STREAK_CONFIG.RETENTION_POINTS;

  // Load initial data when user changes and check for daily boundary sync
  useEffect(() => {
    if (!user?.id) {
      setMillisecondsAccumulated(0);
      setTotalWorkPoints(0);
      setLastActivity(null);
      return;
    }
    
    const loadDataWithDailyCheck = async () => {
      // Load ORIGINAL unreset data first - this is crucial for streak checking
      const key = `workPoints_${user.id}`;
      const stored = localStorage.getItem(key);
      
      let originalData: WorkPointsStorage;
      if (!stored) {
        originalData = {
          millisecondsAccumulated: 0,
          totalWorkPoints: 0,
          lastActivity: new Date().toISOString(),
          currentStreak: 0,
          longestStreak: 0,
          lastStreakDate: ''
        };
      } else {
        try {
          originalData = JSON.parse(stored) as WorkPointsStorage;
          // Handle backward compatibility
          if (typeof originalData.totalWorkPoints === 'undefined') {
            originalData.totalWorkPoints = 0;
          }
        } catch (error) {
          console.error('Error parsing work points data:', error);
          originalData = {
            millisecondsAccumulated: 0,
            totalWorkPoints: 0,
            lastActivity: new Date().toISOString(),
            currentStreak: 0,
            longestStreak: 0,
            lastStreakDate: ''
          };
        }
      }
      
      // Check if daily reset is needed using ORIGINAL data for streak checking
      const resetCheck = await checkAndSyncDailyReset(user.id, originalData);
      
      if (resetCheck.syncResult) {
        setLastSyncResult(resetCheck.syncResult);
        setIsSyncing(false); // Ensure sync state is cleared
      }
      
      if (resetCheck.shouldReset) {
        // Reset detected and sync completed, use updated data from streak check if available
        const dataToUse = resetCheck.updatedData || originalData;
        const freshData: WorkPointsStorage = {
          millisecondsAccumulated: 0,
          totalWorkPoints: dataToUse.totalWorkPoints, // May be reduced by penalty
          lastActivity: new Date().toISOString(),
          currentStreak: dataToUse.currentStreak,
          longestStreak: dataToUse.longestStreak,
          lastStreakDate: dataToUse.lastStreakDate
        };
        saveWorkPointsData(user.id, freshData);
        setMillisecondsAccumulated(0);
        setTotalWorkPoints(dataToUse.totalWorkPoints);
        setCurrentStreak(dataToUse.currentStreak);
        setLongestStreak(dataToUse.longestStreak);
        setLastActivity(new Date());
      } else {
        // No reset needed, use existing data
        setMillisecondsAccumulated(originalData.millisecondsAccumulated);
        setTotalWorkPoints(originalData.totalWorkPoints);
        setCurrentStreak(originalData.currentStreak || 0);
        setLongestStreak(originalData.longestStreak || 0);
        setLastActivity(new Date(originalData.lastActivity));
      }
    };
    
    loadDataWithDailyCheck();
  }, [user?.id]);
  
  // Save data to localStorage whenever it changes
  const saveData = useCallback((newMilliseconds: number, newLastActivity: Date) => {
    if (!user?.id) return;

    console.log("[SAVE WORK POINTS] Saving data:", {  newMilliseconds, totalWorkPoints });
    
    const data: WorkPointsStorage = {
      millisecondsAccumulated: newMilliseconds,
      totalWorkPoints: totalWorkPoints, // Preserve existing total
      lastActivity: newLastActivity.toISOString(),
      currentStreak: currentStreak,
      longestStreak: longestStreak,
      lastStreakDate: '' // Will be updated by streak logic
    };
    
    saveWorkPointsData(user.id, data);
  }, [user?.id, totalWorkPoints, currentStreak, longestStreak]);
  
  // Record user activity
  const recordActivity = useCallback(() => {
    if (!user?.id || !isEligiblePage) return;
    
    const now = new Date();
    const nowTime = now.getTime();
    const lastActivityTime = lastActivity?.getTime() || 0;
    
    // Check if within activity window (10 seconds)
    if (nowTime - lastActivityTime <= WORK_POINTS_CONFIG.ACTIVITY_WINDOW_MS) {
      const timeToAdd = nowTime - lastActivityTime;
      const newTotal = millisecondsAccumulated + timeToAdd;
      const oldPoints = calculatePointsFromMilliseconds(millisecondsAccumulated);
      const newPoints = calculatePointsFromMilliseconds(newTotal);
      
      // Update accumulated time
      setMillisecondsAccumulated(newTotal);
      
      // Trigger animation if points increased
      if (newPoints > oldPoints) {
        setIsAnimating(true);
        
        // Clear existing animation timeout
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }
        
        // Set new animation timeout
        animationTimeoutRef.current = setTimeout(() => {
          setIsAnimating(false);
        }, WORK_POINTS_CONFIG.ANIMATION_DURATION_MS);
      }
      
      // Save to localStorage
      saveData(newTotal, now);
    }
    
    // Update last activity time
    setLastActivity(now);
    setIsActive(true);
    
    // Clear existing activity timeout
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }
    
    // Set user as inactive after timeout
    activityTimeoutRef.current = setTimeout(() => {
      setIsActive(false);
    }, WORK_POINTS_CONFIG.ACTIVITY_TIMEOUT_MS);
  }, [user?.id, isEligiblePage, millisecondsAccumulated, lastActivity, saveData]);
  
  // Reset points (for testing/debugging)
  const resetPoints = useCallback(() => {
    if (!user?.id) return;
    
    setMillisecondsAccumulated(0);
    setLastActivity(new Date());
    setIsActive(false);
    setIsAnimating(false);
    
    clearWorkPointsData(user.id);
    
    // Clear timeouts
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }
  }, [user?.id]);
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);
  
  // Reset active state when leaving eligible page
  useEffect(() => {
    if (!isEligiblePage) {
      setIsActive(false);
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
    }
  }, [isEligiblePage]);
  
  // Set up activity detection
  useActivityDetection({
    onActivity: recordActivity,
    isEnabled: isEligiblePage && !!user?.id
  });
  
  return {
    currentPoints,
    totalWorkPoints,
    millisecondsAccumulated,
    isActive,
    isAnimating,
    isEligiblePage,
    isSyncing,
    lastSyncResult,
    recordActivity,
    resetPoints,
    // Streak properties
    currentStreak,
    longestStreak,
    streakGoalProgress,
    hasMetStreakGoalToday
  };
};
