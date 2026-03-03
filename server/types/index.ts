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
  selectedLanguage?: Language;
  isPublic?: boolean; // Whether user appears on public leaderboard
  lastWorkPointIncrement?: Date; // Timestamp of last successful work point increment (for rate limiting)
  createdAt?: Date;
}

// User creation data type
export interface UserCreateData {
  email: string;
  name: string;
  password: string;
  isPublic?: boolean; // Defaults to true in database
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
  selectedLanguage?: Language;
  isPublic?: boolean;
}

// Auth response type
export interface AuthResponse {
  user: Omit<User, 'password'>;
  token: string;
}

// Language type for multi-language support
export type Language = 'zh' | 'ja' | 'ko' | 'vi';

// HSK Level type for vocabulary entries
export type HskLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6';

// Dictionary Entry type for multi-language dictionaries
export interface DictionaryEntry {
  id: number;
  language: Language;
  word1: string;          // Primary word (simplified/kanji/hangul/word)
  word2: string | null;   // Secondary word (traditional/kana/hanja/null)
  pronunciation: string | null; // Pronunciation (pinyin/romaji/romanization/null)
  tone?: string | null;   // Tone digits derived from pronunciation (e.g. "12" for fēng kuáng)
  definitions: string[];  // Parsed JSON array
  discoverable: boolean;
  script?: string | null;
  hskLevelTag?: string | null;
  breakdown?: Record<string, { definition: string }> | null;
  synonyms?: string[] | null;
  exampleSentences?: Array<{ chinese: string; english: string; usage: string }> | null;
  partsOfSpeech?: string[] | null;
  expansion?: string | null;
  expansionMetadata?: Record<string, { definition: string; pronunciation: string }> | null;
  shortDefinition?: string | null;
  longDefinition?: string | null;
  createdAt: string;
}

// Discover Card type — a curated DictionaryEntry shaped for the sort-cards UI
export interface DiscoverCard {
  id: number;               // dictionaryEntry.id — sent in sort POST
  entryKey: string;         // word1
  entryValue: string;       // definitions[0]
  pronunciation?: string | null;
  tone?: string | null;
  language: Language;
  word2?: string | null;
  script?: string | null;
  hskLevelTag?: string | null;
  breakdown?: Record<string, { definition: string }> | null;
  synonyms?: string[] | null;
  exampleSentences?: Array<{ chinese: string; english: string; usage: string }> | null;
  partsOfSpeech?: string[] | null;
  expansion?: string | null;
  expansionMetadata?: Record<string, { definition: string; pronunciation: string }> | null;
}

export interface DictionaryEntryCreateData {
  language: Language;
  word1: string;
  word2?: string | null;
  pronunciation?: string | null;
  definitions: string; // JSON string
}

// ReviewMark type for flashcard review history
export interface ReviewMark {
  timestamp: string;  // ISO-8601 date string
  isCorrect: boolean;
}

// FlashcardCategory enum for categorizing cards based on last 8 performance
export enum FlashcardCategory {
  UNFAMILIAR = 'Unfamiliar',
  TARGET = 'Target',
  COMFORTABLE = 'Comfortable',
  MASTERED = 'Mastered'
}

// Starter pack bucket type
export type StarterPackBucket = 'library' | 'learn-later' | 'skip';

// VocabEntry model type
export interface VocabEntry {
  id: number;
  userId: string;
  entryKey: string;
  entryValue: string;
  language: Language;
  script?: string;
  pronunciation?: string | null;
  tone?: string | null;   // Tone digits derived from pronunciation (e.g. "12" for fēng kuáng)
  hskLevelTag?: HskLevel | null;
  markHistory?: ReviewMark[];  // Last 16 flashcard mark results
  totalMarkCount?: number;  // Total cumulative count of all marks
  totalCorrectCount?: number;  // Lifetime count of correct marks
  totalSuccessRate?: number;  // Lifetime success rate (0.0 to 1.0)
  last8SuccessRate?: number;  // Success rate for last 8 marks (0.0 to 1.0)
  last16SuccessRate?: number;  // Success rate for last 16 marks (0.0 to 1.0)
  category?: FlashcardCategory;  // Category based on last 8 performance
  starterPackBucket?: StarterPackBucket | null;  // Starter pack sorting bucket
  breakdown?: Record<string, { definition: string }> | null;  // Character breakdown for Chinese vocab
  synonyms?: string[];  // Array of Chinese synonym words
  expansion?: string | null;  // Expanded/fuller form of word (e.g., 不知不觉 → 不知道不觉得)
  expansionMetadata?: Record<string, { definition: string; pronunciation: string }> | null;  // Character breakdown for expansion string
  exampleSentences?: Array<{ chinese: string; english: string; usage: string }>;  // Example sentences showing different uses
  partsOfSpeech?: string[];  // Possible parts of speech (noun, verb, adj, etc.)
  relatedWords?: Array<{ id: number; entryKey: string; sharedCharacters: string[]; successRate: number | null }>;  // Related library words (computed dynamically)
  createdAt: Date;
}

// VocabEntry creation data type
export interface VocabEntryCreateData {
  userId: string;
  entryKey: string;
  entryValue: string;
  language: Language;
  script?: string;
  pronunciation?: string | null;
  hskLevelTag?: HskLevel | null;
}

// VocabEntry update data type
export interface VocabEntryUpdateData {
  entryKey?: string;
  entryValue: string;
  language?: Language;
  script?: string;
  pronunciation?: string | null;
  hskLevelTag?: HskLevel | null;
}

// Request parameters type
export interface RequestParams {
  id: string | number;
}

// Text model type for reader feature
export interface Text {
  id: string;
  userId?: string | null; // uniqueidentifier in SQL, nullable for system texts
  title: string;
  description: string;
  content: string;
  language: Language;
  characterCount: number;
  isUserCreated: boolean; // Flag to distinguish user-created from system texts
  createdAt: string;
}

// Text creation data type
export interface TextCreateData {
  userId: string;
  title: string;
  description?: string;
  content: string;
  language?: Language;
}

// Text update data type
export interface TextUpdateData {
  title?: string;
  description?: string;
  content?: string;
  language?: Language;
}


// API response type
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  code?: string;
}
