import { VocabEntryDAL } from '../dal/implementations/VocabEntryDAL.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';
import { DiscoverCard, StarterPackBucket } from '../types/index.js';
import db from '../db.js';
import { dictTableForLanguage } from '../dal/shared/dictTable.js';
import { vetTableForLanguage } from '../dal/shared/vetTable.js';

/**
 * Starter Packs Service
 * Business logic for the discover / "sort cards" flow.
 *
 * DESIGN (see docs/SORT_CARDS_DESIGN.md): the SERVER owns the level; the client is a
 * dumb FIFO queue. All level estimation and card selection happen here; the client
 * just shows the head of a short queue and asks for one replacement per sort.
 *
 * Card source is the per-language dictionaryentries table (discoverable=TRUE). Per-user
 * sort state lives in two places:
 *   - vocabentries (vet): "Add to Learn Now" / "Already Learned" rows. The GENERATED
 *     `category` column (from markHistory) is the only mastery signal the estimator
 *     reads — so a card mastered via flashcard review (or DEMOTED by a later wrong
 *     answer) automatically moves the level, with no Discover-specific bookkeeping.
 *   - discover_skips: "Skip for now" deferrals (migration 80). Deliberately separate
 *     so a skip carries NO level signal and never enters the library.
 *
 * Difficulty is ONE generalized integer scale '1'..'6' (migration 79) stored in the
 * dict table's difficulty column, ceiling 6 for every language:
 *   - Chinese (dictionaryentries_zh): '1'..'6' — these ARE HSK proficiency levels
 *     (1 = HSK1 .. 6 = HSK6); migration 79 dropped the old 'HSK' prefix only.
 *   - Spanish (dictionaryentries_es): '1'..'6' learner-acquisition difficulty.
 * The encoding is centralized in _levelConfig so the level math stays
 * language-agnostic. For Chinese the value is surfaced as an "HSK 3" badge (the UI
 * re-adds the HSK label for zh); for Spanish it is a plain acquisition score.
 */
export class StarterPacksService {
  /**
   * Leveling tuning knobs (docs/SORT_CARDS_DESIGN.md §4.3 / §12).
   * A level L is "cleared" (so the user advances past it) when:
   *     mastered[L] >= MIN_MASTERED_TO_ADVANCE  AND  learning[L] <= LEARN_LATER_TOLERANCE
   * - MIN_MASTERED_TO_ADVANCE: master at least this many cards at L before advancing.
   * - LEARN_LATER_TOLERANCE: how many "Add to Learn Now" (not-yet-mastered) cards a
   *   level may carry and still clear. One stray "I'll learn this later" never strands
   *   the user; the second one settles them at L until review drains the pile.
   */
  private static readonly MIN_MASTERED_TO_ADVANCE = 3;
  private static readonly LEARN_LATER_TOLERANCE = 1;

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
   * Get the initial queue of ready-to-show cards for a language. The client holds a
   * short FIFO queue (size 2: head + one buffer), so the default limit is 2.
   * Returns `exhausted: true` only when the user has genuinely sorted the entire
   * discoverable dictionary (an extreme edge case — see getNextCards).
   */
  async getStarterPackCards(language: string, userId: string, limit = 2): Promise<{ cards: DiscoverCard[]; exhausted: boolean; level: number }> {
    return this.getNextCards(language, userId, [], limit);
  }

