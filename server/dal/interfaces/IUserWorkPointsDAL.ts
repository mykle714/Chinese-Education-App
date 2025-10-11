import { ITransaction } from '../../types/dal.js';
import {
  UserWorkPoints,
  UserWorkPointsCreateData,
  UserWorkPointsUpdateData,
} from '../../types/workPoints.js';

export interface IUserWorkPointsDAL {
  // Core CRUD operations
  findByUserAndDate(userId: string, date: string): Promise<UserWorkPoints[]>;
  findByUserAndDateAndDevice(userId: string, date: string, deviceFingerprint: string): Promise<UserWorkPoints | null>;
  upsertWorkPoints(userId: string, date: string, deviceFingerprint: string, workPoints: number): Promise<UserWorkPoints>;
  
  // User queries
  findByUserId(userId: string, limit?: number, offset?: number): Promise<UserWorkPoints[]>;
  findByUserIdInDateRange(userId: string, startDate: string, endDate: string): Promise<UserWorkPoints[]>;
  
  // Transaction support
  upsertWorkPointsWithTransaction(
    userId: string,
    date: string,
    deviceFingerprint: string,
    workPoints: number,
    transaction: ITransaction
  ): Promise<UserWorkPoints>;
}
