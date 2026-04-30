import { useEffect, useCallback, useRef, useReducer } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  saveMinutePointsData,
  clearMinutePointsData,
  calculatePointsFromMilliseconds,
  loadMinutePointsDataSync,
  type MinutePointsStorage
} from '../utils/minutePointsStorage';
import { MINUTE_POINTS_ELIGIBLE_PAGES, MINUTE_POINTS_CONFIG, STREAK_CONFIG } from '../constants';
import { useActivityDetection } from './useActivityDetection';
import { checkAndSyncDailyReset } from '../utils/dailyBoundarySync';
import { incrementMinutePoint } from '../utils/minutePointsSync';

export interface UseMinutePointsReturn {
  currentPoints: number;
  accumulativeMinutePoints: number;
  totalStudyTimeMinutes: number;
  todaysMinutePointsMilli: number;
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

interface MinutePointsState {
  todaysMinutePointsMilli: number;
  todaysMinutePointsMinutes: number;
  accumulativeMinutePoints: number;
  lastActivity: Date | null;
  isActive: boolean;
  isAnimating: boolean;
  currentStreak: number;
  isSyncing: boolean;
}

type MinutePointsAction =
  | { type: 'LOAD_DATA'; payload: Omit<MinutePointsState, 'isActive' | 'isAnimating' | 'isSyncing'> }
  | { type: 'TICK'; payload: { newMilliseconds: number; newMinutes: number; newAccumulativePoints: number } }
  | { type: 'REFRESH_ACTIVE'; payload: { now: Date } }
  | { type: 'START_ANIMATION' }
  | { type: 'STOP_ANIMATION' }
  | { type: 'SET_ACTIVE'; payload: boolean }
  | { type: 'SET_SYNCING'; payload: boolean }
  | { type: 'SET_STREAK'; payload: number }
  | { type: 'RESET' };

const minutePointsReducer = (state: MinutePointsState, action: MinutePointsAction): MinutePointsState => {
  switch (action.type) {
    case 'LOAD_DATA':
      return { ...state, ...action.payload };
    case 'TICK':
      return {
        ...state,
        todaysMinutePointsMilli: action.payload.newMilliseconds,
        todaysMinutePointsMinutes: action.payload.newMinutes,
        accumulativeMinutePoints: action.payload.newAccumulativePoints
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
        todaysMinutePointsMilli: 0,
        todaysMinutePointsMinutes: 0,
        lastActivity: null,
        isActive: false,
        isAnimating: false
      };
    default:
      return state;
  }
};

/** Fetch totalMinutePoints and currentStreak from the server */
async function fetchServerTotals(userId: string, token?: string | null): Promise<{ totalMinutePoints: number; currentStreak: number } | null> {
  try {
    const response = await fetch(`${window.location.origin}/api/users/${userId}/total-minute-points`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
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

export const useMinutePoints = (): UseMinutePointsReturn => {
  const { user, token } = useAuth();
  const location = useLocation();

  const [state, dispatch] = useReducer(minutePointsReducer, {
    todaysMinutePointsMilli: 0,
    todaysMinutePointsMinutes: 0,
    accumulativeMinutePoints: 0,
    lastActivity: null,
    isActive: false,
    isAnimating: false,
    currentStreak: 0,
    isSyncing: false
  });

  const isEligiblePage: boolean = MINUTE_POINTS_ELIGIBLE_PAGES.includes(location.pathname);

  const totalStudyTimeMinutes: number = state.accumulativeMinutePoints + Math.floor(state.todaysMinutePointsMilli / 60000);
  const liveSeconds: number = Math.floor((state.todaysMinutePointsMilli % 60000) / 1000);
  const progressToNextPoint: number = (state.todaysMinutePointsMilli % MINUTE_POINTS_CONFIG.MILLISECONDS_PER_POINT) /
                                       MINUTE_POINTS_CONFIG.MILLISECONDS_PER_POINT * 100;
  const streakGoalProgress: number = Math.min(state.todaysMinutePointsMinutes / STREAK_CONFIG.RETENTION_MINUTES, 1);
  const hasMetStreakGoalToday: boolean = state.todaysMinutePointsMinutes >= STREAK_CONFIG.RETENTION_MINUTES;

  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const saveCounterRef = useRef<number>(0);

  // Mirror volatile values into refs so the tick interval (registered once on mount)
  // always reads the latest value without being re-registered every render.
  const stateRef = useRef(state);
  const userIdRef = useRef(user?.id);
  const isEligiblePageRef = useRef(isEligiblePage);
  const tokenRef = useRef(token);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { userIdRef.current = user?.id; }, [user?.id]);
  useEffect(() => { isEligiblePageRef.current = isEligiblePage; }, [isEligiblePage]);
  useEffect(() => { tokenRef.current = token; }, [token]);

  useEffect(() => {
    if (!user?.id) {
      dispatch({
        type: 'LOAD_DATA',
        payload: {
          todaysMinutePointsMilli: 0,
          todaysMinutePointsMinutes: 0,
          accumulativeMinutePoints: 0,
          lastActivity: null,
          currentStreak: 0
        }
      });
      return;
    }

    const loadData = async () => {
      const stored = loadMinutePointsDataSync(user.id);

      // Notify server of new day (idempotent server-side).
      const resetCheck = await checkAndSyncDailyReset(user.id, stored, token);

      const serverData = await fetchServerTotals(user.id, token);

      if (resetCheck.shouldReset) {
        const accumulativePoints = serverData?.totalMinutePoints ?? stored.totalMinutePoints;
        const currentStreak = serverData?.currentStreak ?? 0;

        const freshStorage: MinutePointsStorage = {
          todaysMinutePointsMilli: 0,
          totalMinutePoints: accumulativePoints,
          lastActivity: new Date().toISOString()
        };
        saveMinutePointsData(user.id, freshStorage);

        dispatch({
          type: 'LOAD_DATA',
          payload: {
            todaysMinutePointsMilli: 0,
            todaysMinutePointsMinutes: 0,
            accumulativeMinutePoints: accumulativePoints,
            lastActivity: new Date(),
            currentStreak
          }
        });
      } else {
        const accumulativePoints = serverData?.totalMinutePoints ?? stored.totalMinutePoints;
        const currentStreak = serverData?.currentStreak ?? 0;

        dispatch({
          type: 'LOAD_DATA',
          payload: {
            todaysMinutePointsMilli: stored.todaysMinutePointsMilli,
            todaysMinutePointsMinutes: calculatePointsFromMilliseconds(stored.todaysMinutePointsMilli),
            accumulativeMinutePoints: accumulativePoints,
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

      const newTotal: number = currentState.todaysMinutePointsMilli + 1000;
      const oldPoints: number = currentState.todaysMinutePointsMinutes;
      const newPoints: number = calculatePointsFromMilliseconds(newTotal);
      const pointsEarned: number = newPoints - oldPoints;
      const newAccumulativePoints: number = currentState.accumulativeMinutePoints + pointsEarned;

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
        todaysMinutePointsMilli: newTotal,
        todaysMinutePointsMinutes: newPoints,
        accumulativeMinutePoints: newAccumulativePoints
      };

      if (process.env.NODE_ENV === 'development') {
        saveCounterRef.current += 1;
        if (saveCounterRef.current % 5 === 0) {
          const currentProgress = (newTotal % MINUTE_POINTS_CONFIG.MILLISECONDS_PER_POINT) / MINUTE_POINTS_CONFIG.MILLISECONDS_PER_POINT * 100;
          const secondsAccumulated = Math.floor((newTotal % MINUTE_POINTS_CONFIG.MILLISECONDS_PER_POINT) / 1000);
          console.log(
            `[MINUTE POINTS] ⚡ Timer tick: ${newTotal}ms total, ` +
            `${currentProgress.toFixed(1)}% progress, ${secondsAccumulated}s accumulated`
          );
        }
      }

      if (pointsEarned > 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[MINUTE POINTS] 🔥 Point earned! Total: ${newPoints} points`);
        }

        dispatch({ type: 'START_ANIMATION' });
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }
        animationTimeoutRef.current = setTimeout(() => {
          dispatch({ type: 'STOP_ANIMATION' });
        }, MINUTE_POINTS_CONFIG.ANIMATION_DURATION_MS);

        // Tell the server. If we just crossed the threshold, refetch the streak.
        const wasAtThreshold = oldPoints < STREAK_CONFIG.RETENTION_MINUTES && newPoints >= STREAK_CONFIG.RETENTION_MINUTES;

        incrementMinutePoint(tokenRef.current).then((result) => {
          if (result.success && wasAtThreshold) {
            fetchServerTotals(currentUserId, tokenRef.current).then((data) => {
              if (data) {
                dispatch({ type: 'SET_STREAK', payload: data.currentStreak });
              }
            });
          }
        }).catch(() => {});
      }

      const storageData: MinutePointsStorage = {
        todaysMinutePointsMilli: newTotal,
        totalMinutePoints: newAccumulativePoints,
        lastActivity: new Date().toISOString()
      };
      saveMinutePointsData(currentUserId, storageData);
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
        const storageData: MinutePointsStorage = {
          todaysMinutePointsMilli: currentState.todaysMinutePointsMilli,
          totalMinutePoints: currentState.accumulativeMinutePoints,
          lastActivity: new Date().toISOString()
        };
        saveMinutePointsData(userId, storageData);

        if (process.env.NODE_ENV === 'development') {
          console.log('[MINUTE POINTS] ⏸ Going inactive, saved state');
        }
      }

      dispatch({ type: 'SET_ACTIVE', payload: false });
    }, MINUTE_POINTS_CONFIG.ACTIVITY_TIMEOUT_MS);
  }, []);

  const recordActivityRef = useRef(recordActivity);
  recordActivityRef.current = recordActivity;

  const resetPoints = useCallback(() => {
    if (!user?.id) return;

    dispatch({ type: 'RESET' });
    clearMinutePointsData(user.id);

    if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
  }, [user?.id]);

  // Save state on browser close
  useEffect(() => {
    const handleBeforeUnload = () => {
      const currentState = stateRef.current;
      const userId = userIdRef.current;

      if (userId) {
        const storageData: MinutePointsStorage = {
          todaysMinutePointsMilli: currentState.todaysMinutePointsMilli,
          totalMinutePoints: currentState.accumulativeMinutePoints,
          lastActivity: new Date().toISOString()
        };
        saveMinutePointsData(userId, storageData);
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
        const storageData: MinutePointsStorage = {
          todaysMinutePointsMilli: currentState.todaysMinutePointsMilli,
          totalMinutePoints: currentState.accumulativeMinutePoints,
          lastActivity: new Date().toISOString()
        };
        saveMinutePointsData(userId, storageData);
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
    currentPoints: state.todaysMinutePointsMinutes,
    accumulativeMinutePoints: state.accumulativeMinutePoints,
    totalStudyTimeMinutes,
    todaysMinutePointsMilli: state.todaysMinutePointsMilli,
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
