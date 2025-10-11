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
  
  // User statistics and analytics
  getUserStats(id: string): Promise<{
    totalVocabEntries: number;
    createdAt: Date;
  }>;
  
  // Batch operations
  findUsersCreatedAfter(date: Date): Promise<User[]>;
  findUsersWithVocabCount(): Promise<Array<User & { vocabCount: number }>>;
  
  // Total work points operations
  getTotalWorkPoints(userId: string): Promise<number>;
  updateTotalWorkPoints(userId: string, totalPoints: number): Promise<boolean>;
  incrementTotalWorkPoints(userId: string, pointsToAdd: number): Promise<boolean>;
}
