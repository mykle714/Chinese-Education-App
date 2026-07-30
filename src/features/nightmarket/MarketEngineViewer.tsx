import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useTick, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box } from '@mui/material';
import { TILE_SIZE } from '../../engine/market/nightMarketRegistry';
import { isoToScreen, TILE_WIDTH, TILE_HEIGHT, type ScreenPosition } from '../../engine/market/isometric';
import { computeMinZoom, clampPan, visibleCellWindow, type CellFootprint } from '../../engine/market/cameraFit';
import { useCameraControls } from '../../hooks/useCameraControls';
import { buildFarmField, resolveTileSurfaceUrls, resolveTileDarkSurfaceUrls, FIELD_WIDTH, FIELD_HEIGHT } from '../../engine/market/farmTerrain';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import TemplateTerrainLayer from './TemplateTerrainLayer';
import PlaceholderHouseLayer from './PlaceholderHouseLayer';
// Publishes the camera zoom to the sprite leaves so a building's outer layers can ghost out as the
// camera closes in — see engine/market/layerTranslucency.
import { CameraZoomProvider } from './CameraZoomContext';
import PedestrianLayer from './PedestrianLayer';
import GroundBackdropLayer from './GroundBackdropLayer';
import nmpPerf from './nmpPerf';
import { useMarketWorld } from './useMarketWorld';
import { usePixiPedestrians } from '../../hooks/usePixiPedestrians';
import type { PlacedPlaceholder } from '../../engine/market/templateStitch';
import { placeholderAreaId } from '../../engine/market/placeholderArea';
import type { TemplateBounds } from './useMarketWorld';

// Register Pixi.js classes as pixiContainer / pixiSprite / pixiGraphics / pixiText JSX elements.
extend({ Container, Sprite, Graphics, Text });

/**
 * MarketEngineViewer — Pixi.js host for the night market.
 *
 * The market was rebuilt on the free-farm 2:1 tileset: this component now renders
 * a static {@link FarmTerrainLayer} plateau plus a pan/zoom camera. The former
 * demo layout (floor.png, authored streets/stalls, walking pedestrians, strip
 * slicing, tap dialogs, and the per-stand debug label overlays) was removed — see
 * docs/NIGHT_MARKET_FEATURE.md. The dormant pedestrian/streetGraph engine remains
 * in engine/market for a future re-layout.
 */

/** Per-overlay debug flags. Slimmed to the terrain-era overlays. */
export interface DebugFlags {
  /** Iso (0,0) origin crosshair. */
  origin: boolean;
  /** Tint every tile the terrain model designated as grass. */
  grass: boolean;
  /** Label each tile with the surface sprite (overlay tile) stem it was painted with. */
  overlayLabels: boolean;
  /** Outline each PLACED template's board rectangle + float its "name vN" over the center. */
  templateBounds: boolean;
  /** Outline each PLACEHOLDER occupant slot + label it (owning template + slot id, filled/empty tint). */
  placeholderBounds: boolean;
}

export const DEBUG_FLAG_KEYS: Array<keyof DebugFlags> = [
  'origin', 'grass', 'overlayLabels', 'templateBounds', 'placeholderBounds',
];

export const ALL_DEBUG_OFF: DebugFlags = {
  origin: false, grass: false, overlayLabels: false, templateBounds: false, placeholderBounds: false,
};

export interface MarketEngineViewerProps {
  /** Render the isometric debug grid (fine green + major red lines). Default false. */
  showGrid?: boolean;
  /** Per-overlay debug toggles. Omitted flags default to off. */
  debug?: DebugFlags;
  /** Bump to force the world to re-fetch its layout (e.g. after the author minute-adjust tool). */
  reloadToken?: number;
}

interface SceneProps {
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
  showGrid?: boolean;
  debug: DebugFlags;
  /** Ref set to true by the outer component during a pinch gesture — suppresses Pixi drag. */
  isPinchingRef?: React.RefObject<boolean>;
  /** Bump to force the world to re-fetch its layout. */
  reloadToken?: number;
  /**
   * Report the loaded layout's placement rectangles up to the camera host, which derives its
   * zoom-out floor from them ({@link computeMinZoom}). The world is fetched inside the scene, but
   * zoom state lives outside it — this is the one value that has to travel back up.
   */
  onFootprintsChange?: (footprints: CellFootprint[]) => void;
}

