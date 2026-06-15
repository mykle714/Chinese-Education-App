import { VocabEntryDAL } from '../dal/implementations/VocabEntryDAL.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';
import { DiscoverCard, StarterPackBucket } from '../types/index.js';
import db from '../db.js';
import { dictTableForLanguage } from '../dal/shared/dictTable.js';
import { vetTableForLanguage } from '../dal/shared/vetTable.js';

/**
 * Starter Packs Service
 * Business logic for managing language starter packs (the discover / "sort cards" flow).
 *
 * Card source is the per-language dictionaryentries table (discoverable=TRUE), with
 * per-user sort state tracked in vocabentries (starterPackBucket field). Both
 * supported languages use the same adaptive, difficulty-banded flow
 * (_getDifficultyDiscoverCards / computeUserDifficultyLevel / provisional mode); they differ only
 * in how the integer difficulty level is encoded in the dict table's difficulty column:
 *   - Chinese (dictionaryentries_zh): 'HSK1'..'HSK6' (HSK proficiency, ceiling 6).
 *   - Spanish (dictionaryentries_es): '1'..'5' (learner-acquisition difficulty,
 *     1=easiest..5=hardest, ceiling 5) written by the Spanish vernacular/difficulty
 *     backfill. The encoding is centralized in _levelConfig so the band math stays
 *     language-agnostic.
 *
 * For Chinese the difficulty value doubles as the user-facing HSK proficiency label
 * (rendered as an "HSK 3" badge); for Spanish it is a plain 1–5 acquisition score.
 */
export class StarterPacksService {
  constructor(
    private vocabEntryDAL: VocabEntryDAL,
    private dictionaryDAL: DictionaryDAL
  ) {}

  /**
   * Resolve the per-language dictionaryentries table for discover/sort/undo queries.
   * Whitelisted (never interpolates caller-controlled text) so it is safe to splice
   * directly into SQL. Card ids are surrogate serials that collide across tables, so
   * every id lookup must be scoped to the correct language's table.
   */
  private _dictTable(language: string): string {
    return dictTableForLanguage(language);
  }

  /**
   * Resolve the per-language vocabentries table (vet) — vocabentries_zh /
   * vocabentries_es (migration 66). Whitelisted, safe to splice into SQL.
   */
  private _vetTable(language: string): string {
    return vetTableForLanguage(language);
  }

  /**
   * Compute the band fields ({userDifficultyLevel, provisionalMode}) the client uses to
   * narrow its filter after a fetch/sort/undo. Shared by both languages — the
   * difficulty-level encoding is resolved per-language inside computeUserDifficultyLevel.
   */
  private async _computeBand(userId: string, language: string): Promise<{ userDifficultyLevel: number; provisionalMode: boolean }> {
    const provisionalMode = await this.computeProvisionalMode(userId, language);
    const userDifficultyLevel = await this.computeUserDifficultyLevel(userId, language, provisionalMode);
    return { userDifficultyLevel, provisionalMode };
  }

  /**
   * Get unsorted discoverable cards for a specific language. Both supported
   * languages use the same adaptive difficulty-band flow; the per-language level
   * encoding is resolved inside the flow (see _levelConfig).
   */
  async getStarterPackCards(language: string, userId: string, excludeIds: number[] = []): Promise<{ cards: DiscoverCard[]; userDifficultyLevel: number; provisionalMode: boolean }> {
    return this._getDifficultyDiscoverCards(language, userId, excludeIds);
  }

