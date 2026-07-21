import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { INightMarketSandboxDAL } from '../dal/interfaces/INightMarketSandboxDAL.js';
import { TemplateSandboxRow, TemplateSandboxSettings } from '../types/nightMarket.js';
import { DALError, NotFoundError, ValidationError } from '../types/dal.js';
import { NightMarketPlacementService } from './NightMarketPlacementService.js';
import { NIGHT_MARKET_HUB_TEMPLATE_NAME } from './NightMarketTemplateService.js';

/**
 * Night Market template SANDBOX service — business logic for the desktop-only Template Sandbox
 * tool (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md), where a TEMPLATE AUTHOR freely tiles catalog
 * templates to preview how they compose.
 *
 * LAYER: service layer. Every operation is TEMPLATE-AUTHOR-gated (users.isTemplateAuthor —
 * migration 115, the same grant that gates the template editor), mirroring
 * NightMarketTemplateService.assertTemplateAuthor. Persists to `nightmarkettemplatesandbox`
 * (migration 116) via INightMarketSandboxDAL.
 *
 * This is scratch state only — unrelated to the per-user unlock economy
 * (NightMarketPlacementService). Rows are added / moved / version-switched / deleted by hand;
 * nothing grants or decays them. Offsets are FREEFORM (overlaps allowed) and stored as the
 * template's SW-corner offset in template-cell units.
 *
 * Depends on: migration 116, IUserDAL.findById (author gate), INightMarketSandboxDAL.
 */
/** One whitelisted `settings` key: its JS type, plus the allowed values when it is an enum. */
interface SettingSpec {
  type: 'boolean' | 'string' | 'number';
  values?: readonly string[];
}

export class NightMarketSandboxService {
  constructor(
    private readonly sandboxDAL: INightMarketSandboxDAL,
    private readonly userDAL: IUserDAL,
    /** The live growth algorithm, reused verbatim by {@link iteratePlacement}. */
    private readonly placementService: NightMarketPlacementService,
  ) {}

