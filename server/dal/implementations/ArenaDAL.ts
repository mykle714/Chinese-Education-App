import type { PoolClient } from 'pg';
import type { IArenaDAL, ArenaCandidate, ArenaMemberSeed, ArenaResolutionRow } from '../interfaces/IArenaDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import type { Arena, ArenaMember, ArenaFormationKind } from '../../types/arena.js';
import { ValidationError } from '../../types/dal.js';

/** Every column of an `arenas` row. */
const ARENA_ROW = `
  id, division, timezone, "geoCellPrefix", "formationKind",
  "weekStartsAt", "closesAt", "resolvedAt", "createdAt"
`;

/**
 * The same columns aliased to `a`, for the joins against arena_members.
 * Written out rather than derived from ARENA_ROW by string surgery: a regex that
 * prefixes column names is unreadable, and it silently breaks the first time a
 * column name contains something the pattern did not anticipate.
 */
const ARENA_COLUMNS_AS_A = `
  a.id, a.division, a.timezone, a."geoCellPrefix", a."formationKind",
  a."weekStartsAt", a."closesAt", a."resolvedAt", a."createdAt"
`;

/** Every column of an `arena_members` row. */
const MEMBER_ROW = `
  id, "arenaId", "userId", language,
  "syntheticName", "syntheticAvatarIconId", "syntheticSeed", "syntheticTarget",
  "minutesEarned", "finalRank", "divisionChange", "isLive",
  "updatedAt", "createdAt"
`;

/**
 * Persists the arena tables (migration 146). See docs/ARENA_FEATURE.md § 9.
 *
 * Every method accepts an optional PoolClient so a caller already inside a
 * transaction can enlist the query — the shape docs/BACKEND_LAYERING.md § 3
 * prescribes. Two methods here open transactions of their own when not given
 * one, because their multi-statement work is atomic by requirement rather than
 * by preference: createArenaWithMembers and resolveArena.
 */
