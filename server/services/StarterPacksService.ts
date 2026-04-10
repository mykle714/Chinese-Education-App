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
   * Get unsorted discoverable cards for a specific language, filtered to the
   * user's current HSK level (±2 buffer). Also returns the computed userHskLevel
   * so the client can apply its own narrower filter and display it.
   *
   * Fallback chain when the primary band is empty:
   *   1. Recycle the user's skipped cards in the same band, retry the query.
   *   2. Widen to "any HSK ≤ userHskLevel" (easier-review fallback) — this
   *      keeps the user moving when they've exhausted everything at their
   *      level. The client still narrows the result, so easier cards may not
   *      all reach the UI; that's OK, they're a safety net.
   */
  async getStarterPackCards(language: string, userId: string, excludeIds: number[] = []): Promise<{ cards: DiscoverCard[]; userHskLevel: number; provisionalMode: boolean }> {
    // Compute the user's adaptive HSK level and provisional mode in parallel
    const [userHskLevel, provisionalMode] = await Promise.all([
      this.computeUserHskLevel(userId, language),
      this.computeProvisionalMode(userId, language),
    ]);

    // Step 1: primary query — band matched to the client filter so every fetched card is showable.
    // Provisional mode (< 3 Unfamiliar cards): no HSK band restriction — fetch from all levels so
    //   the user can encounter any card and build Unfamiliar signal quickly. The client still applies
    //   its own narrower filter before displaying, so this is purely a supply-side widening.
    // Normal mode: ±1 around userHskLevel (client shows [level, level+1]; level-1 provides a small buffer).
    // Provisional mode: fetch only cards above the user's current level (userHskLevel+1..6),
    // matching exactly what the client filter will show. Fetching the full range (1..6)
    // caused premature "All cards sorted" — lower-level cards were deduped out on load-more
    // because they were already in allCards, leaving visibleQueue empty.
    const primaryLabels = provisionalMode
      ? this._buildBandLabels(userHskLevel + 1, 6)
      : this._buildBandLabels(userHskLevel - 1, userHskLevel + 1);
    console.log(`[StarterPacks] getStarterPackCards: userHskLevel=${userHskLevel}, provisionalMode=${provisionalMode}, excludeIds.length=${excludeIds.length}, primaryLabels=${JSON.stringify(primaryLabels)}`);
    let rows = await this._fetchUnsortedCardRows(language, userId, primaryLabels, excludeIds);
    console.log(`[StarterPacks] primary query returned ${rows.length} rows`);

    // Step 2: recycle skip cards in the same band and retry
    if (rows.length === 0) {
      await this._clearSkipCards(userId, language);
      rows = await this._fetchUnsortedCardRows(language, userId, primaryLabels, excludeIds);
    }

    // Step 3: easier-review fallback — widen the band when the primary is exhausted.
    // Provisional: already using full range, so fallback is also full range (handles skip-recycle edge case).
    // Normal: any HSK ≤ userHskLevel+1.
    if (rows.length === 0) {
      const easierLabels = provisionalMode
        ? this._buildBandLabels(1, 6)
        : this._buildBandLabels(1, userHskLevel + 1);
      rows = await this._fetchUnsortedCardRows(language, userId, easierLabels, excludeIds);
      if (rows.length > 0) {
        console.log(`[StarterPacks] Easier-review fallback: returning ${rows.length} card(s) for userId=${userId} provisionalMode=${provisionalMode}`);
      }
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
      hskLevel: row.hskLevel,
      breakdown: row.breakdown,
      synonyms: row.synonyms,
      exampleSentences: row.exampleSentences,
      exampleSentencesMetadata: null, // Computed below via on-the-fly computation
      expansion: row.expansion,
      expansionLiteralTranslation: row.expansionLiteralTranslation ?? null,
    }));

    // Compute enrichment metadata on-the-fly in batch queries
    const withExampleMeta = await this.dictionaryDAL.enrichExampleSentencesMetadataBatch(cards, language);
    const enriched = await this.dictionaryDAL.enrichExpansionMetadataBatch(withExampleMeta, language);

    return { cards: enriched, userHskLevel, provisionalMode };
  }

  /**
   * Compute the user's current adaptive HSK level.
   *
   * The level is the ceiling of the average HSK level over the 50 hardest
   * "Mastered" cards (sorted by hskLevel DESC). This anchors the user's level
   * to the ceiling of what they've already learned.
   *
   * Returns 0 if the user has no mastered cards yet. Result is clamped
   * to [1, 6] when mastered cards exist.
   */
  private async computeUserHskLevel(userId: string, language: string): Promise<number> {
    const client = await db.getClient();
    try {
      const result = await client.query<{ avg_lvl: number | null }>(`
        SELECT AVG(lvl)::float AS avg_lvl
        FROM (
          SELECT CAST(SUBSTRING(de."hskLevel" FROM 4) AS INTEGER) AS lvl
          FROM vocabentries ve
          JOIN dictionaryentries de
            ON ve."entryKey" = de.word1 AND de.language = ve.language
          WHERE ve."userId" = $1
            AND ve.language = $2
            AND ve.category = 'Mastered'
            AND de."hskLevel" ~ '^HSK[1-6]$'
          ORDER BY lvl DESC
          LIMIT 50
        ) sub
      `, [userId, language]);

      const avg = result.rows[0]?.avg_lvl;
      if (avg == null) return 0; // brand-new user with no mastered cards
      return Math.max(1, Math.min(6, Math.ceil(avg)));
    } finally {
      client.release();
    }
  }

  /**
   * Determine whether the user is in provisional mode.
   *
   * Provisional mode is active when the user has fewer than 3 cards categorised
   * as "Unfamiliar". In this state the client narrows its card filter to only
   * hskLevel+1, pushing the user toward slightly harder cards so they build up
   * enough Unfamiliar signal quickly to make the adaptive HSK level meaningful.
   */
  private async computeProvisionalMode(userId: string, language: string): Promise<boolean> {
    const client = await db.getClient();
    try {
      const result = await client.query<{ cnt: string }>(`
        SELECT COUNT(*) AS cnt
        FROM vocabentries
        WHERE "userId" = $1 AND language = $2 AND category = 'Unfamiliar'
      `, [userId, language]);
      return parseInt(result.rows[0].cnt, 10) < 3;
    } finally {
      client.release();
    }
  }

  /**
   * Build the array of "HSK{n}" labels covering the inclusive band
   * [minLevel, maxLevel], clamped to [1, 6]. Returns an empty array if the
   * range is invalid.
   */
  private _buildBandLabels(minLevel: number, maxLevel: number): string[] {
    const lo = Math.max(1, Math.min(6, minLevel));
    const hi = Math.max(1, Math.min(6, maxLevel));
    const labels: string[] = [];
    for (let i = lo; i <= hi; i++) {
      labels.push(`HSK${i}`);
    }
    return labels;
  }

  /**
   * Fetch raw unsorted discoverable card rows for a user/language whose
   * `hskLevel` is within the supplied list of allowed labels. Returns an
   * empty array if `allowedLabels` is empty.
   */
  private async _fetchUnsortedCardRows(language: string, userId: string, allowedLabels: string[], excludeIds: number[] = []): Promise<any[]> {
    if (allowedLabels.length === 0) return [];

    const client = await db.getClient();
    try {
      // Exclude cards the client already has (excludeIds) in addition to
      // cards the user has already sorted (vocabentries NOT EXISTS).
      const excludeClause = excludeIds.length > 0
        ? `AND de.id != ALL($4::int[])`
        : '';
      const params: any[] = [language, userId, allowedLabels];
      if (excludeIds.length > 0) params.push(excludeIds);

      const result = await client.query(`
        SELECT de.id, de.word1, de.word2, de.pronunciation, de.tone, de.definitions,
               de.language, de.script, de."hskLevel", de.breakdown, de.synonyms,
               de."exampleSentences", de.expansion, de."expansionLiteralTranslation"
        FROM DictionaryEntries de
        WHERE de.language = $1
          AND de.discoverable = TRUE
          AND de."hskLevel" = ANY($3::text[])
          AND NOT EXISTS (
            SELECT 1 FROM vocabentries ve
            WHERE ve."userId" = $2 AND ve."entryKey" = de.word1
          )
          ${excludeClause}
        ORDER BY de.id ASC
        LIMIT 50
      `, params);
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

      // Recompute HSK level and provisional mode after the sort so the client
      // can update its filter on the fly. Both queries are cheap; run in parallel.
      const [userHskLevel, provisionalMode] = await Promise.all([
        this.computeUserHskLevel(userId, language),
        this.computeProvisionalMode(userId, language),
      ]);

      return {
        success: true,
        message: 'Card sorted successfully',
        bucket: actualBucket,
        userHskLevel,
        provisionalMode
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

      const deleteResult = await client.query(`
        DELETE FROM vocabentries
        WHERE "userId" = $1 AND "entryKey" = $2
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
