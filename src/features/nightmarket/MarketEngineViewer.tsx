// PIXI's non-eval shader codegen. MUST be first: it has to be applied before a
// renderer is created. See ./pixiRuntime for why this is not in main.tsx.
import './pixiRuntime';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useTick, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box } from '@mui/material';
import { TILE_SIZE } from '../../engine/market/nightMarketRegistry';
import { isoToScreen, type ScreenPosition } from '../../engine/market/isometric';
import { computeMinZoom, clampPan, visibleCellWindow, type CellFootprint } from '../../engine/market/cameraFit';
import { followPanFor, approachPan } from '../../engine/market/cameraFollow';
import { useCameraControls } from '../../hooks/useCameraControls';
import TemplateTerrainLayer from './TemplateTerrainLayer';
import PlaceholderHouseLayer from './PlaceholderHouseLayer';
// Publishes the camera zoom to the sprite leaves so a building's outer layers can ghost out as the
// camera closes in — see engine/market/layerTranslucency.
import { CameraZoomProvider } from './CameraZoomContext';
import PedestrianLayer from './PedestrianLayer';
import GroundBackdropLayer from './GroundBackdropLayer';
import nmpPerf from './nmpPerf';
import { usePixiPedestrians } from '../../hooks/usePixiPedestrians';
import type { PlacedPlaceholder } from '../../engine/market/templateStitch';
import { placeholderAreaId } from '../../engine/market/placeholderArea';
import type { TemplateBounds, UseMarketWorldResult } from './useMarketWorld';

// Register Pixi.js classes as pixiContainer / pixiSprite / pixiGraphics / pixiText JSX elements.
extend({ Container, Sprite, Graphics, Text });

/**
 * MarketEngineViewer — Pixi.js host for the night market.
 *
 * Renders the user's continent, built on the free-farm 2:1 tileset: terrain stitched from their
 * placed templates ({@link TemplateTerrainLayer}) over an infinite ground backdrop
 * ({@link GroundBackdropLayer}), occupant houses in filled placeholder slots
 * ({@link PlaceholderHouseLayer}), and ambient pedestrians walking the recovered street graph
 * ({@link PedestrianLayer}) — all under a pan/zoom camera with a tap-to-follow pedestrian lock.
 *
 * PRESENTATIONAL over the layout: {@link ./useMarketWorld} is called by
 * {@link ./NightMarketEnginePage}, which owns the load state and renders the spinner/error. This
 * component receives the assembled world as a prop.
 *
 * ⚠️ Every sprite below is emitted FLAT into the single `sortableChildren` camera container — that
 * is what gives the market one global painter's sort across terrain, houses and walkers. Wrapping
 * a layer in its own container would re-isolate its depth. See docs/NIGHT_MARKET_FEATURE.md
 * § "Terrain performance" for the two React rules and the Pixi one that keep this affordable.
 */

/**
 * Per-overlay debug flags.
 *
 * Every overlay here reads the LIVE stitched world, so it stays truthful against what is actually
 * rendered. Two earlier overlays (a grass tint and per-tile sprite-stem labels) were removed
 * because they did not: they rebuilt the retired procedural `buildFarmField` plateau, which the
 * template terrain replaced, so they drew a field unrelated to what was on screen. An overlay that
 * can disagree with the render is worse than no overlay — do not add one back without pointing it
 * at the stitched world.
 */
export interface DebugFlags {
  /** Iso (0,0) origin crosshair. */
  origin: boolean;
  /** Outline each PLACED template's board rectangle + float its "name vN" over the center. */
  templateBounds: boolean;
  /** Outline each PLACEHOLDER occupant slot + label it (owning template + slot id, filled/empty tint). */
  placeholderBounds: boolean;
  /**
   * Route zoomed-out GROUND through the baked chunk cache instead of per-cell sprites
   * (docs/NIGHT_MARKET_TERRAIN_CHUNKING.md).
   *
   * Unlike the other three this is not an overlay — it changes how terrain is rendered.
   * It lives here because its failure mode (chunk seams, wrong occlusion) is judged by
   * LOOKING, so it needs an in-app A/B toggle, and because it must stay off by default
   * until it has been eyeballed across the zoom range on a real screen.
   */
  chunkedTerrain: boolean;
}

