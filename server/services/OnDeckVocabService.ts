import { OnDeckVocabSet, OnDeckVocabSetCreateData } from '../types/index.js';
import { IOnDeckVocabDAL } from '../dal/interfaces/IOnDeckVocabDAL.js';
import { ValidationError, NotFoundError, DALError } from '../types/dal.js';

/**
 * OnDeck Vocabulary Set Service
 * Handles business logic for OnDeck vocabulary set operations
 */
export class OnDeckVocabService {
  constructor(private onDeckVocabDAL: IOnDeckVocabDAL) {}

  /**
   * Get all on-deck vocab sets for a user
   */
  async getAllSetsForUser(userId: string): Promise<OnDeckVocabSet[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    return await this.onDeckVocabDAL.getAllSetsForUser(userId);
  }

  /**
   * Get a specific on-deck vocab set by user ID and feature name
   */
  async getSetByUserAndFeature(userId: string, featureName: string): Promise<OnDeckVocabSet | null> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!featureName) {
      throw new ValidationError('Feature name is required');
    }

    return await this.onDeckVocabDAL.getSetByUserAndFeature(userId, featureName);
  }

  /**
   * Create or update an on-deck vocab set
   */
  async createOrUpdateSet(userId: string, data: OnDeckVocabSetCreateData): Promise<OnDeckVocabSet> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    // Additional business logic validation
    this.validateSetData(data);

    return await this.onDeckVocabDAL.upsertSet(userId, data);
  }

  /**
   * Delete an on-deck vocab set
   */
  async deleteSet(userId: string, featureName: string): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!featureName) {
      throw new ValidationError('Feature name is required');
    }

    const deleted = await this.onDeckVocabDAL.deleteSetByUserAndFeature(userId, featureName);
    
    if (!deleted) {
      throw new NotFoundError(`OnDeck set '${featureName}' not found for user`);
    }

    return deleted;
  }

  /**
   * Get user's on-deck set statistics
   */
  async getUserSetStats(userId: string): Promise<{
    totalSets: number;
    totalEntries: number;
    averageEntriesPerSet: number;
    lastUpdated: Date | null;
  }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    return await this.onDeckVocabDAL.getUserSetStats(userId);
  }

  /**
   * Add entries to an existing set
   */
  async addEntriesToSet(userId: string, featureName: string, entryIds: number[]): Promise<OnDeckVocabSet> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!featureName) {
      throw new ValidationError('Feature name is required');
    }
    if (!Array.isArray(entryIds) || entryIds.length === 0) {
      throw new ValidationError('Entry IDs array is required and cannot be empty');
    }

    // Get existing set
    const existingSet = await this.onDeckVocabDAL.getSetByUserAndFeature(userId, featureName);
    if (!existingSet) {
      throw new NotFoundError(`OnDeck set '${featureName}' not found for user`);
    }

    // Merge entry IDs (remove duplicates)
    const mergedEntryIds = [...new Set([...existingSet.vocabEntryIds, ...entryIds])];
    
    if (mergedEntryIds.length > 30) {
      throw new ValidationError('Maximum of 30 vocab entries allowed per set');
    }

    // Update the set
    return await this.onDeckVocabDAL.upsertSet(userId, {
      featureName,
      vocabEntryIds: mergedEntryIds
    });
  }

  /**
   * Remove entries from an existing set
   */
  async removeEntriesFromSet(userId: string, featureName: string, entryIds: number[]): Promise<OnDeckVocabSet> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!featureName) {
      throw new ValidationError('Feature name is required');
    }
    if (!Array.isArray(entryIds) || entryIds.length === 0) {
      throw new ValidationError('Entry IDs array is required and cannot be empty');
    }

    // Get existing set
    const existingSet = await this.onDeckVocabDAL.getSetByUserAndFeature(userId, featureName);
    if (!existingSet) {
      throw new NotFoundError(`OnDeck set '${featureName}' not found for user`);
    }

    // Remove specified entry IDs
    const filteredEntryIds = existingSet.vocabEntryIds.filter(id => !entryIds.includes(id));

    // Update the set
    return await this.onDeckVocabDAL.upsertSet(userId, {
      featureName,
      vocabEntryIds: filteredEntryIds
    });
  }

  /**
   * Clear all entries from a set (but keep the set)
   */
  async clearSet(userId: string, featureName: string): Promise<OnDeckVocabSet> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!featureName) {
      throw new ValidationError('Feature name is required');
    }

    // Check if set exists
    const existingSet = await this.onDeckVocabDAL.getSetByUserAndFeature(userId, featureName);
    if (!existingSet) {
      throw new NotFoundError(`OnDeck set '${featureName}' not found for user`);
    }

    // Update with empty array
    return await this.onDeckVocabDAL.upsertSet(userId, {
      featureName,
      vocabEntryIds: []
    });
  }

  /**
   * Get all feature names for a user (for dropdown/selection purposes)
   */
  async getFeatureNamesForUser(userId: string): Promise<string[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const sets = await this.onDeckVocabDAL.getAllSetsForUser(userId);
    return sets.map(set => set.featureName).sort();
  }

  /**
   * Validate set data according to business rules
   */
  private validateSetData(data: OnDeckVocabSetCreateData): void {
    if (!data.featureName || data.featureName.trim() === '') {
      throw new ValidationError('Feature name is required');
    }

    if (data.featureName.length > 100) {
      throw new ValidationError('Feature name cannot exceed 100 characters');
    }

    // Check for valid feature name characters (alphanumeric, spaces, hyphens, underscores)
    const validFeatureNameRegex = /^[a-zA-Z0-9\s\-_]+$/;
    if (!validFeatureNameRegex.test(data.featureName.trim())) {
      throw new ValidationError('Feature name can only contain letters, numbers, spaces, hyphens, and underscores');
    }

    if (!Array.isArray(data.vocabEntryIds)) {
      throw new ValidationError('Vocab entry IDs must be an array');
    }

    if (data.vocabEntryIds.length > 30) {
      throw new ValidationError('Maximum of 30 vocab entries allowed per set');
    }

    // Check for duplicate IDs
    const uniqueIds = new Set(data.vocabEntryIds);
    if (uniqueIds.size !== data.vocabEntryIds.length) {
      throw new ValidationError('Duplicate vocab entry IDs are not allowed');
    }

    // Check that all IDs are positive integers
    for (const id of data.vocabEntryIds) {
      if (!Number.isInteger(id) || id <= 0) {
        throw new ValidationError('All vocab entry IDs must be positive integers');
      }
    }
  }
}
