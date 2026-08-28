import type { PoolClient } from 'pg';
import { IBaseDAL } from './IBaseDAL.js';
import { VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, DifficultyLevel, UsedInItem, IconLayoutItem, SnapConfig, TextColors, TextLayout, TypedMarkHistory } from '../../types/index.js';
import { BulkResult, ITransaction } from '../../types/dal.js';
import type { MasteredAtByBar, MasteryBarId } from '../../contracts/wire.js';

/**
 * The three columns a mark/undo needs off a vet row, plus the row's language.
 *
 * Deliberately NOT a full `VocabEntry`: the mark path does not join the dictionary
 * and has no use for the other ~40 columns, and naming the narrow shape keeps it
 * obvious that `findMarkState` is a lock-and-read for a write, not a card fetch.
 * See docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md.
 */
export interface VetMarkState {
  /** The row's language, i.e. which physical vet table holds it. */
  language: string;
  /** Never null — a row with no history yet reads as `{}`. */
  typedMarkHistory: TypedMarkHistory;
  masteredAt: MasteredAtByBar | null;
}

/**
 * How a mark-history write should touch the `masteredAt` jsonb.
 *
 * `stamp` of a string SETS that bar's key (the mark crossed the bar into Mastered);
 * `null` REMOVES it (an undo retracting the crossing it created). Passing no
 * descriptor at all leaves the column untouched, which is the common case — most
 * marks cross nothing. See docs/MASTERY_REWORK.md.
 */
export interface MasteredAtWrite {
  bar: MasteryBarId;
  stamp: string | null;
}

/**
 * Interface for VocabEntry Data Access Layer
 * Extends base DAL with vocabulary-specific operations
 */
export interface IVocabEntryDAL extends IBaseDAL<VocabEntry, VocabEntryCreateData, VocabEntryUpdateData> {
  // User-specific queries. vet is split per language (migration 66), so id lookups
  // are language-scoped (the caller resolves the language) and there are no
  // cross-language reads.
  findByIdAndLanguage(id: string | number, language: string): Promise<VocabEntry | null>;

  /**
   * Read the mark state of one vet row by its GLOBALLY UNIQUE id, without the caller
   * having to know the row's language first.
   *
   * The two physical vet tables share one id sequence, so an id identifies at most one
   * row across the pair — but nothing says WHICH table, and the mark endpoints receive
   * only a `cardId`. This probes both and returns the one that matches (or null).
   *
   * `forUpdate` takes a row lock, which the mark and undo paths both need: appending to
   * `typedMarkHistory` is a read-modify-write of a whole jsonb column, so two concurrent
   * marks on the same card without the lock silently lose one of them (Word Search fires
   * its reading + production marks in parallel — see docs/WORD_SEARCH_GAME.md). A lock is
   * only meaningful inside a transaction, so `forUpdate` requires `client`.
   */
  findMarkState(
    userId: string,
    cardId: number,
    opts?: { client?: PoolClient; forUpdate?: boolean }
  ): Promise<VetMarkState | null>;

  /**
   * Overwrite one vet row's `typedMarkHistory`, optionally stamping or clearing a
   * single `masteredAt` bar key in the same statement.
   *
   * The caller passes the row's `language` (from `findMarkState`) so this resolves the
   * table directly rather than probing again. Bands are derived, never stored, so the
   * history is the only column a mark writes.
   *
   * Returns true when a row was updated — false means the id/owner pair matched nothing,
   * which for a caller that just read the row under a lock can only be a bug.
   */
  updateMarkHistory(
    userId: string,
    cardId: number,
    language: string,
    history: TypedMarkHistory,
    masteredAt?: MasteredAtWrite | null,
    client?: PoolClient
  ): Promise<boolean>;

  /**
   * Persist (or clear) a custom flashcard icon arrangement for one vet row, scoped to
   * its owner. `layout` of null clears it back to the default centered icon. The
   * editor's snap toggles + Contrast text colors + movable-text placement + card background
   * fill ride along on the same write: `snapConfig` / `textColors` / `textLayout` / `cardColor`
   * of `undefined` leave their column untouched (used by the community copy path), `null`
   * clears it, a value sets it. Returns the updated row, or null when no row matches (wrong
   * id / not the caller's). See docs/CARD_ICON_LAYOUT.md.
   */
  updateIconLayout(
    userId: string,
    id: string | number,
    language: string,
    layout: IconLayoutItem[] | null,
    snapConfig?: SnapConfig | null,
    textColors?: TextColors | null,
    textLayout?: TextLayout | null,
    cardColor?: string | null,
    /**
     * Community attribution for the layout being written (migration 119): a user id forces that
     * author (community copy path), `null` clears it, `undefined` self-attributes to `userId`
     * but only when the layout actually changed. See docs/COMMUNITY_PAGE.md.
     */
    author?: string | null
  ): Promise<VocabEntry | null>;
  /**
   * Persist (or clear) the chosen definition-cluster sense for one vet row (migration 99).
   * `selectedSense` = the cluster's `sense` label; `null` clears it (default/starred sense).
   * Returns the updated row, or null when no row matches. See docs/DEFINITION_CLUSTERS.md.
   */
  updateSelectedSense(
    userId: string,
    id: string | number,
    language: string,
    selectedSense: string | null
  ): Promise<VocabEntry | null>;
  /**
   * Persist (or clear) the learner's own note on one vet row (migration 155).
   * `note` arrives already trimmed and length-capped by the service; `null` clears it.
   * Returns the updated row, or null when no row matches. See docs/CARD_NOTES.md.
   */
  updateNote(
    userId: string,
    id: string | number,
    language: string,
    note: string | null
  ): Promise<VocabEntry | null>;
  findByUserIdAndLanguage(userId: string, language: string, limit?: number, offset?: number): Promise<VocabEntry[]>;
  findByUserAndKey(userId: string, entryKey: string, language: string): Promise<VocabEntry | null>;
  countByUserIdAndLanguage(userId: string, language: string): Promise<number>;

  // Search and filtering
  searchEntries(userId: string, searchTerm: string, language: string, limit?: number): Promise<VocabEntry[]>;
  findByDifficultyLevel(userId: string, difficulty: DifficultyLevel): Promise<VocabEntry[]>;
  findByTokens(userId: string, tokens: string[], language: string): Promise<VocabEntry[]>;

  // Bulk operations for CSV import
  bulkCreate(entries: VocabEntryCreateData[]): Promise<VocabEntry[]>;
  bulkUpsert(entries: VocabEntryCreateData[]): Promise<BulkResult>;
  bulkCreateWithTransaction(entries: VocabEntryCreateData[], transaction: ITransaction): Promise<VocabEntry[]>;

  // Advanced queries
  findDuplicateKeys(userId: string, entryKeys: string[], language: string): Promise<VocabEntry[]>;
  findEntriesCreatedAfter(userId: string, date: Date, language: string): Promise<VocabEntry[]>;
  findRelatedBySharedCharacters(
    userId: string,
    word: string,
    language: string,
    limit?: number
  ): Promise<Array<{ id: number; entryKey: string; pronunciation: string | null; definition: string | null }>>;
  findUsedInForCharacter(
    userId: string,
    character: string,
    language: string,
    limit?: number,
    offset?: number
  ): Promise<UsedInItem[]>;

  // Batch operations with progress tracking
  bulkUpsertWithProgress(
    entries: VocabEntryCreateData[],
    progressCallback?: (processed: number, total: number) => void
  ): Promise<BulkResult>;
}
