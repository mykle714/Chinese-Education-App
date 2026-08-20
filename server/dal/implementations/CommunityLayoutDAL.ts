import { ICommunityLayoutDAL } from '../interfaces/ICommunityLayoutDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import { CommunityDesign, VotedDesignKey, VoteResult } from '../../types/community.js';
import { vetReadFrom, vetTableForLanguage, vetSortedClause, coreCategoryExpr } from '../shared/vetTable.js';
import { DICT_JOIN } from '../shared/dictJoin.js';
import { resolveDisplayDefinition, resolveDisplayPronunciation } from '../../utils/definitions.js';
import { WEEK_BOUNDARY } from '../shared/weekBoundary.js';
import { IS_ADVANCED_LAYOUT } from '../shared/advancedLayout.js';

/**
 * The AUTHOR of the design on a vet row aliased `ve` (migration 119): who made the layout, as
 * opposed to `ve."userId"` who merely has it on their card. NULL (every pre-118 row, and any
 * row saved outside the editor) falls back to the owner — i.e. "assume self-authored".
 */
const AUTHOR_OF_VE = `COALESCE(ve.author, ve."userId")`;

/**
 * Joins the AUTHOR's `users` row so a feed tile can credit whoever designed the layout, not
 * whichever user happens to hold the copy that survived dedupe. LEFT so a deleted author (the
 * FK nulls `author`, migration 119) still yields the row — the client falls back to `ownerName`.
 */
const AUTHOR_JOIN = `LEFT JOIN users author_u ON author_u.id = ${AUTHOR_OF_VE}`;

/**
 * Reads of OTHER users' advanced card-icon layouts for the Community feeds, plus the upvote
 * log (community_layout_votes, migration 86). See docs/COMMUNITY_PAGE.md.
 *
 * Both feeds join the VIEWER's `users` row (aliased `u`) so the per-design vote tally and the
 * once-a-week window use the viewer's timezone-based week boundary (${WEEK_BOUNDARY}). They
 * read through `vetReadFrom`/`DICT_JOIN` (the same vet→det plumbing as normal card reads) and
 * gate on `IS_ADVANCED_LAYOUT` so only genuinely-decorated designs surface.
 *
 * Duplicate suppression (migration 119) has two halves: `dupRank` collapses rows that share one
 * design (same word + same author + equal layout jsonb) within a page, and `excludeAuthors`/
 * `excludeKeys` — parallel arrays of already-shown (authorUserId, entryKey) pairs — carry that
 * across pages, giving the infinite-scroll no-duplicates contract.
 */
export class CommunityLayoutDAL implements ICommunityLayoutDAL {

  /**
   * The connection manager, injected so the DAL can be substituted in a test.
   * Defaults to the process-wide singleton, so `new CommunityLayoutDAL()` at the composition
   * root (dal/setup.ts) keeps working unchanged.
   * See docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 2.
   */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  // Shared SELECT list for a feed row: design identity + det render fields + this-week tally.
  // `$1` is always the viewer's id (also the `u` row), so the correlated vote-count subquery's
  // ${WEEK_BOUNDARY} resolves against the viewer's timezone.
  private feedSelect(voteCountAlias = 'voteCountThisWeek'): string {
    return `
      ve."userId"     AS "ownerUserId",
      owner.name      AS "ownerName",
      ${AUTHOR_OF_VE} AS "authorUserId",
      author_u.name   AS "authorName",
      ve."entryKey"   AS "entryKey",
      ve.language     AS language,
      ve."iconLayout" AS "iconLayout",
      de.pronunciation,
      de.tone,
      de.script,
      de.definition,
      -- Fed to the display resolvers in normalize() and stripped there; never part of the
      -- API shape. The selectedSense read is the DESIGN OWNER's sense pick, which is the
      -- right one here: the feed shows their card as they built it, not as the viewer would.
      de."definitionClusters",
      ve."selectedSense",
      (
        SELECT COUNT(*) FROM community_layout_votes v
        WHERE v."ownerUserId" = ve."userId"
          AND v."entryKey"    = ve."entryKey"
          AND v.language      = ve.language
          AND v."votedAt" >= ${WEEK_BOUNDARY}
      )::int AS "${voteCountAlias}"`;
  }