export const DEBUG_FLAG_KEYS: Array<keyof DebugFlags> = [
  'origin', 'templateBounds', 'placeholderBounds', 'chunkedTerrain',
];

export const ALL_DEBUG_OFF: DebugFlags = {
  origin: false, templateBounds: false, placeholderBounds: false, chunkedTerrain: false,
};

/**
 * The loaded world, as handed down from the page. This component is PRESENTATIONAL with respect
 * to the layout: {@link useMarketWorld} is called by {@link ./NightMarketEnginePage}, which owns
 * the load state so it can render the spinner/error itself. Passing the result down (rather than
 * fetching in the scene) is also what lets the camera read the placement rectangles directly —
 * see {@link MarketEngineViewerProps.world}.
 */
type LoadedWorld = Pick<UseMarketWorldResult, 'world' | 'width' | 'height' | 'field' | 'placements'>;

export interface MarketEngineViewerProps {
  /** Render the isometric debug grid (fine green + major red lines). Default false. */
  showGrid?: boolean;
  /** Per-overlay debug toggles. Omitted flags default to off. */
  debug?: DebugFlags;
  /**
   * Ambient pedestrian count — the load-test knob (docs/REACT_NATIVE_MIGRATION.md action item 4a).
   *
   * Deliberately NOT a `DebugFlags` member: those are booleans, and this is the independent
   * variable of an experiment rather than an overlay. Omit for the normal ambient population.
   */
  pedCount?: number;
  /**
   * The loaded layout. Its `placements` are also the camera's size input: they derive the
   * zoom-out floor ({@link computeMinZoom}) and the pan clamp ({@link clampPan}). Before this was
   * a prop the scene fetched the world itself and had to report the rectangles back UP through an
   * `onFootprintsChange` callback; owning the load at the page removes that back-edge entirely.
   */
  world: LoadedWorld;
}

interface SceneProps extends LoadedWorld {
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
  showGrid?: boolean;
  debug: DebugFlags;
  /** Ambient pedestrian count; see {@link MarketEngineViewerProps.pedCount}. */
  pedCount?: number;
  /** Ref set to true by the outer component during a pinch gesture — suppresses Pixi drag. */
  isPinchingRef?: React.RefObject<boolean>;
  /** Id of the ped the camera is locked onto, or null. See "Pedestrian camera lock" below. */
  lockedPedId: string | null;
  /** Set/clear the pedestrian lock — called on a ped tap, and on a real pan drag (which releases). */
  onLockedPedChange: (id: string | null) => void;
}

// ─── Pedestrian camera lock ──────────────────────────────────────────────────
// Tapping a walker locks the camera onto it: every frame the pan eases toward the pan that centres
// that ped (engine/market/cameraFollow). The lock is released by the user taking the camera back —
// a pan drag past PAN_RELEASE_SLOP_PX here, or any wheel/pinch zoom via useCameraControls'
// `onZoomGesture`. Zoom is never changed by the lock itself.
//
// The slop exists so the tap that CREATES the lock can't cancel it: a finger always jitters a pixel
// or two between down and up, and the stage sees that same pointer stream as a (tiny) drag.

const PAN_RELEASE_SLOP_PX = 6;

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
interface PedestrianTickerProps {
  pedestrians: ReturnType<typeof usePixiPedestrians>;
  /** Ped the camera is chasing, or null for a free camera. */
  lockedPedId: string | null;
  onLockedPedChange: (id: string | null) => void;
  /** Live camera, for the follow step. `panRef` (not a `pan` prop) so the tick reads the pan the
   *  host has actually committed, without this leaf re-rendering on every pan. */
  panRef: React.RefObject<{ x: number; y: number }>;
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
}

