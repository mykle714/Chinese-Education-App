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