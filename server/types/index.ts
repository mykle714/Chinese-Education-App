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
  isPublic?: boolean; // Whether user appears on the public leaderboard
  avatarIconId?: string | null; // FK to icons8("icons8Id") — the icon chosen as profile avatar (migration 77)
  lastMinutePointIncrement?: Date; // Last successful minute-point increment (for rate limiting)
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
  avatarIconId?: string | null; // Set when the user picks/clears their profile avatar (migration 77)
}

// Auth response type
export interface AuthResponse {
  user: Omit<User, 'password'>;
  token: string;
}

// A stored refresh-token row (see migration 85). The raw token is never stored;
// `tokenHash` is its SHA-256 hex. `revokedAt === null` means currently valid.
export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  replacedByHash: string | null;
  userAgent: string | null;
}

// Language type for multi-language support.
// Only Chinese and Spanish are user-selectable for now; ja/ko/vi are not yet
// supported (their per-language dictionary tables don't exist — see CLAUDE.md).
export type Language = 'zh' | 'es';

// Generalized difficulty label stored in dictionaryentries_*.difficulty (drives the
// discover band). One bare-integer '1'..'6' scale for every language (migration 79):
//   - zh: '1'..'6' — these ARE HSK levels (1 = HSK1 .. 6 = HSK6), shown as an
//     "HSK 3" badge in the UI; only the stored 'HSK' prefix was dropped.
//   - es: '1'..'6'  (learner-acquisition difficulty, 1=easiest)
export type DifficultyLevel = '1' | '2' | '3' | '4' | '5' | '6';
export type TenseLabel = 'past' | 'present' | 'future';

// Particle or classifier annotation attached to a segmented character in example sentence metadata
export interface ParticleOrClassifierInfo {
  type: 'particle' | 'classifier';
  definition: string;
}

// Row type for the particlesandclassifiers reference table
export interface ParticleClassifierEntry {
  id: number;
  character: string;
  language: string;
  type: 'particle' | 'classifier';
  definition: string;
  createdAt: string;
}

// Manual per-entry override for display fields; stored as JSONB in dictionaryentries_zh."shortDefinitionPronunciationOverride"
export interface ShortDefinitionPronunciationOverride {
  definition?: string | null;    // Replaces computed shortDefinition
  pronunciation?: string | null; // Replaces DictionaryEntry.pronunciation (space-separated, e.g. "fēng kuáng")
}

// Manual per-entry override for example sentence segment popups; stored as JSONB in dictionaryentries_zh."exampleSentenceDefinitionPronunciationOverride"
export interface ExampleSentenceDefinitionPronunciationOverride {
  definition?: string | null;    // Shown verbatim in the segment popup instead of context-matched definition
  pronunciation?: string | null; // Shown verbatim in the segment popup instead of stored pronunciation
}

// One ordered piece of a long definition split into English prose vs. embedded Chinese.
// `text` parts render as plain prose; `foreign` parts carry the same segmentation payload
// as an example sentence so the client renders them as cpcd with the hover/tap popup.
export type LongDefinitionPart =
  | { type: 'text'; value: string }
  | {
      type: 'foreign';
      foreignText: string;
      _segments: string[];
      segmentMetadata: Record<string, { pronunciation?: string; definition?: string; particleOrClassifier?: ParticleOrClassifierInfo; wordForms?: Record<string, string> }>;
    };

// Dictionary Entry type for multi-language dictionaries
export interface DictionaryEntry {
  id: number;
  language: Language;
  script?: string | null;
  discoverable: boolean;
  createdAt: string;

  // Word forms and pronunciation
  word1: string;          // Primary word (simplified/kanji/hangul/word)
  word2: string | null;   // Secondary word (traditional/kana/hanja/null)
  pronunciation: string | null; // Pronunciation (pinyin/romaji/romanization/null)
  numberedPinyin?: string | null; // Numbered pinyin notation (e.g. "gan1 huo4")
  tone?: string | null;   // Tone digits derived from pronunciation (e.g. "12" for fēng kuáng)

  // Classification
  partsOfSpeech?: string[] | null;
  difficulty?: string | null;

  // Definitions
  definitions: string[];  // Parsed JSON array
  shortDefinitionPronunciationOverride?: ShortDefinitionPronunciationOverride | null; // Raw override object from DB
  shortDefinition?: string | null; // Resolved at runtime: override.definition ?? generateShortDefinition()
  exampleSentenceDefinitionPronunciationOverride?: ExampleSentenceDefinitionPronunciationOverride | null; // Raw override object from DB; applied verbatim in segment popups
  longDefinition?: string | null;
  longDefinitionParts?: LongDefinitionPart[] | null;  // Computed at runtime: longDefinition split into English + cpcd-able Chinese runs

