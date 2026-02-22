import { VocabEntryDAL } from '../dal/implementations/VocabEntryDAL.js';
import { VocabEntry, StarterPackBucket } from '../types/index.js';
import db from '../db.js';

/**
 * Starter Packs Service
 * Business logic for managing language starter packs
 * Now uses starterPackBucket column directly on VocabEntry for simpler architecture
 */
export class StarterPacksService {
  constructor(
    private vocabEntryDAL: VocabEntryDAL
  ) {}

  /**
   * Get starter pack cards for a specific language
   * Returns cards that haven't been sorted yet by the user (starterPackBucket IS NULL)
   */
  async getStarterPackCards(language: string, userId: string): Promise<VocabEntry[]> {
    const limit: number = 50;
    
    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT * FROM vocabentries
        WHERE "userId" = $1 
        AND language = $2
        AND "starterPackBucket" IS NULL
        ORDER BY "createdAt" ASC
        LIMIT $3
      `, [userId, language, limit]);
      
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get user's progress on a starter pack
   */
  async getProgress(language: string, userId: string): Promise<any> {
    const client = await db.getClient();
    try {
      // Count total cards for this language
      const totalResult = await client.query<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM vocabentries
        WHERE "userId" = $1 AND language = $2
      `, [userId, language]);
      
      // Count sorted cards (non-null bucket)
      const sortedResult = await client.query<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM vocabentries
        WHERE "userId" = $1 
        AND language = $2
        AND "starterPackBucket" IS NOT NULL
      `, [userId, language]);
      
      const total: number = parseInt(totalResult.rows[0].count);
      const sorted: number = parseInt(sortedResult.rows[0].count);
      const remaining: number = total - sorted;

      return {
        total,
        sorted,
        remaining,
        percentComplete: total > 0 ? Math.round((sorted / total) * 100) : 0
      };
    } finally {
      client.release();
    }
  }

  /**
   * Sort a card into a bucket
   * Simply updates the starterPackBucket column
   * Special handling: "already-learned" sets bucket to 'library' and marks as Mastered
   */
  async sortCard(userId: string, cardId: number, bucket: string, language: string): Promise<any> {
    // Validate bucket
    const validBuckets: string[] = ['already-learned', 'library', 'skip', 'learn-later'];
    if (!validBuckets.includes(bucket)) {
      throw new Error(`Invalid bucket: ${bucket}`);
    }

    // Special handling for "already-learned" - add to library and mark as Mastered
    let actualBucket: StarterPackBucket = bucket as StarterPackBucket;
    let shouldMarkMastered: boolean = false;
    
    if (bucket === 'already-learned') {
      actualBucket = 'library';
      shouldMarkMastered = true;
    }

    const client = await db.getClient();
    try {
      // Update the card's bucket
      await client.query(`
        UPDATE vocabentries
        SET "starterPackBucket" = $1
        WHERE id = $2 AND "userId" = $3
      `, [actualBucket, cardId, userId]);

      console.log(`Set card ${cardId} starterPackBucket to: ${actualBucket}`);

      // If "already-learned", update category to Mastered and add perfect mark history
      if (shouldMarkMastered) {
        await this.vocabEntryDAL.updateCategory(cardId, 'Mastered');
        console.log(`Updated card ${cardId} category to Mastered`);
        
        // Create 8 correct marks with current timestamp
        const currentTimestamp: string = new Date().toISOString();
        const perfectMarkHistory: any[] = Array(8).fill(null).map(() => ({
          timestamp: currentTimestamp,
          isCorrect: true
        }));
        
        // Update mark history with perfect stats
        await this.vocabEntryDAL.updateMarkHistory(
          cardId,
          perfectMarkHistory,
          8,  // totalMarkCount
          8,  // totalCorrectCount
          1.0,  // totalSuccessRate (100%)
          1.0,  // last8SuccessRate (100%)
          1.0   // last16SuccessRate (100%)
        );
        console.log(`Updated card ${cardId} with perfect mark history (8/8 correct)`);
      }

      return {
        success: true,
        message: 'Card sorted successfully',
        bucket: actualBucket
      };
    } finally {
      client.release();
    }
  }

  /**
   * Undo a card sort
   * Sets starterPackBucket back to NULL
   */
  async undoSort(userId: string, cardId: number, language: string): Promise<any> {
    const client = await db.getClient();
    try {
      const result = await client.query(`
        UPDATE vocabentries
        SET "starterPackBucket" = NULL
        WHERE id = $1 AND "userId" = $2
        RETURNING *
      `, [cardId, userId]);

      if (result.rows.length === 0) {
        return {
          success: false,
          message: 'Card not found'
        };
      }

      return {
        success: true,
        message: 'Card undo successful'
      };
    } finally {
      client.release();
    }
  }
}
