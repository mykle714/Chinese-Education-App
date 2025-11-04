/**
 * Work points sync utilities
 * Handles communication with the server for work points synchronization
 */

import { getWorkPointsDeviceFingerprint } from './deviceFingerprint';
import { API_BASE_URL } from '../constants';

// Types for sync operations
export interface WorkPointsSyncEntry {
  date: string; // YYYY-MM-DD format
  workPoints: number;
  deviceFingerprint?: string;
}

export interface WorkPointsSyncResponse {
  success: boolean;
  message: string;
  data?: {
    date: string;
    workPoints: number;
    deviceFingerprint: string;
    synced: boolean;
  };
}

export interface BulkSyncResponse {
  success: boolean;
  results: Array<{
    date: string;
    success: boolean;
    error?: string;
  }>;
  totalSynced: number;
  totalFailed: number;
}

/**
 * Sync work points for a single date
 */
export async function syncWorkPoints(
  date: string,
  workPoints: number,
  deviceFingerprint?: string
): Promise<WorkPointsSyncResponse> {
  console.log(`[WORK-POINTS-SYNC] 🔄 Syncing work points:`, {
    date,
    workPoints,
    deviceFingerprint: deviceFingerprint ? `${deviceFingerprint.substring(0, 8)}...` : 'auto-generated'
  });

  try {
    const finalDeviceFingerprint = deviceFingerprint || getWorkPointsDeviceFingerprint();
    
    const response = await fetch(`${API_BASE_URL}/api/users/work-points/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Include JWT token
      body: JSON.stringify({
        date,
        workPoints,
        deviceFingerprint: finalDeviceFingerprint
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Sync failed: ${errorData.error || response.statusText}`);
    }

    const result: WorkPointsSyncResponse = await response.json();
    
    console.log(`[WORK-POINTS-SYNC] ✅ Sync successful:`, {
      date,
      workPoints,
      success: result.success,
      message: result.message
    });

    return result;
  } catch (error) {
    console.error(`[WORK-POINTS-SYNC] ❌ Sync failed:`, {
      date,
      workPoints,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // Return failure response
    return {
      success: false,
      message: `Failed to sync work points: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Sync work points for multiple dates (bulk sync)
 */
export async function syncMultipleWorkPoints(
  entries: WorkPointsSyncEntry[]
): Promise<BulkSyncResponse> {
  console.log(`[WORK-POINTS-SYNC] 🔄 Bulk syncing work points:`, {
    entriesCount: entries.length,
    dateRange: entries.length > 0 ? {
      first: entries[0].date,
      last: entries[entries.length - 1].date
    } : null
  });

  try {
    // Ensure all entries have device fingerprints
    const processedEntries = entries.map(entry => ({
      ...entry,
      deviceFingerprint: entry.deviceFingerprint || getWorkPointsDeviceFingerprint()
    }));

    const response = await fetch(`${API_BASE_URL}/api/users/work-points/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Include JWT token
      body: JSON.stringify({
        entries: processedEntries
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Bulk sync failed: ${errorData.error || response.statusText}`);
    }

    const result: BulkSyncResponse = await response.json();
    
    console.log(`[WORK-POINTS-SYNC] ✅ Bulk sync completed:`, {
      entriesCount: entries.length,
      totalSynced: result.totalSynced,
      totalFailed: result.totalFailed,
      success: result.success
    });

    return result;
  } catch (error) {
    console.error(`[WORK-POINTS-SYNC] ❌ Bulk sync failed:`, {
      entriesCount: entries.length,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // Return failure response
    return {
      success: false,
      results: entries.map(entry => ({
        date: entry.date,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })),
      totalSynced: 0,
      totalFailed: entries.length
    };
  }
}

/**
 * Check if sync is needed for unsynced work points data
 */
export function getUnsyncedWorkPointsData(userId: string): WorkPointsSyncEntry[] {
  const unsyncedEntries: WorkPointsSyncEntry[] = [];
  
  try {
    // Check localStorage for work points data that hasn't been synced
    const keys = Object.keys(localStorage).filter(key => 
      key.startsWith(`workPoints_${userId}_`) && !key.endsWith('_synced')
    );

    for (const key of keys) {
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        const dateMatch = key.match(/_(\d{4}-\d{2}-\d{2})$/);
        
        if (dateMatch && data.todaysWorkPointsMilli > 0) {
          const date = dateMatch[1];
          const workPoints = Math.floor(data.todaysWorkPointsMilli / 60000); // 60 seconds = 1 point
          
          // Check if already synced
          const syncedKey = `${key}_synced`;
          const isSynced = localStorage.getItem(syncedKey) === 'true';
          
          if (!isSynced && workPoints > 0) {
            unsyncedEntries.push({
              date,
              workPoints
            });
          }
        }
      } catch (error) {
        console.warn(`Failed to parse work points data for key ${key}:`, error);
      }
    }
  } catch (error) {
    console.error('Error checking for unsynced work points data:', error);
  }

  return unsyncedEntries.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Mark work points as synced in localStorage
 */
export function markWorkPointsAsSynced(userId: string, date: string): void {
  try {
    const key = `workPoints_${userId}_${date}_synced`;
    localStorage.setItem(key, 'true');
  } catch (error) {
    console.warn(`Failed to mark work points as synced for ${date}:`, error);
  }
}

/**
 * Get today's date in YYYY-MM-DD format (local timezone)
 */
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Utility function to perform milestone sync (5 work points)
 * This is the main function that will be called from useWorkPoints
 */
export async function performMilestoneSync(
  userId: string,
  workPoints: number,
  date?: string
): Promise<WorkPointsSyncResponse> {
  const syncDate = date || getTodayDateString();
  
  console.log(`[WORK-POINTS-SYNC] 🎯 Milestone sync triggered:`, {
    userId: `${userId.substring(0, 8)}...`,
    workPoints,
    date: syncDate,
    milestone: workPoints >= 5 ? 'achieved' : 'pending'
  });

  // Check if we need to sync previous unsynced days first
  const unsyncedEntries = getUnsyncedWorkPointsData(userId);
  
  if (unsyncedEntries.length > 0) {
    console.log(`[WORK-POINTS-SYNC] 📦 Found ${unsyncedEntries.length} unsynced entries, performing catch-up sync`);
    
    // Add current day to unsynced entries
    const currentDayEntry = unsyncedEntries.find(entry => entry.date === syncDate);
    if (currentDayEntry) {
      currentDayEntry.workPoints = workPoints;
    } else {
      unsyncedEntries.push({ date: syncDate, workPoints });
    }
    
    // Perform bulk sync
    const bulkResult = await syncMultipleWorkPoints(unsyncedEntries);
    
    if (bulkResult.success) {
      // Mark synced entries
      for (const entry of unsyncedEntries) {
        markWorkPointsAsSynced(userId, entry.date);
      }
    }
    
    // Return result for current day
    const currentDayResult = bulkResult.results.find(r => r.date === syncDate);
    return {
      success: currentDayResult?.success || false,
      message: currentDayResult?.error || bulkResult.success ? 'Sync completed successfully' : 'Bulk sync failed'
    };
  } else {
    // Simple single-day sync
    const result = await syncWorkPoints(syncDate, workPoints);
    
    if (result.success) {
      markWorkPointsAsSynced(userId, syncDate);
    }
    
    return result;
  }
}
