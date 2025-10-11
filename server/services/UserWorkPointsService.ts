import { IUserWorkPointsDAL } from '../dal/interfaces/IUserWorkPointsDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import {
  UserWorkPoints,
  UserWorkPointsCreateData,
  UserWorkPointsStats,
  DeviceWorkPointsSummary,
  WorkPointsAnalytics,
  WorkPointsSyncRequest,
  WorkPointsSyncResponse,
  BulkWorkPointsSync,
  BulkWorkPointsSyncResponse
} from '../types/workPoints.js';
import { ValidationError, NotFoundError } from '../types/dal.js';

/**
 * UserWorkPoints Service - Contains all business logic for work points operations
 * Handles validation, sync processing, analytics, and device management
 */
export class UserWorkPointsService {
  constructor(
    private userWorkPointsDAL: IUserWorkPointsDAL,
    private userDAL: IUserDAL
  ) {}

  /**
   * Sync work points for a user (main sync operation)
   * This is called when users hit the 5-point milestone or other sync triggers
   */
  async syncWorkPoints(userId: string, syncData: WorkPointsSyncRequest): Promise<WorkPointsSyncResponse> {
    console.log(`[WORK-POINTS-SERVICE] 🔄 Starting work points sync:`, {
      userId: `${userId.substring(0, 8)}...`,
      date: syncData.date,
      workPoints: syncData.workPoints,
      device: `${syncData.deviceFingerprint.substring(0, 8)}...`,
      timestamp: new Date().toISOString()
    });

    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      console.error(`[WORK-POINTS-SERVICE] ❌ User validation failed:`, {
        userId: `${userId.substring(0, 8)}...`,
        error: 'User not found'
      });
      throw new NotFoundError('User not found');
    }

    // Business validation
    this.validateSyncRequest(syncData);

    // Generate or validate device fingerprint
    const deviceFingerprint = this.validateDeviceFingerprint(syncData.deviceFingerprint);

    try {
      // Check if this is a new entry vs update to determine if we should add to totals
      const existingEntries = await this.userWorkPointsDAL.findByUserAndDate(userId, syncData.date);
      const previousPointsForDate = existingEntries.reduce((total, entry) => total + entry.workPoints, 0);

      // Perform the sync (upsert operation)
      const syncedEntry = await this.userWorkPointsDAL.upsertWorkPoints(
        userId,
        syncData.date,
        deviceFingerprint,
        syncData.workPoints
      );

      // Calculate how many new points were added (for total accumulation)
      const newPointsForDate = await this.getTotalWorkPointsForDate(userId, syncData.date);
      const pointsToAddToTotal = newPointsForDate - previousPointsForDate;

      // Update user's total work points if there are new points to add
      if (pointsToAddToTotal > 0) {
        try {
          await this.userDAL.incrementTotalWorkPoints(userId, pointsToAddToTotal);
          console.log(`[WORK-POINTS-SERVICE] 📈 Total work points updated:`, {
            userId: `${userId.substring(0, 8)}...`,
            pointsAdded: pointsToAddToTotal,
            date: syncData.date
          });
        } catch (totalUpdateError: any) {
          console.warn(`[WORK-POINTS-SERVICE] ⚠️ Failed to update total work points:`, {
            userId: `${userId.substring(0, 8)}...`,
            error: totalUpdateError.message,
            pointsToAdd: pointsToAddToTotal
          });
          // Don't fail the sync if total update fails
        }
      }

      console.log(`[WORK-POINTS-SERVICE] ✅ Work points sync successful:`, {
        userId: `${userId.substring(0, 8)}...`,
        date: syncData.date,
        workPoints: syncData.workPoints,
        device: `${deviceFingerprint.substring(0, 8)}...`,
        syncTimestamp: syncedEntry.lastSyncTimestamp,
        wasUpdate: syncedEntry.updatedAt > syncedEntry.createdAt,
        totalPointsAdded: pointsToAddToTotal
      });

      return {
        success: true,
        message: `Work points synced successfully for ${syncData.date}`,
        data: {
          date: syncData.date,
          workPoints: syncData.workPoints,
          deviceFingerprint: deviceFingerprint,
          synced: true
        }
      };
    } catch (error: any) {
      console.error(`[WORK-POINTS-SERVICE] ❌ Sync operation failed:`, {
        userId: `${userId.substring(0, 8)}...`,
        date: syncData.date,
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        message: `Failed to sync work points: ${error.message}`,
        data: {
          date: syncData.date,
          workPoints: 0,
          deviceFingerprint: deviceFingerprint,
          synced: false
        }
      };
    }
  }

