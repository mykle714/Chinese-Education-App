// The stored shapes of the `longDefinition` JSONB column (per-sense array for zh,
// per-POS object for es/legacy). Defined in utils/definitions.ts alongside its
// resolvers; that module imports nothing, so this direction introduces no cycle.
import type { LongDefinitionValue } from '../utils/definitions.js';

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
  isValidator?: boolean; // Whether user may download/validate dictionary entries (migration 104, docs/DATA_VALIDATION_SYSTEM.md)
  isTemplateAuthor?: boolean; // Whether user may author Night Market templates (the template editor + save endpoints) (migration 115). Distinct from isValidator.
  avatarIconId?: string | null; // FK to icons8("icons8Id") — the icon chosen as profile avatar (migration 77)
  readingGoal?: boolean; // Account opts into the Reading mastery goal (migration 101, docs/MASTERY_REWORK.md)
  writingGoal?: boolean; // Account opts into the Writing mastery goal (migration 101, docs/MASTERY_REWORK.md)
  showSegmentSpaces?: boolean; // Display pref: gap between word segments in segmented sentences (migration 129, docs/EXAMPLE_SENTENCES.md)
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
  readingGoal?: boolean; // Toggled in account settings (migration 101)
  writingGoal?: boolean; // Toggled in account settings (migration 101)
  showSegmentSpaces?: boolean; // Toggled in account settings (migration 129)
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

// Generalized difficulty band stored in dictionaryentries_*.difficulty (drives the
// discover band). One 1..6 integer scale for every language; the column is a
// smallint (migration 92, finishing migration 79's intent), so these are NUMBERS:
//   - zh: 1..6 — these ARE HSK levels (1 = HSK1 .. 6 = HSK6), shown as an
//     "HSK 3" badge in the UI.
//   - es: 1..6  (learner-acquisition difficulty, 1=easiest)
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5 | 6;
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

// An English translation of ONE Chinese run cited inside a long definition / comparison
// paragraph, keyed by the run's exact text. Stored in dictionaryentries_zh."longDefinitionCitations"
// (migration 126) and word_comparison_cache.citations (migration 127); attached to the matching
// `foreign` part at read time. See docs/DEFINITION_MAPPING.md.
export interface LongDefinitionCitation {
  zh: string;   // the embedded Chinese run, verbatim (the join key to a `foreign` part's foreignText)
  en: string;   // its English translation, as one phrase/sentence
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
      // English translation of the WHOLE run, when one has been generated for it. Present
      // flips the client from per-segment popups to a whole-run highlight + this text
      // (SegmentedSentenceDisplay `runTranslation`). Absent (older rows, or a run the
      // generator skipped) keeps today's per-segment behavior.
      translation?: string | null;
    };

