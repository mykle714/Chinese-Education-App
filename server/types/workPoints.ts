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
export interface WorkPointsSyncRequest {
  date: string; // ISO date string (YYYY-MM-DD)
  workPoints: number;
  deviceFingerprint: string;
}

export interface WorkPointsSyncResponse {
  success: boolean;
  message: string;
  data: {
    date: string;
    workPoints: number;
    deviceFingerprint: string;
    synced: boolean;
  };
}

// Calendar data types
export interface CalendarDayData {
  date: string; // YYYY-MM-DD
  workPointsEarned: number; // Points earned that day
  penaltyAmount: number; // Points lost due to penalty (0 if no penalty)
  streakMaintained: boolean; // Whether user met the daily threshold
  isToday: boolean; // If this is today's date
  hasData: boolean; // Whether user has started tracking by this date
}

export interface CalendarDataResponse {
  month: string; // YYYY-MM
  days: CalendarDayData[];
  userFirstActivityDate: string | null; // First date user had any activity (YYYY-MM-DD)
}
