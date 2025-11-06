import { useEffect, useCallback, useRef, useReducer } from 'react';
import { useLocation } from 'react-router-dom';
import { throttle, debounce } from 'lodash';
import { useAuth } from '../AuthContext';
import { 
  saveWorkPointsData, 
  clearWorkPointsData, 
  calculatePointsFromMilliseconds,
  type WorkPointsStorage
} from '../utils/workPointsStorage';
import { WORK_POINTS_ELIGIBLE_PAGES, WORK_POINTS_CONFIG, STREAK_CONFIG } from '../constants';
import { useActivityDetection } from './useActivityDetection';
import { checkAndSyncDailyReset } from '../utils/dailyBoundarySync';
import { incrementWorkPoint, type WorkPointsSyncResponse } from '../utils/workPointsSync';

export interface UseWorkPointsReturn {
  currentPoints: number;
  accumulativeWorkPoints: number;
  totalStudyTimeMinutes: number;
  todaysWorkPointsMilli: number;
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
  // Progress to next point
  progressToNextPoint: number; // 0-100 percentage toward earning next point (animated in real-time)
}

// State type for reducer
interface WorkPointsState {
  todaysWorkPointsMilli: number;
  todaysWorkPointsMinutes: number; // Calculated minutes - triggers re-renders when points earned
  accumulativeWorkPoints: number;
  lastActivity: Date | null;
  isActive: boolean;
  isAnimating: boolean;
  currentStreak: number;
  longestStreak: number;
  isSyncing: boolean;
  lastSyncResult: WorkPointsSyncResponse | null;
  isFirstActivityOnPage: boolean;
  animatedProgress: number; // 0-100 for smooth real-time animation
}

