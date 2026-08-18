import { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { loadUserLayout } from './nightMarketLayoutApi';
import type { PlacedTemplate } from '../../engine/market/templateStitch';
import { buildMarketWorld, type MarketWorld } from '../../engine/market/marketWorld';
import type { TerrainField } from '../../engine/market/farmTerrain';
import { packCell, type CellId } from '../../engine/market/cellKey';

/**
 * useMarketWorld — runtime hook: load the user's persisted template LAYOUT (their placements),
 * and assemble it into the full {@link MarketWorld} (terrain + navigation graphs) the renderer
 * and pedestrian engine consume (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § useMarketWorld).
 *
 * LAYER: feature/runtime. Bridges the server layout read ({@link loadUserLayout}) to the pure
 * engine assembler ({@link buildMarketWorld}). Hands `world.terrain` to {@link ./TemplateTerrainLayer}
 * and `world.tileGraph`/`world.streetGraph` to {@link ../../hooks/usePixiPedestrians}.
 *
 * SLICE 3: the single-hub fetch is replaced by the user's real layout. The server RECOMPUTES each
 * placement's `activeVersion` from live conditions on every read (recompute-on-read — filled slots
 * + neighbor abutment), persists it when it changes, and seeds the origin hub on first load, so a
 * fresh account still returns a one-template layout.
 *
 * SLICE 4 (occupant rendering): each placement's `filledPlaceholderIds` are threaded into
 * {@link PlacedTemplate} so {@link ../../engine/market/templateStitch stitchWorld} can tag every
 * {@link PlacedPlaceholder} with `filled`. Until the real stand-asset catalog exists, a filled slot
 * is drawn as a HOUSE — or two adjacent houses for a 4×10/10×4 slot — ({@link ./PlaceholderHouseLayer})
 * as a stand-in occupant marker. The nav graphs are unchanged (the houses are decor, not stands), so
 * `buildMarketWorld` still takes no stands.
 *
 * PER-LANGUAGE MARKET (migration 130, docs/PER_LANGUAGE_STREAKS.md): each language has its own
 * continent funded by its own wallet, so the layout read is scoped to `user.selectedLanguage` and
 * switching languages legitimately reloads a DIFFERENT world. `selectedLanguage` is therefore a
 * real dependency of the load effect, not an incidental one.
 *
 * TOKEN RULE (CLAUDE.md): the load effect keys on the stable auth identity
 * (`isAuthenticated`) plus that language, NEVER on `token` — the access token rotates every
 * ~15 min and would otherwise re-fetch/reset the world on each silent refresh.
 * {@link loadUserLayout} builds its own `authHeader()` per request, so it self-heals the rotated
 * token without a dep.
 */

/**
 * A placed template reduced to just what the nmp template-bounds debug overlay needs: its
 * catalog name, live version, board offset, and board size (see
 * {@link ./MarketEngineViewer TemplateBoundsOverlay}). The full {@link PlacedTemplate.def} is
 * intentionally dropped — the overlay only draws the outline + name, not the cells.
 */
export interface TemplateBounds {
  name: string;
  activeVersion: number;
  offsetCol: number;
  offsetRow: number;
  width: number;
  height: number;
}

export interface MarketWorldState {
  /** The assembled world (terrain + tile/street graphs). */
  world: MarketWorld;
  /**
   * SPAN of the terrain-field iteration window in cells (`maxExtent − minExtent` across all
   * placements). Paired with {@link field} (its global origin + footprint membership) so
   * `buildEditorField` can paint a multi-template continent that extends in any direction —
   * including negative offsets. For a single origin hub this equals the hub's own dimensions.
   */
  width: number;
  height: number;
  /**
   * The terrain field: global origin (bbox min-corner) + footprint-union membership test. Shapes
   * the ground so it fills the real continent silhouette (and rims its outline), not just the
   * origin box. Built once per load, so its `contains` closure has stable identity for memoization.
   */
  field: TerrainField;
  /** Per-template placement bounds, for the template-bounds debug overlay. */
  placements: TemplateBounds[];
}

export interface UseMarketWorldResult {
  world: MarketWorld | null;
  width: number;
  height: number;
  /** Terrain-field origin + footprint membership (see {@link MarketWorldState.field}). */
  field: TerrainField;
  /** Per-template placement bounds (name/version/offset/size), for the template-bounds overlay. */
  placements: TemplateBounds[];
  loading: boolean;
  /** A human-readable load error (e.g. the hub template is not authored yet), or null. */
  error: string | null;
}

/** Degenerate field used before the first successful load (nothing renders until `world` exists). */
const EMPTY_FIELD: TerrainField = { originCol: 0, originRow: 0, contains: () => false };

/**
 * @param reloadToken bump this to force a re-fetch of the layout (e.g. after the author
 *   minute-adjust tool grants/decays occupants) — the world re-reads and redraws. Distinct from
 *   the auth token; this is a deliberate manual trigger, so keying the effect on it is correct
 *   (it is NOT the rotating access token the CLAUDE.md reload rule warns against).
 */
export function useMarketWorld(reloadToken = 0, visitedUserId: string | null = null): UseMarketWorldResult {
  const { isAuthenticated, user } = useAuth();
  // Which market to render. Falls back to 'zh' before the user object has loaded, matching the
  // server-side default in resolveLanguage(). `||` not `??` so a blank stored language also
  // falls back rather than requesting a market that cannot exist.
  const language: string = user?.selectedLanguage || 'zh';
  const [state, setState] = useState<MarketWorldState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `/night-market` is an `access: "any"` route (src/routes/routeMeta.ts) but the layout
    // endpoint is gated, so a signed-out visitor genuinely reaches here. RESOLVE the load state
    // rather than returning early: `loading` means "a load is in flight", and leaving it true
    // forever would strand the page's spinner (nmp renders it straight from this hook).
    if (!isAuthenticated) {
      setState(null);
      setError('Sign in to visit your night market.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // The server returns the user's persisted placements (each with its resolved
        // activeVersion + loaded definition) and seeds the origin hub on first load.
        const placements = await loadUserLayout(language, visitedUserId);
        if (cancelled) return;
        if (placements.length === 0) {
          // For the OWN-market read this should not happen (the server always seeds the
          // hub) and means something is wrong. For a VISIT it is an ordinary outcome —
          // seeding is suppressed, so a market nobody has built yet is legitimately
          // empty — hence the two different messages.
          throw new Error(
            visitedUserId
              ? "They haven't built a night market yet."
              : 'The night market has no templates to render.',
          );
        }

        const placed: PlacedTemplate[] = placements.map((p) => ({
          name: p.name,
          activeVersion: p.activeVersion,
          offsetCol: p.offsetCol,
          offsetRow: p.offsetRow,
          def: p.def,
          // Filled slots → tagged onto each PlacedPlaceholder so the occupant (house) layer draws them.
          filledPlaceholderIds: p.filledPlaceholderIds,
        }));

        // Terrain field = the UNION of every placement's footprint — a non-rectangular silhouette
        // once templates tile into an L/T, and one that can extend to NEGATIVE offsets (a template
        // spawned south/west of the origin hub). Compute the global bbox to bound iteration and a
        // membership Set so buildEditorField paints ground only inside the real continent shape.
        const minCol = Math.min(...placements.map((p) => p.offsetCol));
        const minRow = Math.min(...placements.map((p) => p.offsetRow));
        const maxCol = Math.max(...placements.map((p) => p.offsetCol + p.width));
        const maxRow = Math.max(...placements.map((p) => p.offsetRow + p.height));
        const width = maxCol - minCol;
        const height = maxRow - minRow;

        // Packed cell ids, not `"c,r"` strings: `contains` is probed ~8× per visible cell by
        // buildEditorField (membership + the 4-neighbour landmass edge + the slab-occlusion test),
        // so a string key here would allocate on every probe. See engine/market/cellKey.
        const footprint = new Set<CellId>();
        for (const p of placements) {
          for (let c = p.offsetCol; c < p.offsetCol + p.width; c++) {
            for (let r = p.offsetRow; r < p.offsetRow + p.height; r++) {
              footprint.add(packCell(c, r));
            }
          }
        }
        const field: TerrainField = {
          originCol: minCol,
          originRow: minRow,
          contains: (c, r) => footprint.has(packCell(c, r)),
        };

        // Slim per-template bounds for the template-bounds debug overlay (name/version/offset/size).
        const placementBounds: TemplateBounds[] = placements.map((p) => ({
          name: p.name,
          activeVersion: p.activeVersion,
          offsetCol: p.offsetCol,
          offsetRow: p.offsetRow,
          width: p.width,
          height: p.height,
        }));

        // No stands placed yet (occupant → stand rendering is slice 4) → empty stand list.
        setState({ world: buildMarketWorld(placed), width, height, field, placements: placementBounds });
      } catch (err) {
        if (cancelled) return;
        setState(null);
        setError(err instanceof Error ? err.message : 'Failed to load the night market');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the stable auth identity + the manual reloadToken — see the TOKEN RULE note above.
  }, [isAuthenticated, language, reloadToken, visitedUserId]);

  return {
    world: state?.world ?? null,
    width: state?.width ?? 0,
    height: state?.height ?? 0,
    field: state?.field ?? EMPTY_FIELD,
    placements: state?.placements ?? [],
    loading,
    error,
  };
}