  /**
   * Bulk sync work points for multiple days (for catch-up syncing)
   */
  async bulkSyncWorkPoints(userId: string, bulkSync: BulkWorkPointsSync): Promise<BulkWorkPointsSyncResponse> {
    console.log(`[WORK-POINTS-SERVICE] 🔄 Starting bulk work points sync:`, {
      userId: `${userId.substring(0, 8)}...`,
      entriesCount: bulkSync.entries.length,
      dateRange: {
        first: bulkSync.entries[0]?.date,
        last: bulkSync.entries[bulkSync.entries.length - 1]?.date
      }
    });

    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Business validation
    if (!bulkSync.entries || bulkSync.entries.length === 0) {
      throw new ValidationError('No entries provided for bulk sync');
    }

    if (bulkSync.entries.length > 100) {
      throw new ValidationError('Too many entries for bulk sync (maximum 100)');
    }

    // Validate each entry
    for (const entry of bulkSync.entries) {
      this.validateSyncRequest(entry);
    }

    const results: Array<{
      date: string;
      success: boolean;
      error?: string;
    }> = [];

    let totalSynced = 0;
    let totalFailed = 0;

    // Process each entry individually to ensure partial success
    for (const entry of bulkSync.entries) {
      try {
        const deviceFingerprint = this.validateDeviceFingerprint(entry.deviceFingerprint);
        
        await this.userWorkPointsDAL.upsertWorkPoints(
          userId,
          entry.date,
          deviceFingerprint,
          entry.workPoints
        );

        results.push({
          date: entry.date,
          success: true
        });
        totalSynced++;
      } catch (error: any) {
        results.push({
          date: entry.date,
          success: false,
          error: error.message
        });
        totalFailed++;

        console.warn(`[WORK-POINTS-SERVICE] ⚠️ Bulk sync entry failed:`, {
          userId: `${userId.substring(0, 8)}...`,
          date: entry.date,
          error: error.message
        });
      }
    }

    console.log(`[WORK-POINTS-SERVICE] 📊 Bulk sync completed:`, {
      userId: `${userId.substring(0, 8)}...`,
      totalEntries: bulkSync.entries.length,
      synced: totalSynced,
      failed: totalFailed,
      successRate: `${(totalSynced / bulkSync.entries.length * 100).toFixed(1)}%`
    });

    return {
      success: totalFailed === 0,
      results,
      totalSynced,
      totalFailed
    };
  }

