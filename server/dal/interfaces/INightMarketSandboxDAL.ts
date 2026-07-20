import { TemplateSandboxRow, TemplateSandboxSettings } from '../../types/nightMarket.js';

/**
 * Night Market template SANDBOX Data Access Layer interface (migration 116).
 *
 * Persistence for a template author's FREEFORM scratch layout (`nightmarkettemplatesandbox`):
 * which catalog template (by name) the author has dropped where, each in its own switchable
 * `activeVersion`. Pure CRUD — the desktop-only Template Sandbox tool
 * (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md) is the only consumer.
 *
 * Distinct from INightMarketPlacementDAL: that table (`nightmarkettemplatelocations`) is the
 * per-user RUNTIME layout driven by the unlock economy and forbids overlap; THIS table is
 * author scratch state, edited by hand, where overlaps are allowed.
 */
export interface INightMarketSandboxDAL {
  /** All of an author's sandbox placements, in chronological order (createdAt ASC). */
  findByUser(userId: string): Promise<TemplateSandboxRow[]>;

  /** Insert one placement; returns the created row (id/createdAt filled by the DB). */
  insert(
    userId: string,
    templateName: string,
    activeVersion: number,
    offsetCol: number,
    offsetRow: number,
  ): Promise<TemplateSandboxRow>;

  /**
   * Move one placement to a new SW-corner offset (drag). Scoped to `userId` so a stray/foreign
   * id can never move another author's tile, and guarded by `locked = false` so a LOCKED
   * placement can never be moved. Returns the updated row, or null if no row matched (missing,
   * foreign, or locked).
   */
  updatePosition(
    userId: string,
    id: string,
    offsetCol: number,
    offsetRow: number,
  ): Promise<TemplateSandboxRow | null>;

  /**
   * Set one placement's rendered version (the per-instance version switcher). Scoped to
   * `userId`. Returns the updated row, or null if no row matched.
   */
  updateVersion(userId: string, id: string, activeVersion: number): Promise<TemplateSandboxRow | null>;

  /**
   * Set one placement's LOCK (the move-guard toggle), scoped to `userId`. A locked placement
   * cannot be dragged/moved. Returns the updated row, or null if no row matched.
   */
  updateLock(userId: string, id: string, locked: boolean): Promise<TemplateSandboxRow | null>;

  /**
   * MERGE a partial render/view settings patch into one placement's `settings` jsonb bag
   * (migration 119), scoped to `userId`. Merge (not replace) so a one-key patch leaves the other
   * settings untouched. Returns the updated row, or null if no row matched.
   */
  updateSettings(userId: string, id: string, patch: TemplateSandboxSettings): Promise<TemplateSandboxRow | null>;

  /**
   * Delete one placement (the sandbox "Delete selected" action), scoped to `userId`. Returns
   * whether a row was removed.
   */
  deleteById(userId: string, id: string): Promise<boolean>;

  /**
   * Delete ALL of one author's placements (the sandbox "Clear" action — wipes their whole scratch
   * layout). Scoped to `userId`; never touches another author's sandbox. Returns the number of
   * rows removed (0 when the sandbox was already empty — not an error).
   */
  deleteAllForUser(userId: string): Promise<number>;

  /**
   * Delete EVERY author's sandbox placements of a template name — the catalog-delete cascade
   * (NightMarketTemplateService.deleteTemplate). Deliberately NOT scoped to a user: the catalog
   * row is global, so when it is deleted no author's placement of it can render. Returns the
   * number of rows removed.
   */
  deleteByTemplateName(templateName: string): Promise<number>;
}
