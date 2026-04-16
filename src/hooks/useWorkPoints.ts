import { useEffect, useCallback, useRef, useReducer } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  saveWorkPointsData,
  clearWorkPointsData,
  calculatePointsFromMilliseconds,
  loadWorkPointsDataSync,
  type WorkPointsStorage
} from '../utils/workPointsStorage';
import { WORK_POINTS_ELIGIBLE_PAGES, WORK_POINTS_CONFIG, STREAK_CONFIG } from '../constants';
import { useActivityDetection } from './useActivityDetection';
import { checkAndSyncDailyReset } from '../utils/dailyBoundarySync';
import { incrementWorkPoint } from '../utils/workPointsSync';

export interface UseWorkPointsReturn {
  currentPoints: number;
  accumulativeWorkPoints: number;
  totalStudyTimeMinutes: number;
  todaysWorkPointsMilli: number;
  liveSeconds: number;
  isActive: boolean;
  isAnimating: boolean;
  isEligiblePage: boolean;
  isSyncing: boolean;
  recordActivity: () => void;
  resetPoints: () => void;
  currentStreak: number;
  streakGoalProgress: number;
  hasMetStreakGoalToday: boolean;
  progressToNextPoint: number;
}

interface WorkPointsState {
  todaysWorkPointsMilli: number;
  todaysWorkPointsMinutes: number;
  accumulativeWorkPoints: number;
  lastActivity: Date | null;
  isActive: boolean;
  isAnimating: boolean;
  currentStreak: number;
  isSyncing: boolean;
}

type WorkPointsAction =
  | { type: 'LOAD_DATA'; payload: Omit<WorkPointsState, 'isActive' | 'isAnimating' | 'isSyncing'> }
  | { type: 'TICK'; payload: { newMilliseconds: number; newMinutes: number; newAccumulativePoints: number } }
  | { type: 'REFRESH_ACTIVE'; payload: { now: Date } }
  | { type: 'START_ANIMATION' }
  | { type: 'STOP_ANIMATION' }
  | { type: 'SET_ACTIVE'; payload: boolean }
  | { type: 'SET_SYNCING'; payload: boolean }
  | { type: 'SET_STREAK'; payload: number }
  | { type: 'RESET' };

