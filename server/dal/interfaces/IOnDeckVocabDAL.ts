import { OnDeckVocabSet, OnDeckVocabSetCreateData } from '../../types/index.js';
import { IBaseDAL } from './IBaseDAL.js';

/**
 * Interface for OnDeck Vocabulary Set data access operations
 * Extends base CRUD operations with OnDeck-specific functionality
 */
export interface IOnDeckVocabDAL extends IBaseDAL<OnDeckVocabSet, OnDeckVocabSetCreateData, OnDeckVocabSetCreateData> {
  /**
   * Get all on-deck vocab sets for a specific user
   * @param userId - The user's unique identifier
   * @returns Promise resolving to array of OnDeckVocabSet objects
   */
  getAllSetsForUser(userId: string): Promise<OnDeckVocabSet[]>;

  /**
   * Get a specific on-deck vocab set by user ID and feature name
   * @param userId - The user's unique identifier
   * @param featureName - The feature name identifier
   * @returns Promise resolving to OnDeckVocabSet or null if not found
   */
  getSetByUserAndFeature(userId: string, featureName: string): Promise<OnDeckVocabSet | null>;

  /**
   * Create or update an on-deck vocab set (upsert operation)
   * @param userId - The user's unique identifier
   * @param data - The OnDeck vocab set data
   * @returns Promise resolving to the created/updated OnDeckVocabSet
   */
  upsertSet(userId: string, data: OnDeckVocabSetCreateData): Promise<OnDeckVocabSet>;

  /**
   * Delete an on-deck vocab set by user ID and feature name
   * @param userId - The user's unique identifier
   * @param featureName - The feature name identifier
   * @returns Promise resolving to boolean indicating success
   */
  deleteSetByUserAndFeature(userId: string, featureName: string): Promise<boolean>;

  /**
   * Validate that all vocab entry IDs exist and belong to the specified user
   * @param userId - The user's unique identifier
   * @param entryIds - Array of vocab entry IDs to validate
   * @returns Promise that resolves if all IDs are valid, rejects otherwise
   */
  validateVocabEntryIds(userId: string, entryIds: number[]): Promise<void>;

  /**
   * Get statistics for a user's on-deck sets
   * @param userId - The user's unique identifier
   * @returns Promise resolving to statistics object
   */
  getUserSetStats(userId: string): Promise<{
    totalSets: number;
    totalEntries: number;
    averageEntriesPerSet: number;
    lastUpdated: Date | null;
  }>;
}
