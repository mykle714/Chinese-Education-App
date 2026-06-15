// Frontend types for the vocabulary learning application

// Language type for multi-language support.
// Only Chinese and Spanish are user-selectable for now; ja/ko/vi are not yet
// supported (their per-language dictionary tables don't exist — see CLAUDE.md).
export type Language = 'zh' | 'es';

// Language display names
export const LANGUAGE_NAMES: Record<Language, string> = {
  zh: 'Chinese (Mandarin)',
  es: 'Spanish'
};

// Per-language difficulty label stored in dictionaryentries_*.difficulty (drives
// the discover band). The encoding differs by language:
//   - zh: 'HSK1'..'HSK6' (HSK proficiency, also shown as an "HSK 3" badge)
//   - es: '1'..'5'       (learner-acquisition difficulty, 1=easiest)
export type DifficultyLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6' | '1' | '2' | '3' | '4' | '5';

// Particle or classifier annotation for a segment in example sentence metadata
export interface ParticleOrClassifierInfo {
  type: 'particle' | 'classifier';
  definition: string;
}

// One ordered piece of a long definition split into English prose vs. embedded Chinese.
// `text` parts render as plain prose; `foreign` parts carry the same segmentation payload
// as an example sentence so they render as cpcd with the hover/tap popup. Computed by the
// server (enrichLongDefinitionMetadataBatch); mirrors the server LongDefinitionPart type.
export type LongDefinitionPart =
  | { type: 'text'; value: string }
  | {
      type: 'foreign';
      foreignText: string;
      _segments: string[];
      segmentMetadata: Record<string, { pronunciation?: string; definition?: string; particleOrClassifier?: ParticleOrClassifierInfo; wordForms?: Record<string, string> }>;
    };

// Flashcard Category type for spaced repetition
export type FlashcardCategory = 'Unfamiliar' | 'Target' | 'Comfortable' | 'Mastered';

// Starter pack bucket type
export type StarterPackBucket = 'library' | 'skip';

// One "used in" suggestion: a multi-char word containing a single-char headword.
// vet-first (user's own entries) then det-fallback; vocabEntryId === null ⇒ det fallback.
export interface UsedInItem {
  vocabEntryId: number | null;
  entryKey: string;
  pronunciation: string | null;
  definition: string | null;
  vernacularScore: number | null;
}

// Canonical VocabEntry model shared across the whole frontend (flashcards,
// card detail, discover, dictionary adapters, etc.). It is a superset: a
// server-sourced vet row carries identity fields (userId/language) and synonym
// metadata, while a synthetic det-fallback entry from dictEntryAdapter omits
// them — so those identity fields are optional rather than required.
export interface VocabEntry {
  id: number;
  userId?: string;            // absent on det-fallback (non-vet) entries
  entryKey: string;
  definition?: string | null;  // det.definitions[0] — joined from dictionaryentries at read time
  longDefinition?: string | null;
  longDefinitionParts?: LongDefinitionPart[] | null;  // Computed at runtime: longDefinition split into English + cpcd-able Chinese runs
  language?: Language;         // absent on det-fallback entries
  script?: string;
  pronunciation?: string | null;
  tone?: string | null;
  difficulty?: DifficultyLevel | null;
  partsOfSpeech?: string[] | null;
  // Spanish (es) only: the saved sense's part of speech + whether this word1 has
  // multiple discoverable POS (so the UI shows a "(v)"/"(n)" disambiguation badge),
  // plus the secondary gender-homograph gloss. Null/false for Chinese.
  pos?: string | null;
  hasMultiplePos?: boolean;
  alternateGender?: string | null;
  alternateMeaning?: string | null;
  vernacularScore?: number | null;  // 1=literary … 5=natural colloquial
  category?: FlashcardCategory;
  starterPackBucket?: StarterPackBucket | null;
  breakdown?: Record<string, { definition: string; pronunciation?: string }> | null;
  synonyms?: string[];
  synonymsMetadata?: Record<string, { definition: string; pronunciation: string }> | null; // Computed at runtime by server
  expansion?: string | null;
  expansionSegments?: string[] | null;  // GSA word tokens for the expansion string
  expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;
  expansionLiteralTranslation?: string | null;
  iconId?: string | null;  // Representative icons8 icon joined from det; rendered via <img src="/api/icons8/<iconId>/image">
  exampleSentences?: Array<{
    foreignText: string;
    english: string;
    tense?: 'past' | 'present' | 'future';
    partOfSpeechDict?: Record<string, string>;  // AI-generated POS tag per sentence token; absent on det-adapter entries
    translatedVocab?: string;  // English word/phrase in the translation corresponding to the vocab word
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string; particleOrClassifier?: ParticleOrClassifierInfo; wordForms?: Record<string, string> }>;
  }>;
  relatedWords?: Array<{ id: number; entryKey: string; pronunciation: string | null; definition: string | null }>;
  // Single-char zh only: up to 5 multi-char words containing this character (vet-first, det-fallback).
  usedIn?: UsedInItem[] | null;
  // Set by the server after pre-warming the TTS cache for this card. `false`
  // means synthesis errored; the client should fall back to Web Speech. Absent
  // means the server didn't run a prewarm — treat as truthy.
  hasAudio?: boolean;
  createdAt: string;
}