// One sense's extended definition as SHIPPED to the client (zh): the stored
// { sense, pos, definition } plus that text's own segmentation. Every sense is sent so the
// client can follow the learner's sense pick without a refetch (the picker is optimistic) —
// see DictionaryDAL.enrichLongDefinitionMetadataBatch and docs/DEFINITION_CLUSTERS.md.
export interface LongDefinitionSenseView {
  sense: string;                              // cluster `sense` label — matches definitionClusters/selectedSense
  pos?: string | null;
  definition: string;
  parts?: LongDefinitionPart[] | null;        // computed at runtime, same treatment as longDefinitionParts
}

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
  difficulty?: DifficultyLevel | null;

  // Definitions
  definitions: string[];  // Parsed JSON array (flat cache; owned by backfill-process-definitions-array.js)
  definitionClusters?: DefinitionCluster[] | null;  // Orthogonal sense clusters (migration 90); additive metadata, see docs/DEFINITION_CLUSTERS.md
  selectedSense?: string | null;  // Computed at read time (DictionaryController.lookupTerm): the REQUESTING user's saved sense pick for this word from their vet row. NOT a det column - it makes a lookup's dd match that user's flashcard. See docs/DEFINITION_CLUSTERS.md
  shortDefinitionPronunciationOverride?: ShortDefinitionPronunciationOverride | null; // Raw override object from DB
  shortDefinition?: string | null; // Resolved at runtime: override.definition ?? generateShortDefinition()
  exampleSentenceDefinitionPronunciationOverride?: ExampleSentenceDefinitionPronunciationOverride | null; // Raw override object from DB; applied verbatim in segment popups
  longDefinition?: string | null;   // Hydrated at read time from the JSONB column, narrowed to the card's CURRENT sense — see resolveLongDefinition
  // Transient carrier for the raw JSONB `longDefinition` column (per-sense array for zh).
  // mapRowToEntity must collapse `longDefinition` to a string for the ~all consumers that
  // type it as one, but the per-user sense pick (`selectedSense`) is attached LATER in the
  // lookup path — so the un-narrowed value rides along here and enrichLongDefinitionMetadataBatch
  // re-resolves from it, then drops this field from the payload. See docs/DEFINITION_MAPPING.md #5.
  longDefinitionRaw?: LongDefinitionValue | null;
  // Raw `longDefinitionCitations` column (zh, migration 126): translations for the Chinese
  // runs cited in this entry's long definition. Consumed by enrichLongDefinitionMetadataBatch,
  // which folds each one onto its `foreign` part and then drops this field from the payload —
  // the client never needs the standalone list.
  longDefinitionCitations?: LongDefinitionCitation[] | null;
  longDefinitionParts?: LongDefinitionPart[] | null;  // Computed at runtime: longDefinition split into English + cpcd-able Chinese runs
  longDefinitionSenses?: LongDefinitionSenseView[] | null;  // Computed at runtime (zh): EVERY sense's definition + parts, so the client can follow the sense picker without a refetch. NULL for es/legacy per-POS rows.
  // Computed at read time (DictionaryDAL.enrichDefinitionsApprovalBatch): TRUE iff a
  // validations row (field='definitions', action='approve') matches the entry's
  // CURRENT raw partsOfSpeech + definitions + longDefinition columns (all three,
  // since composeBody bundles them as one validation unit — docs/DATA_VALIDATION_SYSTEM.md).
  // Falsy ⇒ client renders the longDefinition block + partsOfSpeech chip with the
  // AI-generated styling.
  definitionsApproved?: boolean;

  // AI-enriched content
  // `sense` = the component character's definitionClusters sense LABEL for how it is
  // used in THIS word (stable across re-clustering, like vet.selectedSense); populated
  // by backfill-breakdown-senses.js. `definition` is then the tagged cluster's lead
  // gloss (the correct-sense gloss), not the global definitions[0]. See docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md.
  breakdown?: Record<string, { definition: string; pronunciation?: string; sense?: string }> | null;
  synonyms?: string[] | null;
  exampleSentences?: Array<{
    foreignText: string;
    english: string;
    translatedVocab?: string;  // English word/phrase in the translation that corresponds to the vocab word
    sense?: string;            // Exact definitionClusters sense label the target word carries in this sentence (zh only)
    segments?: string[];       // Authoritative GSA segmentation authored by the tagging pass; the read path renders these verbatim (falls back to live GSA when absent)
    partOfSpeechDict: Record<string, string>;  // POS tag per GSA segment (from the tagging pass); drives form modification + particle/classifier annotation
    numberDict?: Record<string, 'singular' | 'plural'>;  // Grammatical number per noun segment; selects the plural English form in the segment popup
    tenseDict?: Record<string, TenseLabel>;    // Tense per verb segment (from the tagging pass); selects the verb's inflected English form in the segment popup. Per-verb because a sentence can mix tenses
    senseDict?: Record<string, string>;        // definitionClusters sense label per segment (from the tagging pass); resolves each segment's dd = ddt(matching cluster)
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string; particleOrClassifier?: ParticleOrClassifierInfo; wordForms?: Record<string, string> }>;
    humanApproved?: boolean;   // Computed at read time (enrichExampleSentencesMetadataBatch): TRUE iff a validations row with action='approve' matches this sentence's current foreignText+english (docs/DATA_VALIDATION_SYSTEM.md). Falsy ⇒ client renders the AI-generated styling
  }> | null;
  matchException?: string[] | null;  // Multi-char tokens to suppress during GSA segmentation
  frequencyScore?: number | null;   // Higher = more frequent in everyday conversation; used by GSA to prefer common words
  wordForms?: Record<string, string> | null;  // AI-generated English conjugation map (e.g. {past: "ran", present: "runs"})
};

// Which field of a dictionary entry a validation document targets.
// 'definitions' = the partsOfSpeech + definitions[] + longDefinition bundle;
// 'exampleSentenceN' = exampleSentences[N] (foreignText + english).
export type ValidationField =
  | 'definitions'
  | 'exampleSentence0'
  | 'exampleSentence1'
  | 'exampleSentence2';

