import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../constants';
import { useWorkPoints } from './useWorkPoints';

/** A single unlock record from the server */
export interface NightMarketUnlock {
  id: string;
  userId: string;
  assetId: string;
  unlockType: string;
  unlockOrder: number;
  createdAt: string;
}

interface NightMarketUnlocksResponse {
  unlocks: NightMarketUnlock[];
  nextThreshold: number;
  totalUnlockable: number;
}

interface NightMarketNewUnlockResponse {
  unlock: NightMarketUnlock;
  nextThreshold: number;
}

export interface UseNightMarketReturn {
  /** All unlocked items (base + earned) */
  unlocks: NightMarketUnlock[];
  /** Whether the initial fetch is in progress */
  isLoading: boolean;
  /** Error message if fetch/unlock failed */
  error: string | null;
  /** Work points needed for the next unlock */
  nextThreshold: number;
  /** Total items available in the unlock pool */
  totalUnlockable: number;
  /** Whether the user has enough points to unlock a new item */
  canUnlock: boolean;
  /** Trigger unlock of the next random item */
  unlockNext: () => Promise<void>;
  /** The most recently unlocked item (for animation/notification) */
  newUnlock: NightMarketUnlock | null;
  /** Clear the newUnlock state after animation completes */
  clearNewUnlock: () => void;
  /** Whether an unlock request is in progress */
  isUnlocking: boolean;
}

/**
 * Hook for managing night market unlock data.
 * Fetches unlocked items on mount, provides unlock functionality,
 * and derives canUnlock from current work points.
 */
export function useNightMarket(): UseNightMarketReturn {
  const [unlocks, setUnlocks] = useState<NightMarketUnlock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextThreshold, setNextThreshold] = useState(60);
  const [totalUnlockable, setTotalUnlockable] = useState(0);
  const [newUnlock, setNewUnlock] = useState<NightMarketUnlock | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  // Get accumulated work points to determine unlock eligibility
  const { accumulativeWorkPoints } = useWorkPoints();
  const canUnlock = accumulativeWorkPoints >= nextThreshold && !isUnlocking;

  /** Fetch all unlocked items from the server */
  const fetchUnlocks = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/api/night-market/unlocks`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required. Please log in.');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Server error: ${response.status}`);
      }

      const data: NightMarketUnlocksResponse = await response.json();
      setUnlocks(data.unlocks);
      setNextThreshold(data.nextThreshold);
      setTotalUnlockable(data.totalUnlockable);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load night market data';
      setError(message);
      console.error('[Night Market] Failed to fetch unlocks:', message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Unlock the next random item */
  const unlockNext = useCallback(async () => {
    try {
      setIsUnlocking(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/api/night-market/unlock`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to unlock: ${response.status}`);
      }

      const data: NightMarketNewUnlockResponse = await response.json();

      // Add the new unlock to local state
      setUnlocks(prev => [...prev, data.unlock]);
      setNextThreshold(data.nextThreshold);
      setNewUnlock(data.unlock);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unlock item';
      setError(message);
      console.error('[Night Market] Unlock failed:', message);
    } finally {
      setIsUnlocking(false);
    }
  }, []);

  const clearNewUnlock = useCallback(() => {
    setNewUnlock(null);
  }, []);

  // Fetch unlocks on mount
  useEffect(() => {
    fetchUnlocks();
  }, [fetchUnlocks]);

  return {
    unlocks,
    isLoading,
    error,
    nextThreshold,
    totalUnlockable,
    canUnlock,
    unlockNext,
    newUnlock,
    clearNewUnlock,
    isUnlocking,
  };
}
