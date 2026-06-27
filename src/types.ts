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

// Generalized difficulty label stored in dictionaryentries_*.difficulty (drives the
// discover band). One bare-integer '1'..'6' scale for every language (migration 79):
//   - zh: '1'..'6' — these ARE HSK levels (1 = HSK1 .. 6 = HSK6); the UI re-adds an
//     "HSK n" badge for zh. Only the stored 'HSK' prefix was dropped.
//   - es: '1'..'6'  (learner-acquisition difficulty, 1=easiest)
export type DifficultyLevel = '1' | '2' | '3' | '4' | '5' | '6';

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

/**
 * One placed icon in a custom flashcard icon arrangement (vet."iconLayout", migration
 * 82; see docs/CARD_ICON_LAYOUT.md). Coordinates are NORMALIZED (fractions of the
 * rendered card size) so a saved layout survives the card being shown at different
 * pixel sizes across viewports.
 */
export interface IconLayoutItem {
  iconId: string;   // icons8 natural key; rendered via /api/icons8/<id>/image
  x: number;        // icon CENTER as a fraction of card WIDTH  [0..1]
  y: number;        // icon CENTER as a fraction of card HEIGHT [0..1]
  scale: number;    // multiplier on the base icon box (~0.28 * cardWidth); clamped ~[0.25, 3]
  rotation: number; // degrees
  z: number;        // paint order (higher = front)
  flipX?: boolean;  // horizontal mirror (the "mirror" toolbar action); omitted/false = not mirrored
  locked?: boolean; // when true the icon ignores canvas translate/resize/rotate gestures (the "lock" toolbar action); omitted/false = freely editable
}

/** Max icons allowed in one custom arrangement (mirrors the server cap). */
export const ICON_LAYOUT_MAX_ITEMS = 12;

/**
 * A community-shared advanced card-icon design surfaced on the Community page
 * (docs/COMMUNITY_PAGE.md). Identity = (ownerUserId, entryKey, language). Carries just enough
 * det fields to render the read-only mini card / zoom.
 */
export interface CommunityDesign {
  ownerUserId: string;
  ownerName?: string | null;
  entryKey: string;
  language: Language;
  iconLayout: IconLayoutItem[] | null;
  pronunciation?: string | null;
  tone?: string | null;
  script?: string | null;
  definition?: string | null;
  /** Votes since the viewer's current week boundary. */
  voteCountThisWeek: number;
  /** Whether the viewer already has this word saved (drives the apply-button label). */
  inLibrary: boolean;
}

/** A design the viewer voted on this week (identity key only) — used to grey voted designs. */
export interface VotedDesignKey {
  ownerUserId: string;
  entryKey: string;
  language: Language;
}

export type VoteResult = 'recorded' | 'already-voted';
export type ApplyDesignResult = 'applied' | 'added-and-applied' | 'would-override';

/** Composite key for a design within one language feed (ownerUserId|entryKey). */
export const designKey = (d: { ownerUserId: string; entryKey: string }) =>
  `${d.ownerUserId}|${d.entryKey}`;

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
  iconLayout?: IconLayoutItem[] | null;  // Custom flashcard icon arrangement (vet column, migration 82). NULL = use the default centered iconId. See docs/CARD_ICON_LAYOUT.md
  exampleSentences?: Array<{
    foreignText: string;
    english: string;
    tense?: 'past' | 'present' | 'future';
    partOfSpeechDict?: Record<string, string>;  // AI-generated POS tag per sentence token; absent on det-adapter entries
    numberDict?: Record<string, 'singular' | 'plural'>;  // AI-generated grammatical number per noun token; selects the plural English form in the segment popup
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
  // Whether the source det row is marked discoverable (appears in vocab
  // discovery). Carried through dictEntryAdapter so the dictionary EIP can hide
  // the "+ to Learn Now" button for undiscoverable lookups. Absent on real vet
  // rows (already in the library by definition).
  discoverable?: boolean;
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
  discoverable?: boolean;  // Whether the entry appears in vocab discovery (set during data import). Undiscoverable entries are lookup-only.
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
    numberDict?: Record<string, 'singular' | 'plural'>;  // AI-generated grammatical number per noun token; selects the plural English form in the segment popup
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string; wordForms?: Record<string, string> }>;
  }> | null;
  expansion?: string | null;
  expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;
  expansionLiteralTranslation?: string | null;
  // Optional icons8 icon assigned to this entry (icons8Id); the client renders
  // the icon via <img src="/api/icons8/<iconId>/image">. Null when no icon assigned.
  iconId?: string | null;
}

// GET /api/starter-packs/:language response shape — the initial FIFO queue fill.
// The server owns all leveling; the client just shows these cards in order.
export interface DiscoverFetchResponse {
  cards: DiscoverCard[];
  exhausted: boolean; // true only when the whole discoverable dictionary is sorted
  level: number;      // user's estimated difficulty level — DISPLAY ONLY (a chip), never a filter
}

// POST /api/starter-packs/sort response shape. A sort shrinks the client queue by
// one, so the response carries the single replacement card (nextCard) for the tail —
// there is no separate "load more" call.
export interface DiscoverSortResponse {
  success: boolean;
  message: string;
  bucket: string;
  nextCard: DiscoverCard | null; // replacement for the queue tail; null when exhausted
  exhausted: boolean;
  level: number;                 // user's (possibly updated) estimated level — DISPLAY ONLY
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
