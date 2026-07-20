import { IBaseDAL } from './IBaseDAL.js';
import { VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, DifficultyLevel, UsedInItem, IconLayoutItem, SnapConfig, TextColors, TextLayout } from '../../types/index.js';
import { BulkResult, ITransaction } from '../../types/dal.js';

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
  findByUserIdAndLanguage(userId: string, language: string, limit?: number, offset?: number): Promise<VocabEntry[]>;
  findByUserAndKey(userId: string, entryKey: string, language: string, pos?: string): Promise<VocabEntry | null>;
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
