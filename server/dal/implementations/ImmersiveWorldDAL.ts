import type { PoolClient } from 'pg';
import type { IImmersiveWorldDAL, IWNpcReference } from '../interfaces/IImmersiveWorldDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import type { IWScene, IWSceneSummary } from '../../contracts/iw.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Persists the Immersive World scene catalog (`iw_scenes`, migration 158).
 *
 * WHY EVERY WRITE IS A WHOLE ROW. A scene is authored whole and read whole — that property
 * is what collapsed the five originally-approved child tables into five jsonb columns
 * (migration 158's header). Save therefore replaces every column, and there is no
 * per-blob update method to drift from the editor's model.
 *
 * SCENES ARE NOT USER DATA. There is no `createdBy` and no per-user scoping: authors are
 * staff (§ 14 Q2), and the gate is a permission check in the service, not a row filter.
 *
 * See docs/IMMERSIVE_WORLD.md § 8, § 12 phase 1d.
 */

/** Every column of an `iw_scenes` row, in the order the row type expects. */
const SCENE_COLUMNS = `id, language, name, published,
  "completerNpcId", "completionAction",
  "playerStartCol", "playerStartRow", "playerStartFacing",
  "companionStartCol", "companionStartRow", "companionStartFacing",
  width, height,
  layout, "npcCast", complications, conversations,
  "createdAt", "updatedAt"`;

/** The scene as Postgres hands it back — jsonb arrives parsed, timestamps as Date. */
interface SceneRow {
  id: string;
  language: 'zh' | 'es';
  name: string;
  published: boolean;
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
  conversations: unknown;
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
      conversations: (row.conversations as IWScene['conversations']) ?? [],
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
      JSON.stringify(scene.conversations ?? []),
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
           language, name, published,
           "completerNpcId", "completionAction",
           "playerStartCol", "playerStartRow", "playerStartFacing",
           "companionStartCol", "companionStartRow", "companionStartFacing",
           width, height,
           layout, "npcCast", complications, conversations
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
           language = $2, name = $3, published = $4,
           "completerNpcId" = $5, "completionAction" = $6,
           "playerStartCol" = $7, "playerStartRow" = $8, "playerStartFacing" = $9,
           "companionStartCol" = $10, "companionStartRow" = $11, "companionStartFacing" = $12,
           width = $13, height = $14,
           layout = $15, "npcCast" = $16, complications = $17, conversations = $18,
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
}