// Manual per-entry override for display fields; mirrors server ShortDefinitionPronunciationOverride
export interface ShortDefinitionPronunciationOverride {
  definition?: string | null;    // Replaces computed shortDefinition
  pronunciation?: string | null; // Replaces DictionaryEntry.pronunciation (space-separated, e.g. "fēng kuáng")
}

// Manual per-entry override for example sentence segment popups; mirrors server ExampleSentenceDefinitionPronunciationOverride
export interface ExampleSentenceDefinitionPronunciationOverride {
  definition?: string | null;    // Shown verbatim in the segment popup instead of context-matched definition
  pronunciation?: string | null; // Shown verbatim in the segment popup instead of stored pronunciation
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
  vernacularScore?: number | null;  // 1=literary … 5=natural colloquial
  definitions: string[]; // Array of definition strings
  shortDefinitionPronunciationOverride?: ShortDefinitionPronunciationOverride | null; // Raw override object from DB
  shortDefinition?: string | null;
  longDefinition?: string | null;
  longDefinitionParts?: LongDefinitionPart[] | null;  // Computed at runtime: longDefinition split into English + cpcd-able Chinese runs
  createdAt: string;
}

// Discover Card type — a curated DictionaryEntry shaped for the sort-cards UI
export interface DiscoverCard {
  id: number;               // dictionaryEntry.id — sent in sort POST
  entryKey: string;         // word1
  definition: string;       // definitions[0]
  pronunciation?: string | null;
  tone?: string | null;
  language: Language;
  word2?: string | null;
  script?: string | null;
  difficulty?: string | null;
  // Spanish (es) only: this card's POS, and whether the word1 has multiple
  // discoverable POS (→ show a "(v)"/"(n)" badge). Null/false for Chinese.
  pos?: string | null;
  hasMultiplePos?: boolean;
  breakdown?: Record<string, { definition: string; pronunciation?: string }> | null;
  synonyms?: string[] | null;
  exampleSentences?: Array<{
    foreignText: string;
    english: string;
    tense?: 'past' | 'present' | 'future';
    partOfSpeechDict: Record<string, string>;  // AI-generated POS tag per sentence token (e.g. "particle", "verb", "noun")
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string; wordForms?: Record<string, string> }>;
  }> | null;
  expansion?: string | null;
  expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;
  expansionLiteralTranslation?: string | null;
}

// GET /api/starter-packs/:language response shape
export interface DiscoverFetchResponse {
  cards: DiscoverCard[];
  userDifficultyLevel: number;
  provisionalMode: boolean;
}

// POST /api/starter-packs/sort response shape
export interface DiscoverSortResponse {
  success: boolean;
  message: string;
  bucket: string;
  userDifficultyLevel: number;
  provisionalMode: boolean;
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
