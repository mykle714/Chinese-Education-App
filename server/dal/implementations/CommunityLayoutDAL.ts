import { ICommunityLayoutDAL } from '../interfaces/ICommunityLayoutDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import { CommunityDesign, VotedDesignKey, VoteResult } from '../../types/community.js';
import { vetReadFrom, vetTableForLanguage } from '../shared/vetTable.js';
import { DICT_JOIN } from '../shared/dictJoin.js';
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

    const result = await dbManager.executeQuery<CommunityDesign>(async (client) => {
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
              AND lib."starterPackBucket" = 'library'
              -- category is derived (migration 101). lib."userId" = $1 = u.id (the
              -- viewer, already joined), so reuse the viewer's goal flags.
              AND compute_utcm_category(lib."typedMarkHistory", u."readingGoal", u."writingGoal") <> 'Mastered'
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

    const result = await dbManager.executeQuery<CommunityDesign>(async (client) => {
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

    const result = await dbManager.executeQuery<CommunityDesign>(async (client) => {
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

    const result = await dbManager.executeQuery<VotedDesignKey>(async (client) => {
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
    const result = await dbManager.executeQuery<{ id: number }>(async (client) => {
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
    const result = await dbManager.executeQuery<{ id: number }>(async (client) => {
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
    const result = await dbManager.executeQuery<{ iconLayout: unknown[] | null; author: string }>(async (client) => {
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

    const result = await dbManager.executeQuery<{ id: number; iconLayout: unknown[] | null }>(async (client) => {
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
    const { dupRank, ...rest } = row;
    return {
      ...rest,
      voteCountThisWeek: Number(row.voteCountThisWeek) || 0,
      inLibrary: row.inLibrary === true,
    };
  }
}
