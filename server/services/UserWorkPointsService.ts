import { IUserWorkPointsDAL } from '../dal/interfaces/IUserWorkPointsDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import {
  UserWorkPoints,
  UserWorkPointsCreateData,
  WorkPointsIncrementRequest,
  WorkPointsNewDayRequest,
} from '../types/workPoints.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import { STREAK_CONFIG } from '../constants.js';

/**
 * UserWorkPoints Service - Contains all business logic for work points operations
 */
export class UserWorkPointsService {
  constructor(
    private userWorkPointsDAL: IUserWorkPointsDAL,
    private userDAL: IUserDAL
  ) {}

  /**
   * Increment work points by exactly 1.
   * If this crossing the RETENTION_POINTS threshold for the day, increment the user's streak.
   * POST /api/users/work-points/increment
   */
  async incrementWorkPoints(userId: string, incrementData: WorkPointsIncrementRequest): Promise<void> {
    console.log(`[WORK-POINTS-SERVICE] ➕ Starting work points increment:`, {
      userId: `${userId.substring(0, 8)}...`,
      date: incrementData.date,
      timestamp: new Date().toISOString()
    });

    // Verify user exists and get rate-limiting data
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Rate limit check
    const now = new Date();
    if (user.lastWorkPointIncrement) {
      const secondsSinceLastIncrement = (now.getTime() - user.lastWorkPointIncrement.getTime()) / 1000;
      if (secondsSinceLastIncrement < 59) {
        const waitTime = Math.ceil(59 - secondsSinceLastIncrement);
        throw new ValidationError(`Please wait ${waitTime} more seconds before incrementing again`);
      }
    }

    this.validateDateForIncrement(incrementData.date);

    const deviceFingerprint = this.generateDeviceFingerprint(undefined, Date.now());

    // Get current points for this date before the upsert
    const existingEntries = await this.userWorkPointsDAL.findByUserAndDate(userId, incrementData.date);
    const previousPointsForDate = existingEntries.reduce((total, entry) => total + entry.workPoints, 0);
    const newPointsForDate = previousPointsForDate + 1;

    // Upsert the new point
    await this.userWorkPointsDAL.upsertWorkPoints(
      userId,
      incrementData.date,
      deviceFingerprint,
      newPointsForDate
    );

    // Update user's total work points
    await this.userDAL.incrementTotalWorkPoints(userId, 1);

    // Check if this increment crosses the streak threshold
    if (previousPointsForDate < STREAK_CONFIG.RETENTION_POINTS && newPointsForDate >= STREAK_CONFIG.RETENTION_POINTS) {
      await this.userDAL.incrementStreak(userId);
      console.log(`[WORK-POINTS-SERVICE] 🔥 Streak incremented for user ${userId.substring(0, 8)}...`);
    }

    // Update rate-limiting timestamp
    await this.userDAL.updateLastWorkPointIncrement(userId, now);

    console.log(`[WORK-POINTS-SERVICE] ✅ Increment successful:`, {
      userId: `${userId.substring(0, 8)}...`,
      date: incrementData.date,
      previousPointsForDate,
      newPointsForDate
    });
  }

  /**
   * Apply new-day boundary logic: if the user missed 2+ days since their last streak increment,
   * reset streak and apply a penalty.
   * POST /api/users/work-points/new-day
   */
  async newDayOperation(userId: string, clientDate: string): Promise<void> {
    const streakInfo = await this.userDAL.getUserStreakInfo(userId);

    if (!streakInfo.lastStreakIncrement) {
      // No streak activity yet — nothing to penalise
      return;
    }

    // Compare calendar dates (strip time component from lastStreakIncrement)
    const last = streakInfo.lastStreakIncrement;
    const lastDateStr = `${last.getFullYear()}-${(last.getMonth() + 1).toString().padStart(2, '0')}-${last.getDate().toString().padStart(2, '0')}`;

    const lastMs = new Date(lastDateStr).getTime();
    const clientMs = new Date(clientDate).getTime();
    const daysDiff = Math.round((clientMs - lastMs) / (1000 * 60 * 60 * 24));

    if (daysDiff <= 1) {
      // Yesterday or today — streak still alive
      return;
    }

    // 2+ days gap — break streak and apply penalty
    console.log(`[WORK-POINTS-SERVICE] 💔 Streak broken for ${userId.substring(0, 8)}... (${daysDiff} days since last increment)`);
    await this.userDAL.applyStreakPenalty(userId, STREAK_CONFIG.DAILY_PENALTY_POINTS);
  }

  /**
   * Check if user has work points for a specific date
   */
  async hasWorkPointsForDate(userId: string, date: string): Promise<boolean> {
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    this.validateDateString(date);

    const entries = await this.userWorkPointsDAL.findByUserAndDate(userId, date);
    return entries.length > 0 && entries.some(entry => entry.workPoints > 0);
  }

  /**
   * Get total work points for a specific date (across all devices)
   */
  async getTotalWorkPointsForDate(userId: string, date: string): Promise<number> {
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    this.validateDateString(date);

    const entries = await this.userWorkPointsDAL.findByUserAndDate(userId, date);
    return entries.reduce((total, entry) => total + entry.workPoints, 0);
  }

  /**
   * Generate a simple device fingerprint
   */
  generateDeviceFingerprint(userAgent?: string, timestamp?: number): string {
    const ua = userAgent || 'unknown-device';
    const ts = timestamp || Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `device_${Buffer.from(`${ua}_${ts}_${random}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16)}`;
  }

  private validateDateForIncrement(date: string): void {
    if (!date || typeof date !== 'string') {
      throw new ValidationError('Date must be a string');
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new ValidationError('Date must be in YYYY-MM-DD format');
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      throw new ValidationError('Invalid date');
    }

    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - parsedDate.getTime()) / (1000 * 60 * 60 * 24));
    if (Math.abs(daysDiff) > 7) {
      throw new ValidationError('Date must be within 7 days of today');
    }
  }

  private validateDateString(date: string): void {
    if (!date || typeof date !== 'string') {
      throw new ValidationError('Date must be a string');
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new ValidationError('Date must be in YYYY-MM-DD format');
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      throw new ValidationError('Invalid date');
    }

    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - parsedDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff > 365) {
      throw new ValidationError('Date cannot be more than 365 days in the past');
    }
    if (daysDiff < -7) {
      throw new ValidationError('Date cannot be more than 7 days in the future');
    }
  }
}