  /**
   * Adaptive difficulty-band discover flow: cards filtered to the user's current
   * level (±1 buffer). Also returns the computed userDifficultyLevel so the client can
   * apply its own narrower filter and display it.
   *
   * Fallback chain when the primary band is empty:
   *   1. Recycle the user's skipped cards in the same band, retry the query.
   *   2. Widen to "any level ≤ userDifficultyLevel" (easier-review fallback) — this
   *      keeps the user moving when they've exhausted everything at their
   *      level. The client still narrows the result, so easier cards may not
   *      all reach the UI; that's OK, they're a safety net.
   */
  private async _getDifficultyDiscoverCards(language: string, userId: string, excludeIds: number[] = []): Promise<{ cards: DiscoverCard[]; userDifficultyLevel: number; provisionalMode: boolean }> {
    const table = this._dictTable(language);
    const { maxLevel } = this._levelConfig(language);
    // Provisional mode must be known before the level calc — the level formula
    // differs in provisional mode (see computeUserDifficultyLevel).
    const provisionalMode = await this.computeProvisionalMode(userId, language);
    const userDifficultyLevel = await this.computeUserDifficultyLevel(userId, language, provisionalMode);

    // Step 1: primary query — band matched to the client filter so every fetched card is showable.
    // Provisional mode (< 3 Unfamiliar cards): no difficulty band restriction — fetch from all levels so
    //   the user can encounter any card and build Unfamiliar signal quickly. The client still applies
    //   its own narrower filter before displaying, so this is purely a supply-side widening.
    // Normal mode: ±1 around userDifficultyLevel (client shows [level, level+1]; level-1 provides a small buffer).
    // Provisional mode: fetch only cards above the user's current level (userDifficultyLevel+1..6),
    // matching exactly what the client filter will show. Fetching the full range (1..6)
    // caused premature "All cards sorted" — lower-level cards were deduped out on load-more
    // because they were already in allCards, leaving visibleQueue empty.
    const primaryLabels = provisionalMode
      ? this._buildBandLabels(userDifficultyLevel + 1, maxLevel, language)
      : this._buildBandLabels(userDifficultyLevel - 1, userDifficultyLevel + 1, language);
    console.log(`[StarterPacks] getStarterPackCards: userDifficultyLevel=${userDifficultyLevel}, provisionalMode=${provisionalMode}, excludeIds.length=${excludeIds.length}, primaryLabels=${JSON.stringify(primaryLabels)}`);
    let rows = await this._fetchUnsortedCardRows(language, userId, table, primaryLabels, excludeIds);
    console.log(`[StarterPacks] primary query returned ${rows.length} rows`);

    // Step 2: recycle skip cards in the same band and retry
    if (rows.length === 0) {
      await this._clearSkipCards(userId, language);
      rows = await this._fetchUnsortedCardRows(language, userId, table, primaryLabels, excludeIds);
    }

    // Step 3: easier-review fallback — widen the band when the primary is exhausted.
    // Provisional: already using full range, so fallback is also full range (handles skip-recycle edge case).
    // Normal: any level ≤ userDifficultyLevel+1.
    if (rows.length === 0) {
      const easierLabels = provisionalMode
        ? this._buildBandLabels(1, maxLevel, language)
        : this._buildBandLabels(1, userDifficultyLevel + 1, language);
      rows = await this._fetchUnsortedCardRows(language, userId, table, easierLabels, excludeIds);
      if (rows.length > 0) {
        console.log(`[StarterPacks] Easier-review fallback: returning ${rows.length} card(s) for userId=${userId} provisionalMode=${provisionalMode}`);
      }
    }

    const cards = this._rowsToDiscoverCards(rows);
    const enriched = await this._enrichDiscoverCards(cards, language);

    return { cards: enriched, userDifficultyLevel, provisionalMode };
  }

  /**
   * Map raw dictionaryentries rows into DiscoverCard DTOs. Shared by both the
   * Chinese and Spanish flows so the row→card shape stays in one place.
   */
  private _rowsToDiscoverCards(rows: any[]): DiscoverCard[] {
    return rows.map(row => ({
      id: row.id,
      entryKey: row.word1,
      definition: Array.isArray(row.definitions) ? row.definitions[0] : row.definitions,
      pronunciation: row.pronunciation,
      tone: row.tone,
      language: row.language,
      word2: row.word2,
      script: row.script,
      difficulty: row.difficulty,
      // Spanish POS badge fields (NULL/false for Chinese — see _fetchUnsortedCardRows).
      pos: row.pos ?? null,
      hasMultiplePos: row.hasMultiplePos ?? false,
      breakdown: row.breakdown,
      synonyms: row.synonyms,
      exampleSentences: row.exampleSentences,
      exampleSentencesMetadata: null, // Computed on-the-fly in _enrichDiscoverCards
      expansion: row.expansion,
      expansionLiteralTranslation: row.expansionLiteralTranslation ?? null,
      // Optional icons8 icon for the card; client renders it via /api/icons8/<iconId>/image.
      iconId: row.iconId ?? null,
    }));
  }

  /**
   * Compute example-sentence + expansion enrichment metadata on-the-fly, in batch.
   * Both enrichment methods dispatch internally on language (Spanish uses
   * whitespace tokenization; Chinese uses greedy segmentation).
   */
  private async _enrichDiscoverCards(cards: DiscoverCard[], language: string): Promise<DiscoverCard[]> {
    const withExampleMeta = await this.dictionaryDAL.enrichExampleSentencesMetadataBatch(cards, language);
    return this.dictionaryDAL.enrichExpansionMetadataBatch(withExampleMeta, language);
  }

