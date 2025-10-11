// Custom error type with code and status code
export interface CustomError extends Error {
  code?: string;
  statusCode?: number;
}

// Database configuration type (now using PostgreSQL PoolConfig)
// The actual config is imported from 'pg' PoolConfig type
// This interface is kept for backward compatibility if needed
export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  ssl?: boolean | object;
}

// User model type
export interface User {
  id: string; // uniqueidentifier in SQL
  email: string;
  name: string;
  password?: string; // Not returned to client
  createdAt?: Date;
}

// User creation data type
export interface UserCreateData {
  email: string;
  name: string;
  password: string;
}

// User login data type
export interface UserLoginData {
  email: string;
  password: string;
}

// User update data type
export interface UserUpdateData {
  email?: string;
  name?: string;
  password?: string;
}

// Auth response type
export interface AuthResponse {
  user: Omit<User, 'password'>;
  token: string;
}

// HSK Level type for vocabulary entries
export type HskLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6';

// VocabEntry model type
export interface VocabEntry {
  id: number;
  userId: string;
  entryKey: string;
  entryValue: string;
  hskLevelTag?: HskLevel | null;
  createdAt: Date;
}

// VocabEntry creation data type
export interface VocabEntryCreateData {
  userId: string;
  entryKey: string;
  entryValue: string;
  hskLevelTag?: HskLevel | null;
}

// VocabEntry update data type
export interface VocabEntryUpdateData {
  entryKey?: string;
  entryValue: string;
  hskLevelTag?: HskLevel | null;
}

// Request parameters type
export interface RequestParams {
  id: string | number;
}

// Text model type for reader feature
export interface Text {
  id: string;
  title: string;
  description: string;
  content: string;
  createdAt: string;
  characterCount: number;
}

// OnDeckVocabSet model type
export interface OnDeckVocabSet {
  userId: string; // uniqueidentifier in SQL
  featureName: string;
  vocabEntryIds: number[]; // Will be JSON.parse'd from database
  updatedAt: Date;
}

// OnDeckVocabSet creation data type
export interface OnDeckVocabSetCreateData {
  featureName: string;
  vocabEntryIds: number[];
}

// OnDeckVocabSet update data type (same as create for this use case)
export interface OnDeckVocabSetUpdateData {
  vocabEntryIds: number[];
}

// API response type
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  code?: string;
}
