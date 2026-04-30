import { IBaseDAL } from './IBaseDAL.js';
import { User, UserCreateData, UserUpdateData } from '../../types/index.js';

/**
 * Interface for User Data Access Layer
 * Extends base DAL with user-specific operations
 */
export interface IUserDAL extends IBaseDAL<User, UserCreateData, UserUpdateData> {
  // User-specific query operations
  findByEmail(email: string): Promise<User | null>;
  findByEmailWithPassword(email: string): Promise<User | null>;

  // Password management
  updatePassword(id: string, hashedPassword: string): Promise<boolean>;

  // User deletion
  deleteUser(userId: string): Promise<boolean>;

  // User statistics and analytics
  getUserStats(id: string): Promise<{
    totalVocabEntries: number;
    createdAt: Date;
  }>;

  // Batch operations
  findUsersCreatedAfter(date: Date): Promise<User[]>;
  findUsersWithVocabCount(): Promise<Array<User & { vocabCount: number }>>;

  // Total minute points operations
  getTotalMinutePoints(userId: string): Promise<{ totalMinutePoints: number; currentStreak: number }>;
  updateTotalMinutePoints(userId: string, totalPoints: number): Promise<boolean>;
  incrementTotalMinutePoints(userId: string, pointsToAdd: number): Promise<boolean>;

  // Minute point increment rate limiting
  updateLastMinutePointIncrement(userId: string, timestamp: Date): Promise<boolean>;

  // Streak operations
  getUserStreakInfo(userId: string): Promise<{ currentStreak: number; lastStreakDate: string | null }>;
  setStreak(userId: string, currentStreak: number, lastStreakDate: string): Promise<boolean>;
  applyStreakPenalty(userId: string, penaltyPoints: number, lastStreakDate: string): Promise<boolean>;

  // Leaderboard operations (returns isPublic so callers can mask streak from non-public users)
  getAllUsersWithTotalPoints(): Promise<Array<{ userId: string; email: string; name: string; totalMinutePoints: number }>>;
  getPublicUsersWithTotalPoints(): Promise<Array<{ userId: string; email: string; name: string; totalMinutePoints: number; currentStreak: number; isPublic: boolean }>>;
}