// One row of the `validations` table (migration 104/106) — a human review record
// for a single (entry, field). Kept OFF the det tables so prod data deploys (which
// TRUNCATE+restore dictionaryentries_*) never wipe review data. `content` is the
// data version approved, copied verbatim from the doc the validator read; NULL for
// a flag (no suggested edit anymore — flag is just a signal). `entryId` is
// dictionaryentries_<language>.id. See docs/DATA_VALIDATION_SYSTEM.md.
export interface ValidationRecord {
  id?: string;
  entryId: number;
  language: Language;
  field: ValidationField;
  validatorUserId: string;
  validatorName: string;
  action: 'approve' | 'flag';
  content: string | null;
  createdAt?: string;
}

// A row of `ai_dictionary_cache` (migration 97) — a cached AI-synthesized dictionary answer for a
// pinyin query with no real det match. `word1` NULL ⇒ cached empty result (no likely meaning).
// See docs/DICTIONARY_AI_FALLBACK_SEARCH.md.
export interface AiDictionaryCacheRow {
  id: number;
  queryKey: string;
  language: string;
  word1: string | null;
  pinyin: string | null;
  definition: string | null;
  queriedAt: string;
}

// A display-only AI-synthesized dictionary entry surfaced to the client (rendered as an unclickable
// orange card). No id / metadata — it is not a real det row. `source: 'ai'` tags its provenance.
export interface AiDictionaryEntry {
  word1: string;
  pronunciation: string;  // tone-marked pinyin
  definition: string;     // one concise, complete gloss (no length cap; migration 98)
  source: 'ai';
}

// A row of `word_comparison_cache` (migration 105) — a cached AI-generated paragraph comparing
// two det words. wordA/wordB are stored in canonical (codepoint-sorted) order so both comparison
// directions share one row. See docs/WORD_COMPARE_FEATURE.md.
export interface WordComparisonRow {
  id: number;
  wordA: string;
  wordB: string;
  language: string;
  comparison: string;
  // Translations of the Chinese runs cited in `comparison` (migration 127), produced by the
  // same structured model call. NULL on rows cached before that migration — those serve with
  // per-segment popups until the pair is regenerated.
  citations: LongDefinitionCitation[] | null;
  model: string | null;
  queriedAt: string;
}

// The eip Compare tab's response shape (docs/WORD_COMPARE_FEATURE.md): the raw AI paragraph plus
// its GSA segmentation (embedded Chinese runs → cpcd-able parts with per-segment pinyin +
// definition), computed at READ TIME the same way `longDefinition` is — see
// `enrichLongDefinitionMetadataBatch`. The PARTS themselves are not persisted (recomputed on
// every serve, cached or fresh); the paragraph and its run translations are, in
// `word_comparison_cache.comparison` / `.citations` (migration 127), and the translations are
// folded onto the matching `foreign` parts here.
export interface WordComparisonResult {
  comparison: string;
  comparisonParts: LongDefinitionPart[] | null;
}

