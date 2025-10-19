import { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { useLocation } from 'react-router-dom';
import { throttle, debounce } from 'lodash';
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
import { syncWorkPoints, type WorkPointsSyncResponse } from '../utils/workPointsSync';

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

// State type for reducer
interface WorkPointsState {
  millisecondsAccumulated: number;
  totalWorkPoints: number;
  lastActivity: Date | null;
  isActive: boolean;
  isAnimating: boolean;
  currentStreak: number;
  longestStreak: number;
  isSyncing: boolean;
  lastSyncResult: WorkPointsSyncResponse | null;
}

// Action types for reducer
type WorkPointsAction =
  | { type: 'LOAD_DATA'; payload: Omit<WorkPointsState, 'isActive' | 'isAnimating' | 'isSyncing' | 'lastSyncResult'> }
  | { type: 'RECORD_ACTIVITY'; payload: { newMilliseconds: number; newTotalPoints: number; now: Date } }
  | { type: 'START_ANIMATION' }
  | { type: 'STOP_ANIMATION' }
  | { type: 'SET_ACTIVE'; payload: boolean }
  | { type: 'SET_SYNCING'; payload: boolean }
  | { type: 'SET_SYNC_RESULT'; payload: WorkPointsSyncResponse | null }
  | { type: 'RESET' };

// Reducer function
const workPointsReducer = (state: WorkPointsState, action: WorkPointsAction): WorkPointsState => {
  switch (action.type) {
    case 'LOAD_DATA':
      return {
        ...state,
        ...action.payload
      };
    case 'RECORD_ACTIVITY':
      return {
        ...state,
        millisecondsAccumulated: action.payload.newMilliseconds,
        totalWorkPoints: action.payload.newTotalPoints,
        lastActivity: action.payload.now,
        isActive: true
      };
    case 'START_ANIMATION':
      return {
        ...state,
        isAnimating: true
      };
    case 'STOP_ANIMATION':
      return {
        ...state,
        isAnimating: false
      };
    case 'SET_ACTIVE':
      return {
        ...state,
        isActive: action.payload
      };
    case 'SET_SYNCING':
      return {
        ...state,
        isSyncing: action.payload
      };
    case 'SET_SYNC_RESULT':
      return {
        ...state,
        lastSyncResult: action.payload
      };
    case 'RESET':
      return {
        ...state,
        millisecondsAccumulated: 0,
        lastActivity: new Date(),
        isActive: false,
        isAnimating: false
      };
    default:
      return state;
  }
};

export const useWorkPoints = (): UseWorkPointsReturn => {
  const { user } = useAuth();
  const location = useLocation();
  
  // Use reducer for consolidated state management
  const [state, dispatch] = useReducer(workPointsReducer, {
    millisecondsAccumulated: 0,
    totalWorkPoints: 0,
    lastActivity: null,
    isActive: false,
    isAnimating: false,
    currentStreak: 0,
    longestStreak: 0,
    isSyncing: false,
    lastSyncResult: null
  });
  
  // Refs for cleanup
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Derived state
  const currentPoints = calculatePointsFromMilliseconds(state.millisecondsAccumulated);
  const isEligiblePage = WORK_POINTS_ELIGIBLE_PAGES.includes(location.pathname);
  
  // Streak derived state
  const streakGoalProgress = Math.min(currentPoints / STREAK_CONFIG.RETENTION_POINTS, 1);
  const hasMetStreakGoalToday = currentPoints >= STREAK_CONFIG.RETENTION_POINTS;

  // Debounced save function - saves to localStorage after user stops activity
  const debouncedSave = useRef(
    debounce((userId: string, data: WorkPointsStorage) => {
      if (process.env.NODE_ENV === 'development') {
        console.log("[SAVE WORK POINTS] Saving data (debounced):", { 
          millisecondsAccumulated: data.millisecondsAccumulated, 
          totalWorkPoints: data.totalWorkPoints 
        });
      }
      saveWorkPointsData(userId, data);
    }, 2000)
  ).current;

  // Immediate save function - for when points increment
  const saveImmediately = useCallback((userId: string, data: WorkPointsStorage) => {
    if (process.env.NODE_ENV === 'development') {
      console.log("[SAVE WORK POINTS] Saving data (immediate):", { 
        millisecondsAccumulated: data.millisecondsAccumulated, 
        totalWorkPoints: data.totalWorkPoints 
      });
    }
    saveWorkPointsData(userId, data);
  }, []);

  // Load initial data when user changes and check for daily boundary sync
  useEffect(() => {
    if (!user?.id) {
      dispatch({
        type: 'LOAD_DATA',
        payload: {
          millisecondsAccumulated: 0,
          totalWorkPoints: 0,
          lastActivity: null,
          currentStreak: 0,
          longestStreak: 0
        }
      });
      return;
    }
    
    const loadDataWithDailyCheck = async () => {
      // Fetch total work points from server
      try {
        const response = await fetch(`${window.location.origin}/api/users/${user.id}/total-work-points`, {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          if (process.env.NODE_ENV === 'development') {
            console.log('[WORK POINTS] Fetched total work points from server:', data.totalWorkPoints);
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[WORK POINTS] Failed to fetch total work points from server, using localStorage:', error);
        }
      }
      
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
        dispatch({ type: 'SET_SYNC_RESULT', payload: resetCheck.syncResult });
        dispatch({ type: 'SET_SYNCING', payload: false });
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
        
        dispatch({
          type: 'LOAD_DATA',
          payload: {
            millisecondsAccumulated: 0,
            totalWorkPoints: dataToUse.totalWorkPoints,
            lastActivity: new Date(),
            currentStreak: dataToUse.currentStreak,
            longestStreak: dataToUse.longestStreak
          }
        });
      } else {
        // No reset needed, use existing data
        dispatch({
          type: 'LOAD_DATA',
          payload: {
            millisecondsAccumulated: originalData.millisecondsAccumulated,
            totalWorkPoints: originalData.totalWorkPoints,
            lastActivity: new Date(originalData.lastActivity),
            currentStreak: originalData.currentStreak || 0,
            longestStreak: originalData.longestStreak || 0
          }
        });
      }
    };
    
    loadDataWithDailyCheck();
  }, [user?.id]);
  
  // Record user activity - throttled to prevent excessive calls
  const recordActivityInternal = useCallback(() => {
    if (!user?.id || !isEligiblePage) return;
    
    const now = new Date();
    const nowTime = now.getTime();
    const lastActivityTime = state.lastActivity?.getTime() || 0;
    
    // Check if within activity window (15 seconds)
    if (nowTime - lastActivityTime <= WORK_POINTS_CONFIG.ACTIVITY_WINDOW_MS) {
      const timeToAdd = nowTime - lastActivityTime;
      const newTotal = state.millisecondsAccumulated + timeToAdd;
      const oldPoints = calculatePointsFromMilliseconds(state.millisecondsAccumulated);
      const newPoints = calculatePointsFromMilliseconds(newTotal);
      
      const pointsEarned = newPoints - oldPoints;
      const newTotalPoints = state.totalWorkPoints + pointsEarned;
      
      // Update state in one dispatch
      dispatch({
        type: 'RECORD_ACTIVITY',
        payload: {
          newMilliseconds: newTotal,
          newTotalPoints: newTotalPoints,
          now: now
        }
      });
      
      // Trigger animation if points increased
      if (newPoints > oldPoints) {
        dispatch({ type: 'START_ANIMATION' });
        
        // Clear existing animation timeout
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }
        
        // Set new animation timeout
        animationTimeoutRef.current = setTimeout(() => {
          dispatch({ type: 'STOP_ANIMATION' });
        }, WORK_POINTS_CONFIG.ANIMATION_DURATION_MS);
        
        // Sync to server on every point earned (fire-and-forget)
        if (user?.id) {
          syncWorkPoints(
            new Date().toISOString().split('T')[0],
            newPoints
          ).catch(() => {
            // Silently fail, daily boundary sync will catch up
          });
        }
        
        // Save immediately when points increment
        const data: WorkPointsStorage = {
          millisecondsAccumulated: newTotal,
          totalWorkPoints: newTotalPoints,
          lastActivity: now.toISOString(),
          currentStreak: state.currentStreak,
          longestStreak: state.longestStreak,
          lastStreakDate: ''
        };
        saveImmediately(user.id, data);
      } else {
        // Debounce saves when no point increment
        const data: WorkPointsStorage = {
          millisecondsAccumulated: newTotal,
          totalWorkPoints: newTotalPoints,
          lastActivity: now.toISOString(),
          currentStreak: state.currentStreak,
          longestStreak: state.longestStreak,
          lastStreakDate: ''
        };
        debouncedSave(user.id, data);
      }
    }
    
    // Set user as inactive after timeout
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }
    
    activityTimeoutRef.current = setTimeout(() => {
      dispatch({ type: 'SET_ACTIVE', payload: false });
    }, WORK_POINTS_CONFIG.ACTIVITY_TIMEOUT_MS);
  }, [user?.id, isEligiblePage, state.millisecondsAccumulated, state.lastActivity, state.totalWorkPoints, state.currentStreak, state.longestStreak, debouncedSave, saveImmediately]);
  
  // Throttled version of recordActivity - only runs once every 2 seconds
  const recordActivity = useRef(
    throttle(recordActivityInternal, 2000, { leading: true, trailing: false })
  ).current;
  
  // Reset points (for testing/debugging)
  const resetPoints = useCallback(() => {
    if (!user?.id) return;
    
    dispatch({ type: 'RESET' });
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
      // Cancel pending debounced saves
      debouncedSave.cancel();
      recordActivity.cancel();
    };
  }, [debouncedSave, recordActivity]);
  
  // Reset active state when leaving eligible page
  useEffect(() => {
    if (!isEligiblePage) {
      dispatch({ type: 'SET_ACTIVE', payload: false });
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
    totalWorkPoints: state.totalWorkPoints,
    millisecondsAccumulated: state.millisecondsAccumulated,
    isActive: state.isActive,
    isAnimating: state.isAnimating,
    isEligiblePage,
    isSyncing: state.isSyncing,
    lastSyncResult: state.lastSyncResult,
    recordActivity,
    resetPoints,
    // Streak properties
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    streakGoalProgress,
    hasMetStreakGoalToday
  };
};