function PedestrianTicker({
  pedestrians, lockedPedId, onLockedPedChange, panRef, zoom, onPanChange,
}: PedestrianTickerProps) {
  const [, setFrame] = useState(0);

  // The tick callback is registered by Pixi and must not go stale between renders — mirror the
  // follow inputs into a ref rather than re-subscribing the ticker whenever the zoom changes.
  const followRef = useRef({ lockedPedId, panRef, zoom, onPanChange, onLockedPedChange });
  followRef.current = { lockedPedId, panRef, zoom, onPanChange, onLockedPedChange };

  // This frame's drawables, computed ONCE per tick. `getDrawables()` re-runs `computeDrawable` for
  // every walker and allocates a fresh array, so the tick and the render below must share one
  // result rather than each asking for their own.
  const drawablesRef = useRef(pedestrians.getDrawables());

  useTick((ticker) => {
    const now = performance.now();
    nmpPerf.frame(now); // dev-only; see ./nmpPerf for how to switch it on
    pedestrians.tick(ticker.deltaMS, now);
    const drawables = pedestrians.getDrawables();
    drawablesRef.current = drawables;

    // Camera lock: ease the pan toward the locked ped AFTER the FSM has moved it this frame, so the
    // camera chases the position actually about to be drawn (no one-frame lag). Writing through
    // `onPanChange` means the follow is clamped by the same pan bounds as a manual drag.
    const follow = followRef.current;
    if (follow.lockedPedId) {
      const target = drawables.find((d) => d.id === follow.lockedPedId);
      if (target) {
        const desired = followPanFor(target.isoX, target.isoY, follow.zoom);
        const next = approachPan(follow.panRef.current, desired, ticker.deltaMS);
        // `approachPan` returns the target verbatim once settled, so a stationary ped stops writing.
        if (next.x !== follow.panRef.current.x || next.y !== follow.panRef.current.y) {
          follow.onPanChange(next);
        }
      }
      // A ped that vanished from the sim (a re-seed on world reload) leaves the lock dangling —
      // drop it so the camera doesn't silently freeze.
      else follow.onLockedPedChange(null);
    }

    setFrame((f) => (f + 1) % 1_000_000);
  });

  return (
    <PedestrianLayer
      drawables={drawablesRef.current}
      lockedPedId={lockedPedId}
      onPedTap={onLockedPedChange}
    />
  );
}

// ─── Scene ─────────────────────────────────────────────────────────────────
// Runs inside <Application>. Handles drag-to-pan and renders the terrain.

function NightMarketScene({
  pan, zoom, onPanChange, showGrid, debug, pedCount, isPinchingRef,
  world, width, height, field, placements,
  lockedPedId, onLockedPedChange,
}: SceneProps) {
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
  const onLockedPedChangeRef = useRef(onLockedPedChange);
  onLockedPedChangeRef.current = onLockedPedChange;
  const lockedPedIdRef = useRef(lockedPedId);
  lockedPedIdRef.current = lockedPedId;

  // Slice-2 pedestrians: ambient walkers seeded on the recovered graph. The hook re-seeds
  // when the graph identity changes (first load / version switch) and no-ops while null.
  const pedestrians = usePixiPedestrians({
    tileGraph: world?.tileGraph ?? null,
    streetGraph: world?.streetGraph ?? null,
    count: pedCount,
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
      // The user has taken the camera back — drop any pedestrian lock before applying the drag, or
      // the follow would immediately drag the pan back onto the ped. Slop-gated so the tap that
      // sets the lock (which the stage also sees as a pointer stream) doesn't cancel it.
      if (lockedPedIdRef.current && Math.hypot(dx, dy) > PAN_RELEASE_SLOP_PX) {
        onLockedPedChangeRef.current(null);
        // Re-anchor the drag to here and now: `origPan` was captured at pointerdown, but the follow
        // has been moving the camera ever since, so continuing from it would snap the world back.
        drag.current = {
          active: true,
          startX: e.global.x,
          startY: e.global.y,
          origPanX: panRef.current.x,
          origPanY: panRef.current.y,
        };
        return;
      }
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
  // edges, so the memo below re-runs only every few cells of travel, not on every dragged pixel
  // (this scene re-renders on every committed pan, and once per frame under a pedestrian lock).
  // The window it returns is a DIAMOND, not just a box — see `visibleCellWindow`.
  const screenW = app?.renderer ? app.screen.width : 0;
  const screenH = app?.renderer ? app.screen.height : 0;
  const cullWindow = useMemo(
    () => visibleCellWindow(pan, zoom, screenW, screenH),
    [pan, zoom, screenW, screenH],
  );

  // Census: the numbers that decide whether the lag is "this market is genuinely enormous" or
  // "something is rebuilding that shouldn't". `world` is the authored span; `window` is what the
  // camera can currently see, and is what the terrain actually builds. See ./nmpPerf.
  //
  // In an EFFECT, not the render body: `nmpPerf.count` mutates module state and schedules a
  // `setTimeout`, and this component re-renders on every pan (and every frame while a pedestrian
  // lock is active). A side effect in the render body would fire on renders React discards.
  useEffect(() => {
    nmpPerf.count('world-cells', width * height);
    nmpPerf.count(
      'window-cells',
      (cullWindow.maxCol - cullWindow.minCol + 1) * (cullWindow.maxRow - cullWindow.minRow + 1),
    );
  }, [width, height, cullWindow]);

  // The load the scene is under. `note` (not `count`) because it describes the EXPERIMENT and must
  // survive every report window, and `load` so it also rides on the shipped frame records — a frame
  // time with no pedestrian count attached cannot be plotted against anything.
  //
  // Reads the population through a ref: the hook returns a fresh handle object every render, so
  // depending on it directly would re-run this effect on every pan and every locked-camera frame.
  const pedestriansRef = useRef(pedestrians);
  pedestriansRef.current = pedestrians;
  useEffect(() => {
    const n = pedestriansRef.current.getStates().length;
    nmpPerf.note('pedestrians', String(n));
    nmpPerf.load(`peds=${n}`);
  }, [pedCount, world]);

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
            chunked={debug.chunkedTerrain}
            camera={{ zoom, pan, viewportW: screenW, viewportH: screenH }}
          />
        )}
        {/* Occupant markers: a house (or two adjacent houses) in each FILLED placeholder slot
            (temporary stand-in until the real stand-asset catalog exists). Cosmetic only — not in
            the graph. */}
        {world && <PlaceholderHouseLayer placeholders={world.placeholderAreas} />}
        {world && (
          <PedestrianTicker
            pedestrians={pedestrians}
            lockedPedId={lockedPedId}
            onLockedPedChange={onLockedPedChange}
            panRef={panRef}
            zoom={zoom}
            onPanChange={onPanChange}
          />
        )}
        {/* Template/placeholder bounds read the STITCHED layout (placements + world.placeholderAreas),
            so unlike the two overlays below they stay correct against the real template render. */}
        {debug.templateBounds && <TemplateBoundsOverlay templates={placements} />}
        {debug.placeholderBounds && world && (
          <PlaceholderBoundsOverlay placeholders={world.placeholderAreas} />
        )}
        {debug.origin && <OriginOverlay />}
      </CameraZoomProvider>
    </pixiContainer>
  );
}

