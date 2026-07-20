import { INightMarketSandboxDAL } from '../interfaces/INightMarketSandboxDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { TemplateSandboxRow, TemplateSandboxSettings } from '../../types/nightMarket.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Night Market template SANDBOX DAL (migration 116).
 *
 * Reads/writes `nightmarkettemplatesandbox` — a template author's freeform scratch layout for
 * the desktop-only Template Sandbox tool (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md). Pure
 * persistence; author-gating + coordinate validation live in NightMarketSandboxService.
 *
 * Mirrors NightMarketPlacementDAL's shape, minus the unlock-economy reads — this table is
 * hand-edited scratch state, not driven by minute points.
 */
export class NightMarketSandboxDAL implements INightMarketSandboxDAL {

  private static readonly COLS =
    'id, "userId", "templateName", "activeVersion", "offsetCol", "offsetRow", locked, settings, "createdAt"';

  async findByUser(userId: string): Promise<TemplateSandboxRow[]> {
    if (!userId) throw new ValidationError('User ID is required');

    const result = await dbManager.executeQuery<TemplateSandboxRow>(async (client) => {
      return await client.query(
        `SELECT ${NightMarketSandboxDAL.COLS}
         FROM nightmarkettemplatesandbox
         WHERE "userId" = $1
         ORDER BY "createdAt" ASC`,
        [userId],
      );
    });

    return result.recordset;
  }

  async insert(
    userId: string,
    templateName: string,
    activeVersion: number,
    offsetCol: number,
    offsetRow: number,
  ): Promise<TemplateSandboxRow> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!templateName) throw new ValidationError('Template name is required');

    const result = await dbManager.executeQuery<TemplateSandboxRow>(async (client) => {
      return await client.query(
        `INSERT INTO nightmarkettemplatesandbox
           ("userId", "templateName", "activeVersion", "offsetCol", "offsetRow")
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${NightMarketSandboxDAL.COLS}`,
        [userId, templateName, activeVersion, offsetCol, offsetRow],
      );
    });

    return result.recordset[0];
  }

  async updatePosition(
    userId: string,
    id: string,
    offsetCol: number,
    offsetRow: number,
  ): Promise<TemplateSandboxRow | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!id) throw new ValidationError('Placement ID is required');

    // `locked = false` guard: a locked placement can never be moved (server-side backstop for the
    // client's drag block). A locked or missing row returns no record → the service surfaces it.
    const result = await dbManager.executeQuery<TemplateSandboxRow>(async (client) => {
      return await client.query(
        `UPDATE nightmarkettemplatesandbox
         SET "offsetCol" = $3, "offsetRow" = $4
         WHERE "userId" = $1 AND id = $2 AND locked = false
         RETURNING ${NightMarketSandboxDAL.COLS}`,
        [userId, id, offsetCol, offsetRow],
      );
    });

    return result.recordset[0] ?? null;
  }

  async updateVersion(userId: string, id: string, activeVersion: number): Promise<TemplateSandboxRow | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!id) throw new ValidationError('Placement ID is required');

    const result = await dbManager.executeQuery<TemplateSandboxRow>(async (client) => {
      return await client.query(
        `UPDATE nightmarkettemplatesandbox
         SET "activeVersion" = $3
         WHERE "userId" = $1 AND id = $2
         RETURNING ${NightMarketSandboxDAL.COLS}`,
        [userId, id, activeVersion],
      );
    });

    return result.recordset[0] ?? null;
  }

  async updateLock(userId: string, id: string, locked: boolean): Promise<TemplateSandboxRow | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!id) throw new ValidationError('Placement ID is required');

    const result = await dbManager.executeQuery<TemplateSandboxRow>(async (client) => {
      return await client.query(
        `UPDATE nightmarkettemplatesandbox
         SET locked = $3
         WHERE "userId" = $1 AND id = $2
         RETURNING ${NightMarketSandboxDAL.COLS}`,
        [userId, id, locked],
      );
    });

    return result.recordset[0] ?? null;
  }

  async updateSettings(
    userId: string,
    id: string,
    patch: TemplateSandboxSettings,
  ): Promise<TemplateSandboxRow | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!id) throw new ValidationError('Placement ID is required');

    // MERGE (`||`) rather than replace, so a partial patch never drops the other settings keys.
    const result = await dbManager.executeQuery<TemplateSandboxRow>(async (client) => {
      return await client.query(
        `UPDATE nightmarkettemplatesandbox
         SET settings = settings || $3::jsonb
         WHERE "userId" = $1 AND id = $2
         RETURNING ${NightMarketSandboxDAL.COLS}`,
        [userId, id, JSON.stringify(patch)],
      );
    });

    return result.recordset[0] ?? null;
  }

  async deleteById(userId: string, id: string): Promise<boolean> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!id) throw new ValidationError('Placement ID is required');

    const result = await dbManager.executeQuery(async (client) => {
      return await client.query(
        'DELETE FROM nightmarkettemplatesandbox WHERE "userId" = $1 AND id = $2',
        [userId, id],
      );
    });

    return result.rowsAffected > 0;
  }

  async deleteByTemplateName(templateName: string): Promise<number> {
    if (!templateName) throw new ValidationError('Template name is required');

    // Deliberately NOT scoped to a user: the catalog template is global, so deleting it removes
    // every author's sandbox placement of that name.
    const result = await dbManager.executeQuery(async (client) => {
      return await client.query(
        'DELETE FROM nightmarkettemplatesandbox WHERE "templateName" = $1',
        [templateName],
      );
    });

    return result.rowsAffected;
  }
}
