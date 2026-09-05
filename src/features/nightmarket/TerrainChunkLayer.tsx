import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Assets, Container, Sprite, Texture, RenderTexture } from 'pixi.js';
import { useApplication, useTick } from '@pixi/react';
import { TILE_HEIGHT } from '../../engine/market/isometric';
import {
  CHUNK_PX,
  FARM_TERRAIN_OVERHANG,
  chunkKey,
  chunkScreenRect,
  chunksForScreenRect,
  cellWindowForChunk,
  levelForScale,
  isChunkBakingActive,
  scaleForLevel,
  type ChunkCoord,
  type ScreenRect,
} from '../../engine/market/chunkGrid';
import { buildEditorField, type CompiledMasks, type TerrainField } from '../../engine/market/farmTerrain';
import { buildDraws, WOOD_FLOOR_Y_OFFSET } from './terrainDraws';
import nmpPerf from './nmpPerf';

/**
 * TerrainChunkLayer — baked, LRU-cached ground terrain.
 *
 * LAYER: view (renderer half). The coordinate math is in
 * `src/engine/market/chunkGrid.ts`, which is renderer-free and unit-tested; this
 * file owns only the Pixi parts — `RenderTexture` baking, the LRU, the frame
 * budget. Full design: docs/NIGHT_MARKET_TERRAIN_CHUNKING.md.
 *
 * ── What it replaces ───────────────────────────────────────────────────────────
 * `EditorTerrainLayer` emits one to four sprites per ground cell. That is fine at
 * today's scale (a handful of 16×16 boards) and impossible at the stated target
 * (~100 templates, ~240×240 cells). Here each 256×256 px chunk of projected space
 * is rasterised ONCE into a render texture and thereafter drawn as a single quad,
 * turning ~256 draws into 1.
 *
 * ── TWO THINGS TO UNDERSTAND BEFORE CHANGING THIS FILE ─────────────────────────
 *
 * **1. Only GROUND is baked, never decor.** Baking flattens many cell depths into
 * one image drawn at one z. That is lossless only for art that could never have
 * sorted in front of an entity. Ground caps and slabs are flat; decor (trees,
 * scatter) is tall and must keep its per-cell depth so a walker can pass behind
 * it. Hence `part="ground"` here and `part="decor"` on the live layer alongside.
 *
 * **2. It is deliberately INACTIVE at native zoom.** Even ground is not perfectly
 * flat: a raised dirt lip on a cell nearer the camera currently draws in front of
 * a walker standing behind it, and one flattened image cannot reproduce that.
 * Rather than accept the artifact everywhere, baking engages only BELOW native
 * scale — where the lip is a pixel or two and the walker is a handful — and the
 * exact per-cell sprite path still runs when the camera is close. This mirrors
 * the LOD threshold decision in docs/REACT_NATIVE_MIGRATION.md § Zoom-out policy:
 * fidelity where it is legible, throughput where it is not.
 *
 * ⚠️ The failure mode of this whole subsystem is a SEAM — a strip of clipped
 * sprites along a chunk edge — which renders fine, throws nothing, and is visible
 * only to a human looking at the screen. The defence is
 * `FARM_TERRAIN_OVERHANG`; see `chunkGrid.ts § SpriteOverhang` before touching
 * the bake rect.
 */

/**
 * The single depth every baked ground chunk draws at.
 *
 * Must sit below the lowest live sprite. The deepest thing the live path emits is
 * a dirt slab at `-(col + row) - 0.5`; with the market bounded well inside ±10⁴
 * cells, a large negative constant is unambiguously beneath all of it, and the
 * backdrop below that is a separate container drawn earlier.
 */
const BAKED_GROUND_Z = -1e6;

/** Resident texture cap. ~8 chunks cover a phone viewport; 2 levels are held across a zoom. */
const MAX_RESIDENT_CHUNKS = 24;

/** Chunks baked per frame. A bake is ~1–2 ms, so this stays well inside a 30 fps budget. */
const BAKES_PER_FRAME = 2;

interface BakedChunk {
  texture: RenderTexture;
  /** Monotonic counter for LRU eviction — cheaper and clock-free vs. timestamps. */
  usedAt: number;
}

