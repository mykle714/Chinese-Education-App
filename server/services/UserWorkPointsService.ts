import { IUserWorkPointsDAL } from '../dal/interfaces/IUserWorkPointsDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import {
  UserWorkPoints,
  UserWorkPointsCreateData,
  WorkPointsSyncRequest,
  WorkPointsSyncResponse,
  CalendarDataResponse,
  CalendarDayData
} from '../types/workPoints.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import { STREAK_CONFIG } from '../constants.js';

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
   * Get calendar data for a specific month showing work points and penalties
   */
  async getCalendarData(userId: string, month: string): Promise<CalendarDataResponse> {
    console.log(`[WORK-POINTS-SERVICE] 📅 Getting calendar data:`, {
      userId: `${userId.substring(0, 8)}...`,
      month
    });

    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Validate month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new ValidationError('Month must be in YYYY-MM format');
    }

    const [year, monthNum] = month.split('-').map(Number);
    const startDate = `${year}-${monthNum.toString().padStart(2, '0')}-01`;
    const endDate = new Date(year, monthNum, 0).toISOString().split('T')[0]; // Last day of month

    // Get all work points data for this month
    const monthWorkPoints = await this.userWorkPointsDAL.findByUserIdInDateRange(userId, startDate, endDate);

    // Debug: Log what we got from the database
    console.log(`[CALENDAR-DEBUG] Month work points fetched:`, {
      count: monthWorkPoints.length,
      startDate,
      endDate,
      firstFew: monthWorkPoints.slice(0, 3).map(entry => ({
        date: entry.date,
        dateType: typeof entry.date,
        workPoints: entry.workPoints
      }))
    });

    // Find user's first activity date
    const allUserData = await this.userWorkPointsDAL.findByUserId(userId, 1000, 0);
    let firstActivityDate: string | null = null;
    
    if (allUserData.length > 0) {
      const sorted = allUserData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const firstEntry = sorted[0];
      
      // Convert date to string format (handle both Date objects and strings)
      const dateValue = firstEntry.date as unknown;
      if (dateValue instanceof Date) {
        const year = dateValue.getFullYear();
        const month = (dateValue.getMonth() + 1).toString().padStart(2, '0');
        const day = dateValue.getDate().toString().padStart(2, '0');
        firstActivityDate = `${year}-${month}-${day}`;
      } else if (typeof dateValue === 'string') {
        firstActivityDate = dateValue.split('T')[0]; // Handle ISO strings
      }
    }

    // Generate calendar data for each day of the month
    // Note: We don't determine "today" on the server - that's done client-side based on user's timezone
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const days: CalendarDayData[] = [];

    // Import penalty configuration from constants
    const STREAK_RETENTION_POINTS = STREAK_CONFIG.RETENTION_POINTS;
    const DAILY_PENALTY_POINTS = STREAK_CONFIG.DAILY_PENALTY_POINTS;

    for (let day = 1; day <= daysInMonth; day++) {
      const currentDate = `${year}-${monthNum.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      // Server doesn't determine isToday or isFuture - client will do this based on user's timezone
      const isToday = false; // Client will override this
      const isFuture = false; // Client will determine this
      const isBeforeFirstActivity = firstActivityDate ? currentDate < firstActivityDate : true;

      // Calculate work points earned for this day
      // Convert database date to string for comparison since entry.date might be a Date object at runtime
      const dayEntries = monthWorkPoints.filter(entry => {
        let entryDateStr: string;
        
        // Runtime check - PostgreSQL returns date columns as Date objects despite type definition
        const dateValue = entry.date as unknown;
        
        if (dateValue instanceof Date) {
          // Extract date components directly without timezone conversion
          const year = dateValue.getFullYear();
          const month = (dateValue.getMonth() + 1).toString().padStart(2, '0');
          const day = dateValue.getDate().toString().padStart(2, '0');
          entryDateStr = `${year}-${month}-${day}`;
        } else if (typeof dateValue === 'string') {
          // Already a string in YYYY-MM-DD format
          entryDateStr = dateValue.split('T')[0]; // Handle ISO strings
        } else {
          // Fallback for unexpected formats
          entryDateStr = '';
        }
        
        return entryDateStr === currentDate;
      });
      const workPointsEarned = dayEntries.reduce((sum, entry) => sum + entry.workPoints, 0);

      // Debug log for troubleshooting
      if (day <= 3) {
        console.log(`[CALENDAR-DEBUG] Day ${day}:`, {
          currentDate,
          dayEntriesFound: dayEntries.length,
          workPointsEarned,
          streakThreshold: STREAK_RETENTION_POINTS,
          firstEntry: dayEntries[0] ? {
            date: dayEntries[0].date,
            dateType: typeof dayEntries[0].date,
            workPoints: dayEntries[0].workPoints
          } : null
        });
      }

      // Determine if streak threshold was met
      const streakMaintained = workPointsEarned >= STREAK_RETENTION_POINTS;

      // Calculate penalty if applicable
      // Note: Client will recalculate penalties based on their timezone to determine future dates
      // We set a base penalty here if threshold not met and not before first activity
      let penaltyAmount = 0;
      if (!isBeforeFirstActivity && !streakMaintained) {
        penaltyAmount = DAILY_PENALTY_POINTS;
      }

      days.push({
        date: currentDate,
        workPointsEarned,
        penaltyAmount,
        streakMaintained,
        isToday,
        hasData: !isBeforeFirstActivity
      });
    }

    return {
      month,
      days,
      userFirstActivityDate: firstActivityDate
    };
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
