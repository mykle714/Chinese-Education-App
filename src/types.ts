// Frontend types for the vocabulary learning application

// HSK Level type for vocabulary entries
export type HskLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6';

// VocabEntry model type
export interface VocabEntry {
  id: number;
  userId: string;
  entryKey: string;
  entryValue: string;
  hskLevelTag?: HskLevel | null;
  createdAt: string;
}

// User model type
export interface User {
  id: string; // uniqueidentifier in SQL
  email: string;
  name: string;
  password?: string; // Not returned to client
  createdAt?: Date;
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

// API response type
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  code?: string;
}
