import { memo, useMemo } from 'react';
import { buildEditorField, compileMasks, padTerrainField, type TerrainField } from '../../engine/market/farmTerrain';
import { stitchedToEditorMasks, type StitchedWorld } from '../../engine/market/templateStitch';
import type { CellWindow } from '../../engine/market/isometric';
import EditorTerrainLayer from './EditorTerrainLayer';
import TerrainChunkLayer from './TerrainChunkLayer';
import { isChunkBakingActive } from '../../engine/market/chunkGrid';

/**
 * TemplateTerrainLayer — the RUNTIME terrain renderer for a stitched template world
 * (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § TemplateTerrainLayer).
 *
 * LAYER: view. It is deliberately THIN: it adapts a {@link StitchedWorld} into the
 * {@link EditorMasks} → {@link buildEditorField} pipeline the editor already uses, then
 * delegates the actual sprite emission (dirt slab + light/dark grass caps + decor) to
 * {@link EditorTerrainLayer}. This reuses the editor's exact autotiling and z-sorting
 * rather than duplicating it — the two surfaces stay pixel-identical by construction.
 *
 * MULTI-TEMPLATE FIELD: `width`/`height` are the continent bbox SPAN and {@link field} carries
 * its global origin (bbox min-corner) + footprint-union membership, so the ground paints across
 * the whole continent — including templates spawned at NEGATIVE offsets — and rims the real
 * (possibly L/T-shaped) silhouette rather than just the origin box. (See {@link ./useMarketWorld}
 * where the field is built.)
 *
 * DEFAULT GROUND APRON: the field is padded outward by `apronPad` cells of default ground (tallDirt
 * + lightGrass) so the market's edge tiles autotile against ground rather than drawing a plateau
 * cliff. The pad is a small RING — everything past it is the flat
 * {@link ./GroundBackdropLayer}, which fills the rest of the viewport with the same motif for the
 * cost of one quad. The ring's membership is `boundless` (ground continues forever as far as the
 * autotiler is concerned), so no cliff appears at the ring's own edge either.
 *
 * ⚠️ The ring must stay SMALL. Sizing the pad to the camera's full zoomed-out reach instead (the
 * first cut of this feature) meant ~200×200 cells and 40k+ sprites, which made nmp unusable.
 * `cullWindow` additionally bounds iteration for markets large enough to exceed the viewport.
 */
function TemplateTerrainLayer({
  world,
  width,
  height,
  field,
  apronPad = 0,
  cullWindow,
  chunked = false,
  camera,
}: {
  world: StitchedWorld;
  width: number;
  height: number;
  field: TerrainField;
  /** Cells of default ground to ring the market with. 0 ⇒ pre-apron behavior (silhouette only). */
  apronPad?: number;
  /** Visible cell window; omitted ⇒ build the whole (padded) field. */
  cullWindow?: CellWindow;
  /**
   * Route GROUND through the baked chunk cache instead of per-cell sprites
   * (docs/NIGHT_MARKET_TERRAIN_CHUNKING.md). Requires {@link camera}.
   *
   * OFF by default. This is a throughput change with a visual failure mode that
   * no automated check can see (chunk seams), so it ships behind the nmp debug
   * menu until it has been eyeballed at several zoom levels.
   */
  chunked?: boolean;
  /** Camera state, needed only by the chunk cache to decide which chunks are resident. */
  camera?: { zoom: number; pan: { x: number; y: number }; viewportW: number; viewportH: number };
}) {
  // Masks are per-WORLD, so they survive pan/zoom. Split from the tile build below so dragging the
  // camera does not re-stitch the template masks — only the windowed tile list is rebuilt.
  // Compiled to packed cell ids in the SAME memo: the tile build probes these ~20–25× per visible
  // cell, so it must never see the string-keyed form (see farmTerrain § CompiledMasks).
  const masks = useMemo(() => compileMasks(stitchedToEditorMasks(world)), [world]);

  // `boundless`: membership is infinite (so the ring's outer cells autotile as interior ground),
  // while the returned span keeps iteration to the ring. The backdrop covers everything beyond.
  const padded = useMemo(
    () => padTerrainField(field, width, height, apronPad, true),
    [field, width, height, apronPad],
  );

  const tiles = useMemo(
    () => buildEditorField(padded.width, padded.height, masks, padded.field, cullWindow),
    // Keyed on the window's NUMBERS: visibleCellWindow returns a fresh object each call, and it is
    // already quantised, so this rebuilds every few cells of travel rather than every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [padded, masks, cullWindow?.minCol, cullWindow?.maxCol, cullWindow?.minRow, cullWindow?.maxRow],
  );

  // Baked path: ground comes from the chunk cache (one quad per 256px chunk), and
  // only the tall decor stays as per-cell sprites so it can still sort against
  // pedestrians. See TerrainChunkLayer's header for why the split is necessary.
  //
  // The chunk layer no-ops above native zoom, so `part="decor"` alone would leave
  // the ground missing when the camera is close — hence BOTH parts render live
  // there. `TerrainChunkLayer` owns that threshold; this just mirrors it.
  if (chunked && camera) {
    const baking = isChunkBakingActive(camera.zoom);
    return (
      <>
        <TerrainChunkLayer
          masks={masks}
          fieldWidth={padded.width}
          fieldHeight={padded.height}
          field={padded.field}
          zoom={camera.zoom}
          pan={camera.pan}
          viewportW={camera.viewportW}
          viewportH={camera.viewportH}
        />
        <EditorTerrainLayer tiles={tiles} part={baking ? 'decor' : 'all'} />
      </>
    );
  }

  return <EditorTerrainLayer tiles={tiles} />;
}

/** Memoised: the terrain below is the app's most expensive subtree, and nmp's scene re-renders on
 *  every pan (and once per frame while a pedestrian camera lock is active). `cullWindow` is
 *  quantised so its identity changes rarely. */
export default memo(TemplateTerrainLayer);
