import { IBaseDAL } from './IBaseDAL.js';
import { VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, HskLevel } from '../../types/index.js';
import { BulkResult, ITransaction } from '../../types/dal.js';

/**
 * Interface for VocabEntry Data Access Layer
 * Extends base DAL with vocabulary-specific operations
 */
export interface IVocabEntryDAL extends IBaseDAL<VocabEntry, VocabEntryCreateData, VocabEntryUpdateData> {
  // User-specific queries
  findByUserId(userId: string, limit?: number, offset?: number): Promise<VocabEntry[]>;
  findByUserAndKey(userId: string, entryKey: string): Promise<VocabEntry | null>;
  countByUserId(userId: string): Promise<number>;
  
  // Search and filtering
  searchEntries(userId: string, searchTerm: string, limit?: number): Promise<VocabEntry[]>;
  findByHskLevel(userId: string, hskLevel: HskLevel): Promise<VocabEntry[]>;
  findByCustomTag(userId: string, isCustom: boolean): Promise<VocabEntry[]>;
  
  // Bulk operations for CSV import
  bulkCreate(entries: VocabEntryCreateData[]): Promise<VocabEntry[]>;
  bulkUpsert(entries: VocabEntryCreateData[]): Promise<BulkResult>;
  bulkCreateWithTransaction(entries: VocabEntryCreateData[], transaction: ITransaction): Promise<VocabEntry[]>;
  
  // Advanced queries
  findDuplicateKeys(userId: string, entryKeys: string[]): Promise<VocabEntry[]>;
  findEntriesCreatedAfter(userId: string, date: Date): Promise<VocabEntry[]>;
  
  // Statistics
  getUserVocabStats(userId: string): Promise<{
    total: number;
    customEntries: number;
    hskEntries: number;
    hskBreakdown: Record<HskLevel, number>;
    recentEntries: number; // Last 7 days
  }>;
  
  // Batch operations with progress tracking
  bulkUpsertWithProgress(
    entries: VocabEntryCreateData[],
    progressCallback?: (processed: number, total: number) => void
  ): Promise<BulkResult>;
}
