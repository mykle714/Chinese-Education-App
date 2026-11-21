import type { PoolClient } from 'pg';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import type {
  IStoryDAL,
  StoryRow,
  StoryPassageRow,
  StoryChoiceLookup,
  StoryUpdateFields,
} from '../interfaces/IStoryDAL.js';
import type { StoryListItem } from '../../contracts/stories.js';

/** Every column of a `stories` row, in StoryRow's order. */
const STORY_COLUMNS = `id, language, title, "iconId", "authorUserId", "startPassageId",
  "publishedAt", difficulty, "createdAt", "updatedAt"`;

/**
 * A passage with its choices folded into one jsonb array (ordered by position), so the
 * passage + choices read is ONE query (docs/CYOA_FEATURE.md § 6.3). `p` is the
 * story_passages alias the caller's FROM clause must use.
 */
const PASSAGE_SELECT = `
  SELECT p.id, p."storyId", p.name, p.content, p."endingTitle", p."createdAt", p."updatedAt",
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', c.id, 'position', c.position, 'label', c.label,
                    'targetPassageId', c."targetPassageId")
                  ORDER BY c.position)
           FROM story_choices c WHERE c."passageId" = p.id
         ), '[]'::jsonb) AS choices
  FROM story_passages p`;

/**
 * Persists Adventures (cyoa) — migrations 196, 197 (passage names), 198 (passages seen),
 * 199 (passage order). LAYER: DAL (SQL only, no policy).
 *
 * Referenced by: server/services/StoryService.ts, server/dal/setup.ts.
 * Docs: docs/CYOA_FEATURE.md § 6.
 */
export class StoryDAL implements IStoryDAL {
  /** Injected so a test can substitute a manager; defaults to the process singleton. */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /** Run `fn` on the caller's client when given one, otherwise on a pooled connection. */
  private async run<T>(
    client: PoolClient | undefined,
    fn: (c: PoolClient) => Promise<any>
  ): Promise<{ rows: T[]; rowCount: number }> {
    if (client) {
      const r = await fn(client);
      return { rows: r.rows || [], rowCount: r.rowCount || 0 };
    }
    const r = await this.dbManager.executeQuery<T>(fn);
    return { rows: r.recordset, rowCount: r.rowsAffected };
  }

  private requireId(value: string | undefined | null, label: string): string {
    if (!value || typeof value !== 'string') throw new ValidationError(`${label} is required`);
    return value;
  }

  async isAuthor(userId: string): Promise<boolean> {
    this.requireId(userId, 'userId');
    const { rows } = await this.run<{ isAuthor: boolean }>(undefined, (c) =>
      c.query(`SELECT "isAuthor" FROM users WHERE id = $1`, [userId])
    );
    return rows[0]?.isAuthor === true;
  }

  async listForViewer(viewerId: string, language: string): Promise<StoryListItem[]> {
    this.requireId(viewerId, 'viewerId');
    // Endings total is counted at read time (§ 3.5: deleting an ending lowers it);
    // a passage is an ending when no story_choices row hangs off it.
    const { rows } = await this.run<StoryListItem>(undefined, (c) =>
      c.query(
        `SELECT s.id, s.title, s."iconId", s.difficulty, s."publishedAt",
                COALESCE(NULLIF(u.name, ''), u.username) AS "authorName",
                (s."authorUserId" = $1) AS "isOwn",
                (SELECT COUNT(*)::int FROM story_endings_found f
                   WHERE f."userId" = $1 AND f."storyId" = s.id) AS "endingsFound",
                (SELECT COUNT(*)::int FROM story_passages p
                   WHERE p."storyId" = s.id
                     AND NOT EXISTS (SELECT 1 FROM story_choices c WHERE c."passageId" = p.id)
                ) AS "endingsTotal",
                EXISTS (SELECT 1 FROM story_progress g
                   WHERE g."userId" = $1 AND g."storyId" = s.id) AS "inProgress"
         FROM stories s
         LEFT JOIN users u ON u.id = s."authorUserId"
         WHERE s.language = $2
           AND (s."publishedAt" IS NOT NULL OR s."authorUserId" = $1)
         ORDER BY s.difficulty ASC NULLS LAST,
                  s."publishedAt" DESC NULLS FIRST,
                  s."createdAt" DESC`,
        [viewerId, language]
      )
    );
    return rows;
  }

