/**
 * Server type module.
 *
 * Everything that CROSSES THE WIRE is defined once in `server/contracts/wire.ts`
 * and re-exported here, so `server/**` keeps importing from `../types/index.js`
 * exactly as before. What remains declared in this file is server-only: DB row
 * models (which carry `password` / real `Date`s), DAL create/update shapes, and
 * request/response plumbing the client never sees.
 *
 * Where the server is stricter than the wire contract, it NARROWS by interface
 * extension (`DictionaryEntry`, `VocabEntry`, `Text` below) rather than
 * re-declaring the field list. See the Base/narrow note in contracts/wire.ts.
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 2.
 */

// The stored shapes of the `longDefinition` JSONB column (per-sense array for zh,
// per-POS object for es/legacy). Defined in utils/definitions.ts alongside its
// resolvers; that module imports nothing, so this direction introduces no cycle.
import type { LongDefinitionValue } from '../utils/definitions.js';
import type {
  DictionaryEntryBase,
  Language,
  StarterPackBucket,
  TextBase,
  UserProfile,
  ValidationField,
  VocabEntryBase,
} from '../contracts/wire.js';

// ─── The wire contract, re-exported verbatim ────────────────────────────────────
// Types only — the values below are re-exported separately so `verbatimModuleSyntax`
// consumers stay happy.
export type {
  AiDictionaryEntry,
  ApiResponse,
  ApplyDesignResult,
  BreakdownMap,
  CommunityDesign,
  DefinitionCluster,
  DifficultyLevel,
  DiscoverCard,
  DiscoverFetchResponse,
  DiscoverNextPackResponse,
  DiscoverSortBucket,
  DiscoverSortResponse,
  EntryApprovalFlags,
  ExampleSentence,
  ExampleSentenceDefinitionPronunciationOverride,
  FlashcardCategory,
  IconLayoutItem,
  Language,
  LongDefinitionCitation,
  LongDefinitionPart,
  LongDefinitionSenseView,
  MarkType,
  NumberLabel,
  ParticleOrClassifierInfo,
  RelatedWord,
  ReviewMark,
  SegmentMetadata,
  ShortDefinitionPronunciationOverride,
  SnapConfig,
  SortPack,
  StarterPackBucket,
  TenseLabel,
  TextBlock,
  TextColorMode,
  TextColors,
  TextLayout,
  TextLayoutItem,
  TypedMarkHistory,
  UsedInItem,
  UserProfile,
  ValidationField,
  VoteResult,
  VotedDesignKey,
  WordComparisonResult,
} from '../contracts/wire.js';

export {
  CARD_COLOR_VALUES,
  ENTRY_LEVEL_VALIDATION_FIELDS,
  FLASHCARD_CATEGORY,
  FLASHCARD_CATEGORIES,
  ICON_LAYOUT_MAX_ITEMS,
  LANGUAGES,
  LANGUAGE_NAMES,
  MARK_TYPES,
  MARK_WINDOW_SIZE,
  NO_APPROVALS,
} from '../contracts/wire.js';

// ─── Server-only: infrastructure ────────────────────────────────────────────────

/** Custom error type with code and status code. */
export interface CustomError extends Error {
  code?: string;
  statusCode?: number;
}

/**
 * Database configuration type (the live config is a `pg` PoolConfig; this interface
 * is kept for the few places that describe a connection shape by hand).
 */
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

/** Request parameters type. */
export interface RequestParams {
  id: string | number;
}

// ─── Server-only: user rows ─────────────────────────────────────────────────────

/**
 * The DB row for a user: the wire profile plus the columns that never leave the
 * server. `UserProfile` (contracts/wire.ts) is what the client receives.
 */
export interface User extends UserProfile {
  /** bcrypt hash. Never returned to the client. */
  password?: string;
  /** Last successful minute-point increment (for rate limiting). */
  lastMinutePointIncrement?: Date;
  createdAt?: Date;
}

export interface UserCreateData {
  email: string;
  name: string;
  password: string;
  /** Defaults to true in the database. */
  isPublic?: boolean;
}

export interface UserLoginData {
  email: string;
  password: string;
}

export interface UserUpdateData {
  email?: string;
  name?: string;
  password?: string;
  selectedLanguage?: Language;
  isPublic?: boolean;
  /** Set when the user picks/clears their profile avatar (migration 77). */
  avatarIconId?: string | null;
  /** Toggled in account settings (migration 101). */
  readingGoal?: boolean;
  /** Toggled in account settings (migration 101). */
  writingGoal?: boolean;
  /** Toggled in account settings (migration 129). */
  showSegmentSpaces?: boolean;
}