/**
 * Camera ladder for nmp. The free-farm art is pixel-art (nearest-neighbour, `antialias={false}`),
 * so the camera SETTLES onto half-steps between gestures — see {@link useCameraControls}, which keeps
 * the zoom continuous while the user is pinching/scrolling and only lands on a rung at rest.
 *
 * CRISP_FLOOR (0.5) is the bottom rung. Below it the ladder runs out and the floor becomes
 * SIZE-derived: a market whose tiled continent no longer fits at 0.5× may keep pulling back
 * (continuously, and increasingly blurry) until its whole footprint is on screen — see
 * {@link computeMinZoom}.
 *
 * ⚠ Only the whole numbers on this ladder are truly pixel-crisp; 1.5×/2.5× resample. The half-step
 * spacing predates the settle tween and is kept because the 0.5→8 range needs finer rungs than
 * whole numbers give it near the bottom. Raise ZOOM_STEP to 1 if the odd rungs ever read as soft.
 */
const CRISP_FLOOR = 0.5;
const MAX_ZOOM = 8;
const DEFAULT_ZOOM = 1;
const ZOOM_STEP = 0.5;

/**
 * Cells of real, autotiled default ground drawn around the market. Small on purpose: its only job is
 * to give the market's edge tiles in-field neighbours to autotile against, because everything past
 * it is covered by {@link ./GroundBackdropLayer}'s single tiling quad. Sizing this to the camera's
 * zoomed-out reach instead (the first cut) meant tens of thousands of sprites — see that layer.
 */
const APRON_RING_CELLS = 4;

// ─── Grid overlay ────────────────────────────────────────────────────────────
// Static isometric debug grid. Fine green lines mark every single tile (1 iso
// unit); major red lines mark every 5 tiles. Drawn once since it never changes.

const GRID_MIN = -100;
const GRID_MAX = 100;
// Render ABOVE the terrain sprites (whose z ≈ -(isoX+isoY), roughly [-200, 150])
// so the grid reads over the ground; kept just below the origin crosshair (10_000).
const GRID_Z = 9_000;

function GridOverlay() {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const drawGridLines = (step: number, color: number, alpha: number, lineWidth: number) => {
      for (let v = GRID_MIN; v <= GRID_MAX; v += step) {
        const a = isoToScreen(v, GRID_MIN);
        const b = isoToScreen(v, GRID_MAX);
        g.moveTo(a.screenX, a.screenY);
        g.lineTo(b.screenX, b.screenY);
        const c = isoToScreen(GRID_MIN, v);
        const d = isoToScreen(GRID_MAX, v);
        g.moveTo(c.screenX, c.screenY);
        g.lineTo(d.screenX, d.screenY);
      }
      g.stroke({ color, width: lineWidth, alpha });
    };
    drawGridLines(TILE_SIZE, 0x00c800, 0.5, 0.5);      // fine: every 1 tile (green)
    drawGridLines(TILE_SIZE * 5, 0xff0000, 0.9, 0.75); // major: every 5 tiles (red)
  }, []);

  return <pixiGraphics draw={draw} zIndex={GRID_Z} />;
}

// ─── Origin overlay ──────────────────────────────────────────────────────────
// Cyan iso-axis crosshair at grid (0,0). Floated above everything.

const ORIGIN_MARKER_ARM_ISO = 5;
const ORIGIN_MARKER_WIDTH = 1; // stroke thickness in pre-zoom screen px
const ORIGIN_Z = 10_000;

function OriginOverlay() {
  const drawMarker = useCallback((g: Graphics) => {
    g.clear();
    const east = isoToScreen(ORIGIN_MARKER_ARM_ISO, 0);
    const west = isoToScreen(-ORIGIN_MARKER_ARM_ISO, 0);
    const north = isoToScreen(0, ORIGIN_MARKER_ARM_ISO);
    const south = isoToScreen(0, -ORIGIN_MARKER_ARM_ISO);
    g.moveTo(west.screenX, west.screenY);
    g.lineTo(east.screenX, east.screenY);
    g.moveTo(south.screenX, south.screenY);
    g.lineTo(north.screenX, north.screenY);
    g.stroke({ color: 0x00ffff, width: ORIGIN_MARKER_WIDTH, alpha: 1 });
  }, []);

  return (
    <pixiContainer zIndex={ORIGIN_Z}>
      <pixiGraphics draw={drawMarker} />
    </pixiContainer>
  );
}