  async findStory(storyId: string, client?: PoolClient): Promise<StoryRow | null> {
    this.requireId(storyId, 'storyId');
    const { rows } = await this.run<StoryRow>(client, (c) =>
      c.query(`SELECT ${STORY_COLUMNS} FROM stories WHERE id = $1`, [storyId])
    );
    return rows[0] ?? null;
  }

  async findPassage(passageId: string, client?: PoolClient): Promise<StoryPassageRow | null> {
    this.requireId(passageId, 'passageId');
    const { rows } = await this.run<StoryPassageRow>(client, (c) =>
      c.query(`${PASSAGE_SELECT} WHERE p.id = $1`, [passageId])
    );
    return rows[0] ?? null;
  }

  async listPassages(storyId: string, client?: PoolClient): Promise<StoryPassageRow[]> {
    this.requireId(storyId, 'storyId');
    const { rows } = await this.run<StoryPassageRow>(client, (c) =>
      c.query(`${PASSAGE_SELECT} WHERE p."storyId" = $1 ORDER BY p.position, p.id`, [storyId])
    );
    return rows;
  }

  async countPassages(storyId: string): Promise<number> {
    const { rows } = await this.run<{ n: number }>(undefined, (c) =>
      c.query(`SELECT COUNT(*)::int AS n FROM story_passages WHERE "storyId" = $1`, [storyId])
    );
    return rows[0]?.n ?? 0;
  }

  async countEndings(storyId: string): Promise<number> {
    const { rows } = await this.run<{ n: number }>(undefined, (c) =>
      c.query(
        `SELECT COUNT(*)::int AS n FROM story_passages p
         WHERE p."storyId" = $1
           AND NOT EXISTS (SELECT 1 FROM story_choices c WHERE c."passageId" = p.id)`,
        [storyId]
      )
    );
    return rows[0]?.n ?? 0;
  }

  async listEndingsFound(userId: string, storyId: string): Promise<string[]> {
    const { rows } = await this.run<{ passageId: string }>(undefined, (c) =>
      c.query(
        `SELECT "passageId" FROM story_endings_found WHERE "userId" = $1 AND "storyId" = $2`,
        [userId, storyId]
      )
    );
    return rows.map((row) => row.passageId);
  }

  async recordPassageSeen(userId: string, storyId: string, passageId: string): Promise<void> {
    await this.run(undefined, (c) =>
      c.query(
        `INSERT INTO story_passages_seen ("userId", "storyId", "passageId")
         VALUES ($1, $2, $3)
         ON CONFLICT ("userId", "passageId") DO NOTHING`,
        [userId, storyId, passageId]
      )
    );
  }

  async listPassagesSeen(userId: string, storyId: string): Promise<string[]> {
    const { rows } = await this.run<{ passageId: string }>(undefined, (c) =>
      c.query(
        `SELECT "passageId" FROM story_passages_seen WHERE "userId" = $1 AND "storyId" = $2`,
        [userId, storyId]
      )
    );
    return rows.map((row) => row.passageId);
  }

  async findChoice(choiceId: string): Promise<StoryChoiceLookup | null> {
    this.requireId(choiceId, 'choiceId');
    const { rows } = await this.run<StoryChoiceLookup>(undefined, (c) =>
      c.query(
        `SELECT c.id, c."passageId", c."targetPassageId", p."storyId"
         FROM story_choices c JOIN story_passages p ON p.id = c."passageId"
         WHERE c.id = $1`,
        [choiceId]
      )
    );
    return rows[0] ?? null;
  }

  async getProgress(userId: string, storyId: string): Promise<string | null> {
    const { rows } = await this.run<{ currentPassageId: string }>(undefined, (c) =>
      c.query(
        `SELECT "currentPassageId" FROM story_progress WHERE "userId" = $1 AND "storyId" = $2`,
        [userId, storyId]
      )
    );
    return rows[0]?.currentPassageId ?? null;
  }

  async setProgress(userId: string, storyId: string, passageId: string): Promise<void> {
    await this.run(undefined, (c) =>
      c.query(
        `INSERT INTO story_progress ("userId", "storyId", "currentPassageId")
         VALUES ($1, $2, $3)
         ON CONFLICT ("userId", "storyId")
         DO UPDATE SET "currentPassageId" = EXCLUDED."currentPassageId", "updatedAt" = now()`,
        [userId, storyId, passageId]
      )
    );
  }

