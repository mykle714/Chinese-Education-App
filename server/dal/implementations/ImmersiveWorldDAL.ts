import type { PoolClient } from 'pg';
import type { IImmersiveWorldDAL, IWNpcReference } from '../interfaces/IImmersiveWorldDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import type {
  IWScene, IWSceneRun, IWSceneSummary, IWTranscriptEntry,
} from '../../contracts/iw.js';
import { IW_TRANSCRIPT_MAX_ENTRIES, IW_TRANSCRIPT_MAX_TEXT_CHARS } from '../../contracts/iw.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Persists the Immersive World scene catalog (`iw_scenes`) and its playthroughs
 * (`iw_scene_runs`), both migration 158.
 *
 * WHY EVERY WRITE IS A WHOLE ROW. A scene is authored whole and read whole — that property
 * is what collapsed the five originally-approved child tables into five jsonb columns
 * (migration 158's header). Save therefore replaces every column, and there is no
 * per-blob update method to drift from the editor's model.
 *
 * SCENES ARE NOT USER DATA. There is no `createdBy` and no per-user scoping: authors are
 * staff (§ 14 Q2), and the gate is a permission check in the service, not a row filter.
 * RUNS ARE THE OPPOSITE — every run method is scoped by `userId`, and the read methods take
 * it as a parameter rather than filtering afterwards, so there is no shape of call that
 * returns somebody else's conversation.
 *
 * See docs/IMMERSIVE_WORLD.md § 8, § 12 phase 1d.
 */

/** Every column of an `iw_scenes` row, in the order the row type expects. */
const SCENE_COLUMNS = `id, language, name, published, "sceneNotes",
  "completerNpcId", "completionAction",
  "playerStartCol", "playerStartRow", "playerStartFacing",
  "companionStartCol", "companionStartRow", "companionStartFacing",
  width, height,
  layout, "npcCast", complications, events, conversations, interactions,
  "createdAt", "updatedAt"`;

/** Every column of an `iw_scene_runs` row. `complicationIds`/`eventIds` are omitted
 * deliberately: nothing draws a complication yet (§ 12 phase 3), and a column selected by
 * name that no caller reads is the shape that survives long after the feature is cut. */
const RUN_COLUMNS = `id, "userId", language, "sceneId", completed, "durationSeconds",
  "minutePointsEarned", "overviewTagId", transcript, "startedAt", "completedAt"`;

/** The scene as Postgres hands it back — jsonb arrives parsed, timestamps as Date. */
interface SceneRow {
  id: string;
  language: 'zh' | 'es';
  name: string;
  published: boolean;
  sceneNotes: string;
  completerNpcId: string;
  completionAction: string;
  playerStartCol: number;
  playerStartRow: number;
  playerStartFacing: string;
  companionStartCol: number;
  companionStartRow: number;
  companionStartFacing: string;
  width: number;
  height: number;
  layout: unknown;
  npcCast: unknown;
  complications: unknown;
  events: unknown;
  conversations: unknown;
  interactions: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export class ImmersiveWorldDAL implements IImmersiveWorldDAL {

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

  /**
   * Row → wire shape. The jsonb columns are defaulted defensively: a row written before a
   * blob existed (or by hand, which § 14 Q2 explicitly recommends for scene one) would
   * otherwise hand the editor an `undefined` where it expects a list.
   */
  private toScene(row: SceneRow): IWScene {
    return {
      id: row.id,
      language: row.language,
      name: row.name,
      published: row.published,
      // Defaulted like the jsonb blobs, and for the same reason: a row written before the
      // column existed (migration 160) must not hand the editor an `undefined` text field.
      sceneNotes: row.sceneNotes ?? '',
      completerNpcId: row.completerNpcId,
      completionAction: row.completionAction as IWScene['completionAction'],
      playerStartCol: row.playerStartCol,
      playerStartRow: row.playerStartRow,
      playerStartFacing: row.playerStartFacing as IWScene['playerStartFacing'],
      companionStartCol: row.companionStartCol,
      companionStartRow: row.companionStartRow,
      companionStartFacing: row.companionStartFacing as IWScene['companionStartFacing'],
      width: row.width,
      height: row.height,
      layout: (row.layout as IWScene['layout']) ?? {
        terrain1: [], terrain2: [], decor: {},
      },
      npcCast: (row.npcCast as IWScene['npcCast']) ?? [],
      complications: (row.complications as IWScene['complications']) ?? [],
      // Defaulted like every other blob: a scene authored before migration 161 has no events.
      events: (row.events as IWScene['events']) ?? [],
      conversations: (row.conversations as IWScene['conversations']) ?? [],
      // Defaulted to an EMPTY OBJECT, not an empty list: interactions are keyed by place tag
      // (migration 162), so a scene authored before the column existed has no interactive
      // places rather than an empty list of them.
      interactions: (row.interactions as IWScene['interactions']) ?? {},
      createdAt: row.createdAt?.toISOString(),
      updatedAt: row.updatedAt?.toISOString(),
    };
  }

  /** The positional parameter list shared by insert and update, in column order. */
  private sceneParams(scene: IWScene): unknown[] {
    return [
      scene.language,
      scene.name.trim(),
      scene.published === true,
      typeof scene.sceneNotes === 'string' ? scene.sceneNotes : '',
      scene.completerNpcId,
      scene.completionAction,
      scene.playerStartCol,
      scene.playerStartRow,
      scene.playerStartFacing,
      scene.companionStartCol,
      scene.companionStartRow,
      scene.companionStartFacing,
      scene.width,
      scene.height,
      JSON.stringify(scene.layout ?? {}),
      JSON.stringify(scene.npcCast ?? []),
      JSON.stringify(scene.complications ?? []),
      JSON.stringify(scene.events ?? []),
      JSON.stringify(scene.conversations ?? []),
      JSON.stringify(scene.interactions ?? {}),
    ];
  }

  async listScenes(language?: string, client?: PoolClient): Promise<IWSceneSummary[]> {
    // The counts are computed in SQL rather than by fetching the blobs: the load list is
    // the one place a scene's five blobs are pure weight, and a gallery of 40 scenes would
    // otherwise ship every layout mask to render a row of text.
    const { rows } = await this.run<any>(client, (c) =>
      c.query(
        `SELECT id, language, name, published, width, height,
                jsonb_array_length("npcCast")      AS "castCount",
                jsonb_array_length(complications)  AS "complicationCount",
                "updatedAt"
         FROM iw_scenes
         WHERE ($1::varchar IS NULL OR language = $1)
         ORDER BY "updatedAt" DESC`,
        [language ?? null]
      )
    );
    return rows.map((r) => ({
      id: r.id,
      language: r.language,
      name: r.name,
      published: r.published,
      width: r.width,
      height: r.height,
      castCount: r.castCount ?? 0,
      complicationCount: r.complicationCount ?? 0,
      updatedAt: r.updatedAt?.toISOString?.() ?? String(r.updatedAt),
    }));
  }

  async findSceneById(id: string, client?: PoolClient): Promise<IWScene | null> {
    this.requireId(id, 'Scene id');
    const { rows } = await this.run<SceneRow>(client, (c) =>
      c.query(`SELECT ${SCENE_COLUMNS} FROM iw_scenes WHERE id = $1`, [id])
    );
    return rows[0] ? this.toScene(rows[0]) : null;
  }

  async createScene(scene: IWScene, client?: PoolClient): Promise<IWScene> {
    const { rows } = await this.run<SceneRow>(client, (c) =>
      c.query(
        `INSERT INTO iw_scenes (
           language, name, published, "sceneNotes",
           "completerNpcId", "completionAction",
           "playerStartCol", "playerStartRow", "playerStartFacing",
           "companionStartCol", "companionStartRow", "companionStartFacing",
           width, height,
           layout, "npcCast", complications, events, conversations, interactions
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING ${SCENE_COLUMNS}`,
        this.sceneParams(scene)
      )
    );
    return this.toScene(rows[0]);
  }

  async updateScene(id: string, scene: IWScene, client?: PoolClient): Promise<IWScene | null> {
    this.requireId(id, 'Scene id');
    const { rows } = await this.run<SceneRow>(client, (c) =>
      c.query(
        `UPDATE iw_scenes SET
           language = $2, name = $3, published = $4, "sceneNotes" = $5,
           "completerNpcId" = $6, "completionAction" = $7,
           "playerStartCol" = $8, "playerStartRow" = $9, "playerStartFacing" = $10,
           "companionStartCol" = $11, "companionStartRow" = $12, "companionStartFacing" = $13,
           width = $14, height = $15,
           layout = $16, "npcCast" = $17, complications = $18, events = $19,
           conversations = $20, interactions = $21,
           "updatedAt" = NOW()
         WHERE id = $1
         RETURNING ${SCENE_COLUMNS}`,
        [id, ...this.sceneParams(scene)]
      )
    );
    return rows[0] ? this.toScene(rows[0]) : null;
  }

  async deleteScene(id: string, client?: PoolClient): Promise<boolean> {
    this.requireId(id, 'Scene id');
    // ON DELETE RESTRICT from iw_scene_runs guards a scene with history: the delete
    // raises a foreign-key violation rather than silently taking a learner's runs with it.
    // Unpublishing is the intended retirement path (migration 158).
    const { rowCount } = await this.run(client, (c) =>
      c.query('DELETE FROM iw_scenes WHERE id = $1', [id])
    );
    return rowCount > 0;
  }

  async isNameAvailable(
    language: string,
    name: string,
    exceptId?: string,
    client?: PoolClient
  ): Promise<boolean> {
    // Scoped to the language, not global: a zh "Restaurant" and an es "Restaurant" are
    // different content, not a collision (§ 14 Q8).
    const { rows } = await this.run<{ id: string }>(client, (c) =>
      c.query(
        `SELECT id FROM iw_scenes
         WHERE language = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3)
         LIMIT 1`,
        [language, (name ?? '').trim(), exceptId ?? null]
      )
    );
    return rows.length === 0;
  }

  async listNpcReferences(client?: PoolClient): Promise<IWNpcReference[]> {
    // One query over every table that stores an NPC id. `jsonb_array_elements` is a lateral
    // join, so a scene with an empty cast simply contributes no rows.
    const { rows } = await this.run<IWNpcReference>(client, (c) =>
      c.query(
        `SELECT 'scene:completer' AS source, s.id::text AS "refId", s.name AS label,
                s."completerNpcId" AS "npcId"
           FROM iw_scenes s
         UNION ALL
         SELECT 'scene:cast', s.id::text, s.name, m->>'npcId'
           FROM iw_scenes s, jsonb_array_elements(s."npcCast") m
         UNION ALL
         SELECT 'scene:conversation', s.id::text, s.name, t->>'npcId'
           FROM iw_scenes s,
                jsonb_array_elements(s.conversations) v,
                jsonb_array_elements(v->'turns') t
         UNION ALL
         SELECT 'rating', r.id::text, r."runId"::text, r."npcId"
           FROM iw_scene_ratings r
         UNION ALL
         SELECT 'memory', m."userId"::text, m."userId"::text, m."npcId"
           FROM iw_npc_memories m`
      )
    );
    return rows.filter((r) => typeof r.npcId === 'string' && r.npcId.length > 0);
  }
  // ── Runs and their transcripts (§ 12 phase 3) ──────────────────────────────

  /**
   * Row → wire shape. `transcript` arrives from pg already parsed; it is defaulted
   * defensively for the same reason the scene blobs are — a row written by hand would
   * otherwise hand a caller an `undefined` where it expects a list.
   */
  private toRun(row: any): IWSceneRun {
    return {
      id: row.id,
      userId: row.userId,
      language: row.language,
      sceneId: row.sceneId,
      completed: row.completed,
      durationSeconds: row.durationSeconds ?? null,
      minutePointsEarned: row.minutePointsEarned ?? 0,
      overviewTagId: row.overviewTagId ?? null,
      transcript: Array.isArray(row.transcript) ? row.transcript : [],
      startedAt: row.startedAt?.toISOString?.() ?? String(row.startedAt),
      completedAt: row.completedAt ? (row.completedAt.toISOString?.() ?? String(row.completedAt)) : null,
    };
  }

  /**
   * The one statement that closes a learner's open run in a language, stamping the elapsed
   * time. Shared by {@link openRun} (where it clears the way for the insert) and by
   * {@link completeRun} (where it IS the operation), so the duration is computed the same
   * way whether a run ended or was displaced.
   */
  private static readonly CLOSE_RUN_SET = `
    "completedAt" = NOW(),
    "durationSeconds" = COALESCE(
      "durationSeconds",
      GREATEST(0, EXTRACT(EPOCH FROM (NOW() - "startedAt"))::int)
    )`;

  async openRun(
    userId: string,
    language: string,
    sceneId: string,
    client?: PoolClient
  ): Promise<IWSceneRun> {
    this.requireId(userId, 'User id');
    this.requireId(sceneId, 'Scene id');
    if (!language) throw new ValidationError('Language is required');

    // Both statements or neither — see the interface note. Between them the partial unique
    // index is satisfied by nothing, so a crash in the gap would leave the learner with a
    // language they can never start a run in again.
    const work = async (c: PoolClient): Promise<IWSceneRun> => {
      await c.query(
        `UPDATE iw_scene_runs SET ${ImmersiveWorldDAL.CLOSE_RUN_SET}
          WHERE "userId" = $1 AND language = $2 AND "completedAt" IS NULL`,
        [userId, language]
      );
      const inserted = await c.query(
        `INSERT INTO iw_scene_runs ("userId", language, "sceneId")
         VALUES ($1, $2, $3)
         RETURNING ${RUN_COLUMNS}`,
        [userId, language, sceneId]
      );
      return this.toRun(inserted.rows[0]);
    };

    if (client) return work(client);
    return this.dbManager.executeInTransaction((tx) => work(tx.getClient() as PoolClient));
  }

  async appendTranscript(
    runId: string,
    entries: readonly IWTranscriptEntry[],
    client?: PoolClient
  ): Promise<boolean> {
    this.requireId(runId, 'Run id');
    // Nothing to say is not an error — the recorder calls this with whatever a turn produced,
    // and a frozen turn produces nothing.
    if (entries.length === 0) return false;

    // Truncated HERE rather than at the caller, because this is the layer that owns what the
    // row may contain: a caller that forgot would otherwise be the one path that can breach
    // migration 158's size bound (see IW_TRANSCRIPT_MAX_TEXT_CHARS).
    const bounded = entries.map((e) => ({
      speaker: String(e.speaker ?? ''),
      text: [...String(e.text ?? '')].slice(0, IW_TRANSCRIPT_MAX_TEXT_CHARS).join(''),
      at: e.at ?? new Date().toISOString(),
    }));

    // Append then keep the LAST n, in one statement. `WITH ORDINALITY` is what makes the
    // "oldest first" of the cap expressible at all — jsonb arrays have an order but no
    // column to sort by, so the position has to be materialized before it can be reversed.
    const { rowCount } = await this.run(client, (c) =>
      c.query(
        `UPDATE iw_scene_runs
            SET transcript = (
              SELECT COALESCE(jsonb_agg(entry ORDER BY ord), '[]'::jsonb)
                FROM (
                  SELECT entry, ord
                    FROM jsonb_array_elements(transcript || $2::jsonb)
                         WITH ORDINALITY AS t(entry, ord)
                   ORDER BY ord DESC
                   LIMIT $3
                ) kept
            )
          WHERE id = $1`,
        [runId, JSON.stringify(bounded), IW_TRANSCRIPT_MAX_ENTRIES]
      )
    );
    return rowCount > 0;
  }

  async completeRun(runId: string, completed: boolean, client?: PoolClient): Promise<IWSceneRun | null> {
    this.requireId(runId, 'Run id');
    // Idempotent by the WHERE clause: closing an already-closed run returns null rather than
    // re-stamping it, so a duplicate `/session/end` cannot move a finished run's end time.
    const { rows } = await this.run<any>(client, (c) =>
      c.query(
        `UPDATE iw_scene_runs
            SET ${ImmersiveWorldDAL.CLOSE_RUN_SET}, completed = $2
          WHERE id = $1 AND "completedAt" IS NULL
          RETURNING ${RUN_COLUMNS}`,
        [runId, completed]
      )
    );
    return rows[0] ? this.toRun(rows[0]) : null;
  }

  async findRunById(runId: string, client?: PoolClient): Promise<IWSceneRun | null> {
    this.requireId(runId, 'Run id');
    const { rows } = await this.run<any>(client, (c) =>
      c.query(`SELECT ${RUN_COLUMNS} FROM iw_scene_runs WHERE id = $1`, [runId])
    );
    return rows[0] ? this.toRun(rows[0]) : null;
  }

  async listRuns(
    userId: string,
    limit: number,
    language?: string,
    client?: PoolClient
  ): Promise<IWSceneRun[]> {
    this.requireId(userId, 'User id');
    // `idx_iw_scene_runs_user_started` is exactly this ordering, so the language filter is a
    // cheap filter on an already-narrow scan rather than a second index.
    const { rows } = await this.run<any>(client, (c) =>
      c.query(
        `SELECT ${RUN_COLUMNS} FROM iw_scene_runs
          WHERE "userId" = $1 AND ($2::varchar IS NULL OR language = $2)
          ORDER BY "startedAt" DESC
          LIMIT $3`,
        [userId, language ?? null, Math.max(1, Math.min(200, Math.trunc(limit) || 20))]
      )
    );
    return rows.map((r) => this.toRun(r));
  }
}