  // NOT-EXISTS clause that drops any (authorUserId, entryKey) already shown to the client.
  // `$3` = uuid[] of AUTHORS, `$4` = text[] of entryKeys (parallel arrays).
  //
  // Keyed on the author rather than the row owner (migration 119) so pagination inherits the
  // duplicate collapsing: once a design by author A for word W has been shown, every other
  // user's *copy* of it is excluded from all later pages too — `dupRank` below only dedupes
  // within a single page. The cost is that a same-author/same-word row carrying a genuinely
  // different layout is also skipped on later pages; that is rare and preferable to repeats.
  private readonly excludeClause = `
    AND NOT EXISTS (
      SELECT 1 FROM unnest($3::uuid[], $4::text[]) AS ex(author, key)
      WHERE ex.author = ${AUTHOR_OF_VE} AND ex.key = ve."entryKey"
    )`;

  // Window that ranks rows sharing one design — same word, same author, byte-equal layout
  // (jsonb equality is key-order-independent). The outer query keeps rank 1, so a design and
  // all the copies made from it collapse to a single feed tile. The ORDER BY prefers the row
  // whose owner IS the author (the original) and falls back to a stable owner-id tiebreak.
  private readonly dupRank = `
    ROW_NUMBER() OVER (
      PARTITION BY ve."entryKey", ${AUTHOR_OF_VE}, ve."iconLayout"
      ORDER BY (ve."userId" = ${AUTHOR_OF_VE}) DESC, ve."userId"
    ) AS "dupRank"`;

  async getLearningFeed(
    viewerUserId: string,
    language: string,
    excludeAuthors: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]> {
    if (!viewerUserId) throw new ValidationError('viewerUserId is required');
    const libTable = vetTableForLanguage(language);

    const result = await this.dbManager.executeQuery<CommunityDesign>(async (client) => {
      return await client.query(`
        SELECT * FROM (
        SELECT
          ${this.feedSelect()},
          TRUE AS "inLibrary",         -- feed 1 is, by definition, words the viewer is learning
          ${this.dupRank}
        FROM ${vetReadFrom(language)}
        JOIN users u ON u.id = $1       -- viewer row → week boundary timezone
        JOIN users owner ON owner.id = ve."userId"  -- row owner → display name
        ${AUTHOR_JOIN}
        ${DICT_JOIN}
        WHERE ve.language = $2
          AND ve."userId" <> $1        -- other users' rows only
          AND ${AUTHOR_OF_VE} <> $1    -- ...and never the viewer's own design via someone's copy
          AND ${IS_ADVANCED_LAYOUT}
          AND ve."entryKey" IN (
            SELECT lib."entryKey" FROM ${libTable} lib
            WHERE lib."userId" = $1 AND lib.language = $2
              -- SORTED: the community feed shows cards people deliberately keep,
              -- never a provisional card a game handed them.
              AND ${vetSortedClause('lib')}
              -- CORE BAR (migration 143): a word leaves the Learning feed once the
              -- viewer knows it by sight, which is what "learning" means here. Their
              -- reading/writing bars are a separate pursuit and must not keep a word
              -- they have finished circulating in a feed about words they are on.
              -- Goal-independent, so no users join is needed for it.
              AND ${coreCategoryExpr('lib')} <> 'Mastered'
          )
          ${this.excludeClause}
        ) d
        WHERE d."dupRank" = 1          -- one tile per distinct design (see dupRank)
        ORDER BY random()              -- "randomly selected set" per page
        LIMIT $5
      `, [viewerUserId, language, excludeAuthors, excludeKeys, limit]);
    });

    return result.recordset.map(this.normalize);
  }