// ─── Grass overlay ───────────────────────────────────────────────────────────
// Debug tint over every tile the terrain model ({@link buildFarmField}) marked as
// grass. Rebuilds the SAME field the FarmTerrainLayer paints (same dimensions +
// default seed) so the tinted diamonds line up exactly with the grass caps. Light
// and dark patches get distinct tints (dark drawn in a second pass on top, matching
// how the terrain stacks the dark layer over the light one).

// Just below the origin crosshair (10_000) but above the grid (9_000) so it reads
// over both the terrain and the gridlines.
const GRASS_OVERLAY_Z = 9_500;
const LIGHT_GRASS_OVERLAY_COLOR = 0x33ff66;
const DARK_GRASS_OVERLAY_COLOR = 0x0b6b2f;
const GRASS_OVERLAY_ALPHA = 0.45;

function GrassOverlay() {
  // Deterministic field → memoize once; split into the light and dark tile sets.
  const { lightTiles, darkTiles } = useMemo(() => {
    const field = buildFarmField(FIELD_WIDTH, FIELD_HEIGHT);
    return {
      lightTiles: field.filter((t) => t.kind === 'grass'),
      darkTiles: field.filter((t) => t.darkGrass),
    };
  }, []);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    // Trace each tile's surface diamond (32×16) into the current path.
    const tracePatch = (tiles: typeof lightTiles) => {
      for (const t of tiles) {
        // The diamond sits in the lower half of the tile cell: its bottom vertex is
        // at screenY, so the diamond center is TILE_HEIGHT/2 up.
        const { screenX, screenY } = isoToScreen(t.isoX, t.isoY);
        const cx = screenX;
        const cy = screenY - TILE_HEIGHT / 2;
        g.moveTo(cx, cy - TILE_HEIGHT / 2);   // top vertex
        g.lineTo(cx + TILE_WIDTH / 2, cy);    // right vertex
        g.lineTo(cx, cy + TILE_HEIGHT / 2);   // bottom vertex
        g.lineTo(cx - TILE_WIDTH / 2, cy);    // left vertex
        g.closePath();
      }
    };
    // Light pass, then the dark pass on top (dark over light).
    tracePatch(lightTiles);
    g.fill({ color: LIGHT_GRASS_OVERLAY_COLOR, alpha: GRASS_OVERLAY_ALPHA });
    tracePatch(darkTiles);
    g.fill({ color: DARK_GRASS_OVERLAY_COLOR, alpha: GRASS_OVERLAY_ALPHA });
  }, [lightTiles, darkTiles]);

  return <pixiGraphics draw={draw} zIndex={GRASS_OVERLAY_Z} />;
}

// ─── Overlay-tile labels ───────────────────────────────────────────────────────
// Debug text over each tile naming the SURFACE sprites (overlay tiles) it was painted
// with — the grass cap for a grass tile, the stacked grass-boundary overlays for a
// tile bordering grass, across BOTH the light and dark layers (dark stems prefixed
// `d:`). Resolves the exact same sprites the FarmTerrainLayer paints (via
// resolveTileSurfaceUrls + resolveTileDarkSurfaceUrls) and reverse-maps each url to
// its filename stem.

// Above the grass tint so labels stay readable when both overlays are on.
const OVERLAY_LABEL_Z = 9_600;

/** Trim the verbose pack prefixes so the label is just the meaningful part. */
function shortenStem(stem: string): string {
  if (stem === 'lightGrass_center') return 'grass';
  if (stem === 'darkGrass_center') return 'dark';
  // Dark overlays get a `d:` prefix so they read distinctly from the light ones.
  if (stem.startsWith('darkGrassOverlay_')) return `d:${stem.replace('darkGrassOverlay_', '')}`;
  return stem.replace(/^lightGrassOverlay_/, '');
}