export class ArenaDAL implements IArenaDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /** Run `fn` on the caller's client when given one, otherwise on a pooled connection. */
  private async run<T>(
    client: PoolClient | undefined,
    fn: (c: PoolClient) => Promise<any>,
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

  // ── Reads ──────────────────────────────────────────────────────────────────

  async findArenaById(id: string, client?: PoolClient): Promise<Arena | null> {
    this.requireId(id, 'arena id');
    const { rows } = await this.run<Arena>(client, (c) =>
      c.query(`SELECT ${ARENA_ROW} FROM arenas WHERE id = $1`, [id]),
    );
    return rows[0] ?? null;
  }

  async findLiveArenaForUser(
    userId: string,
    language: string,
    client?: PoolClient,
  ): Promise<Arena | null> {
    this.requireId(userId, 'userId');
    this.requireId(language, 'language');
    // Driven by uq_arena_member_live: at most one row can match.
    const { rows } = await this.run<Arena>(client, (c) =>
      c.query(
        `SELECT ${ARENA_COLUMNS_AS_A}
         FROM arena_members m
         JOIN arenas a ON a.id = m."arenaId"
         WHERE m."userId" = $1 AND m.language = $2 AND m."isLive"
         LIMIT 1`,
        [userId, language],
      ),
    );
    return rows[0] ?? null;
  }

  async findLastResolvedArenaForUser(
    userId: string,
    language: string,
    client?: PoolClient,
  ): Promise<Arena | null> {
    this.requireId(userId, 'userId');
    this.requireId(language, 'language');
    const { rows } = await this.run<Arena>(client, (c) =>
      c.query(
        `SELECT a.id, a.division, a.timezone, a."geoCellPrefix", a."formationKind",
                a."weekStartsAt", a."closesAt", a."resolvedAt", a."createdAt"
         FROM arena_members m
         JOIN arenas a ON a.id = m."arenaId"
         WHERE m."userId" = $1 AND m.language = $2 AND a."resolvedAt" IS NOT NULL
         ORDER BY a."closesAt" DESC
         LIMIT 1`,
        [userId, language],
      ),
    );
    return rows[0] ?? null;
  }

  async listMembers(arenaId: string, client?: PoolClient): Promise<ArenaMember[]> {
    this.requireId(arenaId, 'arenaId');
    const { rows } = await this.run<ArenaMember>(client, (c) =>
      c.query(`SELECT ${MEMBER_ROW} FROM arena_members WHERE "arenaId" = $1`, [arenaId]),
    );
    return rows;
  }

  async listCandidates(weekKey: string, client?: PoolClient): Promise<ArenaCandidate[]> {
    this.requireId(weekKey, 'weekKey');
    // Ordered so the service can walk buckets without re-sorting. geoCell is the
    // locality-preserving sort key (§ 5.1) — a geohash is a space-filling curve,
    // so consecutive runs are geographically tight runs.
    //
    // NULLS LAST is explicit rather than incidental: the location-less pool must
    // be a group of its own, and relying on the collation's NULL ordering here is
    // exactly the bug § 5.2a warns about.
    const { rows } = await this.run<ArenaCandidate>(client, (c) =>
      c.query(
        `SELECT ul."userId", ul.language, ul.division, u.timezone, u."geoCell"
         FROM user_languages ul
         JOIN users u ON u.id = ul."userId"
         WHERE ul."arenaOptInWeek" = $1::date
         ORDER BY u.timezone, ul.division, u."geoCell" NULLS LAST, ul."userId"`,
        [weekKey],
      ),
    );
    return rows;
  }

  async listUnresolvedArenas(asOf: Date, client?: PoolClient): Promise<Arena[]> {
    const { rows } = await this.run<Arena>(client, (c) =>
      c.query(
        `SELECT ${ARENA_ROW} FROM arenas
         WHERE "resolvedAt" IS NULL AND "closesAt" <= $1
         ORDER BY "closesAt"`,
        [asOf],
      ),
    );
    return rows;
  }

  async arenaExistsForBucket(
    timezone: string,
    division: number,
    weekStartsAt: Date,
    client?: PoolClient,
  ): Promise<boolean> {
    const { rows } = await this.run<{ exists: boolean }>(client, (c) =>
      c.query(
        `SELECT EXISTS (
           SELECT 1 FROM arenas
           WHERE timezone = $1 AND division = $2 AND "weekStartsAt" = $3
         ) AS exists`,
        [timezone, division, weekStartsAt],
      ),
    );
    return rows[0]?.exists === true;
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  async createArenaWithMembers(
    arena: {
      division: number;
      timezone: string;
      geoCellPrefix: string | null;
      formationKind: ArenaFormationKind;
      weekStartsAt: Date;
      closesAt: Date;
    },
    members: ArenaMemberSeed[],
    client?: PoolClient,
  ): Promise<Arena> {
    if (!Array.isArray(members) || members.length === 0) {
      throw new ValidationError('an arena must be created with its members');
    }

    const work = async (c: PoolClient): Promise<Arena> => {
      const { rows } = await c.query(
        `INSERT INTO arenas
           (division, timezone, "geoCellPrefix", "formationKind", "weekStartsAt", "closesAt")
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${ARENA_ROW}`,
        [
          arena.division,
          arena.timezone,
          arena.geoCellPrefix,
          arena.formationKind,
          arena.weekStartsAt,
          arena.closesAt,
        ],
      );
      const created: Arena = rows[0];

      // One multi-row INSERT rather than N round trips — 25 members per arena and
      // potentially many arenas per formation run.
      // $1 is the arena id, shared by every row; each member then contributes six
      // parameters. All values are bound — nothing is interpolated into the SQL.
      const params: any[] = [created.id];
      const values = members.map((m) => {
        const b = params.length;
        params.push(
          m.userId ?? null,
          m.language,
          m.syntheticName ?? null,
          m.syntheticAvatarIconId ?? null,
          m.syntheticSeed ?? null,
          m.syntheticTarget ?? null,
        );
        return `($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
      });

      await c.query(
        `INSERT INTO arena_members
           ("arenaId", "userId", language, "syntheticName", "syntheticAvatarIconId",
            "syntheticSeed", "syntheticTarget")
         VALUES ${values.join(', ')}`,
        params,
      );

      return created;
    };

    if (client) return work(client);
    return this.dbManager.executeInTransaction(async (tx) => work(tx.getClient()));
  }

  async replaceSyntheticWithHuman(
    arenaId: string,
    userId: string,
    language: string,
    client?: PoolClient,
  ): Promise<boolean> {
    this.requireId(arenaId, 'arenaId');
    this.requireId(userId, 'userId');
    this.requireId(language, 'language');

    // Take the seat a bot would otherwise hold: a real player always beats a
    // synthetic one, and the arena stays exactly 25 (§ 5.3 step 1).
    //
    // The subselect picks ONE synthetic row; if none is free the UPDATE affects
    // zero rows and the caller falls through to straggler chunking.
    const { rowCount } = await this.run(client, (c) =>
      c.query(
        `UPDATE arena_members
         SET "userId" = $2,
             language = $3,
             "syntheticName" = NULL,
             "syntheticAvatarIconId" = NULL,
             "syntheticSeed" = NULL,
             "syntheticTarget" = NULL,
             "minutesEarned" = 0,
             "updatedAt" = now()
         WHERE id = (
           SELECT id FROM arena_members
           WHERE "arenaId" = $1 AND "userId" IS NULL
           ORDER BY "createdAt"
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )`,
        [arenaId, userId, language],
      ),
    );
    return rowCount > 0;
  }

  async addMinutes(
    userId: string,
    language: string,
    minutes: number,
    client?: PoolClient,
  ): Promise<void> {
    this.requireId(userId, 'userId');
    this.requireId(language, 'language');
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    // Scoped to isLive so minutes credited after close cannot alter a finished
    // board. A user with no live membership simply has nothing updated — the
    // caller (MinutePointsService) must not care whether they are in an arena.
    await this.run(client, (c) =>
      c.query(
        `UPDATE arena_members
         SET "minutesEarned" = "minutesEarned" + $3,
             "updatedAt" = now()
         WHERE "userId" = $1 AND language = $2 AND "isLive"`,
        [userId, language, Math.round(minutes)],
      ),
    );
  }

  async resolveArena(
    arenaId: string,
    rows: ArenaResolutionRow[],
    client?: PoolClient,
  ): Promise<void> {
    this.requireId(arenaId, 'arenaId');

    const work = async (c: PoolClient): Promise<void> => {
      // 1. Stamp the arena. The `resolvedAt IS NULL` predicate makes this the
      //    idempotency guard: a second concurrent run updates zero rows and
      //    returns without touching members.
      const stamped = await c.query(
        `UPDATE arenas SET "resolvedAt" = now()
         WHERE id = $1 AND "resolvedAt" IS NULL`,
        [arenaId],
      );
      if ((stamped.rowCount ?? 0) === 0) return; // already resolved

      // 2. Write each member's final standing.
      for (const r of rows) {
        await c.query(
          `UPDATE arena_members
           SET "finalRank" = $2, "divisionChange" = $3
           WHERE id = $1 AND "arenaId" = $4`,
          [r.memberId, r.finalRank, r.divisionChange, arenaId],
        );
      }

      // 3. ⚠️ Clear liveness for EVERY member — bots included, and regardless of
      //    whether step 2 had a row for them. This is the flip that frees each
      //    user's seat under uq_arena_member_live. Skipping it, or scoping it to
      //    only the members in `rows`, permanently locks those users out of all
      //    future arenas. It is deliberately unconditional and deliberately last.
      await c.query(
        `UPDATE arena_members SET "isLive" = false WHERE "arenaId" = $1 AND "isLive"`,
        [arenaId],
      );
    };

    if (client) return work(client);
    return this.dbManager.executeInTransaction(async (tx) => work(tx.getClient()));
  }

  // ── Arena-owned columns on `user_languages` ────────────────────────────────
  // See the layering note in IArenaDAL: these columns are Arena's, on a table
  // UserLanguagesDAL otherwise owns. The column sets are disjoint.

  async getDivision(userId: string, language: string, client?: PoolClient): Promise<number> {
    this.requireId(userId, 'userId');
    this.requireId(language, 'language');
    const { rows } = await this.run<{ division: number }>(client, (c) =>
      c.query(
        `SELECT division FROM user_languages WHERE "userId" = $1 AND language = $2`,
        [userId, language],
      ),
    );
    // A learner with no row for this language has never studied it; the bottom
    // rung is the correct answer, not an error.
    return rows[0]?.division ?? 1;
  }

  async setDivision(
    userId: string,
    language: string,
    division: number,
    client?: PoolClient,
  ): Promise<void> {
    this.requireId(userId, 'userId');
    this.requireId(language, 'language');
    // Clamped in SQL as well as in the service: the CHECK constraint would
    // reject an out-of-range value by aborting the whole resolution transaction,
    // which would be a catastrophic response to one bad arithmetic result.
    await this.run(client, (c) =>
      c.query(
        `UPDATE user_languages
         SET division = LEAST(GREATEST($3, 1), 12), "updatedAt" = now()
         WHERE "userId" = $1 AND language = $2`,
        [userId, language, Math.round(division)],
      ),
    );
  }

  async setOptInWeek(
    userId: string,
    language: string,
    weekKey: string | null,
    client?: PoolClient,
  ): Promise<void> {
    this.requireId(userId, 'userId');
    this.requireId(language, 'language');
    // Upsert: a learner may opt into a language they have a row for, and the row
    // always exists by the time they can reach the arena UI -- but a race with
    // first-ever study in that language should not lose the opt-in.
    await this.run(client, (c) =>
      c.query(
        `INSERT INTO user_languages ("userId", language, "arenaOptInWeek")
         VALUES ($1, $2, $3::date)
         ON CONFLICT ("userId", language)
         DO UPDATE SET "arenaOptInWeek" = EXCLUDED."arenaOptInWeek", "updatedAt" = now()`,
        [userId, language, weekKey],
      ),
    );
  }

  async setGeoCell(userId: string, geoCell: string | null, client?: PoolClient): Promise<void> {
    this.requireId(userId, 'userId');
    // Shape is validated in the service before it reaches here; the DB CHECK is
    // the last line of defence rather than the first.
    await this.run(client, (c) =>
      c.query(`UPDATE users SET "geoCell" = $2 WHERE id = $1`, [userId, geoCell]),
    );
  }

  async getOptInWeek(
    userId: string,
    language: string,
    client?: PoolClient,
  ): Promise<string | null> {
    this.requireId(userId, 'userId');
    this.requireId(language, 'language');
    // Formatted in SQL, deliberately. node-pg parses a `date` column into a JS
    // Date at LOCAL midnight, so reading the parts back off it shifts the day
    // backwards for any server west of UTC -- a bug that would silently drop
    // users from a week's formation and only in some timezones. TO_CHAR returns
    // the stored date as text with no timezone in the path at all.
    const { rows } = await this.run<{ weekKey: string | null }>(client, (c) =>
      c.query(
        `SELECT TO_CHAR("arenaOptInWeek", 'YYYY-MM-DD') AS "weekKey"
         FROM user_languages WHERE "userId" = $1 AND language = $2`,
        [userId, language],
      ),
    );
    return rows[0]?.weekKey ?? null;
  }
}