  /**
   * Per-language encoding of the integer difficulty level stored in the dict
   * table's difficulty column. Centralizes the differences so the band math
   * (computeUserDifficultyLevel / _buildBandLabels) stays language-agnostic:
   *   - maxLevel       — the difficulty ceiling (zh: 6, es: 5).
   *   - label(n)       — format level n into the stored string ('HSK3' vs '3').
   *   - levelExpr      — SQL extracting the integer level from de."difficulty".
   *   - validPredicate — SQL matching rows whose difficulty is a valid level.
   * All SQL fragments are static (never interpolate caller input) so they are
   * safe to splice directly into queries.
   */
  private _levelConfig(language: string): {
    maxLevel: number;
    label: (n: number) => string;
    levelExpr: string;
    validPredicate: string;
  } {
    if (language === 'es') {
      // Spanish: bare integer '1'..'5' learner-acquisition difficulty.
      return {
        maxLevel: 5,
        label: (n) => String(n),
        levelExpr: `CAST(de."difficulty" AS INTEGER)`,
        validPredicate: `de."difficulty" ~ '^[1-5]$'`,
      };
    }
    // Chinese (default): 'HSK1'..'HSK6'.
    return {
      maxLevel: 6,
      label: (n) => `HSK${n}`,
      levelExpr: `CAST(SUBSTRING(de."difficulty" FROM 4) AS INTEGER)`,
      validPredicate: `de."difficulty" ~ '^HSK[1-6]$'`,
    };
  }

  /**
   * Compute the user's current adaptive difficulty level.
   *
   * Normal mode: ceil(avg level of the 50 hardest Mastered cards). Anchors
   *   the level to the ceiling of what the user has solidly learned.
   * Provisional mode (<3 Unfamiliar): ceil(1 + avg level of the 5 hardest
   *   Mastered cards). Pushes the level one band above recent mastery so the
   *   user encounters harder cards and builds Unfamiliar signal quickly.
   *
   * Returns 0 if the user has no mastered cards yet. Otherwise clamped to
   * [1, maxLevel] (6 for Chinese HSK, 5 for Spanish difficulty).
   */
  private async computeUserDifficultyLevel(userId: string, language: string, provisionalMode: boolean): Promise<number> {
    const { maxLevel, levelExpr, validPredicate } = this._levelConfig(language);
    const det = this._dictTable(language);
    const vet = this._vetTable(language);
    const client = await db.getClient();
    try {
      const sampleSize = provisionalMode ? 5 : 50;
      const result = await client.query<{ avg_lvl: number | null }>(`
        SELECT AVG(lvl)::float AS avg_lvl
        FROM (
          SELECT ${levelExpr} AS lvl
          FROM ${vet} ve
          JOIN ${det} de
            ON ve."entryKey" = de.word1 AND de.language = ve.language
          WHERE ve."userId" = $1
            AND ve.language = $2
            AND ve.category = 'Mastered'
            AND ${validPredicate}
          ORDER BY lvl DESC
          LIMIT $3
        ) sub
      `, [userId, language, sampleSize]);

      const avg = result.rows[0]?.avg_lvl;
      if (avg == null) return 0; // brand-new user with no mastered cards
      const raw = provisionalMode ? 1 + avg : avg;
      return Math.max(1, Math.min(maxLevel, Math.ceil(raw)));
    } finally {
      client.release();
    }
  }

  /**
   * Determine whether the user is in provisional mode.
   *
   * Provisional mode is active when the user has fewer than 3 cards categorised
   * as "Unfamiliar". In this state the client narrows its card filter to only
   * difficulty+1, pushing the user toward slightly harder cards so they build up
   * enough Unfamiliar signal quickly to make the adaptive difficulty level meaningful.
   */
  private async computeProvisionalMode(userId: string, language: string): Promise<boolean> {
    const client = await db.getClient();
    try {
      const result = await client.query<{ cnt: string }>(`
        SELECT COUNT(*) AS cnt
        FROM ${this._vetTable(language)}
        WHERE "userId" = $1 AND language = $2 AND category = 'Unfamiliar'
      `, [userId, language]);
      return parseInt(result.rows[0].cnt, 10) < 3;
    } finally {
      client.release();
    }
  }

  /**
   * Build the array of difficulty-level labels covering the inclusive band
   * [minLevel, maxLevel], in the language's stored encoding (e.g. 'HSK2'..'HSK4'
   * for zh, '2'..'4' for es). Clamped to [1, language ceiling]. Returns an empty
   * array if the range is invalid.
   */
  private _buildBandLabels(minLevel: number, maxLevel: number, language: string): string[] {
    const { maxLevel: cap, label } = this._levelConfig(language);
    const lo = Math.max(1, Math.min(cap, minLevel));
    const hi = Math.max(1, Math.min(cap, maxLevel));
    const labels: string[] = [];
    for (let i = lo; i <= hi; i++) {
      labels.push(label(i));
    }
    return labels;
  }