  // AI-enriched content
  breakdown?: Record<string, { definition: string; pronunciation?: string }> | null;
  synonyms?: string[] | null;
  exampleSentences?: Array<{
    foreignText: string;
    english: string;
    translatedVocab?: string;  // English word/phrase in the translation that corresponds to the vocab word
    tense?: TenseLabel;        // Temporal meaning of the sentence: past, present, or future
    partOfSpeechDict: Record<string, string>;  // AI-generated POS tag per sentence token (e.g. "particle", "verb", "noun")
    numberDict?: Record<string, 'singular' | 'plural'>;  // AI-generated grammatical number per noun token; selects the plural English form in the segment popup
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string; particleOrClassifier?: ParticleOrClassifierInfo; wordForms?: Record<string, string> }>;
  }> | null;
  expansion?: string | null;
  expansionSegments?: string[] | null;  // GSA word tokens for the expansion string (e.g. ["不知", "不觉"])
  expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;  // Keyed by segment
  expansionLiteralTranslation?: string | null;
  matchException?: string[] | null;  // Multi-char tokens to suppress during GSA segmentation
  vernacularScore?: number | null;   // Higher = more colloquially common; used by GSA to prefer common words
  wordForms?: Record<string, string> | null;  // AI-generated English conjugation map (e.g. {past: "ran", present: "runs"})
};

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
  // Spanish (es) only: this card's POS + whether the word1 has multiple
  // discoverable POS (→ client shows a "(v)"/"(n)" badge). Null/false for Chinese.
  pos?: string | null;
  hasMultiplePos?: boolean;
  breakdown?: Record<string, { definition: string }> | null;
  synonyms?: string[] | null;
  exampleSentences?: Array<{
    foreignText: string;
    english: string;
    translatedVocab?: string;  // English word/phrase in the translation that corresponds to the vocab word
    tense?: TenseLabel;        // Temporal meaning of the sentence: past, present, or future
    partOfSpeechDict: Record<string, string>;  // AI-generated POS tag per sentence token (e.g. "particle", "verb", "noun")
    numberDict?: Record<string, 'singular' | 'plural'>;  // AI-generated grammatical number per noun token; selects the plural English form in the segment popup
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string; particleOrClassifier?: ParticleOrClassifierInfo; wordForms?: Record<string, string> }>;
  }> | null;
  expansion?: string | null;
  expansionSegments?: string[] | null;  // GSA word tokens for the expansion string (e.g. ["不知", "不觉"])
  expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;  // Keyed by segment
  expansionLiteralTranslation?: string | null;
  matchException?: string[] | null;  // Multi-char tokens to suppress during GSA segmentation
  // Optional icons8 icon id (FK → icons8."icons8Id"). When set, the client renders
  // the icon via <img src="/api/icons8/<iconId>/image">. Null when no icon assigned.
  iconId?: string | null;
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

// Starter pack bucket type — the value stored in vocabentries.starterPackBucket.
// Only 'library' persists in vet now: "Skip for now" deferrals moved to the
// discover_skips table (migration 80), so 'skip' is no longer a vet bucket value.
// (The discover API still ACCEPTS 'skip'/'already-learned' as input bucket names;
// they just don't map to this stored type.)
export type StarterPackBucket = 'library';

// Used-in item: a multi-char word that contains a given single character.
// Returned per single-char zh card by OnDeckVocabService.enrichWithUsedIn.
// vocabEntryId is null when the item came from the det fallback (not in the user's vet).
export interface UsedInItem {
  vocabEntryId: number | null;
  entryKey: string;
  pronunciation: string | null;
  definition: string | null;
  vernacularScore: number | null;
}

// VocabEntry model type
/**
 * One placed icon in a custom flashcard icon arrangement (vet."iconLayout", migration
 * 82; see docs/CARD_ICON_LAYOUT.md). Coordinates are NORMALIZED so a saved layout
 * survives the card being rendered at different pixel sizes across viewports.
 */
export interface IconLayoutItem {
  iconId: string;   // icons8 natural key (icons8."icons8Id"); rendered via /api/icons8/<id>/image
  x: number;        // icon CENTER as a fraction of card WIDTH  [0..1]
  y: number;        // icon CENTER as a fraction of card HEIGHT [0..1]
  scale: number;    // multiplier on the base icon box (~0.28 * cardWidth); clamped ~[0.25, 3]
  rotation: number; // degrees
  z: number;        // paint order (higher = front)
  flipX?: boolean;  // horizontal mirror (the "mirror" toolbar action); omitted/false = not mirrored
  locked?: boolean; // when true the icon ignores canvas translate/resize/rotate gestures (the "lock" toolbar action); omitted/false = freely editable
}

/** Max icons allowed in one custom arrangement (shared client/server cap). */
export const ICON_LAYOUT_MAX_ITEMS = 12;

