import type {
  IOnDeckVocabDAL, CollectionFilter, FlpReadinessRow, WordSearchDrillRow, WordSearchBonusRow,
} from '../interfaces/IOnDeckVocabDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import type { VocabEntry, MarkType } from '../../types/index.js';
import type { MasteryWorldId } from '../../contracts/wire.js';
import {
  vetTableForLanguage, vetReadFrom, CORE_CATEGORY_SELECT, barCategoryExpr, masteredBarClause,
  builtinCollectionClause, type BuiltinCollectionId, typeCategoryExpr, vetSortedClause,
  WRITING_MASTERY_SELECT, WRITING_FLP_WORD_CLAUSE,
} from '../shared/vetTable.js';
import { DICT_COLS, DICT_JOIN } from '../shared/dictJoin.js';

/**
 * Data access for the study surfaces' card reads — see IOnDeckVocabDAL.
 *
 * LAYER: DAL. Moved here verbatim from `OnDeckVocabService` (2026-11-09), which used to
 * open its own pool clients and hold one for a whole deal, game board or grid. Every
 * method now takes and releases its own client through `executeQuery`.
 *
 * Table names come from the whitelisted helpers (`vetTableForLanguage`, `vetReadFrom`,
 * the fixed `dictionaryentries_zh` for the zh-only Word Search reads), and every
 * spliced SQL fragment (`barCategoryExpr`, `typeCategoryExpr`, `builtinCollectionClause`,
 * …) is chosen from a fixed set by a validated union value. Everything caller-supplied
 * is bound.
 *
 * Referenced by: docs/BACKEND_LAYERING.md, docs/MASTERY_REWORK.md (§ "Ordering").
 */
