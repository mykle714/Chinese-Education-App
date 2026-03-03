// Work Points related TypeScript type definitions

export interface UserWorkPoints {
  userId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  deviceFingerprint: string;
  workPoints: number;
  lastSyncTimestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWorkPointsCreateData {
  userId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  deviceFingerprint: string;
  workPoints: number;
}

export interface UserWorkPointsUpdateData {
  workPoints: number;
}

// API Request/Response types

export interface WorkPointsIncrementRequest {
  date: string; // ISO date string (YYYY-MM-DD) - client's local date
}

export interface WorkPointsNewDayRequest {
  date: string; // ISO date string (YYYY-MM-DD) - client's local date for today
}