export interface TerrainChunkLayerProps {
  /** Compiled masks for the whole world (as `TemplateTerrainLayer` builds them). */
  masks: CompiledMasks;
  /** Padded field dimensions — the same values passed to `buildEditorField`. */
  fieldWidth: number;
  fieldHeight: number;
  /**
   * The padded field-membership test (origin + `contains`/`apron`) — the SAME object the live
   * layer hands `buildEditorField`, so a baked chunk and a live tile agree cell for cell.
   */
  field: TerrainField;
  /** Current camera scale. Baking engages only below native — see `isChunkBakingActive`. */
  zoom: number;
  /** Camera pan, in screen px, as applied by the scene container. */
  pan: { x: number; y: number };
  /** Viewport size in px. */
  viewportW: number;
  viewportH: number;
}

/**
 * The visible region in NATIVE screen space.
 *
 * The scene container is positioned at (screenW/2 + panX, screenH/2 + panY) and
 * scaled by `zoom`, so a viewport pixel `p` maps back to `(p − centre) / zoom`.
 */
function viewportNativeRect(
  pan: { x: number; y: number },
  zoom: number,
  viewportW: number,
  viewportH: number,
): ScreenRect {
  const cx = viewportW / 2 + pan.x;
  const cy = viewportH / 2 + pan.y;
  return {
    minX: (0 - cx) / zoom,
    maxX: (viewportW - cx) / zoom,
    minY: (0 - cy) / zoom,
    maxY: (viewportH - cy) / zoom,
  };
}