// One orthogonal sense cluster within a dictionary entry's `definitionClusters`
// (zh: migration 90; es: migration 123). Glosses sharing one core meaning are
// grouped and ordered prototypical→vernacular WITHIN the cluster; clusters
// themselves are mutually orthogonal and ordered most→least useful. Difficulty
// stays at the word level (not duplicated here).
//
// Each language keeps its homographs in ONE row, distinguished by the field that
// carries its hard sense boundary: `reading` for Chinese (heteronyms — 会
// hui4/kuai4), `gender` for Spanish (cura/m "priest" vs cura/f "cure"). The other
// field is NULL. See docs/DEFINITION_CLUSTERS.md.
export interface DefinitionCluster {
  sense: string;                  // short English label for the shared meaning
  reading: string | null;         // zh: numbered pinyin for THIS sense (e.g. 会计 → "kuai4"). NULL for es.
  pos: string[] | null;           // part(s) of speech for this sense (always an array; single-POS senses are a 1-element array)
  gender?: string | null;         // es: grammatical gender of THIS sense (m/f/mf/…). NULL for zh.
  frequencyScore: number | null; // 1–5 conversation frequency, scored independently per cluster (null = scoring failed)
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
  // Everyday-conversation frequency for the whole entry (1 = almost never spoken …
  // 5 = constant in daily speech), read straight from the det `frequencyScore` column. Drives the
  // sort-flow supply ordering (most frequent first) and the mini-card badge.
  frequencyScore?: number | null;
  breakdown?: Record<string, { definition: string; sense?: string }> | null;
  synonyms?: string[] | null;
  exampleSentences?: Array<{
    foreignText: string;
    english: string;
    translatedVocab?: string;  // English word/phrase in the translation that corresponds to the vocab word
    sense?: string;            // Exact definitionClusters sense label the target word carries in this sentence (zh only)
    segments?: string[];       // Authoritative GSA segmentation authored by the tagging pass; the read path renders these verbatim (falls back to live GSA when absent)
    partOfSpeechDict: Record<string, string>;  // POS tag per GSA segment (from the tagging pass); drives form modification + particle/classifier annotation
    numberDict?: Record<string, 'singular' | 'plural'>;  // Grammatical number per noun segment; selects the plural English form in the segment popup
    tenseDict?: Record<string, TenseLabel>;    // Tense per verb segment (from the tagging pass); selects the verb's inflected English form in the segment popup. Per-verb because a sentence can mix tenses
    senseDict?: Record<string, string>;        // definitionClusters sense label per segment (from the tagging pass); resolves each segment's dd = ddt(matching cluster)
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string; particleOrClassifier?: ParticleOrClassifierInfo; wordForms?: Record<string, string> }>;
    humanApproved?: boolean;   // Computed at read time (enrichExampleSentencesMetadataBatch): TRUE iff a validations row with action='approve' matches this sentence's current foreignText+english (docs/DATA_VALIDATION_SYSTEM.md). Falsy ⇒ client renders the AI-generated styling
  }> | null;
  matchException?: string[] | null;  // Multi-char tokens to suppress during GSA segmentation
  // Optional icons8 icon id (FK → icons8."icons8Id"). When set, the client renders
  // the icon via <img src="/api/icons8/<iconId>/image">. Null when no icon assigned.
  iconId?: string | null;
  // Sort-pack card state (set by getNextPacks; absent in the legacy single-card flow).
  // `sorted` → the user already has a library vet row for this card: it renders locked
  // with a "sorted!" watermark and is not draggable. `skipped` → the card is currently
  // in discover_skips but appears inside an authored pack, so it is draggable again.
  sorted?: boolean;
  skipped?: boolean;
}

/**
 * A sort pack: the on-deck unit of the discover sort flow — up to 3 cards to sort
 * (see docs/SORT_CARDS_REQUIREMENTS.md §4.5). Authored packs come from `sort_packs`;
 * system fallback packs-of-1 are built on the fly. No sentence is shown in this flow —
 * `sort_packs.sentenceForeign`/`sentenceEnglish` exist only to constrain authoring
 * (each entryId's word must occur in the authored sentence), not for display.
 */