  /**
   * Fetch raw unsorted discoverable card rows for a user/language from the given
   * `table`, ordered by id. `allowedLabels` controls the difficulty-band filter:
   *   - `string[]` → restrict to those level labels (e.g. 'HSK3' / '3'). Empty
   *      array → no labels in band, returns [].
   *   - `null` → no level filter at all (escape hatch; both supported languages
   *      now pass labels via the adaptive flow).
   * Excludes cards the user has already sorted (vocabentries NOT EXISTS) and any
   * `excludeIds` the client already holds. `table` is whitelisted via _dictTable.
   */
  private async _fetchUnsortedCardRows(language: string, userId: string, table: string, allowedLabels: string[] | null, excludeIds: number[] = []): Promise<any[]> {
    // Empty (but non-null) label band means "nothing in range" — short-circuit.
    if (allowedLabels !== null && allowedLabels.length === 0) return [];

    const client = await db.getClient();
    try {
      // Build the optional filters with positional params appended in order so the
      // placeholder numbers always line up regardless of which filters are active.
      const params: any[] = [language, userId];
      let filters = '';
      if (allowedLabels !== null) {
        params.push(allowedLabels);
        filters += ` AND de."difficulty" = ANY($${params.length}::text[])`;
      }
      if (excludeIds.length > 0) {
        params.push(excludeIds);
        filters += ` AND de.id != ALL($${params.length}::int[])`;
      }

      // Spanish det carries pos / hasMultiplePos (for the POS badge); Chinese det
      // does not, so substitute literals there. Likewise, a Spanish word1 has one
      // discoverable row per POS, so a card is "already sorted" only when the user
      // has a vet row for that SAME pos — exclude per (word1, pos), not per word1.
      const isEs = language === 'es';
      const posCols = isEs
        ? `, de.pos, de."hasMultiplePos"`
        : `, NULL::varchar AS pos, FALSE AS "hasMultiplePos"`;
      const vetTable = this._vetTable(language);
      const excludePos = isEs ? ` AND ve.pos IS NOT DISTINCT FROM de.pos` : '';

      const result = await client.query(`
        SELECT de.id, de.word1, de.word2, de.pronunciation, de.tone, de.definitions,
               de.language, de.script, de."difficulty", de.breakdown, de.synonyms,
               de."exampleSentences", de.expansion, de."expansionLiteralTranslation",
               de."iconId"${posCols}
        FROM ${table} de
        WHERE de.language = $1
          AND de.discoverable = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM ${vetTable} ve
            WHERE ve."userId" = $2 AND ve."entryKey" = de.word1 AND ve.language = de.language${excludePos}
          )
          ${filters}
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
        DELETE FROM ${this._vetTable(language)}
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
    const table = this._dictTable(language);
    const client = await db.getClient();
    try {
      const totalResult = await client.query<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM ${table}
        WHERE language = $1 AND discoverable = TRUE
      `, [language]);

      const sortedResult = await client.query<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM ${this._vetTable(language)}
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
    const validBuckets: string[] = ['already-learned', 'library', 'skip'];
    if (!validBuckets.includes(bucket)) {
      throw new Error(`Invalid bucket: ${bucket}`);
    }

    let actualBucket: StarterPackBucket = bucket as StarterPackBucket;
    let shouldMarkMastered: boolean = false;

    if (bucket === 'already-learned') {
      actualBucket = 'library';
      shouldMarkMastered = true;
    }

    // Look up the card in the language-appropriate dictionary table. Card ids are
    // per-table surrogate serials that collide across languages, so we must scope
    // the lookup by language (DictionaryDAL.findById is hardcoded to _zh).
    const dictEntry = await this._findDiscoverCardById(cardId, language);
    if (!dictEntry) {
      throw new Error(`Dictionary entry ${cardId} not found`);
    }

    const client = await db.getClient();
    try {
      // Find or create the corresponding VocabEntry. Identity is
      // (userId, entryKey, language[, pos]) — Spanish adds pos so verb vs noun of
      // the same spelling are distinct saved cards. Scope the lookup accordingly.
      const isEs = dictEntry.language === 'es';
      const vetTable = this._vetTable(dictEntry.language);
      const existing = await this.vocabEntryDAL.findByUserAndKey(
        userId, dictEntry.word1, dictEntry.language, isEs ? (dictEntry.pos ?? undefined) : undefined
      );

      let vocabEntryId: number;

      if (!existing) {
        // `category` is a GENERATED column (migration 67) derived from markHistory,
        // so it is omitted here: a fresh row's empty history yields 'Unfamiliar', and
        // the shouldMarkMastered branch below writes an 8/8 history that yields
        // 'Mastered' automatically.
        const insertResult = isEs
          ? await client.query(`
              INSERT INTO ${vetTable} (
                "userId", "entryKey", language, pos, "starterPackBucket"
              ) VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `, [userId, dictEntry.word1, dictEntry.language, dictEntry.pos, actualBucket])
          : await client.query(`
              INSERT INTO ${vetTable} (
                "userId", "entryKey", language, "starterPackBucket"
              ) VALUES ($1, $2, $3, $4)
              RETURNING id
            `, [userId, dictEntry.word1, dictEntry.language, actualBucket]);
        vocabEntryId = insertResult.rows[0].id;
        console.log(`[StarterPacks] Created VocabEntry id=${vocabEntryId} for entryKey=${dictEntry.word1}`);
      } else {
        vocabEntryId = existing.id;
        console.log(`[StarterPacks] VocabEntry already exists id=${vocabEntryId} for entryKey=${dictEntry.word1}`);
      }

      if (shouldMarkMastered) {
        // Writing a perfect 8/8 markHistory makes the GENERATED category resolve to
        // 'Mastered' — no explicit category write needed (or possible).
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

      // Recompute the band after the sort so the client can update its filter on
      // the fly. Neutral for sequential languages (Spanish) — see _computeBand.
      const { userDifficultyLevel, provisionalMode } = await this._computeBand(userId, language);

      return {
        success: true,
        message: 'Card sorted successfully',
        bucket: actualBucket,
        userDifficultyLevel,
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
    const table = this._dictTable(language);
    const client = await db.getClient();
    try {
      // Get word1 (+ pos for Spanish) for the dictionary entry from the
      // language-appropriate table (card ids collide across the per-language
      // tables — see _dictTable).
      const isEs = language === 'es';
      const dictResult = await client.query(`
        SELECT word1, ${isEs ? 'pos' : 'NULL::varchar AS pos'} FROM ${table} WHERE id = $1
      `, [cardId]);

      const word1: string | undefined = dictResult.rows[0]?.word1;
      const pos: string | null = dictResult.rows[0]?.pos ?? null;

      if (!word1) {
        return { success: false, message: 'Card not found in sorted list' };
      }

      // For Spanish, delete only the specific (word1, pos) saved card.
      const deleteResult = isEs
        ? await client.query(`
            DELETE FROM ${this._vetTable(language)}
            WHERE "userId" = $1 AND "entryKey" = $2 AND language = $3 AND pos IS NOT DISTINCT FROM $4
            RETURNING id
          `, [userId, word1, language, pos])
        : await client.query(`
            DELETE FROM ${this._vetTable(language)}
            WHERE "userId" = $1 AND "entryKey" = $2 AND language = $3
            RETURNING id
          `, [userId, word1, language]);

      if (deleteResult.rows.length === 0) {
        return { success: false, message: 'Card not found in sorted list' };
      }

      // Recompute band after rollback so the client can re-sync. Mirrors sortCard().
      const { userDifficultyLevel, provisionalMode } = await this._computeBand(userId, language);

      return { success: true, message: 'Card undo successful', userDifficultyLevel, provisionalMode };
    } finally {
      client.release();
    }
  }

  /**
   * Look up a discover card by its (per-table) surrogate id, scoped to the
   * language-appropriate dictionary table. Returns just the fields sortCard needs
   * (word1 + language). Replaces DictionaryDAL.findById, which is _zh-only.
   */
  private async _findDiscoverCardById(cardId: number, language: string): Promise<{ word1: string; language: string; pos: string | null } | null> {
    const table = this._dictTable(language);
    // Only the Spanish det carries `pos`; the Chinese det has no such column, so
    // select a literal NULL there to keep one shape.
    const posSelect = language === 'es' ? 'pos' : 'NULL::varchar AS pos';
    const client = await db.getClient();
    try {
      const result = await client.query<{ word1: string; language: string; pos: string | null }>(`
        SELECT word1, language, ${posSelect} FROM ${table} WHERE id = $1
      `, [cardId]);
      return result.rows[0] ?? null;
    } finally {
      client.release();
    }
  }
}
