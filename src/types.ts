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

// Generalized difficulty band stored in dictionaryentries_*.difficulty (drives the
// discover band). One 1..6 integer scale for every language; the column is a
// smallint (migration 92, finishing migration 79's intent), so these are NUMBERS:
//   - zh: 1..6 — these ARE HSK levels (1 = HSK1 .. 6 = HSK6); the UI re-adds an
//     "HSK n" badge for zh.
//   - es: 1..6  (learner-acquisition difficulty, 1=easiest)
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5 | 6;

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
 * Per-card snap toggles for the flashcard icon editor (vet."snapConfig", migration 88;
 * see docs/CARD_ICON_LAYOUT.md). Each flag quantizes one editor gesture to a discrete
 * increment (move grid / 22.5° rotation / 5%-of-width size). NULL on the row = all off.
 */
export interface SnapConfig {
  move: boolean;
  rotate: boolean;
  resize: boolean;
}

/**
 * Which back-face text block a movable-text placement targets (vet."textLayout",
 * migration 91; see docs/CARD_ICON_LAYOUT.md). `foreign` = the Chinese/Spanish word
 * glyphs (+ pinyin); `english` = the English definition.
 */
export type TextBlock = 'foreign' | 'english';

/**
 * One movable text block's placement (vet."textLayout", migration 91). Coordinates are
 * NORMALIZED (fractions of the rendered card size) like IconLayoutItem, so a saved layout
 * survives the card being shown at different pixel sizes. Unlike icons there is no iconId,
 * no flipX (mirrored text is unreadable), and no z (text always paints ABOVE the icon
 * layer). See docs/CARD_ICON_LAYOUT.md.
 */
export interface TextLayoutItem {
  x: number;        // block CENTER as a fraction of card WIDTH  [0..1]
  y: number;        // block CENTER as a fraction of card HEIGHT [0..1]
  scale: number;    // multiplier on the block's base font size; clamped ~[0.5, 3]
  rotation: number; // degrees
  locked?: boolean; // when true the block ignores canvas translate/resize/rotate gestures (the "lock" toolbar action); omitted/false = freely editable
}

/**
 * Per-card movable-text placement for the two back-face text blocks (vet."textLayout",
 * migration 91; see docs/CARD_ICON_LAYOUT.md). Each block is optional — an absent block
 * renders at its default lower-third spot. NULL on the row = both blocks at default.
 */
export interface TextLayout {
  foreign?: TextLayoutItem;
  english?: TextLayoutItem;
}

/**
 * One side of a per-card text-color override (vet."textColors", migration 89). 'theme'
 * follows the device/app theme (the default), 'dark' forces black, 'light' forces white.
 */
export type TextColorMode = 'theme' | 'dark' | 'light';

/**
 * Per-card flashcard text-color overrides (vet."textColors", migration 89; see
 * docs/CARD_ICON_LAYOUT.md). `foreign` colors the foreign-word GLYPHS (the Chinese
 * characters / Spanish word) — the pinyin overlay is never affected; `english` colors the
 * English definition. NULL on the row = both 'theme'.
 */
export interface TextColors {
  foreign: TextColorMode;
  english: TextColorMode;
}

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
  snapConfig?: SnapConfig | null;  // Per-card icon-editor snap toggles (vet column, migration 88). NULL = all off. See docs/CARD_ICON_LAYOUT.md
  textColors?: TextColors | null;  // Per-card flashcard text-color overrides (vet column, migration 89). NULL = both 'theme'. See docs/CARD_ICON_LAYOUT.md
  textLayout?: TextLayout | null;  // Per-card movable-text placement for the two back-face text blocks (vet column, migration 91). NULL = default lower-third layout. See docs/CARD_ICON_LAYOUT.md
  cardColor?: string | null;  // Per-card flashcard background fill (CSS hex, vet column, migration 94). NULL = follow theme. See docs/CARD_ICON_LAYOUT.md
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
  definitions: string[]; // Array of definition strings (flat cache)
  definitionClusters?: DefinitionCluster[] | null;  // Orthogonal sense clusters (zh; migration 90) — see docs/DEFINITION_CLUSTERS.md
  shortDefinitionPronunciationOverride?: ShortDefinitionPronunciationOverride | null; // Raw override object from DB
  shortDefinition?: string | null;
  longDefinition?: string | null;
  longDefinitionParts?: LongDefinitionPart[] | null;  // Computed at runtime: longDefinition split into English + cpcd-able Chinese runs
  discoverable?: boolean;  // Whether the entry appears in vocab discovery (set during data import). Undiscoverable entries are lookup-only.
  createdAt: string;
}

// One orthogonal sense cluster within a Chinese entry's `definitionClusters`
// (migration 90). Glosses sharing one core meaning are grouped and ordered
// prototypical→vernacular within the cluster; clusters are mutually orthogonal.
// See docs/DEFINITION_CLUSTERS.md.
export interface DefinitionCluster {
  sense: string;                  // short English label for the shared meaning
  reading: string;                // numbered pinyin for THIS sense (heteronyms differ, e.g. 会计 → "kuai4")
  pos: string | string[] | null;  // part(s) of speech for this sense
  vernacularScore: number | null; // 1–5 register, scored independently per cluster
  glosses: string[];              // verbatim source glosses, ordered prototypical→vernacular
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
  difficulty?: DifficultyLevel | null;
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
  // Sort-pack card state (set by the pack supply). `sorted` → the user already has a
  // library row for this card: it renders locked with a "sorted!" watermark and is not
  // draggable. `skipped` → currently in discover_skips but shown inside an authored
  // pack, so it is draggable again.
  sorted?: boolean;
  skipped?: boolean;
}

/**
 * A sort pack: the on-deck unit of the discover sort flow — up to 3 cards to sort.
 * Authored packs come from the sort_packs table; system fallback packs-of-1 are
 * built on the fly. No sentence is shown in this flow.
 */
export interface SortPack {
  packKey: string;            // "pack:<id>" (authored) | "single:<cardId>" (fallback)
  packId: number | null;      // sort_packs.id for authored; null for fallback singles
  level: number;
  cards: DiscoverCard[];
}

// GET /api/starter-packs/:language response shape — the initial FIFO queue fill.
// The server owns all leveling; the client just shows these cards in order.
export interface DiscoverFetchResponse {
  packs: SortPack[];  // the client holds a short FIFO queue of packs (on-deck + buffer)
  exhausted: boolean; // true only when the whole discoverable dictionary is sorted
  level: number;      // user's estimated difficulty level — DISPLAY ONLY (a chip), never a filter
}

// POST /api/starter-packs/next-pack response: one replacement pack for the FIFO tail,
// requested when the on-deck pack completes.
export interface DiscoverNextPackResponse {
  nextPack: SortPack | null; // null when exhausted
  exhausted: boolean;
  level: number;
}

// POST /api/starter-packs/sort response (pack mode, per-card). The client owns its
// pack queue, so there is no replacement card — only the (possibly updated) level.
export interface DiscoverSortResponse {
  success: boolean;
  bucket: string;
  level: number;
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