function OverlayLabels() {
  // Deterministic field → resolve every tile's surface stems once.
  const labels = useMemo(() => {
    return buildFarmField(FIELD_WIDTH, FIELD_HEIGHT)
      .map((t) => {
        // Both layers' surface sprites, light first then dark (paint order).
        const stems = [...resolveTileSurfaceUrls(t), ...resolveTileDarkSurfaceUrls(t)]
          .map((u) => freeFarmTileset.stemOf(u))
          .filter((s): s is string => !!s)
          .map(shortenStem);
        if (stems.length === 0) return null; // interior dirt — nothing painted
        const { screenX, screenY } = isoToScreen(t.isoX, t.isoY);
        return {
          key: `${t.isoX},${t.isoY}`,
          x: screenX,
          y: screenY - TILE_HEIGHT / 2, // diamond center (surface top face)
          text: stems.join('\n'),
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, []);

  return (
    <pixiContainer zIndex={OVERLAY_LABEL_Z}>
      {labels.map((l) => (
        <pixiText
          key={l.key}
          text={l.text}
          x={l.x}
          y={l.y}
          anchor={{ x: 0.5, y: 0.5 }}
          // Tiny font — tiles are 32px wide; the integer camera zoom scales it up
          // legibly. White fill + dark stroke reads over both grass and dirt.
          style={{
            fontFamily: 'monospace',
            fontSize: 5,
            lineHeight: 5,
            align: 'center',
            fill: 0xffffff,
            stroke: { color: 0x000000, width: 1 },
          }}
          resolution={4}
        />
      ))}
    </pixiContainer>
  );
}

// ─── Iso-rectangle outline helper ──────────────────────────────────────────────
// Trace the diamond outline of a cell rectangle [col, col+w) × [row, row+h) into the
// current Graphics path. isoToScreen maps iso-CORNER coordinates (the same integer grid
// the GridOverlay draws through), so the four rectangle corners are the four diamond
// vertices: south = (col,row), east = (col+w,row), north = (col+w,row+h), west = (col,row+h).
function traceIsoRect(g: Graphics, col: number, row: number, w: number, h: number) {
  const s = isoToScreen(col, row);
  const e = isoToScreen(col + w, row);
  const n = isoToScreen(col + w, row + h);
  const wv = isoToScreen(col, row + h);
  g.moveTo(s.screenX, s.screenY);
  g.lineTo(e.screenX, e.screenY);
  g.lineTo(n.screenX, n.screenY);
  g.lineTo(wv.screenX, wv.screenY);
  g.closePath();
}

/** Screen center of a cell rectangle — isoToScreen of its iso midpoint (affine ⇒ true centroid). */
function isoRectCenter(col: number, row: number, w: number, h: number): ScreenPosition {
  return isoToScreen(col + w / 2, row + h / 2);
}

// Shared tiny-label text style for the bounds overlays — monospace, upscaled by the integer
// camera zoom, white fill + dark stroke so it reads over grass, dirt, and the outline colors.
const BOUNDS_LABEL_STYLE = {
  fontFamily: 'monospace',
  fontSize: 6,
  lineHeight: 6,
  align: 'center' as const,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 1 },
};

// ─── Template bounds overlay ────────────────────────────────────────────────────
// Debug outline + name label for each PLACED template. Draws the template's board
// rectangle (offset..offset+size, in cells) as an amber iso-diamond outline and floats
// "name vN" over its center — so an author can see which template tiles which region and
// which version is live. Unlike the grass/overlayLabels overlays, this reads the STITCHED
// template layout (the placements), so it stays correct against the real render.
const TEMPLATE_BOUNDS_Z = 9_700;
const TEMPLATE_BOUNDS_COLOR = 0xffb300; // amber

function TemplateBoundsOverlay({ templates }: { templates: TemplateBounds[] }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    for (const t of templates) traceIsoRect(g, t.offsetCol, t.offsetRow, t.width, t.height);
    g.stroke({ color: TEMPLATE_BOUNDS_COLOR, width: 1, alpha: 0.95 });
  }, [templates]);

  const labels = useMemo(
    () =>
      templates.map((t) => {
        const { screenX, screenY } = isoRectCenter(t.offsetCol, t.offsetRow, t.width, t.height);
        return {
          key: `${t.name}@${t.offsetCol},${t.offsetRow}`,
          x: screenX,
          y: screenY,
          text: `${t.name}\nv${t.activeVersion}`,
        };
      }),
    [templates],
  );

  return (
    <pixiContainer zIndex={TEMPLATE_BOUNDS_Z}>
      <pixiGraphics draw={draw} />
      {labels.map((l) => (
        <pixiText
          key={l.key}
          text={l.text}
          x={l.x}
          y={l.y}
          anchor={{ x: 0.5, y: 0.5 }}
          style={BOUNDS_LABEL_STYLE}
          resolution={4}
        />
      ))}
    </pixiContainer>
  );
}

// ─── Placeholder bounds overlay ─────────────────────────────────────────────────
// Debug outline + label for each PLACEHOLDER occupant slot (world.placeholderAreas, in
// GLOBAL cells). Filled slots outline cyan, empty slots magenta (two stroke passes, like the
// grass light/dark passes); each is labeled with its owning template + its "col_row" slot id.
const PLACEHOLDER_BOUNDS_Z = 9_720;
const PLACEHOLDER_FILLED_COLOR = 0x00e5ff; // cyan — an occupant is standing here
const PLACEHOLDER_EMPTY_COLOR = 0xff5cf0; // magenta — vacant slot

function PlaceholderBoundsOverlay({ placeholders }: { placeholders: PlacedPlaceholder[] }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const tracePass = (filled: boolean, color: number) => {
      let any = false;
      for (const ph of placeholders) {
        if (ph.filled !== filled) continue;
        traceIsoRect(g, ph.area.col, ph.area.row, ph.area.w, ph.area.h);
        any = true;
      }
      if (any) g.stroke({ color, width: 1, alpha: 0.95 });
    };
    tracePass(true, PLACEHOLDER_FILLED_COLOR);
    tracePass(false, PLACEHOLDER_EMPTY_COLOR);
  }, [placeholders]);

  const labels = useMemo(
    () =>
      placeholders.map((ph) => {
        const { screenX, screenY } = isoRectCenter(ph.area.col, ph.area.row, ph.area.w, ph.area.h);
        return {
          key: `${ph.templateName}@${ph.area.col},${ph.area.row}`,
          x: screenX,
          y: screenY,
          // Owning template + slot anchor id (global col_row) + a filled/empty glyph.
          text: `${ph.templateName}\n${placeholderAreaId(ph.area)} ${ph.filled ? '●' : '○'}`,
        };
      }),
    [placeholders],
  );

  return (
    <pixiContainer zIndex={PLACEHOLDER_BOUNDS_Z}>
      <pixiGraphics draw={draw} />
      {labels.map((l) => (
        <pixiText
          key={l.key}
          text={l.text}
          x={l.x}
          y={l.y}
          anchor={{ x: 0.5, y: 0.5 }}
          style={BOUNDS_LABEL_STYLE}
          resolution={4}
        />
      ))}
    </pixiContainer>
  );
}