  /**
   * Get comprehensive work points statistics for a user
   */
  async getUserWorkPointsStats(userId: string): Promise<UserWorkPointsStats> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    return await this.userWorkPointsDAL.getUserWorkPointsStats(userId);
  }

  /**
   * Get work points analytics for a date range
   */
  async getUserAnalytics(userId: string, startDate: string, endDate: string): Promise<WorkPointsAnalytics> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Business validation for date range
    this.validateDateRange(startDate, endDate);

    return await this.userWorkPointsDAL.getUserWorkPointsAnalytics(userId, startDate, endDate);
  }

  /**
   * Get device usage summary for a user
   */
  async getUserDeviceSummary(userId: string): Promise<DeviceWorkPointsSummary[]> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    return await this.userWorkPointsDAL.getDeviceWorkPointsSummary(userId);
  }

  /**
   * Get user's recent work points activity
   */
  async getRecentActivity(userId: string, days: number = 30): Promise<UserWorkPoints[]> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Business validation
    if (days < 1 || days > 365) {
      throw new ValidationError('Days must be between 1 and 365');
    }

    return await this.userWorkPointsDAL.getRecentWorkPoints(userId, days);
  }

  /**
   * Get work points for specific date range with pagination
   */
  async getUserWorkPointsInRange(
    userId: string,
    startDate: string,
    endDate: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<UserWorkPoints[]> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Business validation
    this.validateDateRange(startDate, endDate);
    this.validatePagination(limit, offset);

    return await this.userWorkPointsDAL.findByUserIdInDateRange(userId, startDate, endDate);
  }

  /**
   * Check if user has work points for a specific date
   */
  async hasWorkPointsForDate(userId: string, date: string): Promise<boolean> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Business validation
    this.validateDateString(date);

    const entries = await this.userWorkPointsDAL.findByUserAndDate(userId, date);
    return entries.length > 0 && entries.some(entry => entry.workPoints > 0);
  }

  /**
   * Get total work points for a specific date (across all devices)
   */
  async getTotalWorkPointsForDate(userId: string, date: string): Promise<number> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Business validation
    this.validateDateString(date);

    const entries = await this.userWorkPointsDAL.findByUserAndDate(userId, date);
    return entries.reduce((total, entry) => total + entry.workPoints, 0);
  }

  /**
   * Generate a simple device fingerprint if none provided
   */
  generateDeviceFingerprint(userAgent?: string, timestamp?: number): string {
    const ua = userAgent || 'unknown-device';
    const ts = timestamp || Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    
    // Simple hash-like fingerprint
    return `device_${Buffer.from(`${ua}_${ts}_${random}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16)}`;
  }

  // Private validation methods

  /**
   * Validate work points sync request
   */
  private validateSyncRequest(syncData: WorkPointsSyncRequest): void {
    if (!syncData.date) {
      throw new ValidationError('Date is required');
    }

    if (!syncData.deviceFingerprint) {
      throw new ValidationError('Device fingerprint is required');
    }

    if (typeof syncData.workPoints !== 'number' || syncData.workPoints < 0) {
      throw new ValidationError('Work points must be a non-negative number');
    }

    if (syncData.workPoints > 10000) {
      throw new ValidationError('Work points cannot exceed 10000 per day (seems unrealistic)');
    }

    // Validate date format
    this.validateDateString(syncData.date);
  }

  /**
   * Validate and sanitize device fingerprint
   */
  private validateDeviceFingerprint(fingerprint: string): string {
    if (!fingerprint || fingerprint.trim().length === 0) {
      throw new ValidationError('Device fingerprint cannot be empty');
    }

    const sanitized = fingerprint.trim();

    if (sanitized.length > 255) {
      throw new ValidationError('Device fingerprint is too long (maximum 255 characters)');
    }

    // Basic sanitization - only allow alphanumeric characters, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
      throw new ValidationError('Device fingerprint contains invalid characters (only alphanumeric, hyphens, and underscores allowed)');
    }

    return sanitized;
  }

  /**
   * Validate date string format
   */
  private validateDateString(date: string): void {
    if (!date || typeof date !== 'string') {
      throw new ValidationError('Date must be a string');
    }

    // Check YYYY-MM-DD format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new ValidationError('Date must be in YYYY-MM-DD format');
    }

    // Validate actual date
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      throw new ValidationError('Invalid date');
    }

    // Business rule: don't allow dates too far in the past or future
    const now = new Date();
    const maxPastDays = 365; // 1 year ago
    const maxFutureDays = 7; // 1 week in future

    const daysDiff = Math.floor((now.getTime() - parsedDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff > maxPastDays) {
      throw new ValidationError(`Date cannot be more than ${maxPastDays} days in the past`);
    }

    if (daysDiff < -maxFutureDays) {
      throw new ValidationError(`Date cannot be more than ${maxFutureDays} days in the future`);
    }
  }

  /**
   * Validate date range
   */
  private validateDateRange(startDate: string, endDate: string): void {
    this.validateDateString(startDate);
    this.validateDateString(endDate);

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      throw new ValidationError('Start date cannot be after end date');
    }

    // Business rule: limit date range to prevent excessive queries
    const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 365) {
      throw new ValidationError('Date range cannot exceed 365 days');
    }
  }

  /**
   * Validate pagination parameters
   */
  private validatePagination(limit: number, offset: number): void {
    if (typeof limit !== 'number' || limit < 1 || limit > 1000) {
      throw new ValidationError('Limit must be between 1 and 1000');
    }

    if (typeof offset !== 'number' || offset < 0) {
      throw new ValidationError('Offset must be a non-negative number');
    }
  }
}