function TerrainChunkLayer({
  masks, fieldWidth, fieldHeight, field, zoom, pan, viewportW, viewportH,
}: TerrainChunkLayerProps) {
  const { app } = useApplication();
  const cache = useRef<Map<string, BakedChunk>>(new Map());
  const queue = useRef<ChunkCoord[]>([]);
  const clock = useRef(0);
  const textures = useRef<Map<string, Texture>>(new Map());
  // Bumped after each bake batch so React re-renders with the new textures. The
  // cache itself lives in a ref because it is mutated from the tick callback.
  const [, setBakeTick] = useState(0);

  const level = levelForScale(zoom);
  const active = isChunkBakingActive(zoom);

  // Which chunks the camera needs right now.
  const needed = useMemo(() => {
    if (!active) return [];
    return chunksForScreenRect(level, viewportNativeRect(pan, zoom, viewportW, viewportH));
  }, [active, level, pan, zoom, viewportW, viewportH]);

  /**
   * Rasterise one chunk.
   *
   * Builds the tile field for the chunk's (overhang-expanded) cell window using
   * the SAME `buildEditorField` call the live renderer uses, decomposes it with
   * the SAME `buildDraws`, then draws into a render texture at the level's scale.
   * Sprites landing outside the texture are clipped by the render target, which
   * is exactly what the overhang margin relies on.
   */
  const bake = useCallback((coord: ChunkCoord): BakedChunk | null => {
    if (!app?.renderer) return null;

    const rect = chunkScreenRect(coord);
    const s = scaleForLevel(coord.level);
    const window = cellWindowForChunk(coord, FARM_TERRAIN_OVERHANG);
    const tiles = buildEditorField(fieldWidth, fieldHeight, masks, field, window);
    if (tiles.length === 0) return null;

    // `countPerf: false` — a bake must not overwrite the live terrain census.
    const { draws } = buildDraws(tiles, { col: 0, row: 0 }, false);

    const scene = new Container();
    // Painter's order within the chunk. The baked image collapses to ONE z in the
    // parent, so the sort has to happen here, at bake time, rather than being left
    // to the scene container's sortableChildren.
    const ordered: Array<{ z: number; url: string; x: number; y: number }> = [];
    for (const d of draws) {
      if (d.dirtUrl) ordered.push({ z: d.dirtZ, url: d.dirtUrl, x: d.x, y: d.y + TILE_HEIGHT });
      // The wood floor rides its own skirt, not the slab's — see WOOD_FLOOR_Y_OFFSET.
      if (d.floorUrl) ordered.push({ z: d.floorZ, url: d.floorUrl, x: d.x, y: d.y + WOOD_FLOOR_Y_OFFSET });
      for (const u of d.surfaceUrls) ordered.push({ z: d.surfaceZ, url: u, x: d.x, y: d.y });
      for (const u of d.darkSurfaceUrls) ordered.push({ z: d.darkSurfaceZ, url: u, x: d.x, y: d.y });
      // Decor is deliberately absent — see the header, note 1.
    }
    ordered.sort((a, b) => a.z - b.z);

    for (const o of ordered) {
      const tex = textures.current.get(o.url);
      if (!tex) continue; // not loaded yet; this chunk re-bakes when the atlas resolves
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 1);
      // Native screen space → chunk-local texture space.
      sp.x = (o.x - rect.minX) * s;
      sp.y = (o.y - rect.minY) * s;
      sp.scale.set(s);
      scene.addChild(sp);
    }

    const texture = RenderTexture.create({ width: CHUNK_PX, height: CHUNK_PX });
    app.renderer.render({ container: scene, target: texture });
    scene.destroy({ children: true });
    return { texture, usedAt: ++clock.current };
  }, [app, masks, field, fieldWidth, fieldHeight]);

  // Load every texture the tileset can produce before baking. A bake that runs
  // with a half-loaded atlas silently omits sprites, and unlike the live layer it
  // BAKES that omission in — so the gap persists until something invalidates the
  // chunk. Waiting is the only safe option.
  const [atlasReady, setAtlasReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Probe the whole field once to collect the URL vocabulary. Cheap relative to
      // a bake, and it runs once per world.
      const probe = buildEditorField(fieldWidth, fieldHeight, masks, field, undefined);
      const { urls } = buildDraws(probe, { col: 0, row: 0 }, false);
      const entries = await Promise.all([...urls].map(async (u) => {
        const tex = await Assets.load<Texture>(u);
        tex.source.scaleMode = 'nearest';
        return [u, tex] as const;
      }));
      if (cancelled) return;
      textures.current = new Map(entries);
      setAtlasReady(true);
    })();
    return () => { cancelled = true; };
  }, [masks, field, fieldWidth, fieldHeight]);

  // Invalidate everything when the world itself changes (a placement, a template
  // version bump, a season swap). Chunk-level invalidation via
  // `chunksForCellBounds` is the optimisation for incremental edits; a whole-world
  // change legitimately dirties all of it.
  useEffect(() => {
    for (const c of cache.current.values()) c.texture.destroy(true);
    cache.current.clear();
    queue.current = [];
  }, [masks, field, fieldWidth, fieldHeight]);

  // Destroy on unmount — render textures are GPU memory and are not GC'd for us.
  useEffect(() => () => {
    for (const c of cache.current.values()) c.texture.destroy(true);
    cache.current.clear();
  }, []);

  // Enqueue whatever is missing. Kept out of the tick so the queue reflects the
  // camera at commit time rather than mid-frame.
  useEffect(() => {
    if (!active || !atlasReady) return;
    const pending = needed.filter(
      (c) => !cache.current.has(chunkKey(c)) && !queue.current.some((q) => chunkKey(q) === chunkKey(c)),
    );
    if (pending.length) queue.current.push(...pending);
  }, [needed, active, atlasReady]);

  // Drain the bake queue against a per-frame budget so a pan never hitches.
  useTick(() => {
    if (!atlasReady || queue.current.length === 0) return;
    let baked = 0;
    while (queue.current.length && baked < BAKES_PER_FRAME) {
      const coord = queue.current.shift()!;
      const key = chunkKey(coord);
      if (cache.current.has(key)) continue;
      const chunk = bake(coord);
      // A null bake means "no tiles here" — cache nothing, and do not retry every
      // frame: `needed` only re-enqueues when the camera moves.
      if (chunk) cache.current.set(key, chunk);
      baked++;
    }

    // LRU eviction. Bounded by the SCREEN, not the world — the property the whole
    // design exists for.
    if (cache.current.size > MAX_RESIDENT_CHUNKS) {
      const victims = [...cache.current.entries()]
        .sort((a, b) => a[1].usedAt - b[1].usedAt)
        .slice(0, cache.current.size - MAX_RESIDENT_CHUNKS);
      for (const [k, v] of victims) {
        v.texture.destroy(true);
        cache.current.delete(k);
      }
    }

    if (baked > 0) setBakeTick((n) => n + 1);
    nmpPerf.count('terrain-chunks-resident', cache.current.size);
    nmpPerf.count('terrain-chunks-queued', queue.current.length);
  });

  if (!active || !atlasReady) return null;

  return (
    <>
      {needed.map((coord) => {
        const key = chunkKey(coord);
        const entry = cache.current.get(key);
        if (!entry) return null;
        entry.usedAt = ++clock.current;
        const rect = chunkScreenRect(coord);
        const inv = 1 / scaleForLevel(coord.level);
        return (
          <pixiSprite
            key={key}
            texture={entry.texture}
            x={rect.minX}
            y={rect.minY}
            // Texture space → native screen space. The camera container then applies
            // `zoom` on top, so the chunk is always minified, never magnified.
            scale={inv}
            // ONE depth for the whole baked image, below every entity. This is the
            // flattening described in the header; it is why only ground is baked.
            zIndex={BAKED_GROUND_Z}
            eventMode="none"
          />
        );
      })}
    </>
  );
}

export default TerrainChunkLayer;