// ─── Pedestrian ticker ───────────────────────────────────────────────────────

/**
 * Owns the animation frame: advances the pedestrian FSM and re-renders ONLY the pedestrian sprites.
 *
 * ⚠️ PERF-CRITICAL SPLIT. The frame counter used to live in {@link NightMarketScene}, so every tick
 * re-rendered the scene and React reconciled the whole terrain tree (thousands of `pixiSprite`
 * elements) 60 times a second. Keeping the counter in this leaf confines the per-frame work to the
 * ~dozen pedestrian sprites. Do not hoist it back up — and note that the memoisation on the terrain
 * layers is the second half of the same fix, since a scene re-render for any other reason (a pan)
 * would otherwise still rebuild the terrain.
 */
function PedestrianTicker({ pedestrians }: { pedestrians: ReturnType<typeof usePixiPedestrians> }) {
  const [, setFrame] = useState(0);
  useTick((ticker) => {
    const now = performance.now();
    nmpPerf.frame(now); // dev-only; see ./nmpPerf for how to switch it on
    pedestrians.tick(ticker.deltaMS, now);
    setFrame((f) => (f + 1) % 1_000_000);
  });
  return <PedestrianLayer drawables={pedestrians.getDrawables()} />;
}

// ─── Scene ─────────────────────────────────────────────────────────────────
// Runs inside <Application>. Handles drag-to-pan and renders the terrain.