// Action types for reducer
type WorkPointsAction =
  | { type: 'LOAD_DATA'; payload: Omit<WorkPointsState, 'isActive' | 'isAnimating' | 'isSyncing' | 'lastSyncResult' | 'isFirstActivityOnPage' | 'animatedProgress'> }
  | { type: 'RECORD_ACTIVITY'; payload: { newMilliseconds: number; newMinutes: number; newAccumulativePoints: number; now: Date } }
  | { type: 'START_ANIMATION' }
  | { type: 'STOP_ANIMATION' }
  | { type: 'SET_ACTIVE'; payload: boolean }
  | { type: 'SET_SYNCING'; payload: boolean }
  | { type: 'SET_SYNC_RESULT'; payload: WorkPointsSyncResponse | null }
  | { type: 'SET_ANIMATED_PROGRESS'; payload: number }
  | { type: 'SET_FIRST_ACTIVITY_FLAG'; payload: boolean }
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
        todaysWorkPointsMilli: action.payload.newMilliseconds,
        todaysWorkPointsMinutes: action.payload.newMinutes,
        accumulativeWorkPoints: action.payload.newAccumulativePoints,
        lastActivity: action.payload.now,
        isActive: true,
        isFirstActivityOnPage: false // Clear flag after first activity
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
    case 'SET_ANIMATED_PROGRESS':
      return {
        ...state,
        animatedProgress: action.payload
      };
    case 'SET_FIRST_ACTIVITY_FLAG':
      return {
        ...state,
        isFirstActivityOnPage: action.payload
      };
    case 'RESET':
      return {
        ...state,
        todaysWorkPointsMilli: 0,
        todaysWorkPointsMinutes: 0,
        lastActivity: new Date(),
        isActive: false,
        isAnimating: false,
        isFirstActivityOnPage: true
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
    todaysWorkPointsMilli: 0,
    todaysWorkPointsMinutes: 0,
    accumulativeWorkPoints: 0,
    lastActivity: null,
    isActive: false,
    isAnimating: false,
    currentStreak: 0,
    longestStreak: 0,
    isSyncing: false,
    lastSyncResult: null,
    isFirstActivityOnPage: true, // First activity on page should award 0 points
    animatedProgress: 0
  });
  
  // Derived state (must come before refs that use them)
  const isEligiblePage = WORK_POINTS_ELIGIBLE_PAGES.includes(location.pathname);
  
  // Calculate total study time including today's partial progress
  const totalStudyTimeMinutes = state.accumulativeWorkPoints + Math.floor(state.todaysWorkPointsMilli / 60000);
  
  // Refs for cleanup and state access
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Refs to access current state in throttled function (avoid stale closures)
  const stateRef = useRef(state);
  const userIdRef = useRef(user?.id);
  const isEligiblePageRef = useRef(isEligiblePage);
  const locationRef = useRef(location);
  
  // Streak derived state
  const streakGoalProgress = Math.min(state.todaysWorkPointsMinutes / STREAK_CONFIG.RETENTION_POINTS, 1);
  const hasMetStreakGoalToday = state.todaysWorkPointsMinutes >= STREAK_CONFIG.RETENTION_POINTS;
  
  // Update refs whenever values change
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);
  
  useEffect(() => {
    isEligiblePageRef.current = isEligiblePage;
  }, [isEligiblePage]);
  
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // Watch todaysWorkPointsMinutes to trigger re-renders when work points are earned
  // This ensures the WorkPointsBadge and other components update immediately
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[WORK POINTS] Minutes updated:', state.todaysWorkPointsMinutes);
    }
  }, [state.todaysWorkPointsMinutes]);

  // Real-time animated progress using requestAnimationFrame
  useEffect(() => {
    if (!state.isActive) {
      // When inactive, show progress based only on accumulated time
      // This ensures the progress bar shows exactly where the user left off
      const staticProgress = (state.todaysWorkPointsMilli % WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT) / 
                             WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT * 100;
      dispatch({ type: 'SET_ANIMATED_PROGRESS', payload: staticProgress });
      return;
    }

    let animationFrameId: number;
    
    const animate = () => {
      if (!stateRef.current.isActive || !stateRef.current.lastActivity) {
        return;
      }

      const now = Date.now();
      const lastActivityTime = stateRef.current.lastActivity.getTime();
      const elapsedSinceLastActivity = now - lastActivityTime;
      
      // Cap elapsed time at ACTIVITY_TIMEOUT_MS for visual consistency
      const cappedElapsed = Math.min(elapsedSinceLastActivity, WORK_POINTS_CONFIG.ACTIVITY_TIMEOUT_MS);
      
      // Calculate total milliseconds including elapsed time
      const totalMs = stateRef.current.todaysWorkPointsMilli + cappedElapsed;
      
      // Calculate progress (0-100) for one full revolution = MILLISECONDS_PER_POINT
      const progress = (totalMs % WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT) / 
                       WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT * 100;
      
      dispatch({ type: 'SET_ANIMATED_PROGRESS', payload: progress });
      
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [state.isActive, state.todaysWorkPointsMilli, state.lastActivity]);

  // Debounced save function - saves to localStorage after user stops activity
  const debouncedSave = useRef(
    debounce((userId: string, data: WorkPointsStorage) => {
      if (process.env.NODE_ENV === 'development') {
        console.log("[SAVE WORK POINTS] Saving data (debounced):", { 
          todaysWorkPointsMilli: data.todaysWorkPointsMilli, 
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
        todaysWorkPointsMilli: data.todaysWorkPointsMilli, 
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
            todaysWorkPointsMilli: 0,
            todaysWorkPointsMinutes: 0,
            accumulativeWorkPoints: 0,
            lastActivity: null,
            currentStreak: 0,
            longestStreak: 0
          }
        });
      return;
    }
    
    const loadDataWithDailyCheck = async () => {
      // Fetch total work points from server
      let serverTotalWorkPoints: number | null = null;
      try {
        const response = await fetch(`${window.location.origin}/api/users/${user.id}/total-work-points`, {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          serverTotalWorkPoints = data.totalWorkPoints;
          if (process.env.NODE_ENV === 'development') {
            console.log('[WORK POINTS] Fetched accumulative work points from server:', serverTotalWorkPoints);
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[WORK POINTS] Failed to fetch total work points from server, will fall back to localStorage:', error);
        }
      }
      
      // Load ORIGINAL unreset data first - this is crucial for streak checking
      const key = `workPoints_${user.id}`;
      const stored = localStorage.getItem(key);
      
      let originalData: WorkPointsStorage;
      if (!stored) {
        originalData = {
          todaysWorkPointsMilli: 0,
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
            todaysWorkPointsMilli: 0,
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
        // Use server value if available, otherwise fall back to stored value
        const accumulativePoints = serverTotalWorkPoints !== null ? serverTotalWorkPoints : dataToUse.totalWorkPoints;
        const freshData: WorkPointsStorage = {
          todaysWorkPointsMilli: 0,
          totalWorkPoints: accumulativePoints, // Use server value for storage too
          lastActivity: new Date().toISOString(),
          currentStreak: dataToUse.currentStreak,
          longestStreak: dataToUse.longestStreak,
          lastStreakDate: dataToUse.lastStreakDate
        };
        saveWorkPointsData(user.id, freshData);
        
        dispatch({
          type: 'LOAD_DATA',
          payload: {
            todaysWorkPointsMilli: 0,
            todaysWorkPointsMinutes: 0,
            accumulativeWorkPoints: accumulativePoints, // Use server value if available
            lastActivity: new Date(),
            currentStreak: dataToUse.currentStreak,
            longestStreak: dataToUse.longestStreak
          }
        });
      } else {
        // No reset needed, use server value if available, otherwise use existing data
        const accumulativePoints = serverTotalWorkPoints !== null ? serverTotalWorkPoints : originalData.totalWorkPoints;
        
        dispatch({
          type: 'LOAD_DATA',
          payload: {
            todaysWorkPointsMilli: originalData.todaysWorkPointsMilli,
            todaysWorkPointsMinutes: calculatePointsFromMilliseconds(originalData.todaysWorkPointsMilli),
            accumulativeWorkPoints: accumulativePoints, // Use server value if available
            lastActivity: new Date(originalData.lastActivity),
            currentStreak: originalData.currentStreak || 0,
            longestStreak: originalData.longestStreak || 0
          }
        });
      }
    };
    
    loadDataWithDailyCheck();
  }, [user?.id]);
  
  // Record user activity - reads from refs to avoid stale closures
  const recordActivityInternal = useCallback(() => {
    // Read current values from refs
    const currentUserId = userIdRef.current;
    const currentIsEligiblePage = isEligiblePageRef.current;
    const currentState = stateRef.current;
    
    if (!currentUserId || !currentIsEligiblePage) {
      return;
    }
    
    const now = new Date();
    const nowTime = now.getTime();
    const lastActivityTime = currentState.lastActivity?.getTime() || 0;
    const timeSinceLastActivity = nowTime - lastActivityTime;
    
    // Handle first activity on page OR awakening from idle - only update baseline, no points awarded
    if (currentState.isFirstActivityOnPage || !currentState.isActive) {
      dispatch({
        type: 'RECORD_ACTIVITY',
        payload: {
          newMilliseconds: currentState.todaysWorkPointsMilli, // Keep current value
          newMinutes: currentState.todaysWorkPointsMinutes, // Keep current value
          newAccumulativePoints: currentState.accumulativeWorkPoints, // Keep current value
          now: now // Set baseline for future activities
        }
      });
      
      // Immediately update ref to prevent race conditions
      stateRef.current = {
        ...currentState,
        lastActivity: now,
        isActive: true,
        isFirstActivityOnPage: false
      };
    } else {
      // Subsequent activities: award time capped at ACTIVITY_TIMEOUT_MS
      const timeToAdd = Math.min(timeSinceLastActivity, WORK_POINTS_CONFIG.ACTIVITY_TIMEOUT_MS);
      const newTotal = currentState.todaysWorkPointsMilli + timeToAdd;
      const oldPoints = currentState.todaysWorkPointsMinutes;
      const newPoints = calculatePointsFromMilliseconds(newTotal);
      
      const pointsEarned = newPoints - oldPoints;
      const newAccumulativePoints = currentState.accumulativeWorkPoints + pointsEarned;
      
      // Update state in one dispatch
      dispatch({
        type: 'RECORD_ACTIVITY',
        payload: {
          newMilliseconds: newTotal,
          newMinutes: newPoints,
          newAccumulativePoints: newAccumulativePoints,
          now: now
        }
      });
      
      // Immediately update ref to prevent race conditions
      stateRef.current = {
        ...currentState,
        todaysWorkPointsMilli: newTotal,
        todaysWorkPointsMinutes: newPoints,
        accumulativeWorkPoints: newAccumulativePoints,
        lastActivity: now,
        isActive: true,
        isFirstActivityOnPage: false
      };
      
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
        
        // Increment work point on server (new secure endpoint)
        // This updates the server's totalWorkPoints immediately
        if (user?.id) {
          const todayDate = new Date().toISOString().split('T')[0];
          incrementWorkPoint(todayDate).then((result) => {
            if (result.success && result.workPointsAdded) {
              // Server successfully incremented - state already updated locally
              if (process.env.NODE_ENV === 'development') {
                console.log('[WORK POINTS] Server increment successful:', result);
              }
            } else {
              // Rate limited or other error - don't break the UI
              // The daily boundary sync will catch up later
              if (process.env.NODE_ENV === 'development') {
                console.log('[WORK POINTS] Server increment failed (will retry later):', result.message);
              }
            }
          }).catch((error) => {
            // Network error - silently fail, daily boundary sync will catch up
            if (process.env.NODE_ENV === 'development') {
              console.warn('[WORK POINTS] Increment network error:', error);
            }
          });
        }
        
        // Save immediately when points increment
        const data: WorkPointsStorage = {
          todaysWorkPointsMilli: newTotal,
          totalWorkPoints: newAccumulativePoints,
          lastActivity: now.toISOString(),
          currentStreak: currentState.currentStreak,
          longestStreak: currentState.longestStreak,
          lastStreakDate: ''
        };
        saveImmediately(currentUserId, data);
      } else {
        // Debounce saves when no point increment
        const data: WorkPointsStorage = {
          todaysWorkPointsMilli: newTotal,
          totalWorkPoints: newAccumulativePoints,
          lastActivity: now.toISOString(),
          currentStreak: currentState.currentStreak,
          longestStreak: currentState.longestStreak,
          lastStreakDate: ''
        };
        debouncedSave(currentUserId, data);
      }
    }
    
    // Set user as inactive after timeout
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }
    
    activityTimeoutRef.current = setTimeout(() => {
      // Before going inactive, capture the elapsed time and add it to accumulated
      // This prevents the progress bar from jumping back
      const currentState = stateRef.current;
      const userId = userIdRef.current;
      
      if (currentState.lastActivity && userId) {
        const now = Date.now();
        const lastActivityTime = currentState.lastActivity.getTime();
        const elapsedSinceLastActivity = now - lastActivityTime;
        const cappedElapsed = Math.min(elapsedSinceLastActivity, WORK_POINTS_CONFIG.ACTIVITY_TIMEOUT_MS);
        
        const newTotal = currentState.todaysWorkPointsMilli + cappedElapsed;
        const oldPoints = currentState.todaysWorkPointsMinutes;
        const newPoints = calculatePointsFromMilliseconds(newTotal);
        const pointsEarned = newPoints - oldPoints;
        const newAccumulativePoints = currentState.accumulativeWorkPoints + pointsEarned;
        
        // Update accumulated time before going inactive
        dispatch({
          type: 'RECORD_ACTIVITY',
          payload: {
            newMilliseconds: newTotal,
            newMinutes: newPoints,
            newAccumulativePoints: newAccumulativePoints,
            now: currentState.lastActivity // Keep the same lastActivity
          }
        });
        
        // Update ref immediately
        stateRef.current = {
          ...currentState,
          todaysWorkPointsMilli: newTotal,
          todaysWorkPointsMinutes: newPoints,
          accumulativeWorkPoints: newAccumulativePoints
        };
        
        // Save to localStorage
        const data: WorkPointsStorage = {
          todaysWorkPointsMilli: newTotal,
          totalWorkPoints: newAccumulativePoints,
          lastActivity: currentState.lastActivity.toISOString(),
          currentStreak: currentState.currentStreak,
          longestStreak: currentState.longestStreak,
          lastStreakDate: ''
        };
        saveWorkPointsData(userId, data);
      }
      
      // Now set inactive
      dispatch({ type: 'SET_ACTIVE', payload: false });
    }, WORK_POINTS_CONFIG.ACTIVITY_TIMEOUT_MS);
  }, [debouncedSave, saveImmediately, user?.id]);
  
  // Throttled version of recordActivity - only runs once every 2 seconds
  const throttledRecordActivity = throttle(recordActivityInternal, 2000, { leading: true, trailing: false });
  
  const recordActivity = useCallback(() => {
    throttledRecordActivity();
  }, [throttledRecordActivity]);
  
  const recordActivityRef = useRef(recordActivity);
  recordActivityRef.current = recordActivity;
  
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
  
  // Cleanup debounced/throttled functions when they change
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
      throttledRecordActivity.cancel();
    };
  }, [debouncedSave, throttledRecordActivity]);
  
  // Cleanup timeouts only on unmount
  useEffect(() => {
    return () => {
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []); // Empty dependency array = only runs on unmount
  
  // Reset active state and first activity flag when leaving/entering eligible pages
  useEffect(() => {
    if (!isEligiblePage) {
      dispatch({ type: 'SET_ACTIVE', payload: false });
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
    } else {
      // When entering an eligible page, reset the first activity flag
      dispatch({ type: 'SET_FIRST_ACTIVITY_FLAG', payload: true });
    }
  }, [isEligiblePage, location.pathname]);
  
  // Set up activity detection
  useActivityDetection({
    onActivity: () => recordActivityRef.current(),
    isEnabled: isEligiblePage && !!user?.id
  });
  
  return {
    currentPoints: state.todaysWorkPointsMinutes,
    accumulativeWorkPoints: state.accumulativeWorkPoints,
    totalStudyTimeMinutes,
    todaysWorkPointsMilli: state.todaysWorkPointsMilli,
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
    hasMetStreakGoalToday,
    // Progress to next point (animated in real-time)
    progressToNextPoint: state.animatedProgress
  };
};