export interface SortPack {
  // Stable client identity used for de-dup / exclusion. Authored: "pack:<id>";
  // fallback single: "single:<cardId>".
  packKey: string;
  // sort_packs.id for authored packs; null for fallback packs-of-1 (nothing to mark seen).
  packId: number | null;
  level: number;
  cards: DiscoverCard[];
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

// The four mastery mark types. A mark's type is decided by the surface that
// produced it (see docs/MASTERY_REWORK.md §1):
//   recognition — flp foreign-first review + Bubble Match
//   production  — flp English-first review + Word Search "Pinyin" mode
//   reading     — Word Search "No Pinyin" mode
//   writing     — Practice Writing drill
export type MarkType = 'recognition' | 'production' | 'reading' | 'writing';

export const MARK_TYPES: readonly MarkType[] = ['recognition', 'production', 'reading', 'writing'] as const;

// Per-card typed mark streams: each type keeps its own <=8 most-recent marks.
// Stored in vet."typedMarkHistory" (migration 101). An absent/empty track means
// no marks of that type yet (which the pbh math treats as all-negative).
export type TypedMarkHistory = Partial<Record<MarkType, ReviewMark[]>>;

// How many most-recent marks each type retains (the sliding-window size).
export const MARK_WINDOW_SIZE = 8;

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
  frequencyScore: number | null;
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

/**
 * One side of a per-card text-color override (vet."textColors", migration 89). 'theme'
 * follows the device/app theme (the default), 'dark' forces black, 'light' forces white.
 */
export type TextColorMode = 'theme' | 'dark' | 'light';

/**
 * Per-card flashcard text-color overrides (vet."textColors", migration 89; see
 * docs/CARD_ICON_LAYOUT.md). `foreign` colors the foreign-word GLYPHS (Chinese characters
 * / Spanish word) — the pinyin overlay is never affected; `english` colors the English
 * definition. NULL on the row = both 'theme'.
 */
export interface TextColors {
  foreign: TextColorMode;
  english: TextColorMode;
}

/**
 * The exact set of EXPLICIT card-background fills the fie "card" menu offers (vet."cardColor",
 * migration 94). Any incoming cardColor is validated against this list (else NULL) so only
 * these hexes — or NULL (the "auto" option = follow theme) — are ever stored. This MUST stay
 * in sync with the client palette in src/utils/cardColor.ts (CARD_COLOR_OPTIONS). See
 * docs/CARD_ICON_LAYOUT.md.
 *   grey #D8D8DC · beige #F5EBE0 · white #FFFFFF · black #000000 · red #F2BAC9 ·
 *   green #BAF2D8 · blue #BAD7F2 · yellow #F2E2BA · purple #D8BAF2
 */
export const CARD_COLOR_VALUES: readonly string[] = ['#D8D8DC', '#F5EBE0', '#FFFFFF', '#000000', '#F2BAC9', '#BAF2D8', '#BAD7F2', '#F2E2BA', '#D8BAF2'];

/**
 * Which back-face text block a movable-text placement targets (vet."textLayout",
 * migration 91; see docs/CARD_ICON_LAYOUT.md).
 */
export type TextBlock = 'foreign' | 'english';

/**
 * One movable text block's placement (vet."textLayout", migration 91). NORMALIZED coords
 * (fractions of the card size) like IconLayoutItem; no iconId/flipX/z. See
 * docs/CARD_ICON_LAYOUT.md.
 */
export interface TextLayoutItem {
  x: number;        // block CENTER as a fraction of card WIDTH  [0..1]
  y: number;        // block CENTER as a fraction of card HEIGHT [0..1]
  scale: number;    // multiplier on the block's base font size; clamped ~[0.5, 3]
  rotation: number; // degrees
  locked?: boolean; // when true the block ignores canvas translate/resize/rotate gestures; omitted/false = freely editable
}

/**
 * Per-card movable-text placement for the two back-face text blocks (vet."textLayout",
 * migration 91; see docs/CARD_ICON_LAYOUT.md). Each block optional (absent = default spot);
 * NULL on the row = both at default.
 */
export interface TextLayout {
  foreign?: TextLayoutItem;
  english?: TextLayoutItem;
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
  // Computed at read time (DictionaryDAL.enrichDefinitionsApprovalBatch): TRUE iff a
  // validations row (field='definitions', action='approve') matches the entry's
  // CURRENT raw partsOfSpeech + definitions + longDefinition columns (docs/DATA_VALIDATION_SYSTEM.md).
  definitionsApproved?: boolean;
  frequencyScore?: number | null;  // 1–5 conversation-frequency score from dictionaryentries_zh (1=almost never spoken, 5=constant in daily speech)
  definitionClusters?: DefinitionCluster[] | null;  // Orthogonal sense clusters (zh; migration 90), joined from det via DICT_JOIN — see docs/DEFINITION_CLUSTERS.md
  selectedSense?: string | null;  // Per-card chosen cluster `sense` label (vet column, migration 99). NULL = default/starred sense. See docs/DEFINITION_CLUSTERS.md
  typedMarkHistory?: TypedMarkHistory;  // Per-type mark streams (migration 101); see docs/MASTERY_REWORK.md
  totalMarkCount?: number;  // Total cumulative count of all marks
  totalCorrectCount?: number;  // Lifetime count of correct marks
  category?: FlashcardCategory;  // utcm level, computed from typedMarkHistory + the account's goal flags (compute_utcm_category)
  // flp face-steering (docs/MASTERY_REWORK.md § Per-type cooldown): the subset of
  // flp-reviewable mark types ('recognition'/'production') whose PER-TYPE cooldown
  // has elapsed, stamped by OnDeckVocabService when a card is selected for the
  // working loop. The client shows the matching face (production→English-first,
  // recognition→foreign-first); both present ⇒ random. Absent on cards not routed
  // through flp selection (games, dictionary lookups).
  readyMarkTypes?: MarkType[];
  starterPackBucket: StarterPackBucket;  // Starter pack sorting bucket (required)
  breakdown?: Record<string, { definition: string; pronunciation?: string; sense?: string }> | null;  // Character breakdown for Chinese vocab (`sense` = component char's definitionClusters label for this word)
  synonyms?: string[];  // Array of Chinese synonym words
  synonymsMetadata?: Record<string, { definition: string; pronunciation: string }> | null;  // Computed at runtime by batch-reading from dictionaryentries_zh
  longDefinition?: string | null;  // AI-generated extended definition (25–150 chars) from dictionaryentries_zh
  longDefinitionCitations?: LongDefinitionCitation[] | null;  // Raw det column (migration 126), joined via DICT_JOIN; folded onto the `foreign` parts and dropped by enrichLongDefinitionMetadataBatch
  longDefinitionParts?: LongDefinitionPart[] | null;  // Computed at runtime: longDefinition split into English + cpcd-able Chinese runs
  longDefinitionSenses?: LongDefinitionSenseView[] | null;  // Computed at runtime (zh): EVERY sense's definition + parts, so the client can follow the sense picker without a refetch. NULL for es/legacy per-POS rows.
  iconId?: string | null;  // Representative icons8 icon (FK to icons8.icons8Id) joined from det; client renders via <img src="/api/icons8/<iconId>/image">
  iconLayout?: IconLayoutItem[] | null;  // Custom flashcard icon arrangement (vet column, migration 82). NULL = use the default centered iconId. See docs/CARD_ICON_LAYOUT.md
  snapConfig?: SnapConfig | null;  // Per-card icon-editor snap toggles (vet column, migration 88). NULL = all off. See docs/CARD_ICON_LAYOUT.md
  textColors?: TextColors | null;  // Per-card flashcard text-color overrides (vet column, migration 89). NULL = both 'theme'. See docs/CARD_ICON_LAYOUT.md
  textLayout?: TextLayout | null;  // Per-card movable-text placement for the two back-face text blocks (vet column, migration 91). NULL = default lower-third layout. See docs/CARD_ICON_LAYOUT.md
  cardColor?: string | null;  // Per-card flashcard background fill (CSS hex, one of CARD_COLOR_VALUES, vet column, migration 94). NULL = follow theme. See docs/CARD_ICON_LAYOUT.md
  exampleSentences?: Array<{
    foreignText: string;
    english: string;
    translatedVocab?: string;  // English word/phrase in the translation that corresponds to the vocab word
    sense?: string;            // Exact definitionClusters sense label the target word carries in this sentence (zh only)
    segments?: string[];       // Authoritative GSA segmentation authored by the tagging pass; the read path renders these verbatim (falls back to live GSA when absent)
    partOfSpeechDict: Record<string, string>;  // POS tag per GSA segment (from the tagging pass); drives form modification + particle/classifier annotation
    numberDict?: Record<string, 'singular' | 'plural'>;  // Grammatical number per noun segment; selects the plural English form in the segment popup
    tenseDict?: Record<string, TenseLabel>;    // Tense per verb segment (from the tagging pass); selects the verb's inflected English form in the segment popup. Per-verb because a sentence can mix tenses
    senseDict?: Record<string, string>;        // definitionClusters sense label per segment (from the tagging pass); resolves each segment's dd = ddt(matching cluster)
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string; definition?: string; particleOrClassifier?: ParticleOrClassifierInfo; wordForms?: Record<string, string> }>;
    humanApproved?: boolean;   // Computed at read time (enrichExampleSentencesMetadataBatch): TRUE iff a validations row with action='approve' matches this sentence's current foreignText+english (docs/DATA_VALIDATION_SYSTEM.md). Falsy ⇒ client renders the AI-generated styling
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
  // Validation-doc linkage (migration 104). NULL/undefined ⇒ ordinary user document.
  // When set, this text reviews dictionaryentries_<validationLanguage>.id = validationEntryId
  // (det id is a SERIAL integer).
  validationEntryId?: number | null;
  validationLanguage?: Language | null;
  validationField?: ValidationField | null;
  createdAt: string;
}

// Text creation data type. The validation* fields are set only by ValidationService
// when it composes a validation document; ordinary document creation omits them.
export interface TextCreateData {
  userId: string;
  title: string;
  description?: string;
  content: string;
  language?: Language;
  validationEntryId?: number | null;
  validationLanguage?: Language | null;
  validationField?: ValidationField | null;
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