function NightMarketScene({ pan, zoom, onPanChange, showGrid, debug, isPinchingRef, reloadToken, onFootprintsChange }: SceneProps) {
  // `isInitialised` flips true once Pixi's async init() (which creates the
  // renderer) resolves; `app`'s identity is stable across init, so an effect
  // keyed only on `app` would bail before the renderer exists and never re-run.
  const { app, isInitialised } = useApplication();

  // Drag tracking in refs — avoids extra re-renders during pan.
  const drag = useRef({ active: false, startX: 0, startY: 0, origPanX: 0, origPanY: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const onPanChangeRef = useRef(onPanChange);
  onPanChangeRef.current = onPanChange;

  // Template runtime: load the authored hub template → assembled MarketWorld (stitched
  // terrain + recovered tile/street graphs). Replaces the former static procedural farm
  // plateau (FarmTerrainLayer/WalkwayLayer/HouseLayer).
  const { world, width, height, field, placements } = useMarketWorld(reloadToken);

  // Hand the placement rectangles to the camera host so it can size its zoom-out floor. Kept in a
  // ref-read effect (not a render-time call) so the parent's state update never happens mid-render.
  const onFootprintsChangeRef = useRef(onFootprintsChange);
  onFootprintsChangeRef.current = onFootprintsChange;
  useEffect(() => {
    onFootprintsChangeRef.current?.(placements);
  }, [placements]);

  // Slice-2 pedestrians: ambient walkers seeded on the recovered graph. The hook re-seeds
  // when the graph identity changes (first load / version switch) and no-ops while null.
  const pedestrians = usePixiPedestrians({
    tileGraph: world?.tileGraph ?? null,
    streetGraph: world?.streetGraph ?? null,
  });

  // NOTE: the per-frame simulation + re-render lives in <PedestrianTicker> below, NOT here. Bumping
  // frame state in this component re-rendered the entire scene at 60fps — including the terrain,
  // the app's largest element tree — which was the dominant cost of nmp's lag.

  // Stage pointer events: drag-to-pan. Keyed on `isInitialised` so it reattaches
  // once the renderer exists.
  useEffect(() => {
    if (!isInitialised || !app?.stage || !app.renderer) return;
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = app.screen;

    const onDown = (e: FederatedPointerEvent) => {
      drag.current = {
        active: true,
        startX: e.global.x,
        startY: e.global.y,
        origPanX: panRef.current.x,
        origPanY: panRef.current.y,
      };
    };
    const onMove = (e: FederatedPointerEvent) => {
      if (isPinchingRef?.current) return; // suppress drag during pinch
      if (!drag.current.active) return;
      const dx = e.global.x - drag.current.startX;
      const dy = e.global.y - drag.current.startY;
      onPanChangeRef.current({ x: drag.current.origPanX + dx, y: drag.current.origPanY + dy });
    };
    const onUp = () => { drag.current.active = false; };

    stage.on('pointerdown', onDown);
    stage.on('pointermove', onMove);
    stage.on('pointerup', onUp);
    stage.on('pointerupoutside', onUp);
    return () => {
      stage.off('pointerdown', onDown);
      stage.off('pointermove', onMove);
      stage.off('pointerup', onUp);
      stage.off('pointerupoutside', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, isInitialised]);

  // Which cells the camera can currently see, for terrain culling. An apron-padded field is far
  // larger than the market (tens of thousands of cells at the zoom-out floor), so building it whole
  // is not affordable — this bounds the work to the viewport. `visibleCellWindow` quantises its
  // edges, so the memo below re-runs only every few cells of travel, not every dragged pixel
  // (the scene itself re-renders every tick to advance the pedestrians).
  const screenW = app?.renderer ? app.screen.width : 0;
  const screenH = app?.renderer ? app.screen.height : 0;
  const cullWindow = useMemo(
    () => visibleCellWindow(pan, zoom, screenW, screenH),
    [pan, zoom, screenW, screenH],
  );

  // Census: the numbers that decide whether the lag is "this market is genuinely enormous" or
  // "something is rebuilding that shouldn't". `world` is the authored span; `window` is what the
  // camera can currently see, and is what the terrain actually builds. See ./nmpPerf.
  nmpPerf.count('world-cells', width * height);
  nmpPerf.count(
    'window-cells',
    (cullWindow.maxCol - cullWindow.minCol + 1) * (cullWindow.maxRow - cullWindow.minRow + 1),
  );

  // app.screen reads app.renderer.screen — gate on renderer, not screen.
  if (!app?.renderer) return null;

  const cx = app.screen.width / 2 + pan.x;
  const cy = app.screen.height / 2 + pan.y;

  return (
    <pixiContainer x={cx} y={cy} scale={zoom} sortableChildren>
      {/* Context only — emits no display object, so the layers below stay DIRECT children of the
          container and keep taking part in its single global z-sort. */}
      <CameraZoomProvider zoom={zoom}>
        {/* Infinite default ground — one tiling quad behind everything, so the viewport is never
            bare however far the camera pulls back. The real tiles only cover the market + ring. */}
        <GroundBackdropLayer pan={pan} zoom={zoom} viewportW={screenW} viewportH={screenH} />
        {showGrid && <GridOverlay />}
        {world && (
          <TemplateTerrainLayer
            world={world.terrain}
            width={width}
            height={height}
            field={field}
            apronPad={APRON_RING_CELLS}
            cullWindow={cullWindow}
          />
        )}
        {/* Occupant markers: a house (or two adjacent houses) in each FILLED placeholder slot
            (temporary stand-in until the real stand-asset catalog exists). Cosmetic only — not in
            the graph. */}
        {world && <PlaceholderHouseLayer placeholders={world.placeholderAreas} />}
        {world && <PedestrianTicker pedestrians={pedestrians} />}
        {/* Template/placeholder bounds read the STITCHED layout (placements + world.placeholderAreas),
            so unlike the two overlays below they stay correct against the real template render. */}
        {debug.templateBounds && <TemplateBoundsOverlay templates={placements} />}
        {debug.placeholderBounds && world && (
          <PlaceholderBoundsOverlay placeholders={world.placeholderAreas} />
        )}
        {/* NOTE: the GrassOverlay/OverlayLabels debug tints below still visualize the OLD
            procedural buildFarmField, not the stitched template terrain — they are stale
            against the template render and want re-targeting when a debug pass is
            needed (both default off). */}
        {debug.grass && <GrassOverlay />}
        {debug.overlayLabels && <OverlayLabels />}
        {debug.origin && <OriginOverlay />}
      </CameraZoomProvider>
    </pixiContainer>
  );
}

// ─── MarketEngineViewer ───────────────────────────────────────────────────────
// Outer component: pan/zoom state, gesture handlers, Application mount.

function MarketEngineViewer({ showGrid, debug = ALL_DEBUG_OFF, reloadToken }: MarketEngineViewerProps) {
  // The loaded layout's placement rectangles, reported up by the scene. Held in a ref (not state)
  // because only the camera-limit callbacks read it — a re-render would buy nothing.
  const footprintsRef = useRef<CellFootprint[]>([]);

  // Shared camera: continuous pinch/wheel zoom that settles onto the ZOOM_STEP ladder at rest, a
  // zoom-out floor that drops below CRISP_FLOOR once the tiled continent outgrows the viewport, and
  // a pan clamp that keeps the market anchored to the viewport.
  const { containerRef, pan, zoom, setPan, reclampPan, isPinchingRef, ready } = useCameraControls({
    crispFloor: CRISP_FLOOR,
    maxZoom: MAX_ZOOM,
    ladderStep: ZOOM_STEP,
    initialZoom: DEFAULT_ZOOM,
    // Seats the origin hub below the header on first paint (then gets clamped once the world loads).
    initialPan: { x: 0, y: 250 },
    minZoomFor: (el) => computeMinZoom(footprintsRef.current, el.clientWidth, el.clientHeight, CRISP_FLOOR),
    // Keeps the point under the screen centre inside the placement bbox. Viewport-independent, so
    // the element the host hands us is unused here.
    clampPan: (p, z) => clampPan(p, footprintsRef.current, z),
    enablePinch: true,
  });

  // The clamp's inputs move without the pan moving — the world finishes loading, or the element
  // resizes — and nothing else would notice that the standing pan has gone out of bounds.
  const handleFootprintsChange = useCallback((footprints: CellFootprint[]) => {
    footprintsRef.current = footprints;
    reclampPan();
  }, [reclampPan]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => reclampPan());
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, ready, reclampPan]);

  return (
    <Box
      className="market-engine-viewer"
      ref={containerRef}
      sx={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {ready && (
        <Application resizeTo={containerRef} backgroundAlpha={0} antialias={false}>
          <NightMarketScene
            pan={pan}
            zoom={zoom}
            onPanChange={setPan}
            showGrid={showGrid}
            debug={debug}
            isPinchingRef={isPinchingRef}
            reloadToken={reloadToken}
            onFootprintsChange={handleFootprintsChange}
          />
        </Application>
      )}
    </Box>
  );
}

export default MarketEngineViewer;