const workPointsReducer = (state: WorkPointsState, action: WorkPointsAction): WorkPointsState => {
  switch (action.type) {
    case 'LOAD_DATA':
      return { ...state, ...action.payload };
    case 'TICK':
      return {
        ...state,
        todaysWorkPointsMilli: action.payload.newMilliseconds,
        todaysWorkPointsMinutes: action.payload.newMinutes,
        accumulativeWorkPoints: action.payload.newAccumulativePoints
      };
    case 'REFRESH_ACTIVE':
      return { ...state, lastActivity: action.payload.now, isActive: true };
    case 'START_ANIMATION':
      return { ...state, isAnimating: true };
    case 'STOP_ANIMATION':
      return { ...state, isAnimating: false };
    case 'SET_ACTIVE':
      return { ...state, isActive: action.payload };
    case 'SET_SYNCING':
      return { ...state, isSyncing: action.payload };
    case 'SET_STREAK':
      return { ...state, currentStreak: action.payload };
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

/** Fetch totalWorkPoints and currentStreak from the server */
async function fetchServerTotals(userId: string): Promise<{ totalWorkPoints: number; currentStreak: number } | null> {
  try {
    const response = await fetch(`${window.location.origin}/api/users/${userId}/total-work-points`, {
      credentials: 'include'
    });
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Intentionally silent — caller handles null
  }
  return null;
}

export const useWorkPoints = (): UseWorkPointsReturn => {
  const { user } = useAuth();
  const location = useLocation();

  const [state, dispatch] = useReducer(workPointsReducer, {
    todaysWorkPointsMilli: 0,
    todaysWorkPointsMinutes: 0,
    accumulativeWorkPoints: 0,
    lastActivity: null,
    isActive: false,
    isAnimating: false,
    currentStreak: 0,
    isSyncing: false
  });

  const isEligiblePage: boolean = WORK_POINTS_ELIGIBLE_PAGES.includes(location.pathname);

  const totalStudyTimeMinutes: number = state.accumulativeWorkPoints + Math.floor(state.todaysWorkPointsMilli / 60000);
  const liveSeconds: number = Math.floor((state.todaysWorkPointsMilli % 60000) / 1000);
  const progressToNextPoint: number = (state.todaysWorkPointsMilli % WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT) /
                                       WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT * 100;
  const streakGoalProgress: number = Math.min(state.todaysWorkPointsMinutes / STREAK_CONFIG.RETENTION_POINTS, 1);
  const hasMetStreakGoalToday: boolean = state.todaysWorkPointsMinutes >= STREAK_CONFIG.RETENTION_POINTS;

  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const saveCounterRef = useRef<number>(0);

  // Mirror volatile values into refs so that the tick interval callback (registered
  // once on mount) can always read the *latest* value without being re-registered
  // on every render. Without refs, the closure captured by setInterval would hold
  // stale state from the render it was registered in.
  const stateRef = useRef(state);
  const userIdRef = useRef(user?.id);
  const isEligiblePageRef = useRef(isEligiblePage);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { userIdRef.current = user?.id; }, [user?.id]);
  useEffect(() => { isEligiblePageRef.current = isEligiblePage; }, [isEligiblePage]);

  // Load initial data and check daily boundary
  useEffect(() => {
    if (!user?.id) {
      dispatch({
        type: 'LOAD_DATA',
        payload: {
          todaysWorkPointsMilli: 0,
          todaysWorkPointsMinutes: 0,
          accumulativeWorkPoints: 0,
          lastActivity: null,
          currentStreak: 0
        }
      });
      return;
    }

    const loadData = async () => {
      // Read localStorage synchronously so we can check the day boundary
      const stored = loadWorkPointsDataSync(user.id);

      // Check if a new day has started; if so, tell the server
      const resetCheck = await checkAndSyncDailyReset(user.id, stored);

      // Fetch authoritative totals from server
      const serverData = await fetchServerTotals(user.id);

      if (resetCheck.shouldReset) {
        const accumulativePoints = serverData?.totalWorkPoints ?? stored.totalWorkPoints;
        const currentStreak = serverData?.currentStreak ?? 0;

        const freshStorage: WorkPointsStorage = {
          todaysWorkPointsMilli: 0,
          totalWorkPoints: accumulativePoints,
          lastActivity: new Date().toISOString()
        };
        saveWorkPointsData(user.id, freshStorage);

        dispatch({
          type: 'LOAD_DATA',
          payload: {
            todaysWorkPointsMilli: 0,
            todaysWorkPointsMinutes: 0,
            accumulativeWorkPoints: accumulativePoints,
            lastActivity: new Date(),
            currentStreak
          }
        });
      } else {
        const accumulativePoints = serverData?.totalWorkPoints ?? stored.totalWorkPoints;
        const currentStreak = serverData?.currentStreak ?? 0;

        dispatch({
          type: 'LOAD_DATA',
          payload: {
            todaysWorkPointsMilli: stored.todaysWorkPointsMilli,
            todaysWorkPointsMinutes: calculatePointsFromMilliseconds(stored.todaysWorkPointsMilli),
            accumulativeWorkPoints: accumulativePoints,
            lastActivity: new Date(stored.lastActivity),
            currentStreak
          }
        });
      }
    };

    loadData();
  }, [user?.id]);

  // 1-second accumulation timer
  useEffect(() => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }

    if (!state.isActive || !isEligiblePage || !user?.id) {
      return;
    }

    saveCounterRef.current = 0;

    tickIntervalRef.current = setInterval(() => {
      const currentState = stateRef.current;
      const currentUserId = userIdRef.current;
      const currentIsEligible = isEligiblePageRef.current;

      if (!currentState.isActive || !currentIsEligible || !currentUserId) {
        return;
      }

      const newTotal: number = currentState.todaysWorkPointsMilli + 1000;
      const oldPoints: number = currentState.todaysWorkPointsMinutes;
      const newPoints: number = calculatePointsFromMilliseconds(newTotal);
      const pointsEarned: number = newPoints - oldPoints;
      const newAccumulativePoints: number = currentState.accumulativeWorkPoints + pointsEarned;

      dispatch({
        type: 'TICK',
        payload: {
          newMilliseconds: newTotal,
          newMinutes: newPoints,
          newAccumulativePoints
        }
      });

      stateRef.current = {
        ...currentState,
        todaysWorkPointsMilli: newTotal,
        todaysWorkPointsMinutes: newPoints,
        accumulativeWorkPoints: newAccumulativePoints
      };

      if (process.env.NODE_ENV === 'development') {
        saveCounterRef.current += 1;
        if (saveCounterRef.current % 5 === 0) {
          const currentProgress = (newTotal % WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT) / WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT * 100;
          const secondsAccumulated = Math.floor((newTotal % WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT) / 1000);
          console.log(
            `[WORK POINTS] ⚡ Timer tick: ${newTotal}ms total, ` +
            `${currentProgress.toFixed(1)}% progress, ${secondsAccumulated}s accumulated`
          );
        }
      }

      if (pointsEarned > 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[WORK POINTS] 🔥 Point earned! Total: ${newPoints} points`);
        }

        dispatch({ type: 'START_ANIMATION' });
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }
        animationTimeoutRef.current = setTimeout(() => {
          dispatch({ type: 'STOP_ANIMATION' });
        }, WORK_POINTS_CONFIG.ANIMATION_DURATION_MS);

        // Increment on server; if this crosses the streak threshold, re-fetch streak
        const todayDate = new Date().toISOString().split('T')[0];
        const wasAtThreshold = oldPoints < STREAK_CONFIG.RETENTION_POINTS && newPoints >= STREAK_CONFIG.RETENTION_POINTS;

        incrementWorkPoint(todayDate).then((result) => {
          if (result.success && wasAtThreshold) {
            // Streak was incremented server-side — pull the updated value
            fetchServerTotals(currentUserId).then((data) => {
              if (data) {
                dispatch({ type: 'SET_STREAK', payload: data.currentStreak });
              }
            });
          }
        }).catch(() => {});
      }

      // Save to localStorage every tick
      const storageData: WorkPointsStorage = {
        todaysWorkPointsMilli: newTotal,
        totalWorkPoints: newAccumulativePoints,
        lastActivity: new Date().toISOString()
      };
      saveWorkPointsData(currentUserId, storageData);
    }, 1000);

    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
    };
  }, [state.isActive, isEligiblePage, user?.id]);

  const recordActivity = useCallback(() => {
    const currentUserId = userIdRef.current;
    const currentIsEligiblePage = isEligiblePageRef.current;

    if (!currentUserId || !currentIsEligiblePage) return;

    const now = new Date();
    dispatch({ type: 'REFRESH_ACTIVE', payload: { now } });

    stateRef.current = { ...stateRef.current, lastActivity: now, isActive: true };

    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }

    activityTimeoutRef.current = setTimeout(() => {
      const currentState = stateRef.current;
      const userId = userIdRef.current;

      if (userId) {
        const storageData: WorkPointsStorage = {
          todaysWorkPointsMilli: currentState.todaysWorkPointsMilli,
          totalWorkPoints: currentState.accumulativeWorkPoints,
          lastActivity: new Date().toISOString()
        };
        saveWorkPointsData(userId, storageData);

        if (process.env.NODE_ENV === 'development') {
          console.log('[WORK POINTS] ⏸ Going inactive, saved state');
        }
      }

      dispatch({ type: 'SET_ACTIVE', payload: false });
    }, WORK_POINTS_CONFIG.ACTIVITY_TIMEOUT_MS);
  }, []);

  const recordActivityRef = useRef(recordActivity);
  recordActivityRef.current = recordActivity;

  const resetPoints = useCallback(() => {
    if (!user?.id) return;

    dispatch({ type: 'RESET' });
    clearWorkPointsData(user.id);

    if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
  }, [user?.id]);

  // Save state on browser close
  useEffect(() => {
    const handleBeforeUnload = () => {
      const currentState = stateRef.current;
      const userId = userIdRef.current;

      if (userId) {
        const storageData: WorkPointsStorage = {
          todaysWorkPointsMilli: currentState.todaysWorkPointsMilli,
          totalWorkPoints: currentState.accumulativeWorkPoints,
          lastActivity: new Date().toISOString()
        };
        saveWorkPointsData(userId, storageData);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
      if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, []);

  // Save and deactivate when leaving eligible pages
  useEffect(() => {
    if (!isEligiblePage) {
      const currentState = stateRef.current;
      const userId = userIdRef.current;

      if (currentState.isActive && userId) {
        const storageData: WorkPointsStorage = {
          todaysWorkPointsMilli: currentState.todaysWorkPointsMilli,
          totalWorkPoints: currentState.accumulativeWorkPoints,
          lastActivity: new Date().toISOString()
        };
        saveWorkPointsData(userId, storageData);
      }

      dispatch({ type: 'SET_ACTIVE', payload: false });
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    }
  }, [isEligiblePage, location.pathname]);

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
    recordActivity,
    resetPoints,
    currentStreak: state.currentStreak,
    streakGoalProgress,
    hasMetStreakGoalToday,
    progressToNextPoint
  };
};
