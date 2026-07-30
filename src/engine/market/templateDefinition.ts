import type { PlaceholderArea } from './placeholderArea';

/**
 * The serialized `definition` shape stored on a night-market template row.
 *
 * ── Why this lives in the engine, not in the feature ──────────────────────────
 * This is the engine's INPUT contract: `templateStitch` (and the pedestrian /
 * street-recovery tests) consume a definition to build a world, and they must not
 * depend on the authoring UI that happens to produce one. It used to be declared in
 * `src/features/nightmarket/templateEditorApi.ts`, which made `src/engine/` import
 * from `src/features/` — a layering inversion, since every other edge runs
 * feature → engine. See docs/ARCHITECTURE_REVIEW.md finding 9.
 *
 * `templateEditorApi.ts` re-exports this type, so the feature-side import path is
 * unchanged for its own callers.
 *
 * Referenced by: engine/market/templateStitch.ts, engine/market/__tests__/
 * pedestrianSim.test.ts + streetRecovery.test.ts, features/nightmarket/
 * templateEditorApi.ts + nightMarketLayoutApi.ts.
 * Documented in docs/NIGHT_MARKET_TEMPLATES.md.
 */
export interface TemplateDefinitionPayload {
  /** Terrain-1 mask cells (currently rendered as light grass). */
  terrain1: string[];
  /** Terrain-2 mask cells (currently rendered as dark grass, over terrain 1). */
  terrain2: string[];
  /** Street-walkable cells — a walkability class, rendered as a spriteless tint. */
  street: string[];
  /** Communal-walkable cells (parks/plazas) — a walkability class, no sprite. */
  communal: string[];
  /**
   * Placeholder AREAS (occupant slots) — fixed-size dropped rectangles ({col,row,w,h}), an
   * override overlay with no sprite. Shared across versions (owned by version 0). Legacy rows
   * stored a flat `string[]` cell mask; those load as NO areas (must be re-dropped — see
   * definitionToMasks).
   */
  placeholder: PlaceholderArea[];
  /** Condition-mask cells — a per-version override overlay, no sprite. */
  condition: string[];
  decor: Record<string, string>;
}
