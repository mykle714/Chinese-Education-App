import { VocabEntryDAL } from '../dal/implementations/VocabEntryDAL.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';
import { DiscoverCard, StarterPackBucket } from '../types/index.js';
import db from '../db.js';

/**
 * Starter Packs Service
 * Business logic for managing language starter packs
 * Uses curated DictionaryEntries (discoverable=TRUE) as the card source,
 * with per-user sort state tracked in vocabentries (starterPackBucket field).
 */
export class StarterPacksService {
  constructor(
    private vocabEntryDAL: VocabEntryDAL,
    private dictionaryDAL: DictionaryDAL
  ) {}

  /**
   * Get unsorted discoverable cards for a specific language.
   * Returns up to 50 cards that the user has not yet sorted.
   * If the stack is empty, skip cards are recycled (deleted from vocabentries)
   * so they re-enter the discover flow.
   */
  async getStarterPackCards(language: string, userId: string): Promise<DiscoverCard[]> {
    let rows = await this._fetchUnsortedCardRows(language, userId);

    // When the discover stack is exhausted, recycle skip cards so the user
    // gets another pass at words they previously deferred.
    if (rows.length === 0) {
      await this._clearSkipCards(userId, language);
      rows = await this._fetchUnsortedCardRows(language, userId);
    }

    const cards: DiscoverCard[] = rows.map(row => ({
      id: row.id,
      entryKey: row.word1,
      entryValue: Array.isArray(row.definitions) ? row.definitions[0] : row.definitions,
      pronunciation: row.pronunciation,
      tone: row.tone,
      language: row.language,
      word2: row.word2,
      script: row.script,
      hskLevelTag: row.hskLevelTag,
      breakdown: row.breakdown,
      synonyms: row.synonyms,
      exampleSentences: row.exampleSentences,
      exampleSentencesMetadata: null, // Computed below via on-the-fly computation
      expansion: row.expansion,
      expansionLiteralTranslation: row.expansionLiteralTranslation ?? null,
    }));

    // Compute enrichment metadata on-the-fly in batch queries
    const withExampleMeta = await this.dictionaryDAL.enrichExampleSentencesMetadataBatch(cards, language);
    return await this.dictionaryDAL.enrichExpansionMetadataBatch(withExampleMeta, language);
  }

  /**
   * Fetch raw unsorted discoverable card rows for a user/language.
   * A card is "unsorted" if the user has no vocabentry for it.
   */
  private async _fetchUnsortedCardRows(language: string, userId: string): Promise<any[]> {
    const client = await db.getClient();
    try {
      const result = await client.query(`
        SELECT de.id, de.word1, de.word2, de.pronunciation, de.tone, de.definitions,
               de.language, de.script, de."hskLevelTag", de.breakdown, de.synonyms,
               de."exampleSentences", de.expansion, de."expansionLiteralTranslation"
        FROM DictionaryEntries de
        WHERE de.language = $1
          AND de.discoverable = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM vocabentries ve
            WHERE ve."userId" = $2 AND ve."entryKey" = de.word1
          )
        ORDER BY de.id ASC
        LIMIT 50
      `, [language, userId]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Delete all skip-bucket vocabentries for a user/language so those cards
   * re-enter the discover flow on the next fetch.
   */
  private async _clearSkipCards(userId: string, language: string): Promise<void> {
    const client = await db.getClient();
    try {
      const result = await client.query(`
        DELETE FROM vocabentries
        WHERE "userId" = $1 AND language = $2 AND "starterPackBucket" = 'skip'
        RETURNING id
      `, [userId, language]);
      console.log(`[StarterPacks] Recycled ${result.rowCount} skip card(s) for userId=${userId} language=${language}`);
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
      const totalResult = await client.query<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM DictionaryEntries
        WHERE language = $1 AND discoverable = TRUE
      `, [language]);

      const sortedResult = await client.query<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM vocabentries
        WHERE "userId" = $1 AND language = $2 AND "starterPackBucket" IS NOT NULL
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
   * Creates/updates the corresponding vocabentry with starterPackBucket set.
   * Special handling: "already-learned" → bucket='library' + category='Mastered' + perfect mark history
   */
  async sortCard(userId: string, cardId: number, bucket: string, language: string): Promise<any> {
    const validBuckets: string[] = ['already-learned', 'library', 'skip', 'learn-later'];
    if (!validBuckets.includes(bucket)) {
      throw new Error(`Invalid bucket: ${bucket}`);
    }

    let actualBucket: StarterPackBucket = bucket as StarterPackBucket;
    let shouldMarkMastered: boolean = false;

    if (bucket === 'already-learned') {
      actualBucket = 'library';
      shouldMarkMastered = true;
    }

    // Fetch the full dictionary entry
    const dictEntry = await this.dictionaryDAL.findById(cardId);
    if (!dictEntry) {
      throw new Error(`Dictionary entry ${cardId} not found`);
    }

    const client = await db.getClient();
    try {
      // Find or create the corresponding VocabEntry
      const existing = await this.vocabEntryDAL.findByUserAndKey(userId, dictEntry.word1);

      let vocabEntryId: number;

      if (!existing) {
        const initialCategory = shouldMarkMastered ? 'Mastered' : 'Unfamiliar';
        const insertResult = await client.query(`
          INSERT INTO VocabEntries (
            "userId", "entryKey", "entryValue", language, "starterPackBucket", category
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [
          userId,
          dictEntry.word1,
          dictEntry.definitions[0] || '',
          dictEntry.language,
          actualBucket,
          initialCategory,
        ]);
        vocabEntryId = insertResult.rows[0].id;
        console.log(`[StarterPacks] Created VocabEntry id=${vocabEntryId} for entryKey=${dictEntry.word1}`);
      } else {
        vocabEntryId = existing.id;
        console.log(`[StarterPacks] VocabEntry already exists id=${vocabEntryId} for entryKey=${dictEntry.word1}`);
      }

      if (shouldMarkMastered) {
        await this.vocabEntryDAL.updateCategory(vocabEntryId, 'Mastered');
        const currentTimestamp: string = new Date().toISOString();
        const perfectMarkHistory: any[] = Array(8).fill(null).map(() => ({
          timestamp: currentTimestamp,
          isCorrect: true
        }));
        await this.vocabEntryDAL.updateMarkHistory(
          vocabEntryId,
          perfectMarkHistory,
          8, 8, 1.0, 1.0, 1.0
        );
        console.log(`[StarterPacks] Marked VocabEntry id=${vocabEntryId} as Mastered with 8/8 history`);
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
   * Deletes the vocabentry row (only if created via starter pack, i.e. starterPackBucket IS NOT NULL)
   */
  async undoSort(userId: string, cardId: number, language: string): Promise<any> {
    const client = await db.getClient();
    try {
      // Get word1 for the dictionary entry
      const dictResult = await client.query(`
        SELECT word1 FROM DictionaryEntries WHERE id = $1
      `, [cardId]);

      const word1: string | undefined = dictResult.rows[0]?.word1;

      if (!word1) {
        return { success: false, message: 'Card not found in sorted list' };
      }

      // Delete the vocabentry only if it was created via starter pack
      const deleteResult = await client.query(`
        DELETE FROM vocabentries
        WHERE "userId" = $1 AND "entryKey" = $2 AND "starterPackBucket" IS NOT NULL
        RETURNING id
      `, [userId, word1]);

      if (deleteResult.rows.length === 0) {
        return { success: false, message: 'Card not found in sorted list' };
      }

      return { success: true, message: 'Card undo successful' };
    } finally {
      client.release();
    }
  }
}