  async getTopFeed(
    viewerUserId: string,
    language: string,
    excludeAuthors: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]> {
    if (!viewerUserId) throw new ValidationError('viewerUserId is required');
    const libTable = vetTableForLanguage(language);

    const result = await this.dbManager.executeQuery<CommunityDesign>(async (client) => {
      return await client.query(`
        SELECT * FROM (
        SELECT
          ${this.feedSelect()},
          EXISTS (
            SELECT 1 FROM ${libTable} mine
            WHERE mine."userId" = $1 AND mine.language = $2 AND mine."entryKey" = ve."entryKey"
          ) AS "inLibrary",
          ${this.dupRank}
        FROM ${vetReadFrom(language)}
        JOIN users u ON u.id = $1
        JOIN users owner ON owner.id = ve."userId"  -- row owner → display name
        ${AUTHOR_JOIN}
        ${DICT_JOIN}
        WHERE ve.language = $2
          AND ve."userId" <> $1
          AND ${AUTHOR_OF_VE} <> $1    -- never the viewer's own design via someone else's copy
          AND ${IS_ADVANCED_LAYOUT}
          -- Every advanced layout is eligible for the Top feed; designs with no vote this
          -- week still appear, sorted to the bottom by the vote-count ORDER BY below.
          ${this.excludeClause}
        ) d
        WHERE d."dupRank" = 1          -- one tile per distinct design (see dupRank)
        ORDER BY d."voteCountThisWeek" DESC, d."ownerUserId", d."entryKey"  -- top this week, stable tiebreak
        LIMIT $5
      `, [viewerUserId, language, excludeAuthors, excludeKeys, limit]);
    });

    return result.recordset.map(this.normalize);
  }

  async getDesignsByOwner(
    viewerUserId: string,
    ownerUserId: string,
    language: string,
    afterEntryKey: string | null,
    limit: number,
  ): Promise<CommunityDesign[]> {
    if (!viewerUserId) throw new ValidationError('viewerUserId is required');
    if (!ownerUserId) throw new ValidationError('ownerUserId is required');
    const libTable = vetTableForLanguage(language);

    const result = await this.dbManager.executeQuery<CommunityDesign>(async (client) => {
      // THREE deliberate differences from the feeds above, all of them because this
      // query answers "what has THIS person designed" rather than "what should the
      // viewer be shown":
      //
      //  1. No `ve."userId" <> $1` exclusion. A viewer may open their OWN profile,
      //     and a profile that hid its owner's designs from its owner would be
      //     absurd. The feeds exclude self because a feed is a discovery surface.
      //  2. No dupRank. Duplicate collapsing exists to stop one design appearing as
      //     N tiles across N owners; within ONE owner a (word, layout) pair is
      //     unique by the vet row's own identity, so there is nothing to collapse.
      //  3. Keyset pagination on `entryKey`, not the feeds' exclude-arrays. The
      //     exclude arrays exist because the feeds are randomly/vote ordered and
      //     therefore unstable; this list has a total, stable order, so a cursor is
      //     both cheaper and immune to the arrays growing without bound as a
      //     prolific designer's list is scrolled.
      return await client.query(`
        SELECT
          ${this.feedSelect()},
          EXISTS (
            SELECT 1 FROM ${libTable} mine
            WHERE mine."userId" = $1 AND mine.language = $3 AND mine."entryKey" = ve."entryKey"
          ) AS "inLibrary"
        FROM ${vetReadFrom(language)}
        JOIN users u ON u.id = $1                   -- viewer row → week-boundary timezone
        JOIN users owner ON owner.id = ve."userId"  -- row owner → display name
        ${AUTHOR_JOIN}
        ${DICT_JOIN}
        WHERE ve.language = $3
          AND ve."userId" = $2
          AND ${IS_ADVANCED_LAYOUT}
          AND ($4::text IS NULL OR ve."entryKey" > $4::text)
        ORDER BY ve."entryKey"
        LIMIT $5
      `, [viewerUserId, ownerUserId, language, afterEntryKey, limit]);
    });

    return result.recordset.map(this.normalize);
  }

