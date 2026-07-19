import { useMemo } from 'react';
import { buildEditorField, type TerrainField } from '../../engine/market/farmTerrain';
import { stitchedToEditorMasks, type StitchedWorld } from '../../engine/market/templateStitch';
import EditorTerrainLayer from './EditorTerrainLayer';

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
 */
export default function TemplateTerrainLayer({
  world,
  width,
  height,
  field,
}: {
  world: StitchedWorld;
  width: number;
  height: number;
  field: TerrainField;
}) {
  const tiles = useMemo(() => {
    const masks = stitchedToEditorMasks(world);
    return buildEditorField(width, height, masks, field);
  }, [world, width, height, field]);

  return <EditorTerrainLayer tiles={tiles} />;
}