  /**
   * Select the next batch of ready-to-show cards (server is the sole owner of card
   * selection — the client does NO filtering). Supply order (docs §5):
   *   1. In-level first, then NEAREST-level-first — a single SQL `ORDER BY
   *      ABS(level - estimate)` gives in-level cards, then ±1, ±2, … so the user
   *      drifts away from their level only as gradually as the data allows.
   *   2. Recycle skips: only once non-skip supply is exhausted do skipped cards
   *      re-enter (oldest skip first), filling any remaining slots.
   * Excludes cards the user has already sorted (vet row) and any `excludeIds` the
   * client already holds. `exhausted` is true only when nothing is left at all.
   *
   * `level` is the user's estimated difficulty level (docs §6), returned for
   * DISPLAY ONLY — the client shows it as a chip but must never filter on it.
   */
  async getNextCards(language: string, userId: string, excludeIds: number[] = [], limit = 2): Promise<{ cards: DiscoverCard[]; exhausted: boolean; level: number }> {
    const level = await this.estimateLevel(userId, language);

    // Step 1: fresh (non-skipped) cards, nearest-level-first.
    let rows = await this._fetchSupplyRows(language, userId, level, excludeIds, { includeSkips: false, limit });

    // Step 2: backfill from recycled skips only if fresh supply ran short.
    if (rows.length < limit) {
      const have = new Set([...excludeIds, ...rows.map((r) => r.id)]);
      const skipRows = await this._fetchSupplyRows(language, userId, level, [...have], { includeSkips: true, limit: limit - rows.length });
      rows = rows.concat(skipRows);
    }

    const enriched = await this._enrichDiscoverCards(this._rowsToDiscoverCards(rows), language);
    return { cards: enriched, exhausted: enriched.length === 0, level };
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
      // Spanish POS badge fields (NULL/false for Chinese — see _fetchSupplyRows).
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
   * Encoding of the integer difficulty level stored in the dict table's difficulty
   * column. As of migration 79 every supported language uses ONE generalized scale —
   * a bare integer '1'..'6' — so this is no longer per-language:
   *   - maxLevel       — the difficulty ceiling (6 for all languages).
   *   - levelExpr      — SQL extracting the integer level from de."difficulty".
   *   - validPredicate — SQL matching rows whose difficulty is a valid level.
   * All SQL fragments are static (never interpolate caller input) so they are
   * safe to splice directly into queries.
   *
   * For Chinese the integer still IS the HSK proficiency level (1 = HSK1 .. 6 = HSK6);
   * migration 79 only dropped the textual 'HSK' prefix, the semantics are unchanged.
   * For Spanish it is a learner-acquisition score on the same 1..6 scale.
   */
  private _levelConfig(_language: string): {
    maxLevel: number;
    levelExpr: string;
    validPredicate: string;
  } {
    // Single generalized config (kept the `_language` param in case a future
    // language needs to diverge from the shared 1..6 integer scale).
    return {
      maxLevel: 6,
      levelExpr: `CAST(de."difficulty" AS INTEGER)`,
      validPredicate: `de."difficulty" ~ '^[1-6]$'`,
    };
  }

  /**
   * Estimate the user's current difficulty level: the lowest level they have NOT yet
   * cleared (docs §4.3). Pure function of vet mastery state, recomputed on demand —
   * never accumulated from sort events, so it is order-independent and picks up
   * flashcard-review progress (and demotions) automatically.
   *
   * For each level L we count, in ONE grouped query:
   *   - mastered[L]: vet rows at L with category = 'Mastered'.
   *   - learning[L]: vet rows at L in the library but NOT mastered (the "don't know"
   *     / frontier signal). Skips are in discover_skips, not vet, so they never count.
   * A level is cleared when mastered[L] >= MIN_MASTERED_TO_ADVANCE AND
   * learning[L] <= LEARN_LATER_TOLERANCE. The same rule gives both the fast cold-start
   * climb and the slow settled climb, because learning[L] self-shrinks as cards are
   * mastered. A brand-new user (all zero) is not-cleared at L1 → estimate 1.
   */
  async estimateLevel(userId: string, language: string): Promise<number> {
    const { maxLevel, levelExpr, validPredicate } = this._levelConfig(language);
    const det = this._dictTable(language);
    const vet = this._vetTable(language);
    const client = await db.getClient();
    try {
      const result = await client.query<{ lvl: number; mastered: string; learning: string }>(`
        SELECT ${levelExpr} AS lvl,
               COUNT(*) FILTER (WHERE ve.category = 'Mastered')  AS mastered,
               COUNT(*) FILTER (WHERE ve.category <> 'Mastered') AS learning
        FROM ${vet} ve
        JOIN ${det} de
          ON ve."entryKey" = de.word1 AND de.language = ve.language
        WHERE ve."userId" = $1
          AND ve.language = $2
          AND ${validPredicate}
        GROUP BY lvl
      `, [userId, language]);

      // Index the per-level counts so missing levels read as 0.
      const mastered = new Map<number, number>();
      const learning = new Map<number, number>();
      for (const row of result.rows) {
        mastered.set(row.lvl, parseInt(row.mastered, 10));
        learning.set(row.lvl, parseInt(row.learning, 10));
      }

      // Walk up from the bottom; return the first uncleared level.
      for (let L = 1; L <= maxLevel; L++) {
        const cleared =
          (mastered.get(L) ?? 0) >= StarterPacksService.MIN_MASTERED_TO_ADVANCE &&
          (learning.get(L) ?? 0) <= StarterPacksService.LEARN_LATER_TOLERANCE;
        if (!cleared) return L;
      }
      return maxLevel; // everything cleared → top of the scale
    } finally {
      client.release();
    }
  }

  /**
   * Fetch ready-to-show discoverable card rows for a user/language, ordered
   * NEAREST-LEVEL-FIRST around `level` (in-level, then ±1, ±2, …; ties broken by id).
   * Always excludes cards the user has already sorted (vet NOT EXISTS) and any
   * `excludeIds` the caller already holds.
   *
   * `opts.includeSkips` selects the two supply phases (docs §5):
   *   - false → exclude cards currently in discover_skips (the normal fresh supply).
   *   - true  → ONLY cards in discover_skips (the recycle phase), oldest skip first,
   *             used to backfill when fresh supply is short.
   */
  private async _fetchSupplyRows(
    language: string,
    userId: string,
    level: number,
    excludeIds: number[],
    opts: { includeSkips: boolean; limit: number }
  ): Promise<any[]> {
    if (opts.limit <= 0) return [];

    const det = this._dictTable(language);
    const vetTable = this._vetTable(language);
    const { levelExpr, validPredicate } = this._levelConfig(language);

    const client = await db.getClient();
    try {
      // $1 language, $2 userId, $3 level (for the nearest-first distance ordering),
      // then optional excludeIds, then $limit.
      const params: any[] = [language, userId, level];
      let excludeFilter = '';
      if (excludeIds.length > 0) {
        params.push(excludeIds);
        excludeFilter = ` AND de.id != ALL($${params.length}::int[])`;
      }

      // Skip phase: fresh supply EXCLUDES skipped cards; recycle phase keeps ONLY them.
      // `recycleOrder` pulls the oldest skip back first when recycling.
      const skipFilter = opts.includeSkips
        ? `AND EXISTS (SELECT 1 FROM discover_skips ds WHERE ds."userId" = $2 AND ds.language = de.language AND ds."cardId" = de.id)`
        : `AND NOT EXISTS (SELECT 1 FROM discover_skips ds WHERE ds."userId" = $2 AND ds.language = de.language AND ds."cardId" = de.id)`;
      const recycleOrder = opts.includeSkips
        ? `(SELECT ds."createdAt" FROM discover_skips ds WHERE ds."userId" = $2 AND ds.language = de.language AND ds."cardId" = de.id) ASC,`
        : '';

      // Spanish det carries pos / hasMultiplePos (for the POS badge); Chinese det does
      // not, so substitute literals. A Spanish word1 has one discoverable row per POS,
      // so a card is "already sorted" only when the user has a vet row for that SAME
      // pos — exclude per (word1, pos), not per word1.
      const isEs = language === 'es';
      const posCols = isEs
        ? `, de.pos, de."hasMultiplePos"`
        : `, NULL::varchar AS pos, FALSE AS "hasMultiplePos"`;
      const excludePos = isEs ? ` AND ve.pos IS NOT DISTINCT FROM de.pos` : '';

      params.push(opts.limit);
      const limitParam = `$${params.length}`;

      const result = await client.query(`
        SELECT de.id, de.word1, de.word2, de.pronunciation, de.tone, de.definitions,
               de.language, de.script, de."difficulty", de.breakdown, de.synonyms,
               de."exampleSentences", de.expansion, de."expansionLiteralTranslation",
               de."iconId"${posCols}
        FROM ${det} de
        WHERE de.language = $1
          AND de.discoverable = TRUE
          AND ${validPredicate}
          AND NOT EXISTS (
            SELECT 1 FROM ${vetTable} ve
            WHERE ve."userId" = $2 AND ve."entryKey" = de.word1 AND ve.language = de.language${excludePos}
          )
          ${skipFilter}
          ${excludeFilter}
        ORDER BY ${recycleOrder} ABS(${levelExpr} - $3) ASC, de.id ASC
        LIMIT ${limitParam}
      `, params);
      return result.rows;
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

      // "Sorted" = cards the user has acted on = library vet rows PLUS current skips.
      // Skips moved out of vet into discover_skips (migration 80), so both must be
      // counted to keep progress faithful to the pre-split behaviour.
      const sortedResult = await client.query<{ count: string }>(`
        SELECT
          (SELECT COUNT(*) FROM ${this._vetTable(language)}
             WHERE "userId" = $1 AND language = $2 AND "starterPackBucket" IS NOT NULL)
        + (SELECT COUNT(*) FROM discover_skips
             WHERE "userId" = $1 AND language = $2) AS count
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
   * Sort a card into a bucket and return the single replacement card for the client's
   * FIFO tail (a sort always shrinks the queue by one, so it carries its own refill —
   * there is no separate "load more" call). `excludeIds` are the ids the client still
   * holds, so the replacement is never a duplicate.
   *
   * Bucket effects (docs §8):
   *   - skip            → INSERT discover_skips (NO vet row → no level signal).
   *   - library         → "Add to Learn Now": upsert vet row, empty history (Unfamiliar).
   *   - already-learned → upsert vet row + perfect 8/8 history → GENERATED category Mastered.
   */
  async sortCard(userId: string, cardId: number, bucket: string, language: string, excludeIds: number[] = []): Promise<any> {
    const validBuckets: string[] = ['already-learned', 'library', 'skip'];
    if (!validBuckets.includes(bucket)) {
      throw new Error(`Invalid bucket: ${bucket}`);
    }

    // Skip is signal-free: it lives in discover_skips, never in vet. Record it and
    // return — no dictionary lookup or vet upsert needed.
    if (bucket === 'skip') {
      await this._recordSkip(userId, cardId, language);
      const { cards, exhausted, level } = await this.getNextCards(language, userId, excludeIds, 1);
      return { success: true, message: 'Card skipped', bucket: 'skip', nextCard: cards[0] ?? null, exhausted, level };
    }

    // library / already-learned both persist as the internal 'library' bucket
    // (per CLAUDE.md "Learn Now" is UI text only). already-learned additionally
    // writes a perfect history so the GENERATED category resolves to Mastered.
    const actualBucket: StarterPackBucket = 'library';
    const shouldMarkMastered = bucket === 'already-learned';

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
    } finally {
      client.release();
    }

    // Compute the one replacement card AFTER the sort is persisted, so the new vet
    // row is reflected in the estimate and the supply exclusions.
    const { cards, exhausted, level } = await this.getNextCards(language, userId, excludeIds, 1);
    return { success: true, message: 'Card sorted successfully', bucket: actualBucket, nextCard: cards[0] ?? null, exhausted, level };
  }

  /**
   * Record a "Skip for now" deferral in discover_skips (signal-free — see §3.3).
   * Idempotent per (userId, language, cardId) via the unique index.
   */
  private async _recordSkip(userId: string, cardId: number, language: string): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query(`
        INSERT INTO discover_skips ("userId", language, "cardId")
        VALUES ($1, $2, $3)
        ON CONFLICT ("userId", language, "cardId") DO NOTHING
      `, [userId, language, cardId]);
    } finally {
      client.release();
    }
  }

  /**
   * Undo the last sort. The client passes the bucket it sorted into so we reverse the
   * exact trace (docs §8):
   *   - skip            → DELETE the discover_skips row (by cardId — no word1 lookup).
   *   - library / already-learned → DELETE the vet row (by word1[, pos]).
   * Returns { success } — the client already has the card to re-show; it does not
   * need a replacement.
   */
  async undoSort(userId: string, cardId: number, bucket: string, language: string): Promise<any> {
    if (bucket === 'skip') {
      const client = await db.getClient();
      try {
        const result = await client.query(`
          DELETE FROM discover_skips
          WHERE "userId" = $1 AND language = $2 AND "cardId" = $3
          RETURNING id
        `, [userId, language, cardId]);
        return result.rows.length > 0
          ? { success: true, message: 'Skip undo successful' }
          : { success: false, message: 'Skip not found' };
      } finally {
        client.release();
      }
    }

    // library / already-learned: delete the vet row created by the sort.
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

      return { success: true, message: 'Card undo successful' };
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