  async getDesignsForEntry(
    viewerUserId: string,
    language: string,
    entryKey: string,
    excludeAuthors: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]> {
    if (!viewerUserId) throw new ValidationError('viewerUserId is required');
    if (!entryKey) throw new ValidationError('entryKey is required');
    const libTable = vetTableForLanguage(language);

    const result = await this.dbManager.executeQuery<CommunityDesign>(async (client) => {
      return await client.query(`
        SELECT * FROM (
        SELECT
          ${this.feedSelect()},
          EXISTS (
            SELECT 1 FROM ${libTable} mine
            WHERE mine."userId" = $1 AND mine.language = $2 AND mine."entryKey" = ve."entryKey"
          ) AS "inLibrary",
          ${this.dupRank}
        FROM ${vetReadFrom(language)}
        JOIN users u ON u.id = $1
        JOIN users owner ON owner.id = ve."userId"  -- row owner → display name
        ${AUTHOR_JOIN}
        ${DICT_JOIN}
        WHERE ve.language = $2
          AND ve."userId" <> $1
          AND ${AUTHOR_OF_VE} <> $1    -- never the viewer's own design via someone else's copy
          AND ve."entryKey" = $5
          AND ${IS_ADVANCED_LAYOUT}
          ${this.excludeClause}
        ) d
        WHERE d."dupRank" = 1          -- one tile per distinct design (see dupRank)
        ORDER BY d."voteCountThisWeek" DESC, d."ownerUserId"  -- top for this word, stable tiebreak
        LIMIT $6
      `, [viewerUserId, language, excludeAuthors, excludeKeys, entryKey, limit]);
    });

    return result.recordset.map(this.normalize);
  }

  async getMyVotesThisWeek(viewerUserId: string): Promise<VotedDesignKey[]> {
    if (!viewerUserId) throw new ValidationError('viewerUserId is required');

    const result = await this.dbManager.executeQuery<VotedDesignKey>(async (client) => {
      return await client.query(`
        SELECT DISTINCT v."ownerUserId" AS "ownerUserId", v."entryKey" AS "entryKey", v.language AS language
        FROM community_layout_votes v
        JOIN users u ON u.id = v."voterUserId"   -- voter row → week boundary timezone
        WHERE v."voterUserId" = $1 AND v."votedAt" >= ${WEEK_BOUNDARY}
      `, [viewerUserId]);
    });

    return result.recordset;
  }

  async recordVote(
    voterUserId: string,
    ownerUserId: string,
    entryKey: string,
    language: string,
  ): Promise<VoteResult> {
    if (!voterUserId) throw new ValidationError('voterUserId is required');
    if (!ownerUserId) throw new ValidationError('ownerUserId is required');
    if (!entryKey) throw new ValidationError('entryKey is required');
    if (!language) throw new ValidationError('language is required');

    // Insert iff no vote by this voter for this design exists since the voter's week boundary.
    // The single statement is race-safe enough for this use (the worst case under a double-tap
    // is two rows in the same week, which the tally tolerates and the UI greys after the first).
    const result = await this.dbManager.executeQuery<{ id: number }>(async (client) => {
      return await client.query(`
        INSERT INTO community_layout_votes ("voterUserId", "ownerUserId", "entryKey", language)
        -- Explicit casts: with bound params in an INSERT...SELECT, pg otherwise deduces
        -- conflicting types for a param used in both the SELECT list and the NOT EXISTS
        -- comparison (text vs character varying → error 42P08).
        SELECT $1::uuid, $2::uuid, $3::varchar, $4::varchar
        FROM users u
        WHERE u.id = $1::uuid
          AND NOT EXISTS (
            SELECT 1 FROM community_layout_votes v
            WHERE v."voterUserId" = $1::uuid AND v."ownerUserId" = $2::uuid
              AND v."entryKey" = $3::varchar AND v.language = $4::varchar
              AND v."votedAt" >= ${WEEK_BOUNDARY}
          )
        RETURNING id
      `, [voterUserId, ownerUserId, entryKey, language]);
    });

    return result.recordset.length > 0 ? 'recorded' : 'already-voted';
  }