/** Auth response type. */
export interface AuthResponse {
  user: Omit<User, 'password'>;
  token: string;
}

/**
 * A stored refresh-token row (migration 85). The raw token is never stored;
 * `tokenHash` is its SHA-256 hex. `revokedAt === null` means currently valid.
 */
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

// ─── Server-only: reference tables ──────────────────────────────────────────────

/** Row type for the particlesandclassifiers reference table. */
export interface ParticleClassifierEntry {
  id: number;
  character: string;
  language: string;
  type: 'particle' | 'classifier';
  definition: string;
  createdAt: string;
}

/**
 * One row of the `validations` table (migration 104/106) — a human review record for
 * a single (entry, field). Kept OFF the det tables so prod data deploys (which
 * TRUNCATE+restore dictionaryentries_*) never wipe review data. `content` is the data
 * version approved, copied verbatim from the doc the validator read; NULL for a flag.
 * `entryId` is dictionaryentries_<language>.id. See docs/DATA_VALIDATION_SYSTEM.md.
 */
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

/**
 * A row of `ai_dictionary_cache` (migration 97) — a cached AI-synthesized dictionary
 * answer for a pinyin query with no real det match. `word1` NULL ⇒ cached empty
 * result. See docs/DICTIONARY_AI_FALLBACK_SEARCH.md.
 */
export interface AiDictionaryCacheRow {
  id: number;
  queryKey: string;
  language: string;
  word1: string | null;
  pinyin: string | null;
  definition: string | null;
  queriedAt: string;
}

/**
 * A row of `word_comparison_cache` (migration 105) — a cached AI-generated paragraph
 * comparing two det words. wordA/wordB are stored in canonical (codepoint-sorted)
 * order so both comparison directions share one row. See docs/WORD_COMPARE_FEATURE.md.
 */
export interface WordComparisonRow {
  id: number;
  wordA: string;
  wordB: string;
  language: string;
  comparison: string;
  /**
   * Translations of the Chinese runs cited in `comparison` (migration 127). NULL on
   * rows cached before that migration — those serve with per-segment popups until the
   * pair is regenerated.
   */
  citations: import('../contracts/wire.js').LongDefinitionCitation[] | null;
  model: string | null;
  queriedAt: string;
}

// ─── Server narrowings of the wire contract ─────────────────────────────────────

/**
 * Dictionary entry as the SERVER holds it: the wire shape, plus the two fields the
 * client never receives, plus the required-ness the DB guarantees.
 */
export interface DictionaryEntry extends DictionaryEntryBase {
  discoverable: boolean;
  createdAt: string;
  /**
   * Transient carrier for the raw JSONB `longDefinition` column (per-sense array for
   * zh). mapRowToEntity must collapse `longDefinition` to a string for the ~all
   * consumers that type it as one, but the per-user sense pick (`selectedSense`) is
   * attached LATER in the lookup path — so the un-narrowed value rides along here and
   * enrichLongDefinitionMetadataBatch re-resolves from it, then DROPS this field from
   * the payload. See docs/DEFINITION_MAPPING.md #5.
   */
  longDefinitionRaw?: LongDefinitionValue | null;
}

export interface DictionaryEntryCreateData {
  language: Language;
  word1: string;
  word2?: string | null;
  pronunciation?: string | null;
  /** JSON string. */
  definitions: string;
}

/**
 * Vocab entry as the SERVER holds it: identity columns are NOT NULL in the vet
 * tables, and `createdAt` is a real `Date` from `pg`. The client's counterpart keeps
 * those optional because it also builds synthetic det-fallback entries.
 */
export interface VocabEntry extends VocabEntryBase {
  userId: string;
  language: Language;
  starterPackBucket: StarterPackBucket;
  createdAt: Date;
}

export interface VocabEntryCreateData {
  userId: string;
  entryKey: string;
  language: Language;
  difficulty?: import('../contracts/wire.js').DifficultyLevel | null;
}

export interface VocabEntryUpdateData {
  entryKey?: string;
  language?: Language;
  difficulty?: import('../contracts/wire.js').DifficultyLevel | null;
}

/**
 * Reader document row. Identical to the wire shape — aliased rather than re-declared
 * so it stays that way.
 */
export type Text = TextBase;

/**
 * Text creation data. The validation* fields are set only by ValidationService when it
 * composes a validation document; ordinary document creation omits them.
 */
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

export interface TextUpdateData {
  title?: string;
  description?: string;
  content?: string;
  language?: Language;
}
