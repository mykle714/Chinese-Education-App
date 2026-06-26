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
import { incrementMinutePoint, fetchLanguageSummary } from '../utils/minutePointsSync';
import { isSameStreakDay } from '../utils/streakDay';
import { getMinutePointsPaused } from '../utils/minutePointsPause';

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

export const useMinutePoints = (): UseMinutePointsReturn => {
  const { user, token } = useAuth();
  const location = useLocation();

  // Minutes are tracked per language; everything below is scoped to the user's
  // currently selected language (default 'zh' for legacy accounts).
  const language: string = user?.selectedLanguage || 'zh';

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

  const isEligiblePage: boolean = MINUTE_POINTS_ELIGIBLE_PAGES.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(prefix + '/')
  );

  const totalStudyTimeMinutes: number = state.accumulativeMinutePoints;
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
  const languageRef = useRef(language);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { userIdRef.current = user?.id; }, [user?.id]);
  useEffect(() => { isEligiblePageRef.current = isEligiblePage; }, [isEligiblePage]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { languageRef.current = language; }, [language]);

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
      const stored = loadMinutePointsDataSync(user.id, language);

      // Stale local sub-minute progress only counts if it belongs to the SAME
      // streak day as now. We must use the server's 4 AM-bounded streak day
      // (isSameStreakDay) — NOT a midnight toDateString() comparison: a session
      // run between midnight and 4 AM belongs to the previous streak day, so on a
      // fresh login later that same calendar day the server correctly reports 0
      // for today. A midnight comparison would mark that pre-4 AM progress as
      // "same day" and Math.max() below would resurrect it, making the fire badge
      // show yesterday's minutes on the first login of the new streak day.
      const sameDay = isSameStreakDay(stored.lastActivity, new Date());

      // Server is authoritative per language: lifetime total, today's minutes
      // (cross-device), and the global streak. Fall back to local storage offline.
      const serverData = await fetchLanguageSummary(language, token);

      const accumulativePoints = serverData?.totalMinutePoints ?? stored.totalMinutePoints;
      const currentStreak = serverData?.currentStreak ?? 0;

      // Seed today's milliseconds from the server's whole-minute count, but keep
      // any same-day local sub-minute progress that the server hasn't seen yet.
      const serverTodayMilli =
        serverData ? serverData.todayMinutes * MINUTE_POINTS_CONFIG.MILLISECONDS_PER_POINT : 0;
      const localTodayMilli = sameDay ? stored.todaysMinutePointsMilli : 0;
      const todaysMinutePointsMilli = Math.max(serverTodayMilli, localTodayMilli);

      const freshStorage: MinutePointsStorage = {
        todaysMinutePointsMilli,
        totalMinutePoints: accumulativePoints,
        lastActivity: new Date().toISOString()
      };
      saveMinutePointsData(user.id, language, freshStorage);

      dispatch({
        type: 'LOAD_DATA',
        payload: {
          todaysMinutePointsMilli,
          todaysMinutePointsMinutes: calculatePointsFromMilliseconds(todaysMinutePointsMilli),
          accumulativeMinutePoints: accumulativePoints,
          lastActivity: new Date(),
          currentStreak
        }
      });
    };

    loadData();
  }, [user?.id, language, token]);

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

      // Paused (e.g. flp icon-layout editor): hold accumulation — don't count this
      // second as study time. The interval keeps running so it resumes on unpause.
      if (getMinutePointsPaused()) {
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
            // Streak is global; refetch it via the per-language summary.
            fetchLanguageSummary(languageRef.current, tokenRef.current).then((data) => {
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
      saveMinutePointsData(currentUserId, languageRef.current, storageData);
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
        saveMinutePointsData(userId, languageRef.current, storageData);

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
    clearMinutePointsData(user.id, language);

    if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
  }, [user?.id, language]);

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
        saveMinutePointsData(userId, languageRef.current, storageData);
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
        saveMinutePointsData(userId, languageRef.current, storageData);
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