// ─── MarketEngineViewer ───────────────────────────────────────────────────────
// Outer component: pan/zoom state, gesture handlers, Application mount.

function MarketEngineViewer({ showGrid, debug = ALL_DEBUG_OFF, pedCount, world }: MarketEngineViewerProps) {
  // The loaded layout's placement rectangles. Mirrored into a ref because the camera-limit
  // callbacks below are called by `useCameraControls` mid-gesture and must read the CURRENT
  // placements without being re-created (and re-subscribed) on every render.
  const footprintsRef = useRef<CellFootprint[]>(world.placements);
  footprintsRef.current = world.placements;

  // Pedestrian camera lock: the ped the camera is chasing, or null for a free camera. State (not a
  // ref) because the ring in <PedestrianLayer> has to re-render when it changes; it changes at most
  // once per gesture, so it costs nothing per frame.
  const [lockedPedId, setLockedPedId] = useState<string | null>(null);

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
    // Wheel/pinch = the user grabbing the camera → release the pedestrian lock. The pan-drag half of
    // that rule lives in the scene, which is where drags are read.
    onZoomGesture: () => setLockedPedId(null),
  });

  // The clamp's inputs move without the pan moving — the world finishes loading (or reloads after
  // the author minute-adjust tool grows the continent) — and nothing else would notice that the
  // standing pan has gone out of bounds. `placements` is a fresh array per load, so its identity is
  // exactly the "the world changed size" signal.
  useEffect(() => {
    reclampPan();
  }, [world.placements, reclampPan]);

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
            pedCount={pedCount}
            isPinchingRef={isPinchingRef}
            world={world.world}
            width={world.width}
            height={world.height}
            field={world.field}
            placements={world.placements}
            lockedPedId={lockedPedId}
            onLockedPedChange={setLockedPedId}
          />
        </Application>
      )}
    </Box>
  );
}

export default MarketEngineViewer;
