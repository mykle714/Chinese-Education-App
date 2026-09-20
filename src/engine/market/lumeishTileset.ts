/**
 * lumeishTileset — asset registry + lookup helpers for the NORMALIZED `lumeish`
 * furniture pack (`src/assets/test-assets/lumeish-normalized/`).
 *
 * LAYER: pure asset/lookup layer, exactly like {@link ./freeFarmTileset}. It resolves
 * *which sprite URL* to draw and *how many tiles that sprite covers*. It does NOT
 * render, animate, or apply the isometric transform — callers own the draw loop.
 *
 * WHY A SECOND TILESET MODULE
 * The two packs disagree on everything except geometry. `free-farm-assets` is
 * name-addressed (`plank_ew_2_center`), exterior, authored on a fixed 32x32 cell with a
 * documented skirt convention. `lumeish` is id-addressed (`1.png` … `151.png`),
 * interior furniture, and was authored TIGHTLY CROPPED at ~60 distinct pixel sizes.
 * Folding it into `FreeFarmTileset` would mean teaching that class two naming schemes
 * and two anchor rules, so it gets its own registry with the same public shape.
 *
 * WHAT MAKES IT ENGINE-COMPATIBLE
 * The pack shares the engine's projection and pitch — 2:1 dimetric on a 32x16 diamond
 * (see {@link ./isometric}) — so the only mismatch was the crop. `scripts/normalize-lumeish.mjs`
 * re-cuts every sprite onto a whole number of 32x32 cells and emits `manifest.json`;
 * this module is the runtime half of that pipeline and reads only the normalized output.
 *
 * ⚠️ PLACEMENT IS DELIBERATELY APPROXIMATE. The normalizer CENTERS each sprite in its
 * padded box rather than seating it on the tile's diamond, so objects render slightly
 * high — accepted for a test pack. Each sprite's true foot is recorded as
 * {@link LumeishSprite.baseRow}, so the fix is a normalizer change plus a draw-offset
 * here, with no re-cutting of art. See docs/LUMEISH_ASSET_PIPELINE.md.
 *
 * ⚠️ STYLE, NOT GEOMETRY, IS THE REAL MISMATCH. The two packs share ZERO exact colours
 * (farm: 132 colours, mean saturation 0.62; lumeish: 67 colours on Lospec's
 * ARCHIMEDES 64, mean saturation 0.27). Mixing them in one scene reads as two games.
 * That is fine for the current test/eval use and is called out here so it is a choice
 * rather than a surprise.
 *
 * ASSET IMPORTS. Both the sprite glob and the manifest reach into `src/assets/`, which
 * `src/engine/__tests__/enginePurity.test.ts` allows under its narrow asset carve-out
 * (`isAllowedAssetRef`): data files only, one directory, no code. Do not widen that.
 *
 * Referenced by docs: docs/LUMEISH_ASSET_PIPELINE.md — update its "Runtime registry"
 * section if this module's lookup semantics change.
 */

import { TILE_WIDTH, type StripPlacement } from './isometric';
import {
  propAnchorFraction,
  propFootprint,
  propStrips,
  type CellFootprint,
  type CellSpan,
  type PropArt,
} from './footprint';
import manifestJson from '../../assets/test-assets/lumeish-normalized/manifest.json';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A sprite's footprint in whole 32x32 cells: `[cellsWide, cellsTall]`. */
export type LumeishFootprint = readonly [number, number];

/** One normalized sprite, joined from the manifest entry and the Vite-resolved URL. */
export interface LumeishSprite {
  /** Numeric id from the source pack filename (`57.png` -> 57). Stable across re-runs. */
  readonly id: number;
  /** Fingerprinted asset URL of the NORMALIZED png, ready to hand to a texture loader. */
  readonly url: string;
  /** Padded canvas footprint in cells; multiply by {@link LUMEISH_CELL_PX} for pixels. */
  readonly cells: LumeishFootprint;
  /** Original tightly-cropped source size in px, before padding (debug/provenance). */
  readonly srcSize: readonly [number, number];
  /** Where the source art's top-left corner was placed inside the padded canvas. */
  readonly offset: readonly [number, number];
  /**
   * ISO FOOTPRINT — how many cells this prop OCCUPIES, `w` along isoX × `h` along isoY.
   *
   * Not to be confused with {@link cells}, which is the padded PIXEL box. The two are
   * different measurements and routinely disagree: a 2×1 padded canvas is 64×32 px, but in a
   * 2:1 projection that width is spanned by a 1×1 diamond plus overhang as easily as by a
   * 2×1 one. The normalizer derives this from the base diamond's geometry; see
   * docs/LUMEISH_ASSET_PIPELINE.md § "Multi-cell occupancy".
   */
  readonly isoSpan: CellSpan;
  /**
   * The base diamond's south vertex in PADDED canvas px — the point that seats on the foot
   * cell's front vertex. This is what makes placement accurate despite the loose centered
   * padding, and it is the same convention `House.png` uses (`HOUSE_BASE_CORNER`).
   */
  readonly anchorTex: { readonly x: number; readonly y: number };
  /**
   * The raw `[leftReach, rightReach]` px measurement {@link isoSpan} was rounded from, kept
   * for auditing: a surprising span can be checked (and hand-corrected in the manifest)
   * without re-deriving it from pixels.
   */
  readonly reachPx: readonly [number, number];
  /**
   * The canonical (lower-id) sprite this one is the opposite facing of, or `null` if
   * this sprite IS the canonical one / has no pair.
   *
   * The pair shares a mirrored silhouette but is INDEPENDENTLY SHADED — do NOT render
   * one facing by flipping the other (`scale.x = -1`), or the light lands on the wrong
   * face. Swap to the sibling's URL instead; see {@link facingSibling}.
   */
  readonly mirrorOf: number | null;
}

