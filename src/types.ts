/**
 * Frontend type module.
 *
 * Everything that CROSSES THE WIRE is defined once in `server/contracts/wire.ts`
 * and re-exported here, so `src/**` keeps importing from `"../types"` exactly as
 * before. Reaching into `server/` is deliberate and one-directional: the backend
 * Docker build context is `./server`, so the contract cannot live at the repo root
 * without changing the deployment; the frontend image copies the whole repo, so this
 * direction works. The server owns the contract; the client conforms to it.
 *
 * What remains declared here is client-only: view models and the det-fallback
 * widenings that have no server counterpart.
 *
 * Before this consolidation the two modules re-declared 29 types, 6 of which had
 * drifted — the client's `DictionaryEntry` was missing 21 fields. See
 * docs/ARCHITECTURE_REVIEW.md finding 2.
 */

import type {
  DictionaryEntryBase,
  TextBase,
  VocabEntryBase,
} from "../server/contracts/wire";

// ─── The wire contract, re-exported verbatim ────────────────────────────────────
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
  DistractorChar,
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
} from "../server/contracts/wire";

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
} from "../server/contracts/wire";

// ─── Client narrowings of the wire contract ─────────────────────────────────────

/**
 * The user shape the client holds. Identical to the wire profile — the client has no
 * fields of its own, and critically no `password` (the old `src/types.ts` User
 * declared one, which never crossed the wire).
 *
 * This is now the ONLY client-side User. `AuthContext.tsx` previously kept a private,
 * non-exported `interface User` that was the only one with the current field set;
 * it imports this instead.
 */
export type { UserProfile as User } from "../server/contracts/wire";

/**
 * Dictionary entry as the CLIENT receives it. `createdAt` arrives as an ISO string,
 * and the server's transient `longDefinitionRaw` carrier is dropped before send, so
 * it is absent here by construction.
 */
export interface DictionaryEntry extends DictionaryEntryBase {
  createdAt: string;
}

/**
 * Canonical VocabEntry model for the whole frontend (flashcards, card detail,
 * discover, dictionary adapters).
 *
 * It is a SUPERSET in optionality: a server-sourced vet row carries identity fields
 * (userId/language/starterPackBucket), while a synthetic det-fallback entry from
 * `dictEntryAdapter` omits them — so `VocabEntryBase` leaves those optional and the
 * server narrows them to required rather than the other way around.
 */
export interface VocabEntry extends VocabEntryBase {
  createdAt: string;
}

/**
 * Reader document as the client receives it. Identical to the wire shape — aliased
 * rather than re-declared so it stays that way.
 */
export type Text = TextBase;

// ─── Client-only view models ────────────────────────────────────────────────────

/** Composite key for a design within one language feed (ownerUserId|entryKey). */
export const designKey = (d: { ownerUserId: string; entryKey: string }) =>
  `${d.ownerUserId}|${d.entryKey}`;

/** Combined vocab lookup response. */
export interface VocabLookupResponse {
  personalEntries: VocabEntry[];
  dictionaryEntries: DictionaryEntry[];
}