  /** Throw unless the user exists and is a template author (403). Mirrors the template service. */
  private async assertTemplateAuthor(userId: string): Promise<void> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isTemplateAuthor) {
      throw new DALError(
        'Only template authors can use the Night Market template sandbox',
        'ERR_FORBIDDEN',
        403,
      );
    }
  }

  /** Validate a non-empty template name within the catalog's length cap. */
  private cleanTemplateName(name: unknown): string {
    if (typeof name !== 'string') throw new ValidationError('Template name is required');
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new ValidationError('Template name is required');
    if (trimmed.length > 120) throw new ValidationError('Template name must be ≤ 120 characters');
    return trimmed;
  }

  /** Validate a non-negative integer version. */
  private cleanVersion(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new ValidationError('Version must be a non-negative integer');
    }
    return value;
  }

  /**
   * Validate an offset coordinate: an integer within a generous sandbox bound. The sandbox is a
   * scratch surface, so the bound is only a sanity clamp against absurd values, not a placement
   * rule (offsets can be negative — the SW corner may sit anywhere around the origin).
   */
  private cleanOffset(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new ValidationError(`Sandbox ${label} must be an integer`);
    }
    if (value < -10000 || value > 10000) {
      throw new ValidationError(`Sandbox ${label} is out of range`);
    }
    return value;
  }

  /** All of an author's sandbox placements (author-gated). */
  async listPlacements(userId: string): Promise<TemplateSandboxRow[]> {
    await this.assertTemplateAuthor(userId);
    return this.sandboxDAL.findByUser(userId);
  }

  /** Add one placement to the author's sandbox (author-gated). Returns the created row. */
  async addPlacement(
    userId: string,
    input: { templateName: unknown; activeVersion: unknown; offsetCol: unknown; offsetRow: unknown },
  ): Promise<TemplateSandboxRow> {
    await this.assertTemplateAuthor(userId);
    const templateName = this.cleanTemplateName(input.templateName);
    const activeVersion = this.cleanVersion(input.activeVersion);
    const offsetCol = this.cleanOffset(input.offsetCol, 'offsetCol');
    const offsetRow = this.cleanOffset(input.offsetRow, 'offsetRow');
    return this.sandboxDAL.insert(userId, templateName, activeVersion, offsetCol, offsetRow);
  }

  /**
   * ITERATE — step the REAL runtime growth algorithm once over the author's sandbox layout and
   * persist whatever it would have placed (the sandbox's "what would the game do here?" button).
   *
   * Delegates the geometry to {@link NightMarketPlacementService.planNextPlacement}, the very same
   * planner the live continent grows with (docs/NIGHT_MARKET_TEMPLATES.md § "Placement algorithm"),
   * so the sandbox preview can never drift from production behaviour.
   *
   * Iterated placements are inserted LOCKED (unlike hand-dropped ones): the position is the
   * algorithm's answer, and a stray drag would silently turn the preview into a hand-made layout
   * that the next Iterate then plans against. The author can still unlock with L to move it.
   *
   * Two cases:
   *   • EMPTY sandbox → there are no exposed anchors to attach to, so seed the starter hub at the
   *     origin, exactly as NightMarketWorldService.seedHubPlacement does for a new account.
   *   • otherwise → run the planner; `null` (no legal candidate at any anchor) surfaces to the
   *     client as a "nothing fits" message rather than an error.
   *
   * The placement is stored at the version the planner CHOSE (its most-conditioned candidate
   * version). That differs from the runtime, which persists activeVersion 0 and lets
   * recompute-on-read settle the version — the sandbox has no version selector pass, so keeping the
   * planner's version is what makes the result visible and inspectable here.
   */
  async iteratePlacement(userId: string): Promise<{ placement: TemplateSandboxRow | null; trace: string[] }> {
    await this.assertTemplateAuthor(userId);
    const placements = await this.sandboxDAL.findByUser(userId);

    if (placements.length === 0) {
      const placement = await this.sandboxDAL.insert(userId, NIGHT_MARKET_HUB_TEMPLATE_NAME, 0, 0, 0, true);
      return { placement, trace: ['seeded the starter hub at the origin (empty sandbox — no anchors to plan against)'] };
    }

    // `trace: true` — Iterate is an AUTHORING tool, so it collects the planner's full decision log
    // (anchor queue in visit order, per-anchor candidate counts, per-candidate rejection reasons,
    // tiebreak scores). The lines go to the server console AND ride back to the client, which
    // replays them into the browser console — the author is looking at the scene, not the server.
    // The live growth path leaves tracing off.
    const { plan, trace } = await this.placementService.planNextPlacement(placements, undefined, { trace: true });
    if (!plan) return { placement: null, trace };
    const placement = await this.sandboxDAL.insert(userId, plan.templateName, plan.version, plan.offsetCol, plan.offsetRow, true);
    return { placement, trace };
  }

  /** Move one placement to a new SW-corner offset (drag). 404 if it is not the author's. */
  async movePlacement(
    userId: string,
    id: string,
    input: { offsetCol: unknown; offsetRow: unknown },
  ): Promise<TemplateSandboxRow> {
    await this.assertTemplateAuthor(userId);
    const offsetCol = this.cleanOffset(input.offsetCol, 'offsetCol');
    const offsetRow = this.cleanOffset(input.offsetRow, 'offsetRow');
    // Null = missing, foreign, OR locked (the DAL guards `locked = false`). The client blocks
    // dragging a locked tile, so this is a backstop; surface a clear message either way.
    const row = await this.sandboxDAL.updatePosition(userId, id, offsetCol, offsetRow);
    if (!row) throw new NotFoundError('Sandbox placement not found or is locked');
    return row;
  }

  /** Lock / unlock one placement (the move-guard toggle). 404 if it is not the author's. */
  async setPlacementLock(userId: string, id: string, locked: unknown): Promise<TemplateSandboxRow> {
    await this.assertTemplateAuthor(userId);
    if (typeof locked !== 'boolean') throw new ValidationError('locked must be a boolean');
    const row = await this.sandboxDAL.updateLock(userId, id, locked);
    if (!row) throw new NotFoundError('Sandbox placement not found');
    return row;
  }

  /**
   * Whitelist of `settings` keys and their expected types (migration 119). The bag is generic so
   * new author-facing render switches need no migration, but it is NOT free-form: an unknown key
   * is rejected here so a client typo can never silently persist dead state.
   */
  private static readonly SETTINGS_SCHEMA: Record<keyof TemplateSandboxSettings, SettingSpec> = {
    houseMode: { type: 'string', values: ['all', 'placeholder', 'none'] },
  };

  /** Validate a partial settings patch against {@link SETTINGS_SCHEMA}. */
  private cleanSettings(value: unknown): TemplateSandboxSettings {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ValidationError('settings must be an object');
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) throw new ValidationError('settings patch must contain at least one key');
    const schema = NightMarketSandboxService.SETTINGS_SCHEMA as Record<string, SettingSpec | undefined>;
    for (const [key, val] of entries) {
      const spec = schema[key];
      if (!spec) throw new ValidationError(`Unknown sandbox setting "${key}"`);
      if (typeof val !== spec.type) throw new ValidationError(`Sandbox setting "${key}" must be a ${spec.type}`);
      // Enum-valued settings additionally check membership, so an unknown mode can never reach
      // the client renderer (which would silently fall back and hide the author's mistake).
      if (spec.values && !spec.values.includes(val as string)) {
        throw new ValidationError(`Sandbox setting "${key}" must be one of: ${spec.values.join(', ')}`);
      }
    }
    return value as TemplateSandboxSettings;
  }

  /**
   * Merge a partial render/view settings patch into one placement's `settings` bag (e.g.
   * `{ houseMode: 'none' }`). 404 if it is not the author's.
   */
  async setPlacementSettings(userId: string, id: string, settings: unknown): Promise<TemplateSandboxRow> {
    await this.assertTemplateAuthor(userId);
    const patch = this.cleanSettings(settings);
    const row = await this.sandboxDAL.updateSettings(userId, id, patch);
    if (!row) throw new NotFoundError('Sandbox placement not found');
    return row;
  }

  /** Set one placement's rendered version (the per-instance switcher). 404 if not the author's. */
  async setPlacementVersion(userId: string, id: string, activeVersion: unknown): Promise<TemplateSandboxRow> {
    await this.assertTemplateAuthor(userId);
    const ver = this.cleanVersion(activeVersion);
    const row = await this.sandboxDAL.updateVersion(userId, id, ver);
    if (!row) throw new NotFoundError('Sandbox placement not found');
    return row;
  }

  /** Delete one placement (the "Delete selected" action). 404 if not the author's. */
  async removePlacement(userId: string, id: string): Promise<void> {
    await this.assertTemplateAuthor(userId);
    const deleted = await this.sandboxDAL.deleteById(userId, id);
    if (!deleted) throw new NotFoundError('Sandbox placement not found');
  }

  /**
   * Clear the caller's whole sandbox (the "Clear" action). Author-gated like every other write.
   * An already-empty sandbox is a no-op success (returns 0) — clearing is idempotent.
   */
  async clearPlacements(userId: string): Promise<number> {
    await this.assertTemplateAuthor(userId);
    return this.sandboxDAL.deleteAllForUser(userId);
  }

  /**
   * Delete EVERY author's sandbox placements of a template name. Called by
   * NightMarketTemplateService.deleteTemplate when a template is removed from the catalog (the
   * catalog row is global, so a placement of it can no longer render). NOT author-gated on its
   * own — the caller already gated the catalog delete. Returns the number of rows removed.
   */
  async removePlacementsForTemplate(templateName: string): Promise<number> {
    return this.sandboxDAL.deleteByTemplateName(templateName);
  }
}