/**
 * Per-card snap toggles for the flashcard icon editor (vet."snapConfig", migration 88;
 * see docs/CARD_ICON_LAYOUT.md). Each flag quantizes one editor gesture to a discrete
 * increment (move grid / 22.5° rotation / 5%-of-width size). NULL on the row = all off.
 */
export interface SnapConfig {
  move: boolean;
  rotate: boolean;
  resize: boolean;
}

export interface VocabEntry {
  id: number;
  userId: string;
  entryKey: string;
  definition?: string | null;  // det.definitions[0] — joined from dictionaryentries_zh at read time
  language: Language;
  script?: string;
  pronunciation?: string | null;
  tone?: string | null;   // Tone digits derived from pronunciation (e.g. "12" for fēng kuáng)
  difficulty?: DifficultyLevel | null;
  partsOfSpeech?: string[] | null;  // POS tags from dictionaryentries_zh (e.g. ["noun", "verb"])
  vernacularScore?: number | null;  // 1–5 register score from dictionaryentries_zh (1=literary, 5=natural colloquial)
  markHistory?: ReviewMark[];  // Last 16 flashcard mark results
  totalMarkCount?: number;  // Total cumulative count of all marks
  totalCorrectCount?: number;  // Lifetime count of correct marks
  totalSuccessRate?: number;  // Lifetime success rate (0.0 to 1.0)
  last8SuccessRate?: number;  // Success rate for last 8 marks (0.0 to 1.0)
  last16SuccessRate?: number;  // Success rate for last 16 marks (0.0 to 1.0)
  category?: FlashcardCategory;  // Category based on last 8 performance
  starterPackBucket: StarterPackBucket;  // Starter pack sorting bucket (required)
  breakdown?: Record<string, { definition: string; pronunciation?: string }> | null;  // Character breakdown for Chinese vocab
  synonyms?: string[];  // Array of Chinese synonym words
  synonymsMetadata?: Record<string, { definition: string; pronunciation: string }> | null;  // Computed at runtime by batch-reading from dictionaryentries_zh
  expansion?: string | null;  // Expanded/fuller form of word (e.g., 不知不觉 → 不知道不觉得)
  expansionSegments?: string[] | null;  // GSA word tokens for the expansion string — computed at runtime
  expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;  // Computed at runtime, keyed by segment
  expansionLiteralTranslation?: string | null;  // Literal phrase translation derived from expansion components
  longDefinition?: string | null;  // AI-generated extended definition (25–150 chars) from dictionaryentries_zh
  longDefinitionParts?: LongDefinitionPart[] | null;  // Computed at runtime: longDefinition split into English + cpcd-able Chinese runs
  iconId?: string | null;  // Representative icons8 icon (FK to icons8.icons8Id) joined from det; client renders via <img src="/api/icons8/<iconId>/image">
  iconLayout?: IconLayoutItem[] | null;  // Custom flashcard icon arrangement (vet column, migration 82). NULL = use the default centered iconId. See docs/CARD_ICON_LAYOUT.md
  snapConfig?: SnapConfig | null;  // Per-card icon-editor snap toggles (vet column, migration 88). NULL = all off. See docs/CARD_ICON_LAYOUT.md
  exampleSentences?: Array<{
    foreignText: string;
    english: string;
    translatedVocab?: string;  // English word/phrase in the translation that corresponds to the vocab word
    tense?: TenseLabel;        // Temporal meaning of the sentence: past, present, or future
    partOfSpeechDict: Record<string, string>;  // AI-generated POS tag per sentence token (e.g. "particle", "verb", "noun")
    numberDict?: Record<string, 'singular' | 'plural'>;  // AI-generated grammatical number per noun token; selects the plural English form in the segment popup
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string; particleOrClassifier?: ParticleOrClassifierInfo; wordForms?: Record<string, string> }>;
  }>;  // Example sentences enriched at runtime with greedy segmentation and per-segment metadata
  relatedWords?: Array<{ id: number; entryKey: string; pronunciation: string | null; definition: string | null }>;  // Related library words (computed dynamically)
  usedIn?: UsedInItem[] | null;  // Single-char zh only: multi-char words that contain this character (vet-first, det-fallback). Computed at runtime.
  hasAudio?: boolean;  // Pre-warm result from TTSService.synthesize — false means synthesis failed and the client should fall back to Web Speech for this card
  createdAt: Date;
}

// VocabEntry creation data type
export interface VocabEntryCreateData {
  userId: string;
  entryKey: string;
  language: Language;
  difficulty?: DifficultyLevel | null;
}

// VocabEntry update data type
export interface VocabEntryUpdateData {
  entryKey?: string;
  language?: Language;
  difficulty?: DifficultyLevel | null;
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
