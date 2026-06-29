import { ICommunityLayoutDAL } from '../interfaces/ICommunityLayoutDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import { CommunityDesign, VotedDesignKey, VoteResult } from '../../types/community.js';
import { vetReadFrom, vetTableForLanguage } from '../shared/vetTable.js';
import { DICT_JOIN } from '../shared/dictJoin.js';
import { WEEK_BOUNDARY } from '../shared/weekBoundary.js';
import { IS_ADVANCED_LAYOUT } from '../shared/advancedLayout.js';

/**
 * Reads of OTHER users' advanced card-icon layouts for the Community feeds, plus the upvote
 * log (community_layout_votes, migration 86). See docs/COMMUNITY_PAGE.md.
 *
 * Both feeds join the VIEWER's `users` row (aliased `u`) so the per-design vote tally and the
 * once-a-week window use the viewer's timezone-based week boundary (${WEEK_BOUNDARY}). They
 * read through `vetReadFrom`/`DICT_JOIN` (the same vet→det plumbing as normal card reads) and
 * gate on `IS_ADVANCED_LAYOUT` so only genuinely-decorated designs surface. `excludeOwners`/
 * `excludeKeys` are parallel arrays of already-shown (ownerUserId, entryKey) pairs — the
 * infinite-scroll no-duplicates contract.
 */
export class CommunityLayoutDAL implements ICommunityLayoutDAL {
  // Shared SELECT list for a feed row: design identity + det render fields + this-week tally.
  // `$1` is always the viewer's id (also the `u` row), so the correlated vote-count subquery's
  // ${WEEK_BOUNDARY} resolves against the viewer's timezone.
  private feedSelect(voteCountAlias = 'voteCountThisWeek'): string {
    return `
      ve."userId"     AS "ownerUserId",
      owner.name      AS "ownerName",
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

  // NOT-EXISTS clause that drops any (ownerUserId, entryKey) already shown to the client.
  // `$3` = uuid[] of owners, `$4` = text[] of entryKeys (parallel arrays).
  private readonly excludeClause = `
    AND NOT EXISTS (
      SELECT 1 FROM unnest($3::uuid[], $4::text[]) AS ex(owner, key)
      WHERE ex.owner = ve."userId" AND ex.key = ve."entryKey"
    )`;

  async getLearningFeed(
    viewerUserId: string,
    language: string,
    excludeOwners: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]> {
    if (!viewerUserId) throw new ValidationError('viewerUserId is required');
    const libTable = vetTableForLanguage(language);

    const result = await dbManager.executeQuery<CommunityDesign>(async (client) => {
      return await client.query(`
        SELECT
          ${this.feedSelect()},
          TRUE AS "inLibrary"          -- feed 1 is, by definition, words the viewer is learning
        FROM ${vetReadFrom(language)}
        JOIN users u ON u.id = $1       -- viewer row → week boundary timezone
        JOIN users owner ON owner.id = ve."userId"  -- design author → display name
        ${DICT_JOIN}
        WHERE ve.language = $2
          AND ve."userId" <> $1        -- other users' designs only
          AND ${IS_ADVANCED_LAYOUT}
          AND ve."entryKey" IN (
            SELECT lib."entryKey" FROM ${libTable} lib
            WHERE lib."userId" = $1 AND lib.language = $2
              AND lib."starterPackBucket" = 'library'
              AND (lib.category IS NULL OR lib.category <> 'Mastered')
          )
          ${this.excludeClause}
        ORDER BY random()              -- "randomly selected set" per page
        LIMIT $5
      `, [viewerUserId, language, excludeOwners, excludeKeys, limit]);
    });

    return result.recordset.map(this.normalize);
  }

  async getTopFeed(
    viewerUserId: string,
    language: string,
    excludeOwners: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]> {
    if (!viewerUserId) throw new ValidationError('viewerUserId is required');
    const libTable = vetTableForLanguage(language);

    const result = await dbManager.executeQuery<CommunityDesign>(async (client) => {
      return await client.query(`
        SELECT
          ${this.feedSelect()},
          EXISTS (
            SELECT 1 FROM ${libTable} mine
            WHERE mine."userId" = $1 AND mine.language = $2 AND mine."entryKey" = ve."entryKey"
          ) AS "inLibrary"
        FROM ${vetReadFrom(language)}
        JOIN users u ON u.id = $1
        JOIN users owner ON owner.id = ve."userId"  -- design author → display name
        ${DICT_JOIN}
        WHERE ve.language = $2
          AND ve."userId" <> $1
          AND ${IS_ADVANCED_LAYOUT}
          -- Every advanced layout is eligible for the Top feed; designs with no vote this
          -- week still appear, sorted to the bottom by the vote-count ORDER BY below.
          ${this.excludeClause}
        ORDER BY "voteCountThisWeek" DESC, ve."userId", ve."entryKey"  -- top this week, stable tiebreak
        LIMIT $5
      `, [viewerUserId, language, excludeOwners, excludeKeys, limit]);
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
  ): Promise<unknown[] | null> {
    if (!ownerUserId) throw new ValidationError('ownerUserId is required');
    const table = vetTableForLanguage(language);

    const result = await dbManager.executeQuery<{ iconLayout: unknown[] | null }>(async (client) => {
      return await client.query(`
        SELECT "iconLayout" FROM ${table}
        WHERE "userId" = $1 AND "entryKey" = $2 AND language = $3
      `, [ownerUserId, entryKey, language]);
    });

    return result.recordset[0]?.iconLayout ?? null;
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
    return {
      ...row,
      voteCountThisWeek: Number(row.voteCountThisWeek) || 0,
      inLibrary: row.inLibrary === true,
    };
  }
}