  async removeVote(
    voterUserId: string,
    ownerUserId: string,
    entryKey: string,
    language: string,
  ): Promise<boolean> {
    if (!voterUserId) throw new ValidationError('voterUserId is required');
    if (!ownerUserId) throw new ValidationError('ownerUserId is required');
    if (!entryKey) throw new ValidationError('entryKey is required');
    if (!language) throw new ValidationError('language is required');

    // Delete this voter's vote(s) for the design within the current week (the toggle/unvote).
    // `USING users u` brings the voter's timezone into scope for ${WEEK_BOUNDARY}.
    const result = await this.dbManager.executeQuery<{ id: number }>(async (client) => {
      return await client.query(`
        DELETE FROM community_layout_votes clv
        USING users u
        WHERE u.id = clv."voterUserId"
          AND clv."voterUserId" = $1::uuid AND clv."ownerUserId" = $2::uuid
          AND clv."entryKey" = $3::varchar AND clv.language = $4::varchar
          AND clv."votedAt" >= ${WEEK_BOUNDARY}
        RETURNING clv.id
      `, [voterUserId, ownerUserId, entryKey, language]);
    });

    return result.recordset.length > 0;
  }

  async getDesignLayout(
    ownerUserId: string,
    entryKey: string,
    language: string,
  ): Promise<{ iconLayout: unknown[] | null; author: string } | null> {
    if (!ownerUserId) throw new ValidationError('ownerUserId is required');
    const table = vetTableForLanguage(language);

    // COALESCE(author, "userId") (migration 119): a legacy/unattributed row is treated as
    // authored by its owner, so a copy of it still carries a stable author forward.
    const result = await this.dbManager.executeQuery<{ iconLayout: unknown[] | null; author: string }>(async (client) => {
      return await client.query(`
        SELECT "iconLayout", COALESCE(author, "userId") AS author FROM ${table}
        WHERE "userId" = $1 AND "entryKey" = $2 AND language = $3
      `, [ownerUserId, entryKey, language]);
    });

    return result.recordset[0] ?? null;
  }

  async findViewerEntry(
    viewerUserId: string,
    entryKey: string,
    language: string,
  ): Promise<{ id: number; iconLayout: unknown[] | null } | null> {
    if (!viewerUserId) throw new ValidationError('viewerUserId is required');
    const table = vetTableForLanguage(language);

    const result = await this.dbManager.executeQuery<{ id: number; iconLayout: unknown[] | null }>(async (client) => {
      return await client.query(`
        SELECT id, "iconLayout" FROM ${table}
        WHERE "userId" = $1 AND "entryKey" = $2 AND language = $3
      `, [viewerUserId, entryKey, language]);
    });

    return result.recordset[0] ?? null;
  }

  // pg returns jsonb already parsed and the COUNT cast as a JS number; coerce defensively so
  // the API contract (numeric voteCountThisWeek, boolean inLibrary) holds regardless of driver.
  private normalize(row: any): CommunityDesign {
    // dupRank is an internal window value from the dedupe subquery — never part of the API shape.
    // definitionClusters / selectedSense are likewise internal: they exist only to feed the
    // display resolvers below, and dropping them here keeps `CommunityDesign` unchanged.
    const { dupRank, definitionClusters, selectedSense, ...rest } = row;
    return {
      ...rest,
      // Sense-resolved rather than read straight off det. The `pronunciation` column is the
      // unreviewed CEDICT seed handed to the clusterer, so a corrected heteronym keeps the
      // wrong reading there forever (重点 = `chóng diǎn` in the column, `zhòng diǎn` in its
      // clusters) — a community card would print different pinyin than the same word's
      // flashcard. See docs/DEFINITION_CLUSTERS.md.
      pronunciation: resolveDisplayPronunciation({ ...row, definitionClusters, selectedSense }),
      definition: resolveDisplayDefinition({ ...row, definitionClusters, selectedSense }),
      voteCountThisWeek: Number(row.voteCountThisWeek) || 0,
      inLibrary: row.inLibrary === true,
    };
  }
}
