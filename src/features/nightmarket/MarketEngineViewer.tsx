import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useTick, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box } from '@mui/material';
import { TILE_SIZE } from '../../engine/market/nightMarketRegistry';
import { isoToScreen, TILE_WIDTH, TILE_HEIGHT } from '../../engine/market/isometric';
import { buildFarmField, resolveTileSurfaceUrls, resolveTileDarkSurfaceUrls, FIELD_WIDTH, FIELD_HEIGHT } from '../../engine/market/farmTerrain';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import FarmTerrainLayer from './FarmTerrainLayer';
import WalkwayLayer from './WalkwayLayer';
import HouseLayer from './HouseLayer';

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
}

export const DEBUG_FLAG_KEYS: Array<keyof DebugFlags> = ['origin', 'grass', 'overlayLabels'];

export const ALL_DEBUG_OFF: DebugFlags = { origin: false, grass: false, overlayLabels: false };

export interface MarketEngineViewerProps {
  /** Render the isometric debug grid (fine green + major red lines). Default false. */
  showGrid?: boolean;
  /** Per-overlay debug toggles. Omitted flags default to off. */
  debug?: DebugFlags;
}

interface SceneProps {
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
  showGrid?: boolean;
  debug: DebugFlags;
  /** Ref set to true by the outer component during a pinch gesture — suppresses Pixi drag. */
  isPinchingRef?: React.RefObject<boolean>;
}

// Integer zoom range — the free-farm art is pixel-art, so only whole-number
// scale factors keep it crisp (nearest-neighbour, no fractional resampling).
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const DEFAULT_ZOOM = 3;

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

// ─── Scene ─────────────────────────────────────────────────────────────────
// Runs inside <Application>. Handles drag-to-pan and renders the terrain.

function NightMarketScene({ pan, zoom, onPanChange, showGrid, debug, isPinchingRef }: SceneProps) {
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

  // Keep Pixi's ticker running (drives any future animation); no per-frame state.
  useTick(() => {});

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

  // app.screen reads app.renderer.screen — gate on renderer, not screen.
  if (!app?.renderer) return null;

  const cx = app.screen.width / 2 + pan.x;
  const cy = app.screen.height / 2 + pan.y;

  return (
    <pixiContainer x={cx} y={cy} scale={zoom} sortableChildren>
      {showGrid && <GridOverlay />}
      <FarmTerrainLayer />
      <WalkwayLayer />
      <HouseLayer />
      {debug.grass && <GrassOverlay />}
      {debug.overlayLabels && <OverlayLabels />}
      {debug.origin && <OriginOverlay />}
    </pixiContainer>
  );
}

// ─── MarketEngineViewer ───────────────────────────────────────────────────────
// Outer component: pan/zoom state, gesture handlers, Application mount.

function MarketEngineViewer({ showGrid, debug = ALL_DEBUG_OFF }: MarketEngineViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [ready, setReady] = useState(false);

  // Refs kept in sync so gesture handlers read the latest values without
  // recreating on every render.
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // True while a 2-finger pinch is active — suppresses the Pixi drag handler.
  const isPinchingRef = useRef(false);
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, startPanX: 0, startPanY: 0, midX: 0, midY: 0 });

  useEffect(() => {
    if (containerRef.current) setReady(true);
  }, []);

  // Set an integer zoom, adjusting pan so the focal point stays fixed on screen.
  const applyZoomAtPoint = useCallback((focalX: number, focalY: number, rawZoom: number) => {
    const el = containerRef.current;
    if (!el) return;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(rawZoom)));
    if (newZoom === zoomRef.current) return; // integer steps — ignore sub-step deltas
    const ratio = newZoom / zoomRef.current;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const newPan = {
      x: (focalX - w / 2) * (1 - ratio) + panRef.current.x * ratio,
      y: (focalY - h / 2) * (1 - ratio) + panRef.current.y * ratio,
    };
    zoomRef.current = newZoom;
    panRef.current = newPan;
    setZoom(newZoom);
    setPan(newPan);
  }, []);

  // Wheel zoom centered on the cursor. One integer step per notch.
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const step = e.deltaY < 0 ? 1 : -1;
    applyZoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoomRef.current + step);
  }, [applyZoomAtPoint]);

  // Pinch-to-zoom: capture phase so we can preventDefault before Pixi sees the touches.
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      isPinchingRef.current = true;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const el = containerRef.current!;
      const rect = el.getBoundingClientRect();
      const dx = t1.clientX - t0.clientX;
      const dy = t1.clientY - t0.clientY;
      pinchRef.current = {
        active: true,
        startDist: Math.sqrt(dx * dx + dy * dy),
        startZoom: zoomRef.current,
        startPanX: panRef.current.x,
        startPanY: panRef.current.y,
        midX: (t0.clientX + t1.clientX) / 2 - rect.left,
        midY: (t0.clientY + t1.clientY) / 2 - rect.top,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pinchRef.current.active || e.touches.length !== 2) return;
    e.preventDefault();
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    const newDist = Math.sqrt(dx * dx + dy * dy);
    const scale = newDist / pinchRef.current.startDist;
    // Snap to an integer zoom around the pinch midpoint.
    applyZoomAtPoint(pinchRef.current.midX, pinchRef.current.midY, pinchRef.current.startZoom * scale);
  }, [applyZoomAtPoint]);

  const handleTouchEnd = useCallback(() => {
    pinchRef.current.active = false;
    isPinchingRef.current = false;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart, { capture: true });
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd, ready]);

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
          />
        </Application>
      )}
    </Box>
  );
}

export default MarketEngineViewer;