  async clearProgress(userId: string, storyId: string): Promise<void> {
    await this.run(undefined, (c) =>
      c.query(`DELETE FROM story_progress WHERE "userId" = $1 AND "storyId" = $2`, [userId, storyId])
    );
  }

  async recordEndingFound(userId: string, storyId: string, passageId: string): Promise<boolean> {
    // ON CONFLICT DO NOTHING + RETURNING: a row comes back only on the first find, which
    // is exactly the "New!" signal — and a repeat ending never moves the count (§ 3.5).
    const { rowCount } = await this.run(undefined, (c) =>
      c.query(
        `INSERT INTO story_endings_found ("userId", "storyId", "passageId")
         VALUES ($1, $2, $3)
         ON CONFLICT ("userId", "passageId") DO NOTHING
         RETURNING "passageId"`,
        [userId, storyId, passageId]
      )
    );
    return rowCount > 0;
  }

  async createStory(
    data: { authorUserId: string; language: string; title: string; iconId: string | null },
    client?: PoolClient
  ): Promise<StoryRow> {
    this.requireId(data.authorUserId, 'authorUserId');
    const { rows } = await this.run<StoryRow>(client, (c) =>
      c.query(
        `INSERT INTO stories ("authorUserId", language, title, "iconId")
         VALUES ($1, $2, $3, $4)
         RETURNING ${STORY_COLUMNS}`,
        [data.authorUserId, data.language, data.title, data.iconId]
      )
    );
    return rows[0];
  }

