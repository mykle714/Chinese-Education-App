import { VocabEntryDAL } from '../dal/implementations/VocabEntryDAL.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';
import { SortPacksDAL } from '../dal/implementations/SortPacksDAL.js';
import { DiscoverCard, StarterPackBucket, SortPack } from '../types/index.js';
import { SortPackRow } from '../types/sortPacks.js';
import db from '../db.js';
import { dictTableForLanguage } from '../dal/shared/dictTable.js';
import { vetTableForLanguage, UTCM_USERS_JOIN, UTCM_CATEGORY_EXPR } from '../dal/shared/vetTable.js';
import { perfectTypedMarkHistory } from '../utils/masteryCompute.js';
import { LazyEnrichmentService } from './LazyEnrichmentService.js';

/**
 * Starter Packs Service
 * Business logic for the discover / "sort cards" flow.
 *
 * DESIGN (see docs/SORT_CARDS_REQUIREMENTS.md §6 — adaptive leveling, rewritten): the
 * CLIENT owns the adaptive level once the session starts. The server's only leveling
 * job is (a) a one-time COLD-START seed via `estimateLevel` when the client enters the
 * flow with no level yet, and (b) serving supply centered on whatever level the client
 * asks for next, drifting to adjacent levels when that level's supply runs out (unless
 * the request is a manual dropdown pin, which never drifts). The client tracks its own
 * running target level and the "already learned" streak that promotes it — see
 * `SortCardsPage.tsx` — because the level must react to a SortPack's outcome as soon as
 * it completes, not on the next server round-trip.
 *
 * Card source is the per-language dictionaryentries table, gated by _supplyGate:
 * zh on `sortable=TRUE` (migration 110, lazy-enrichment), es on `discoverable=TRUE`. Per-user
 * sort state lives in two places:
 *   - vocabentries (vet): "Add to Learn Now" / "Already Learned" rows persist what the
 *     user did with a card; the GENERATED `category` column (from markHistory) is what
 *     `estimateLevel`'s cold-start seed reads.
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
   * Cold-start tuning knobs for `estimateLevel` (docs/SORT_CARDS_REQUIREMENTS.md §6.1).
   * Used ONLY to seed the level the very first time a user enters the flow (no client
   * target level yet). A level L is "cleared" (so the cold-start seed skips past it)
   * when:
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
    private dictionaryDAL: DictionaryDAL,
    private sortPacksDAL: SortPacksDAL,
    // Request-time lazy-enrichment trigger (docs/DISCOVER_LAZY_ENRICHMENT.md §5).
    // Sorting a zh card into Learn Now / Already-Learned tops up its enrichment when
    // the sorter is a validator. Optional so non-DI test construction still works.
    private lazyEnrichmentService?: LazyEnrichmentService
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
      vernacularScore: row.vernacularScore ?? null,
      // Spanish POS badge fields (NULL/false for Chinese — see _fetchSupplyRows).
      pos: row.pos ?? null,
      hasMultiplePos: row.hasMultiplePos ?? false,
      breakdown: row.breakdown,
      synonyms: row.synonyms,
      exampleSentences: row.exampleSentences,
      exampleSentencesMetadata: null, // Computed on-the-fly in _enrichDiscoverCards
      // Optional icons8 icon for the card; client renders it via /api/icons8/<iconId>/image.
      iconId: row.iconId ?? null,
    }));
  }

  /**
   * Compute example-sentence enrichment metadata on-the-fly, in batch.
   * The enrichment method dispatches internally on language (Spanish uses
   * whitespace tokenization; Chinese uses greedy segmentation).
   */
  private async _enrichDiscoverCards(cards: DiscoverCard[], language: string): Promise<DiscoverCard[]> {
    return this.dictionaryDAL.enrichExampleSentencesMetadataBatch(cards, language);
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
    // `difficulty` is a smallint (migration 92), so it is used directly — no
    // CAST, and the validity check is a numeric range rather than a text regex.
    return {
      maxLevel: 6,
      levelExpr: `de."difficulty"`,
      validPredicate: `de."difficulty" BETWEEN 1 AND 6`,
    };
  }

  /**
   * Supply-visibility gate for the discover flows (sort / quick-mark / progress).
   *
   * Chinese gates on the `sortable` flag (migration 110) so lazily-enriched cards
   * appear in discover BEFORE full enrichment; other languages fall back to
   * `discoverable` (they have no `sortable` column yet — see
   * docs/DISCOVER_LAZY_ENRICHMENT.md, zh-only scope). `sortable` is a strict
   * superset of `discoverable` (discoverable ⇒ sortable), so this never *hides* a
   * previously-visible card.
   *
   * @param alias - table alias prefix incl. trailing dot (e.g. `de.`), or '' when
   *   the query has no alias (getProgress).
   */
  private _supplyGate(language: string, alias = 'de.'): string {
    const col = language === 'zh' ? 'sortable' : 'discoverable';
    return `${alias}${col} = TRUE`;
  }

  /**
   * COLD-START ONLY (docs §6.1): the lowest level the user has NOT yet cleared, used to
   * seed the client's adaptive target level the first time it enters the flow with no
   * level of its own to send. Once seeded, the client tracks and moves its own target
   * level per-SortPack-signal (§6, rewritten) — this is never called again mid-session
   * to re-derive or override that running estimate. Pure function of vet mastery state,
   * so it still picks up flashcard-review progress (and demotions) automatically for
   * the NEXT cold start (e.g. a fresh session after time away).
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
      // category is derived per row from typedMarkHistory + the account's goal flags
      // (migration 101), so join users for the flags and use compute_utcm_category.
      const result = await client.query<{ lvl: number; mastered: string; learning: string }>(`
        SELECT ${levelExpr} AS lvl,
               COUNT(*) FILTER (WHERE ${UTCM_CATEGORY_EXPR} = 'Mastered')  AS mastered,
               COUNT(*) FILTER (WHERE ${UTCM_CATEGORY_EXPR} <> 'Mastered') AS learning
        FROM ${vet} ve
        JOIN ${det} de
          ON ve."entryKey" = de.word1 AND de.language = ve.language
        ${UTCM_USERS_JOIN}
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
    opts: { includeSkips: boolean; limit: number; exactLevel?: number }
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

      // When the caller pins an exact level (pack supply drives level drift itself),
      // constrain to that band so level is honored before any pack-vs-single ordering.
      let exactLevelFilter = '';
      if (typeof opts.exactLevel === 'number') {
        params.push(opts.exactLevel);
        exactLevelFilter = ` AND ${levelExpr} = $${params.length}`;
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
               de.language, de.script, de."difficulty", de."vernacularScore", de.breakdown, de.synonyms,
               de."exampleSentences",
               de."iconId"${posCols}
        FROM ${det} de
        WHERE de.language = $1
          AND ${this._supplyGate(language)}
          AND ${validPredicate}
          AND NOT EXISTS (
            SELECT 1 FROM ${vetTable} ve
            WHERE ve."userId" = $2 AND ve."entryKey" = de.word1 AND ve.language = de.language${excludePos}
          )
          ${skipFilter}
          ${excludeFilter}
          ${exactLevelFilter}
        ORDER BY ${recycleOrder} ABS(${levelExpr} - $3) ASC, de."vernacularScore" DESC NULLS LAST, de.id ASC
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
        WHERE language = $1 AND ${this._supplyGate(language, '')}
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
   * QUICK MARK (docs/QUICK_MARK.md) — bulk-triage supply. Unlike the Sort Cards pack
   * supply, this returns a full PAGE of not-yet-sorted discoverable words at ONE EXACT
   * level, ordered by vernacular score (most colloquial first), paginated by offset.
   *
   * Differences from `_fetchSupplyRows`:
   *   - exact level only (no nearest-level ± drift);
   *   - `discover_skips` is NOT excluded — a skipped word has no vet row, so it is
   *     offered here for a second triage pass (docs §5, resolved decision);
   *   - KEYSET (cursor) pagination with a `hasMore` probe (fetch limit+1).
   *
   * Pagination is keyset, NOT offset: the batch save creates vet rows for the cards
   * the user marked, which drops them out of this (vet-excluding) result set. A numeric
   * OFFSET would then skip that many still-unsorted cards on the next page. A cursor on
   * the stable sort key — `(vernacularScore DESC NULLS LAST, id ASC)` — always resumes
   * exactly after the last card shown, regardless of rows removed above it. The cursor
   * is the last-seen `{ score, id }`; null (first page) means no lower bound.
   *
   * `level == null` seeds from the user's adaptive frontier (estimateLevel) so opening
   * the page with no chosen level lands on their current level.
   */
  async listQuickMarkCards(
    language: string,
    userId: string,
    level: number | null,
    cursor: { score: number | null; id: number } | null,
    limit = 100,
  ): Promise<{ cards: DiscoverCard[]; level: number; hasMore: boolean }> {
    const resolvedLevel = level ?? await this.estimateLevel(userId, language);

    const det = this._dictTable(language);
    const vetTable = this._vetTable(language);
    const { levelExpr, validPredicate } = this._levelConfig(language);
    // Spanish det carries pos / hasMultiplePos (POS badge) and needs per-(word1,pos)
    // exclusion; Chinese substitutes literals and excludes per word1 (see _fetchSupplyRows).
    const isEs = language === 'es';
    const posCols = isEs ? `, de.pos, de."hasMultiplePos"` : `, NULL::varchar AS pos, FALSE AS "hasMultiplePos"`;
    const excludePos = isEs ? ` AND ve.pos IS NOT DISTINCT FROM de.pos` : '';

    // $1 language, $2 userId, $3 level, then optional cursor score+id, then limit.
    const params: any[] = [language, userId, resolvedLevel];
    let cursorFilter = '';
    if (cursor) {
      params.push(cursor.score); // may be null (the NULL-score tail)
      const scoreIdx = params.length;
      params.push(cursor.id);
      const idIdx = params.length;
      // Resume strictly AFTER (cursor.score, cursor.id) under DESC-NULLS-LAST / id-ASC:
      //   - a NULL cursor score means we're already in the trailing NULL-score block,
      //     so continue by id within it;
      //   - otherwise take everything with a lower score, the same score with a larger
      //     id, or any NULL score (which sorts after every non-NULL score).
      cursorFilter = `
        AND CASE
              WHEN $${scoreIdx}::int IS NULL THEN (de."vernacularScore" IS NULL AND de.id > $${idIdx})
              ELSE (
                de."vernacularScore" < $${scoreIdx}::int
                OR (de."vernacularScore" = $${scoreIdx}::int AND de.id > $${idIdx})
                OR de."vernacularScore" IS NULL
              )
            END`;
    }
    params.push(limit + 1);
    const limitIdx = params.length;

    const client = await db.getClient();
    try {
      const result = await client.query(`
        SELECT de.id, de.word1, de.word2, de.pronunciation, de.tone, de.definitions,
               de.language, de.script, de."difficulty", de."vernacularScore", de.breakdown, de.synonyms,
               de."exampleSentences",
               de."iconId"${posCols}
        FROM ${det} de
        WHERE de.language = $1
          AND ${this._supplyGate(language)}
          AND ${validPredicate}
          AND ${levelExpr} = $3
          AND NOT EXISTS (
            SELECT 1 FROM ${vetTable} ve
            WHERE ve."userId" = $2 AND ve."entryKey" = de.word1 AND ve.language = de.language${excludePos}
          )
          ${cursorFilter}
        ORDER BY de."vernacularScore" DESC NULLS LAST, de.id ASC
        LIMIT $${limitIdx}
      `, params);

      const rows = result.rows;
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const cards = await this._enrichDiscoverCards(this._rowsToDiscoverCards(pageRows), language);
      return { cards, level: resolvedLevel, hasMore };
    } finally {
      client.release();
    }
  }

  /**
   * QUICK MARK batch save (docs/QUICK_MARK.md §6). Reconciles each card's vet state to
   * its on-screen mark in one request — this is NOT append-only, because Quick Mark
   * leaves saved cards on-page and re-savable, so cycling a card back to empty must
   * DELETE the vet row an earlier Save created.
   *   - 'library' / 'already-learned' → `sortCard` (same bucket effects as Sort Cards).
   *     Passing opts={packId:null} takes sortCard's lightweight pack-mode return path:
   *     it writes the vet row and clears any skip WITHOUT computing a replacement card.
   *   - 'empty' → `undoSort` (non-skip branch) deletes any vet row for the card; a
   *     no-op when none exists (a card the user marked and cleared without ever saving).
   * Failures are logged per-card and skipped so one bad id can't abort the whole save.
   */
  async quickMarkBatch(
    userId: string,
    language: string,
    marks: Array<{ cardId: number; state: 'empty' | 'library' | 'already-learned' }>,
  ): Promise<{ success: boolean; applied: number }> {
    let applied = 0;
    for (const { cardId, state } of marks) {
      try {
        if (state === 'empty') {
          await this.undoSort(userId, cardId, 'library', language);
        } else {
          await this.sortCard(userId, cardId, state, language, [], { packId: null });
        }
        applied++;
      } catch (err) {
        console.error(`[QuickMark] Failed to apply mark for card ${cardId} (${state}):`, err);
      }
    }
    return { success: true, applied };
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
  async sortCard(
    userId: string,
    cardId: number,
    bucket: string,
    language: string,
    excludeIds: number[] = [],
    // Pack mode: when `packId` is present (number OR null), the caller is the sort-pack
    // flow — it manages its own pack queue, so we DON'T compute a legacy replacement
    // card. When `lastInPack` is true the final card of an authored pack was just
    // sorted, so the pack is marked seen (never shown again). Legacy single-card
    // callers (and the Skipped-page popup) omit `opts` entirely and get `nextCard`.
    opts: { packId?: number | null; lastInPack?: boolean } = {}
  ): Promise<any> {
    const inPackMode = opts.packId !== undefined;
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
        // Fill ALL FOUR typed tracks 8/8 so compute_utcm_category resolves to
        // 'Mastered' under ANY goal configuration (a single maxed track can't
        // master a card on its own — the first pbh term is capped at 6). See
        // docs/MASTERY_REWORK.md.
        const currentTimestamp: string = new Date().toISOString();
        await this.vocabEntryDAL.updateTypedMarkHistory(
          vocabEntryId,
          perfectTypedMarkHistory(currentTimestamp),
          8, 8
        );
        console.log(`[StarterPacks] Marked VocabEntry id=${vocabEntryId} as Mastered with a full typed history`);
      }
    } finally {
      client.release();
    }

    // Sorting a card OVERRIDES any prior "skip for now" on it: a card that was skipped
    // and later sorted (from an authored pack, or the Skipped-page popup) must leave
    // discover_skips so it no longer shows on the Skipped page.
    await this._clearSkip(userId, cardId, language);

    // On-sort lazy-enrichment trigger (docs/DISCOVER_LAZY_ENRICHMENT.md §5). A skip
    // never reaches here (it returned early above), so this fires only for a real sort
    // into Learn Now / Already-Learned. Fire-and-forget: it self-gates to validators +
    // incomplete zh rows and never throws, so it can't affect the sort response.
    this.lazyEnrichmentService?.triggerForWord({
      word: dictEntry.word1,
      language: dictEntry.language,
      userId,
    });

    // Pack mode: the client owns its pack queue AND its own adaptive target level
    // (docs §6, rewritten) — it derives the pack's signal from the buckets it already
    // knows client-side, so there is nothing level-related for the server to compute or
    // echo back here. Mark the pack seen when its last card was just sorted.
    if (inPackMode) {
      if (opts.packId != null && opts.lastInPack) {
        await this.markPackSeen(userId, opts.packId);
      }
      return { success: true, message: 'Card sorted successfully', bucket: actualBucket };
    }

    // Legacy single-card flow: compute the one replacement card AFTER the sort is
    // persisted, so the new vet row is reflected in the estimate and the exclusions.
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
  async undoSort(userId: string, cardId: number, bucket: string, language: string, packId: number | null = null): Promise<any> {
    // Undoing any card action within a pack means that pack is no longer fully
    // finished/skipped, so it must be un-seen (array_remove) — otherwise it would be
    // wrongly suppressed and never re-served. array_remove is a no-op when the id is
    // absent, so this is safe for non-completing undos too.
    if (packId != null) {
      await this._unseePack(userId, packId);
    }

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

  // ===========================================================================
  // Sort packs (docs/SORT_PACKS_IMPLEMENTATION.md §3). The on-deck unit becomes a
  // SortPack (up to 3 cards, no sentence). Authored packs come from sort_packs; system
  // fallback packs-of-1 are built on the fly from a single fresh word.
  // ===========================================================================

  /** Delete any discover_skips row for (userId, language, cardId). No-op if absent. */
  private async _clearSkip(userId: string, cardId: number, language: string): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query(
        `DELETE FROM discover_skips WHERE "userId" = $1 AND language = $2 AND "cardId" = $3`,
        [userId, language, cardId]
      );
    } finally {
      client.release();
    }
  }

  /** The authored pack ids this user has already finished or skipped (users.seenPacks). */
  private async _getSeenPacks(userId: string): Promise<number[]> {
    const client = await db.getClient();
    try {
      const result = await client.query<{ seenPacks: number[] }>(
        `SELECT "seenPacks" FROM users WHERE id = $1`,
        [userId]
      );
      return result.rows[0]?.seenPacks ?? [];
    } finally {
      client.release();
    }
  }

  /**
   * Record an authored pack as seen (finished or skipped) so it is never served again.
   * Appends only if absent, keeping seenPacks free of duplicates.
   */
  async markPackSeen(userId: string, packId: number): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query(
        `UPDATE users SET "seenPacks" = array_append("seenPacks", $2)
         WHERE id = $1 AND NOT ($2 = ANY("seenPacks"))`,
        [userId, packId]
      );
    } finally {
      client.release();
    }
  }

  /** Remove a pack id from seenPacks (undo of the finishing/skipping action). */
  private async _unseePack(userId: string, packId: number): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query(
        `UPDATE users SET "seenPacks" = array_remove("seenPacks", $2) WHERE id = $1`,
        [userId, packId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Hydrate a set of det ids into DiscoverCards (in the given id order) tagged with
   * per-user pack state: `sorted` (has a library vet row → locked + "sorted!") and
   * `skipped` (currently in discover_skips → draggable again inside a pack). Used for
   * authored-pack cards; Spanish matches vet per (word1, pos).
   */
  private async _hydrateCards(entryIds: number[], userId: string, language: string): Promise<DiscoverCard[]> {
    if (entryIds.length === 0) return [];
    const det = this._dictTable(language);
    const vetTable = this._vetTable(language);
    const isEs = language === 'es';
    const posCols = isEs ? `, de.pos, de."hasMultiplePos"` : `, NULL::varchar AS pos, FALSE AS "hasMultiplePos"`;
    const excludePos = isEs ? ` AND ve.pos IS NOT DISTINCT FROM de.pos` : '';

    const client = await db.getClient();
    try {
      const result = await client.query(`
        SELECT de.id, de.word1, de.word2, de.pronunciation, de.tone, de.definitions,
               de.language, de.script, de."difficulty", de."vernacularScore", de.breakdown, de.synonyms,
               de."exampleSentences",
               de."iconId"${posCols},
               EXISTS (
                 SELECT 1 FROM ${vetTable} ve
                 WHERE ve."userId" = $2 AND ve."entryKey" = de.word1 AND ve.language = de.language${excludePos}
               ) AS sorted,
               EXISTS (
                 SELECT 1 FROM discover_skips ds
                 WHERE ds."userId" = $2 AND ds.language = de.language AND ds."cardId" = de.id
               ) AS skipped
        FROM ${det} de
        WHERE de.id = ANY($1::int[]) AND de.language = $3
        ORDER BY array_position($1::int[], de.id)
      `, [entryIds, userId, language]);

      // Preserve authored card order; attach the pack-state flags onto each DTO.
      return this._rowsToDiscoverCards(result.rows).map((card, i) => ({
        ...card,
        sorted: result.rows[i].sorted === true,
        skipped: result.rows[i].skipped === true,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * A pack's colloquial-register rank for the within-level supply ordering: the mean
   * vernacularScore across its cards that have one. A pack with no scored cards ranks
   * -1 so it sinks below any pack that has a real score.
   */
  private _packVernacularRank(pack: SortPack): number {
    const scores = pack.cards
      .map((c) => c.vernacularScore)
      .filter((s): s is number => typeof s === 'number');
    if (scores.length === 0) return -1;
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }

  /** Turn authored sort_packs rows into SortPack DTOs (cards hydrated; no sentence — not shown in this flow). */
  private async _hydrateAuthoredPacks(rows: SortPackRow[], userId: string, language: string): Promise<SortPack[]> {
    return Promise.all(rows.map(async (row) => ({
      packKey: `pack:${row.id}`,
      packId: row.id,
      level: row.level,
      cards: await this._hydrateCards(row.entryIds, userId, language),
    })));
  }

  /**
   * Build system fallback packs-of-1 from fresh (un-sorted, un-skipped) words nearest
   * the level. Reuses the card supply query, then wraps each enriched card as a
   * single-card pack.
   */
  private async _buildFallbackPacks(
    language: string,
    userId: string,
    level: number,
    excludeCardIds: number[],
    limit: number
  ): Promise<SortPack[]> {
    if (limit <= 0) return [];
    // Pin to EXACTLY this level — getNextPacks drives the nearest-level drift, so a
    // level's singles are served before drifting away (level honored first).
    const rows = await this._fetchSupplyRows(language, userId, level, excludeCardIds, { includeSkips: false, limit, exactLevel: level });
    const cards = await this._enrichDiscoverCards(this._rowsToDiscoverCards(rows), language);
    return cards.map((card) => ({
      packKey: `single:${card.id}`,
      packId: null,
      level: (card.difficulty as number | null) ?? level,
      cards: [{ ...card, sorted: false, skipped: false }],
    }));
  }

  /**
   * Level visit order for the supply drift: the estimated level first, then outward by
   * distance, biased UPWARD on ties (adapt-up — a level-3 pack is preferred over a
   * level-1 pack for a level-2 user). e.g. level 2 → [2, 3, 1, 4, 5, 6].
   */
  private _levelDriftOrder(level: number): number[] {
    const { maxLevel } = this._levelConfig('');
    const levels: number[] = [];
    for (let l = 1; l <= maxLevel; l++) levels.push(l);
    return levels.sort((a, b) => {
      const da = Math.abs(a - level);
      const db = Math.abs(b - level);
      if (da !== db) return da - db;
      return b - a; // tie → higher level first (adapt upward)
    });
  }

  /**
   * Client-facing supply for the sort-pack flow. Serves AUTHORED packs first
   * (nearest-level-first by packOrder, excluding seen packs and any the client still
   * holds, dropping packs whose cards are ALL already sorted), then fills the rest with
   * fallback packs-of-1. `excludePackKeys` are the packKeys the client currently holds
   * so a replacement is never a duplicate. Skips are NOT auto-recycled (requirements §5.2).
   *
   * `requestedLevel` is the level to center supply on. Two callers, same param:
   *   - AUTO (client's adaptive target): the client sends the level it is currently
   *     tracking (docs §6, rewritten — it moves the target itself as SortPacks resolve,
   *     no server round-trip needed to decide the next level). `null` means the client
   *     has no target yet (its very first fetch this session) — the server seeds one
   *     via the cold-start `estimateLevel`.
   *   - MANUAL (the level dropdown, docs §6.5): the client sends its pinned level with
   *     `manual: true`.
   * `manual` controls drift: auto requests (manual=false, whether cold-started or
   * client-tracked) drift to adjacent levels when `requestedLevel`'s supply runs out
   * (§6.3); a manual pin never drifts — it collapses the walk to a single level. Either
   * way the returned `level` just echoes the center actually used, for the client to
   * remember (e.g. to capture the cold-start seed) — never re-derived from vet state
   * after cold start, and never shown as a fluctuating number in the auto UI.
   */
  async getNextPacks(
    language: string,
    userId: string,
    excludePackKeys: string[] = [],
    limit = 2,
    requestedLevel: number | null = null,
    manual = false
  ): Promise<{ packs: SortPack[]; exhausted: boolean; level: number }> {
    const level = requestedLevel != null ? requestedLevel : await this.estimateLevel(userId, language);
    const seen = await this._getSeenPacks(userId);

    // Split the client-held packKeys into authored ids and single card ids.
    const heldPackIds: number[] = [];
    const heldSingleIds: number[] = [];
    for (const key of excludePackKeys) {
      if (key.startsWith('pack:')) heldPackIds.push(Number(key.slice(5)));
      else if (key.startsWith('single:')) heldSingleIds.push(Number(key.slice(7)));
    }

    // LEVEL is honored before the authored-packs-first rule: walk levels nearest-first
    // and, WITHIN each level, serve authored packs then fallback singles, before ever
    // drifting to the next level. So a level-2 request exhausts ALL level-2 supply
    // (packs AND singles) before seeing any level-1 or level-3 card. A manual pin
    // collapses this walk to a single level — no drift out of the requested level.
    const excludePackIds = [...seen, ...heldPackIds];
    const excludeCardIds = [...heldSingleIds];
    const packs: SortPack[] = [];

    const levelsToVisit = manual ? [level] : this._levelDriftOrder(level);
    for (const lvl of levelsToVisit) {
      if (packs.length >= limit) break;

      // Authored packs at this level (over-fetch: some may drop as all-cards-sorted).
      const remaining1 = limit - packs.length;
      const candidates = await this.sortPacksDAL.fetchPacksAtLevel(language, lvl, excludePackIds, remaining1 * 3 + 5);
      const authored = await this._hydrateAuthoredPacks(candidates, userId, language);
      // Within a level, surface the most colloquial packs first (docs §5): rank each
      // pack by the mean vernacularScore of its cards (nulls sink to the bottom), a
      // stable sort so ties keep the authored packOrder from fetchPacksAtLevel.
      authored.sort((a, b) => this._packVernacularRank(b) - this._packVernacularRank(a));
      for (const p of authored) {
        if (packs.length >= limit) break;
        if (p.cards.some((c) => !c.sorted)) { // never serve an all-sorted pack (§4.5)
          packs.push(p);
          if (p.packId != null) excludePackIds.push(p.packId);
          excludeCardIds.push(...p.cards.map((c) => c.id));
        }
      }

      if (packs.length >= limit) break;

      // Then fallback packs-of-1 at this SAME level.
      const remaining2 = limit - packs.length;
      const fallback = await this._buildFallbackPacks(language, userId, lvl, excludeCardIds, remaining2);
      for (const p of fallback) {
        packs.push(p);
        excludeCardIds.push(...p.cards.map((c) => c.id));
      }
    }

    return { packs, exhausted: packs.length === 0, level };
  }

  /**
   * Skip a whole pack: record a discover_skips row for each remaining unsorted card
   * (each independently recoverable on the Skipped page) and mark the pack seen (for
   * authored packs). Signal-free — no vet rows, no level movement (requirements §5.1).
   */
  async skipPack(userId: string, cardIds: number[], language: string, packId: number | null = null): Promise<void> {
    if (cardIds.length > 0) {
      const client = await db.getClient();
      try {
        await client.query(`
          INSERT INTO discover_skips ("userId", language, "cardId")
          SELECT $1, $2, UNNEST($3::int[])
          ON CONFLICT ("userId", language, "cardId") DO NOTHING
        `, [userId, language, cardIds]);
      } finally {
        client.release();
      }
    }
    if (packId != null) {
      await this.markPackSeen(userId, packId);
    }
  }

  /**
   * All words the user has currently skipped in a language, newest-first, as
   * DiscoverCards for the Skipped page grid. (No example-sentence enrichment — the grid
   * only needs the card face.)
   */
  async listSkipped(userId: string, language: string): Promise<DiscoverCard[]> {
    const det = this._dictTable(language);
    const isEs = language === 'es';
    const posCols = isEs ? `, de.pos, de."hasMultiplePos"` : `, NULL::varchar AS pos, FALSE AS "hasMultiplePos"`;
    const client = await db.getClient();
    try {
      const result = await client.query(`
        SELECT de.id, de.word1, de.word2, de.pronunciation, de.tone, de.definitions,
               de.language, de.script, de."difficulty", de."vernacularScore", de.breakdown, de.synonyms,
               de."exampleSentences",
               de."iconId"${posCols}
        FROM discover_skips ds
        JOIN ${det} de ON de.id = ds."cardId" AND de.language = ds.language
        WHERE ds."userId" = $1 AND ds.language = $2
        ORDER BY ds."createdAt" DESC
      `, [userId, language]);
      return this._rowsToDiscoverCards(result.rows);
    } finally {
      client.release();
    }
  }

  /**
   * Recycle ALL of the user's skips for a language back into the normal supply (the
   * Skipped page "Recycle all" action). Returns how many were cleared.
   */
  async recycleAllSkips(userId: string, language: string): Promise<number> {
    const client = await db.getClient();
    try {
      const result = await client.query(
        `DELETE FROM discover_skips WHERE "userId" = $1 AND language = $2 RETURNING id`,
        [userId, language]
      );
      return result.rows.length;
    } finally {
      client.release();
    }
  }
}