/** Cell size of the normalized pack in source px. Asserted equal to `TILE_WIDTH`. */
export const LUMEISH_CELL_PX = manifestJson.cellPx;

// The whole pipeline exists to put this pack on the engine's tile pitch; if the two ever
// disagree, every footprint in the manifest is silently wrong. Fail loudly at module load
// rather than shipping subtly misaligned furniture.
if (LUMEISH_CELL_PX !== TILE_WIDTH) {
  throw new Error(
    `lumeishTileset: manifest cellPx (${LUMEISH_CELL_PX}) !== engine TILE_WIDTH (${TILE_WIDTH}). ` +
      'Re-run scripts/normalize-lumeish.mjs after changing the tile pitch.',
  );
}

// ---------------------------------------------------------------------------
// Raw asset load (Vite): path -> url. Eager so the map is ready synchronously,
// matching freeFarmTileset's approach (and its justification: ~150 files).
// ---------------------------------------------------------------------------

const RAW: Record<string, string> = import.meta.glob(
  '../../assets/test-assets/lumeish-normalized/*.png',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

/** basename of a glob key, e.g. ".../057.png" -> "057.png". */
function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// ---------------------------------------------------------------------------
// LumeishTileset
// ---------------------------------------------------------------------------

export class LumeishTileset {
  /** Every sprite, keyed by numeric id — the primary lookup. */
  private readonly byId = new Map<number, LumeishSprite>();

  /** Reverse of {@link byId}: fingerprinted url -> id (for debug labels / hit-testing). */
  private readonly idByUrl = new Map<string, number>();

  /** Canonical sprites only (one per facing pair) in manifest order — for picker UIs. */
  private readonly canonicalIds: number[] = [];

  /** id -> the OTHER facing's id, populated in both directions. */
  private readonly siblingById = new Map<number, number>();

  /** Memoised {@link strips} results, keyed `"id:flip"`. Built lazily — most props are 1×1. */
  private readonly stripCache = new Map<string, StripPlacement[]>();

  constructor(raw: Record<string, string> = RAW, manifest = manifestJson) {
    const urlByFile = new Map<string, string>();
    for (const [path, url] of Object.entries(raw)) urlByFile.set(basename(path), url);

    for (const entry of manifest.sprites) {
      const url = urlByFile.get(entry.file);
      // A manifest row with no file on disk means the normalized folder is stale (the
      // script was not re-run, or output was partially deleted). Skip rather than throw
      // so one missing sprite cannot black out the whole scene, but say so once.
      if (!url) {
        console.warn(
          `[lumeishTileset] manifest lists ${entry.file} but no such asset was globbed — ` +
            're-run scripts/normalize-lumeish.mjs.',
        );
        continue;
      }

      const sprite: LumeishSprite = {
        id: entry.id,
        url,
        cells: [entry.cells[0], entry.cells[1]] as const,
        srcSize: [entry.src[0], entry.src[1]] as const,
        offset: [entry.offset[0], entry.offset[1]] as const,
        isoSpan: { w: entry.isoSpan[0], h: entry.isoSpan[1] },
        anchorTex: { x: entry.anchorTex[0], y: entry.anchorTex[1] },
        reachPx: [entry.reachPx[0], entry.reachPx[1]] as const,
        mirrorOf: entry.mirrorOf,
      };
      this.byId.set(sprite.id, sprite);
      this.idByUrl.set(url, sprite.id);

      if (sprite.mirrorOf === null) {
        this.canonicalIds.push(sprite.id);
      } else {
        // Record the pairing from both ends so `facingSibling` works on either id.
        this.siblingById.set(sprite.id, sprite.mirrorOf);
        this.siblingById.set(sprite.mirrorOf, sprite.id);
      }
    }
  }

  // --- primary lookups ----------------------------------------------------

  /** The normalized sprite URL for an id, or `undefined` if the pack has no such id. */
  get(id: number): string | undefined {
    return this.byId.get(id)?.url;
  }

  /** The full record for an id (footprint, foot row, pairing), or `undefined`. */
  sprite(id: number): LumeishSprite | undefined {
    return this.byId.get(id);
  }

  /** Every sprite in manifest order. */
  all(): LumeishSprite[] {
    return [...this.byId.values()];
  }

  /** Every sprite id. */
  ids(): number[] {
    return [...this.byId.keys()];
  }

  /**
   * One sprite per object — the canonical facing of each mirrored pair, plus every
   * unpaired sprite. This is what a placement palette should list; showing `all()`
   * shows each sofa twice.
   */
  canonical(): LumeishSprite[] {
    return this.canonicalIds
      .map((id) => this.byId.get(id))
      .filter((s): s is LumeishSprite => s !== undefined);
  }

  /**
   * The opposite-facing sprite of `id`, or `undefined` if the pack ships only one facing.
   * Use this to turn an object around — never a horizontal flip (see {@link LumeishSprite.mirrorOf}).
   */
  facingSibling(id: number): LumeishSprite | undefined {
    const siblingId = this.siblingById.get(id);
    return siblingId === undefined ? undefined : this.byId.get(siblingId);
  }

  // --- geometry -----------------------------------------------------------

  /** Padded PIXEL box in cells, defaulting to a single cell for an unknown id. */
  paddedCells(id: number): LumeishFootprint {
    return this.byId.get(id)?.cells ?? ([1, 1] as const);
  }

  /** Padded pixel size of a sprite's canvas — `paddedCells * LUMEISH_CELL_PX`. */
  pixelSize(id: number): readonly [number, number] {
    const [w, h] = this.paddedCells(id);
    return [w * LUMEISH_CELL_PX, h * LUMEISH_CELL_PX] as const;
  }

  /** Iso footprint span in cells (occupancy), defaulting to 1×1 for an unknown id. */
  span(id: number): CellSpan {
    return this.byId.get(id)?.isoSpan ?? { w: 1, h: 1 };
  }

  /**
   * This sprite as a generic {@link PropArt} — the SAME description `house.ts` builds for
   * `House.png`, so furniture flows through the shared placement/occupancy/depth system in
   * {@link ./footprint} rather than a lumeish-specific path.
   */
  art(id: number): PropArt | undefined {
    const sprite = this.byId.get(id);
    if (!sprite) return undefined;
    const [texW, texH] = this.pixelSize(id);
    return { texW, texH, anchorTex: sprite.anchorTex, span: sprite.isoSpan };
  }

  /**
   * The cells this sprite occupies when placed at (col,row). `flip` transposes the span, as
   * a horizontal mirror must — note that the pack ships both facings as separate art, so a
   * flip here is about the FOOTPRINT of the sibling sprite, not about mirroring pixels.
   */
  footprintAt(id: number, col: number, row: number, flip = false): CellFootprint {
    const art = this.art(id);
    return art
      ? propFootprint(art, col, row, flip)
      : { col, row, w: 1, h: 1 };
  }

  /** Pixi anchor fraction seating {@link LumeishSprite.anchorTex} at the sprite's position. */
  anchorFraction(id: number): { x: number; y: number } {
    const art = this.art(id);
    return art ? propAnchorFraction(art) : { x: 0.5, y: 1 };
  }

  /**
   * Per-screen-column depth strips for this sprite, relative to a foot cell at (0,0).
   *
   * Only props wider than one cell actually need slicing, but this returns strips for every
   * sprite so a renderer has one code path. Memoised because the result is a pure function of
   * the art and a renderer would otherwise recompute it every frame.
   */
  strips(id: number, flip = false): StripPlacement[] {
    const key = `${id}:${flip ? 1 : 0}`;
    const cached = this.stripCache.get(key);
    if (cached) return cached;
    const art = this.art(id);
    const built = art ? propStrips(art, flip) : [];
    this.stripCache.set(key, built);
    return built;
  }

  // --- debug --------------------------------------------------------------

  /** Reverse lookup: the sprite id for a resolved (fingerprinted) url. */
  idOf(url: string): number | undefined {
    return this.idByUrl.get(url);
  }
}

/** Shared singleton — the pack is static content, so one instance is enough. */
export const lumeishTileset = new LumeishTileset();
