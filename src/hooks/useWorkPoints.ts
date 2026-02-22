import { useEffect, useCallback, useRef, useReducer } from 'react';
import { useLocation } from 'react-router-dom';
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
  liveSeconds: number; // Real-time seconds counter (0-59), driven by timer
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
  progressToNextPoint: number; // 0-100 percentage toward earning next point
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
}

// Action types for reducer
type WorkPointsAction =
  | { type: 'LOAD_DATA'; payload: Omit<WorkPointsState, 'isActive' | 'isAnimating' | 'isSyncing' | 'lastSyncResult'> }
  | { type: 'TICK'; payload: { newMilliseconds: number; newMinutes: number; newAccumulativePoints: number } }
  | { type: 'REFRESH_ACTIVE'; payload: { now: Date } }
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
    case 'TICK':
      return {
        ...state,
        todaysWorkPointsMilli: action.payload.newMilliseconds,
        todaysWorkPointsMinutes: action.payload.newMinutes,
        accumulativeWorkPoints: action.payload.newAccumulativePoints
      };
    case 'REFRESH_ACTIVE':
      return {
        ...state,
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
        todaysWorkPointsMilli: 0,
        todaysWorkPointsMinutes: 0,
        lastActivity: null,
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
    todaysWorkPointsMilli: 0,
    todaysWorkPointsMinutes: 0,
    accumulativeWorkPoints: 0,
    lastActivity: null,
    isActive: false,
    isAnimating: false,
    currentStreak: 0,
    longestStreak: 0,
    isSyncing: false,
    lastSyncResult: null
  });
  
  // Derived state
  const isEligiblePage: boolean = WORK_POINTS_ELIGIBLE_PAGES.includes(location.pathname);
  
  // Calculate total study time including today's partial progress
  const totalStudyTimeMinutes: number = state.accumulativeWorkPoints + Math.floor(state.todaysWorkPointsMilli / 60000);
  
  // Live seconds counter derived directly from accumulated milliseconds
  const liveSeconds: number = Math.floor((state.todaysWorkPointsMilli % 60000) / 1000);
  
  // Progress to next point derived directly from accumulated milliseconds
  const progressToNextPoint: number = (state.todaysWorkPointsMilli % WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT) / 
                                       WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT * 100;
  
  // Refs for cleanup and state access
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const saveCounterRef = useRef<number>(0); // Count ticks for logging
  
  // Refs to access current state in callbacks (avoid stale closures)
  const stateRef = useRef(state);
  const userIdRef = useRef(user?.id);
  const isEligiblePageRef = useRef(isEligiblePage);
  
  // Streak derived state
  const streakGoalProgress: number = Math.min(state.todaysWorkPointsMinutes / STREAK_CONFIG.RETENTION_POINTS, 1);
  const hasMetStreakGoalToday: boolean = state.todaysWorkPointsMinutes >= STREAK_CONFIG.RETENTION_POINTS;
  
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

  // Watch todaysWorkPointsMinutes to trigger re-renders when work points are earned
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[WORK POINTS] Minutes updated:', state.todaysWorkPointsMinutes);
    }
  }, [state.todaysWorkPointsMinutes]);

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
        const dataToUse = resetCheck.updatedData || originalData;
        const accumulativePoints: number = serverTotalWorkPoints !== null ? serverTotalWorkPoints : dataToUse.totalWorkPoints;
        const freshData: WorkPointsStorage = {
          todaysWorkPointsMilli: 0,
          totalWorkPoints: accumulativePoints,
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
            accumulativeWorkPoints: accumulativePoints,
            lastActivity: new Date(),
            currentStreak: dataToUse.currentStreak,
            longestStreak: dataToUse.longestStreak
          }
        });
      } else {
        const accumulativePoints: number = serverTotalWorkPoints !== null ? serverTotalWorkPoints : originalData.totalWorkPoints;
        
        dispatch({
          type: 'LOAD_DATA',
          payload: {
            todaysWorkPointsMilli: originalData.todaysWorkPointsMilli,
            todaysWorkPointsMinutes: calculatePointsFromMilliseconds(originalData.todaysWorkPointsMilli),
            accumulativeWorkPoints: accumulativePoints,
            lastActivity: new Date(originalData.lastActivity),
            currentStreak: originalData.currentStreak || 0,
            longestStreak: originalData.longestStreak || 0
          }
        });
      }
    };
    
    loadDataWithDailyCheck();
  }, [user?.id]);
  
  // ===== CORE: Live 1-second accumulation timer =====
  // This timer drives ALL time accumulation, point increments, saves, and UI updates.
  // It only accumulates when the user is active AND on an eligible page.
  useEffect(() => {
    // Clear any existing interval
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    
    // Only run the timer when active and on an eligible page with a user
    if (!state.isActive || !isEligiblePage || !user?.id) {
      return;
    }
    
    saveCounterRef.current = 0;
    
    tickIntervalRef.current = setInterval(() => {
      const currentState = stateRef.current;
      const currentUserId = userIdRef.current;
      const currentIsEligible = isEligiblePageRef.current;
      
      // Guard: only accumulate when active and eligible
      if (!currentState.isActive || !currentIsEligible || !currentUserId) {
        return;
      }
      
      // Add 1 second (1000ms) of study time
      const newTotal: number = currentState.todaysWorkPointsMilli + 1000;
      const oldPoints: number = currentState.todaysWorkPointsMinutes;
      const newPoints: number = calculatePointsFromMilliseconds(newTotal);
      const pointsEarned: number = newPoints - oldPoints;
      const newAccumulativePoints: number = currentState.accumulativeWorkPoints + pointsEarned;
      
      // Dispatch tick to update state
      dispatch({
        type: 'TICK',
        payload: {
          newMilliseconds: newTotal,
          newMinutes: newPoints,
          newAccumulativePoints: newAccumulativePoints
        }
      });
      
      // Update ref immediately to prevent stale reads on next tick
      stateRef.current = {
        ...currentState,
        todaysWorkPointsMilli: newTotal,
        todaysWorkPointsMinutes: newPoints,
        accumulativeWorkPoints: newAccumulativePoints
      };
      
      // Log every 5 seconds in development
      if (process.env.NODE_ENV === 'development') {
        saveCounterRef.current += 1;
        if (saveCounterRef.current % 5 === 0) {
          const currentProgress: number = (newTotal % WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT) / WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT * 100;
          const secondsAccumulated: number = Math.floor((newTotal % WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT) / 1000);
          console.log(
            `[WORK POINTS] ⚡ Timer tick: ${newTotal}ms total, ` +
            `${currentProgress.toFixed(1)}% progress, ${secondsAccumulated}s accumulated`
          );
        }
      }
      
      // Handle point earned
      if (pointsEarned > 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `[WORK POINTS] 🔥 Point earned! Total: ${newPoints} points ` +
            `(${newTotal}ms accumulated, ${pointsEarned} points earned)`
          );
        }
        
        // Trigger animation
        dispatch({ type: 'START_ANIMATION' });
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }
        animationTimeoutRef.current = setTimeout(() => {
          dispatch({ type: 'STOP_ANIMATION' });
        }, WORK_POINTS_CONFIG.ANIMATION_DURATION_MS);
        
        // Increment work point on server
        const todayDate: string = new Date().toISOString().split('T')[0];
        incrementWorkPoint(todayDate).then((result) => {
          if (result.success && result.workPointsAdded) {
            if (process.env.NODE_ENV === 'development') {
              console.log('[WORK POINTS] Server increment successful:', result);
            }
          } else {
            if (process.env.NODE_ENV === 'development') {
              console.log('[WORK POINTS] Server increment failed (will retry later):', result.message);
            }
          }
        }).catch((error) => {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[WORK POINTS] Increment network error:', error);
          }
        });
      }
      
      // Save to localStorage every tick (every second)
      const data: WorkPointsStorage = {
        todaysWorkPointsMilli: newTotal,
        totalWorkPoints: newAccumulativePoints,
        lastActivity: new Date().toISOString(),
        currentStreak: currentState.currentStreak,
        longestStreak: currentState.longestStreak,
        lastStreakDate: ''
      };
      saveWorkPointsData(currentUserId, data);
    }, 1000);
    
    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
    };
  }, [state.isActive, isEligiblePage, user?.id]);
  
  // ===== recordActivity: ONLY refreshes active state =====
  // User activity just resets the inactivity timeout. No time accumulation here.
  const recordActivity = useCallback(() => {
    const currentUserId = userIdRef.current;
    const currentIsEligiblePage = isEligiblePageRef.current;
    
    if (!currentUserId || !currentIsEligiblePage) {
      return;
    }
    
    const now = new Date();
    
    // Refresh active state
    dispatch({ type: 'REFRESH_ACTIVE', payload: { now } });
    
    // Update ref immediately
    stateRef.current = {
      ...stateRef.current,
      lastActivity: now,
      isActive: true
    };
    
    // Reset inactivity timeout
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }
    
    activityTimeoutRef.current = setTimeout(() => {
      const currentState = stateRef.current;
      const userId = userIdRef.current;
      
      // Save current state before going inactive
      if (userId) {
        const data: WorkPointsStorage = {
          todaysWorkPointsMilli: currentState.todaysWorkPointsMilli,
          totalWorkPoints: currentState.accumulativeWorkPoints,
          lastActivity: new Date().toISOString(),
          currentStreak: currentState.currentStreak,
          longestStreak: currentState.longestStreak,
          lastStreakDate: ''
        };
        saveWorkPointsData(userId, data);
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[WORK POINTS] ⏸ Going inactive, saved state:', {
            todaysWorkPointsMilli: currentState.todaysWorkPointsMilli,
            seconds: Math.floor((currentState.todaysWorkPointsMilli % 60000) / 1000)
          });
        }
      }
      
      dispatch({ type: 'SET_ACTIVE', payload: false });
    }, WORK_POINTS_CONFIG.ACTIVITY_TIMEOUT_MS);
  }, []);
  
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
  
  // Save state on browser close/refresh and cleanup timeouts on unmount
  useEffect(() => {
    const handleBeforeUnload = () => {
      const currentState = stateRef.current;
      const userId = userIdRef.current;
      
      if (userId) {
        // Save current accumulated state as-is (no elapsed time to capture — timer already accumulated it)
        const data: WorkPointsStorage = {
          todaysWorkPointsMilli: currentState.todaysWorkPointsMilli,
          totalWorkPoints: currentState.accumulativeWorkPoints,
          lastActivity: new Date().toISOString(),
          currentStreak: currentState.currentStreak,
          longestStreak: currentState.longestStreak,
          lastStreakDate: ''
        };
        saveWorkPointsData(userId, data);
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
      }
    };
  }, []);
  
  // Save and deactivate when leaving eligible pages
  useEffect(() => {
    if (!isEligiblePage) {
      const currentState = stateRef.current;
      const userId = userIdRef.current;
      
      // Save current state before deactivating
      if (currentState.isActive && userId) {
        const data: WorkPointsStorage = {
          todaysWorkPointsMilli: currentState.todaysWorkPointsMilli,
          totalWorkPoints: currentState.accumulativeWorkPoints,
          lastActivity: new Date().toISOString(),
          currentStreak: currentState.currentStreak,
          longestStreak: currentState.longestStreak,
          lastStreakDate: ''
        };
        saveWorkPointsData(userId, data);
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[WORK POINTS] 📦 Saved state before leaving eligible page:', {
            todaysWorkPointsMilli: currentState.todaysWorkPointsMilli,
            seconds: Math.floor((currentState.todaysWorkPointsMilli % 60000) / 1000)
          });
        }
      }
      
      dispatch({ type: 'SET_ACTIVE', payload: false });
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
    }
  }, [isEligiblePage, location.pathname]);
  
  // Set up activity detection — this is what makes recordActivity fire on user interaction
  useActivityDetection({
    onActivity: () => recordActivityRef.current(),
    isEnabled: isEligiblePage && !!user?.id
  });
  
  return {
    currentPoints: state.todaysWorkPointsMinutes,
    accumulativeWorkPoints: state.accumulativeWorkPoints,
    totalStudyTimeMinutes,
    todaysWorkPointsMilli: state.todaysWorkPointsMilli,
    liveSeconds,
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
    // Progress to next point (updates every 1s tick)
    progressToNextPoint
  };
};