  async updateStory(storyId: string, fields: StoryUpdateFields, client?: PoolClient): Promise<StoryRow | null> {
    this.requireId(storyId, 'storyId');
    // Build the SET list from the fields actually present; `iconId: null` clears the icon,
    // an absent key leaves the column alone.
    const sets: string[] = [];
    const values: unknown[] = [storyId];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`"${column}" = $${values.length}`);
    };
    if (fields.title !== undefined) add('title', fields.title);
    if (fields.iconId !== undefined) add('iconId', fields.iconId);
    if (fields.startPassageId !== undefined) add('startPassageId', fields.startPassageId);
    sets.push(`"updatedAt" = now()`);

    const { rows } = await this.run<StoryRow>(client, (c) =>
      c.query(`UPDATE stories SET ${sets.join(', ')} WHERE id = $1 RETURNING ${STORY_COLUMNS}`, values)
    );
    return rows[0] ?? null;
  }

  async deleteStory(storyId: string): Promise<boolean> {
    this.requireId(storyId, 'storyId');
    const { rowCount } = await this.run(undefined, (c) => c.query(`DELETE FROM stories WHERE id = $1`, [storyId]));
    return rowCount > 0;
  }

  async createPassage(storyId: string, content: string, client?: PoolClient): Promise<StoryPassageRow> {
    this.requireId(storyId, 'storyId');
    const { rows } = await this.run<StoryPassageRow>(client, (c) =>
      c.query(
        `WITH inserted AS (
           -- Appended: MAX + 1 (migration 199). Two concurrent creates could collide on
           -- UNIQUE (storyId, position); one then fails with a 500 and can be retried.
           INSERT INTO story_passages ("storyId", content, position)
           VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1 FROM story_passages WHERE "storyId" = $1))
           RETURNING id, "storyId", name, content, "endingTitle", "createdAt", "updatedAt"
         ), touched AS (
           UPDATE stories SET "updatedAt" = now() WHERE id = $1
         )
         SELECT inserted.*, '[]'::jsonb AS choices FROM inserted`,
        [storyId, content]
      )
    );
    return rows[0];
  }

  async duplicatePassage(storyId: string, sourcePassageId: string, name: string | null, client: PoolClient): Promise<string> {
    this.requireId(storyId, 'storyId');
    this.requireId(sourcePassageId, 'sourcePassageId');
    // 1. Make room right after the source. One statement, so the DEFERRABLE unique
    //    constraint (migration 199) lets positions pass through each other.
    await client.query(
      `UPDATE story_passages SET position = position + 1
        WHERE "storyId" = $1
          AND position > (SELECT position FROM story_passages WHERE id = $2 AND "storyId" = $1)`,
      [storyId, sourcePassageId]
    );
    // 2. The copy, in the gap.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO story_passages ("storyId", name, content, "endingTitle", position)
       SELECT "storyId", $3, content, "endingTitle", position + 1
         FROM story_passages WHERE id = $2 AND "storyId" = $1
       RETURNING id`,
      [storyId, sourcePassageId, name]
    );
    const copyId = rows[0]?.id;
    if (!copyId) throw new Error(`duplicatePassage: passage ${sourcePassageId} not in story ${storyId}`);
    // 3. Its choices: same labels and targets, except a loop back into the source loops
    //    back into the copy (the copy behaves like the original).
    await client.query(
      `INSERT INTO story_choices ("passageId", position, label, "targetPassageId")
       SELECT $2, position, label, CASE WHEN "targetPassageId" = $1 THEN $2 ELSE "targetPassageId" END
         FROM story_choices WHERE "passageId" = $1`,
      [sourcePassageId, copyId]
    );
    await client.query(`UPDATE stories SET "updatedAt" = now() WHERE id = $1`, [storyId]);
    return copyId;
  }

  async savePassage(
    passageId: string,
    data: {
      name: string | null;
      content: string;
      endingTitle: string | null;
      choices: Array<{ position: number; label: string; targetPassageId: string | null }>;
    },
    client: PoolClient
  ): Promise<void> {
    this.requireId(passageId, 'passageId');
    await client.query(
      `WITH updated AS (
         UPDATE story_passages SET content = $2, "endingTitle" = $3, name = $4, "updatedAt" = now()
         WHERE id = $1 RETURNING "storyId"
       )
       UPDATE stories SET "updatedAt" = now() WHERE id = (SELECT "storyId" FROM updated)`,
      [passageId, data.content, data.endingTitle, data.name]
    );
    // Replace, not diff: choice ids are referenced by nothing durable (progress keys on
    // the passage), so a fresh set of rows is simplest and keeps positions dense.
    await client.query(`DELETE FROM story_choices WHERE "passageId" = $1`, [passageId]);
    if (data.choices.length > 0) {
      await client.query(
        `INSERT INTO story_choices ("passageId", position, label, "targetPassageId")
         SELECT $1, x.position, x.label, x."targetPassageId"
         FROM jsonb_to_recordset($2::jsonb) AS x(position smallint, label text, "targetPassageId" uuid)`,
        [passageId, JSON.stringify(data.choices)]
      );
    }
  }

  async reorderPassages(storyId: string, passageIds: string[]): Promise<void> {
    this.requireId(storyId, 'storyId');
    // One statement: the DEFERRABLE unique constraint is checked when it ends, so
    // positions may pass through each other. The service has already checked that
    // `passageIds` is exactly the story's passages.
    await this.run(undefined, (c) =>
      c.query(
        `WITH reordered AS (
           UPDATE story_passages p SET position = ordered.n
             FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, n)
            WHERE p.id = ordered.id AND p."storyId" = $1
         )
         UPDATE stories SET "updatedAt" = now() WHERE id = $1`,
        [storyId, passageIds]
      )
    );
  }

  async deletePassage(passageId: string): Promise<boolean> {
    this.requireId(passageId, 'passageId');
    const { rowCount } = await this.run(undefined, (c) =>
      c.query(
        `WITH deleted AS (DELETE FROM story_passages WHERE id = $1 RETURNING "storyId")
         UPDATE stories SET "updatedAt" = now() WHERE id = (SELECT "storyId" FROM deleted)
         RETURNING id`,
        [passageId]
      )
    );
    return rowCount > 0;
  }

  async publish(storyId: string, difficulty: number | null): Promise<string> {
    const { rows } = await this.run<{ publishedAt: string }>(undefined, (c) =>
      c.query(
        `UPDATE stories SET "publishedAt" = now(), difficulty = $2, "updatedAt" = now()
         WHERE id = $1 RETURNING "publishedAt"`,
        [storyId, difficulty]
      )
    );
    return rows[0]?.publishedAt;
  }

  async unpublish(storyId: string): Promise<boolean> {
    const { rowCount } = await this.run(undefined, (c) =>
      c.query(`UPDATE stories SET "publishedAt" = NULL, "updatedAt" = now() WHERE id = $1`, [storyId])
    );
    return rowCount > 0;
  }
}
