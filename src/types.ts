// Frontend types for the vocabulary learning application

// Language type for multi-language support
export type Language = 'zh' | 'ja' | 'ko' | 'vi';

// Language display names
export const LANGUAGE_NAMES: Record<Language, string> = {
  zh: 'Chinese (Mandarin)',
  ja: 'Japanese',
  ko: 'Korean',
  vi: 'Vietnamese'
};

// HSK Level type for vocabulary entries
export type HskLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6';

// Flashcard Category type for spaced repetition
export type FlashcardCategory = 'Unfamiliar' | 'Target' | 'Comfortable' | 'Mastered';

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
  tone?: string | null;
  hskLevelTag?: HskLevel | null;
  category?: FlashcardCategory;
  starterPackBucket?: StarterPackBucket | null;
  breakdown?: Record<string, { definition: string; pronunciation?: string }> | null;
  synonyms?: string[];
  synonymsMetadata?: Record<string, { definition: string; pronunciation: string }> | null; // Computed at runtime by server
  expansion?: string | null;
  expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;
  expansionLiteralTranslation?: string | null;
  exampleSentences?: Array<{
    chinese: string;
    english: string;
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string }>;
  }>;
  relatedWords?: Array<{ id: number; entryKey: string; pronunciation: string | null; definition: string | null }>;
  createdAt: string;
}

// Manual per-entry override for display fields; mirrors server ShortDefinitionPronunciationOverride
export interface ShortDefinitionPronunciationOverride {
  definition?: string | null;    // Replaces computed shortDefinition
  pronunciation?: string | null; // Replaces DictionaryEntry.pronunciation (space-separated, e.g. "fēng kuáng")
}

// Dictionary Entry type for multi-language dictionaries
export interface DictionaryEntry {
  id: number;
  language: Language;
  word1: string;          // Primary word (simplified/kanji/hangul/word)
  word2: string | null;   // Secondary word (traditional/kana/hanja/null)
  pronunciation: string | null; // Pronunciation — may be overridden by shortDefinitionPronunciationOverride.pronunciation
  numberedPinyin?: string | null;
  tone?: string | null;
  partsOfSpeech?: string[] | null;
  definitions: string[]; // Array of definition strings
  shortDefinitionPronunciationOverride?: ShortDefinitionPronunciationOverride | null; // Raw override object from DB
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
  breakdown?: Record<string, { definition: string; pronunciation?: string }> | null;
  synonyms?: string[] | null;
  exampleSentences?: Array<{
    chinese: string;
    english: string;
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string }>;
  }> | null;
  expansion?: string | null;
  expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;
  expansionLiteralTranslation?: string | null;
}

// Combined vocab lookup response
export interface VocabLookupResponse {
  personalEntries: VocabEntry[];
  dictionaryEntries: DictionaryEntry[];
}

// User model type
export interface User {
  id: string; // uniqueidentifier in SQL
  email: string;
  name: string;
  password?: string; // Not returned to client
  isPublic?: boolean;
  selectedLanguage?: Language;
  createdAt?: Date;
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

// API response type
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  code?: string;
}