export class OnDeckVocabDAL implements IOnDeckVocabDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /** Run one query and hand back its rows. */
  private async rows<T>(sql: string, params: unknown[]): Promise<T[]> {
    const result = await this.dbManager.executeQuery<T>((client) => client.query(sql, params));
    return result.recordset;
  }

  /**
   * WHERE fragment restricting a PLAYABLE read to a focus-mode scope
   * (docs/FOCUS_MODE.md § 4 / § 4a), or the empty string for an ordinary round.
   *
   * The id list is bound as one int[] parameter, never interpolated (only the `$n`
   * placeholder position is, and that is computed from the caller's own parameter list).
   * (Was `OnDeckVocabService.focusPlayFilter`.)
   */
  private focusScopeClause(
    scope: CollectionFilter | null | undefined,
    nextParamIndex: number
  ): { clause: string; params: Array<number[]> } {
    if (scope == null) return { clause: '', params: [] };

    if (scope.kind === 'focus') {
      // Strict membership, no provisional escape hatch: a focused round never lends,
      // so there is no lent card it would need to admit.
      return { clause: `AND ve.id = ANY($${nextParamIndex}::int[])`, params: [scope.ids] };
    }

    // 'outside-focus' — an flp break draws from everything but today's snapshot.
    return { clause: `AND NOT (ve.id = ANY($${nextParamIndex}::int[]))`, params: [scope.setIds] };
  }

  // ── Vet reads: candidates ─────────────────────────────────────────────

  async findGameCandidatesInCategory(
    userId: string,
    language: string,
    category: string,
    markType: MarkType,
    cap: number,
    opts: { maxEntryKeyLen?: number; excludeIds: number[]; lentIds: number[]; scope?: CollectionFilter | null }
  ): Promise<VocabEntry[]> {
    // $8 is the next free placeholder after the seven bound below.
    const scope = this.focusScopeClause(opts.scope, 8);
    // maxEntryKeyLen is a caller-supplied constant (never user input); coerce to a
    // safe integer before inlining, since it isn't a bind param.
    const lenClause = opts.maxEntryKeyLen != null
      ? `AND LENGTH(ve."entryKey") <= ${Math.max(0, Math.floor(opts.maxEntryKeyLen))}`
      : '';
    return this.rows<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${WRITING_MASTERY_SELECT}, ${CORE_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $4
      -- SORTED ONLY: a lent card is not an ordinary candidate. It is never on
      -- cooldown and always bands Unfamiliar, so leaving it in this query let the
      -- lent rows out-compete the learner's own deck in every round. Lending is now
      -- the LAST fill tier and hands its rows back by id (docs/PROVISIONAL_CARDS.md
      -- § 4b, findRowsByIds).
      AND (${vetSortedClause()} OR ve.id = ANY($7::int[]))
      AND ${typeCategoryExpr('$5')} = $2
      AND NOT (ve.id = ANY($6::int[]))
      ${lenClause}
      ${scope.clause}
      -- THE LEARNER'S OWN CARDS FIRST, then lent ones, then random within each.
      -- Without this the two are shuffled together, so a round that had to borrow
      -- could leave the learner's own cards on the bench in favour of words they
      -- never chose — the exact outcome the sorted-only selection rule exists to
      -- prevent (docs/PROVISIONAL_CARDS.md § 4b). Only matters when lentIds is
      -- non-empty; otherwise every row is sorted and the first key is constant.
      ORDER BY (ve."starterPackBucket" = 'provisional') ASC, RANDOM()
      LIMIT $3
    `, [userId, category, cap, language, markType, opts.excludeIds, opts.lentIds, ...scope.params]);
  }

  async findFlpCandidates(
    userId: string,
    language: string,
    opts: { category: string | null; world: MasteryWorldId; excludeIds: number[]; lentIds: number[]; scope?: CollectionFilter | null }
  ): Promise<VocabEntry[]> {
    // Fixed placeholders: $1 user, $2 excluded ids, $3 language, $4 lent ids. The band
    // ($5, when one is asked for) and the focus scope take the next free ones. Numbered
    // as they are added, because an unreferenced placeholder is a Postgres error
    // ("could not determine data type of parameter").
    const params: unknown[] = [userId, opts.excludeIds, language, opts.lentIds];
    let bandClause = '';
    if (opts.category !== null) {
      params.push(opts.category);
      bandClause = `AND ${barCategoryExpr(opts.world)} = $${params.length}`;
    }
    const scope = this.focusScopeClause(opts.scope, params.length + 1);
    params.push(...scope.params);
    return this.rows<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${WRITING_MASTERY_SELECT}, ${CORE_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $3
      -- SORTED ONLY: same rule as the game pools — a lent card enters a round only
      -- through the last-resort lend tier, by id (docs/PROVISIONAL_CARDS.md § 4b).
      AND (${vetSortedClause()} OR ve.id = ANY($4::int[]))
      ${bandClause}
      AND ve.id != ALL($2::int[])
      ${opts.world === 'writing' ? WRITING_FLP_WORD_CLAUSE : ''}
      ${scope.clause}
      -- Stable tiebreak only; the real ordering is rankFlpEligible in app code, which
      -- also puts own cards before lent ones in its stale tier. The tie is REAL for
      -- stale cards of equal ease, which keep this order — own-first is repeated here
      -- so the tiebreak agrees with the ranker.
      ORDER BY (ve."starterPackBucket" = 'provisional') ASC, ve."createdAt" DESC
    `, params);
  }

  async findRowsByIds(userId: string, language: string, ids: number[]): Promise<VocabEntry[]> {
    if (ids.length === 0) return [];
    return this.rows<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${WRITING_MASTERY_SELECT}, ${CORE_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $2
      AND ve.id = ANY($3::int[])
    `, [userId, language, ids]);
  }

  async findDdRowsByIds(userId: string, language: string, ids: number[]): Promise<VocabEntry[]> {
    if (ids.length === 0) return [];
    return this.rows<VocabEntry>(`
      SELECT ve.id, ve."selectedSense", ${DICT_COLS}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $2
      AND ve.id = ANY($3::int[])
    `, [userId, language, ids]);
  }

  // ── Vet reads: decks and counts ───────────────────────────────────────

  async findSortedCards(userId: string, language: string): Promise<VocabEntry[]> {
    return this.rows<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${WRITING_MASTERY_SELECT}, ${CORE_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $2
      -- SORTED: this is the deck the user built, not what a game may serve.
      AND ${vetSortedClause()}
      ORDER BY ve."createdAt" DESC
    `, [userId, language]);
  }

  async findBuiltinCollectionCards(
    userId: string, language: string, collection: BuiltinCollectionId
  ): Promise<VocabEntry[]> {
    return this.rows<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${WRITING_MASTERY_SELECT}, ${CORE_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $2
      -- SORTED: deck read.
      AND ${vetSortedClause()}
      AND ${builtinCollectionClause(collection)}
      ORDER BY ve."createdAt" DESC
    `, [userId, language]);
  }

  async countMasteredByWorld(userId: string, language: string): Promise<Record<MasteryWorldId, number>> {
    const [row] = await this.rows<{ core: number; reading: number; writing: number }>(`
      SELECT
        COUNT(*) FILTER (WHERE ${masteredBarClause('core')})::int    AS core,
        COUNT(*) FILTER (WHERE ${masteredBarClause('reading')})::int AS reading,
        COUNT(*) FILTER (WHERE ${masteredBarClause('writing')})::int AS writing
      FROM ${vetTableForLanguage(language)} ve
      WHERE ve."userId" = $1
      AND ve."language" = $2
      -- SORTED: these are deck sizes shown to the user, so a lent card must not
      -- inflate them (same rule as countByBand).
      AND ${vetSortedClause()}
    `, [userId, language]);
    return { core: row?.core ?? 0, reading: row?.reading ?? 0, writing: row?.writing ?? 0 };
  }

  async countByBand(
    userId: string, language: string, categories: string[], world: MasteryWorldId
  ): Promise<Array<{ category: string; n: number }>> {
    // `world` is a validated union value, so `barCategoryExpr` can only produce one of
    // three fixed SQL fragments. category is computed per row from typedMarkHistory
    // (migration 143), so we group by the derived expression. `ve` alias is required by
    // barCategoryExpr's default. No users join: no bar depends on the goal flags.
    const categoryExpr = barCategoryExpr(world);
    return this.rows<{ category: string; n: number }>(`
      SELECT ${categoryExpr} AS category, COUNT(*)::int AS n
      FROM ${vetTableForLanguage(language)} ve
      WHERE ve."userId" = $1
      AND ve."language" = $3
      -- SORTED: these counts are the deck sizes shown on the decks page. They must
      -- NOT count provisional cards, or the page would claim cards the user has not
      -- sorted. Games no longer use these counts to gate entry.
      AND ${vetSortedClause()}
      AND ${categoryExpr} = ANY($2::text[])
      GROUP BY ${categoryExpr}
    `, [userId, categories, language]);
  }

  async findReadinessRows(
    userId: string, language: string, world: MasteryWorldId, onlyIds?: number[]
  ): Promise<FlpReadinessRow[]> {
    return this.rows<FlpReadinessRow>(`
      SELECT ve.id, ve."typedMarkHistory", ${WRITING_MASTERY_SELECT}
      FROM ${vetReadFrom(language)}
      WHERE ve."userId" = $1
      AND ve."language" = $2
      ${world === 'writing' ? WRITING_FLP_WORD_CLAUSE : ''}
      -- SORTED: deck read, same rule as countMasteredByWorld — a lent provisional
      -- card must not inflate a figure the learner reads as "my deck".
      AND ${vetSortedClause()}
      ${onlyIds ? 'AND ve.id = ANY($3::int[])' : ''}
    `, onlyIds ? [userId, language, onlyIds] : [userId, language]);
  }

  // ── Gloss meaning groups ──────────────────────────────────────────────

  async findMeaningGroupIds(glossKeys: string[]): Promise<Array<{ glossKey: string; meaningGroupId: number }>> {
    if (glossKeys.length === 0) return [];
    return this.rows<{ glossKey: string; meaningGroupId: number }>(`
      SELECT "glossKey", "meaningGroupId"
      FROM gloss_meaning_groups
      WHERE "glossKey" = ANY($1::text[])
    `, [glossKeys]);
  }

  // ── Word Search det reads (zh only) ───────────────────────────────────

  async findFillerWords(maxDifficulty: number, limit: number): Promise<string[]> {
    const found = await this.rows<{ word1: string }>(`
      SELECT word1
      FROM dictionaryentries_zh
      WHERE language = 'zh' AND difficulty BETWEEN 1 AND $1
      ORDER BY RANDOM()
      LIMIT $2
    `, [maxDifficulty, limit]);
    return found.map((row) => row.word1);
  }

  async findSingleCharWords(limit: number): Promise<string[]> {
    const found = await this.rows<{ word1: string }>(`
      SELECT word1
      FROM dictionaryentries_zh
      WHERE language = 'zh' AND char_length(word1) = 1
      ORDER BY RANDOM()
      LIMIT $1
    `, [limit]);
    return found.map((row) => row.word1);
  }

  async findHeadwordPronunciations(words: string[]): Promise<Array<{ word1: string; pronunciation: string | null }>> {
    if (words.length === 0) return [];
    return this.rows<{ word1: string; pronunciation: string | null }>(`
      SELECT word1, pronunciation
      FROM dictionaryentries_zh
      WHERE language = 'zh' AND word1 = ANY($1)
    `, [words]);
  }

  async findDrillEntries(words: string[]): Promise<WordSearchDrillRow[]> {
    if (words.length === 0) return [];
    return this.rows<WordSearchDrillRow>(`
      SELECT word1, pronunciation, definitions, "definitionClusters", components,
             "matchException", "frequencyScore", "exampleSentenceDefinitionPronunciationOverride",
             -- The target word's own breakdown, so a single-character drill rung is
             -- glossed with the sense that character carries IN THIS WORD (the same
             -- answer the bt gives). The client prefers the grid cell's definition for
             -- that rung, which resolves identically; this keeps the shipped rung list
             -- self-consistent for the cell-less fallback path.
             breakdown
      FROM dictionaryentries_zh
      WHERE language = 'zh' AND word1 = ANY($1)
    `, [words]);
  }

  async findWordsSpelledFrom(chars: string[], limit: number): Promise<WordSearchBonusRow[]> {
    if (chars.length === 0) return [];
    // The `^[...]+$` regex anchors both ends, so a word with even one character outside
    // `chars` is excluded. Escape regex metacharacters that would be meaningful inside a
    // `[...]` class, in case a future filler source ever contains one — none of the
    // Chinese characters used today need it, so this is purely defensive. The class is
    // bound as a parameter, never spliced into the SQL.
    const charClass = chars.map((ch) => ch.replace(/[\^\]\\-]/g, '\\$&')).join('');
    return this.rows<WordSearchBonusRow>(`
      SELECT word1, pronunciation, definitions->>0 AS definition, "definitionClusters"
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        AND word1 ~ ('^[' || $1 || ']+$')
      LIMIT $2
    `, [charClass, limit]);
  }
}
