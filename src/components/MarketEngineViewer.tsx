import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useTick, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text, Assets, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box, CircularProgress, Alert } from '@mui/material';
import { TILE_SIZE, type FrameAnimation, type MotionSpec } from '../config/nightMarketRegistry';
import { evaluateMotion } from '../utils/nightMarketMotion';
import { isoToScreen, computeLayerZ, computePedestrianZ } from '../utils/isometric';
import { TILES, DEMO_STALLS, STREETS, STREET_GRAPH, FLOOR_TILE_IMAGE_PATH, FLOOR_TILE_SCALE } from '../config/tileRegistry';
import type { UsePixiPedestriansHandle } from '../hooks/usePixiPedestrians';

// Register Pixi.js classes as pixiContainer / pixiSprite / pixiGraphics / pixiText JSX elements.
extend({ Container, Sprite, Graphics, Text });

export interface EngineLayer {
  imagePath: string;
  x: number;        // screen-space X relative to viewport center
  y: number;        // screen-space Y relative to viewport center
  zIndex: number;
  scale: number;
  groupId: string;
  motions?: MotionSpec[];
  frameAnimation?: FrameAnimation;
}

/** Per-overlay debug flags. Each toggles a single debug label/outline layer. */
export interface DebugFlags {
  footprints: boolean;
  standLabels: boolean;
  streetLabels: boolean;
  pedestrianStates: boolean;
  origin: boolean;
  coordinates: boolean;
  tileInfo: boolean;
  frozen: boolean;
}

export const DEBUG_FLAG_KEYS: Array<keyof DebugFlags> = [
  'footprints', 'standLabels', 'streetLabels', 'pedestrianStates', 'origin', 'coordinates', 'tileInfo', 'frozen',
];

export const ALL_DEBUG_OFF: DebugFlags = {
  footprints: false, standLabels: false, streetLabels: false, pedestrianStates: false, origin: false, coordinates: false, tileInfo: false, frozen: false,
};

// Note: `frozen` is intentionally excluded from `ALL_DEBUG_ON` — it changes
// simulation behavior, not just visibility.
export const ALL_DEBUG_ON: DebugFlags = {
  footprints: true, standLabels: true, streetLabels: true, pedestrianStates: true, origin: true, coordinates: true, tileInfo: true, frozen: false,
};

export interface MarketEngineViewerProps {
  layers: EngineLayer[];
  onLayerTap?: (id: string | number) => void;
  /** Pixi-native pedestrian handle. When provided, pedestrians are ticked via
   *  Pixi's useTick and rendered z-sorted alongside static layers. */
  pedestrians?: UsePixiPedestriansHandle;
  /** Render the isometric debug grid (fine green + major red lines). Default false. */
  showGrid?: boolean;
  /** Per-overlay debug toggles. Omitted flags default to off. */
  debug?: DebugFlags;
}

interface SceneProps {
  layers: EngineLayer[];
  textures: Map<string, Texture>;
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
  onLayerTap?: (id: string | number) => void;
  pedestrians?: UsePixiPedestriansHandle;
  showGrid?: boolean;
  debug: DebugFlags;
  /** Ref set to true by the outer component during a pinch gesture — suppresses Pixi drag. */
  isPinchingRef?: React.RefObject<boolean>;
}

const TAP_MAX_DIST = 5;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5.0;

// ─── Grid overlay ────────────────────────────────────────────────────────────
// Static isometric debug grid. Fine lines mark every 5 tiles (green);
// major lines mark every 25 tiles (red, every 5 green lines).
// Drawn once since the grid never changes.

const GRID_MIN = -500;
const GRID_MAX = 500;

// Sits above the tile floor (which uses background z - 1000) but below any
// entity (entity z = -(isoX+isoY) + slotFraction, typically >> -999).
const GRID_Z = -999;

function GridOverlay() {
  const draw = useCallback((g: Graphics) => {
    g.clear();

    // Batch all lines per style, then stroke once — avoids redundant draw calls.
    const drawGridLines = (step: number, color: number, alpha: number, lineWidth: number) => {
      for (let v = GRID_MIN; v <= GRID_MAX; v += step) {
        // Constant-isoX lines (vary isoY)
        const a = isoToScreen(v, GRID_MIN);
        const b = isoToScreen(v, GRID_MAX);
        g.moveTo(a.screenX, a.screenY);
        g.lineTo(b.screenX, b.screenY);
        // Constant-isoY lines (vary isoX)
        const c = isoToScreen(GRID_MIN, v);
        const d = isoToScreen(GRID_MAX, v);
        g.moveTo(c.screenX, c.screenY);
        g.lineTo(d.screenX, d.screenY);
      }
      g.stroke({ color, width: lineWidth, alpha });
    };

    drawGridLines(TILE_SIZE * 5, 0x00C800, 0.5, 1);      // fine: every 5 tiles (green)
    drawGridLines(TILE_SIZE * 25, 0xFF0000, 0.9, 1.5);   // major: every 25 tiles / 5 green (red)
  }, []);

  return <pixiGraphics draw={draw} zIndex={GRID_Z} />;
}

// ─── Footprint outline overlay ───────────────────────────────────────────────
// Strokes the outer perimeter of each stand's footprint as an isometric rhombus
// so the authored tile geometry can be visually inspected against floor tiles
// and adjacent stalls. Gated behind showDebug.
//
// Footprints are rectangular blocks of tiles; the screen-space outline is the
// rhombus whose vertices are the iso corners of that block. Per-tile sprites
// anchor at (0.5, 1) — bottom vertex of the diamond at the tile's iso position —
// so the outer perimeter corners in iso space are (+isoY = north on screen,
// so the smallest-iso corner sits at the bottom of the diamond):
//   south  = (minIsoX,     minIsoY)
//   east   = (maxIsoX + 1, minIsoY)
//   north  = (maxIsoX + 1, maxIsoY + 1)
//   west   = (minIsoX,     maxIsoY + 1)

// Sits just above GridOverlay so outlines render over the grid but still
// below stand sprites (entity z = -(isoX+isoY)+slot, typically >> -998).
const FOOTPRINT_OUTLINE_Z = -998;

// Labels must always float above every sprite. Sprite z-indices are bounded
// by -(isoX+isoY)+slot_fraction, with isoX+isoY ranging ~-150..210, so the
// max sprite z is ~150.5. Use a large constant to guarantee labels are on top.
const LABEL_Z = 10_000;
const FOOTPRINT_OUTLINE_COLOR = 0xffd24a;

function FootprintOutlineOverlay() {
  const rhombi = useMemo(() => {
    return DEMO_STALLS.map(stand => {
      const fp = stand.footprint;
      if (!fp || fp.length === 0) return null;
      let minIsoX = Infinity, maxIsoX = -Infinity, minIsoY = Infinity, maxIsoY = -Infinity;
      for (const t of fp) {
        if (t.isoX < minIsoX) minIsoX = t.isoX;
        if (t.isoX > maxIsoX) maxIsoX = t.isoX;
        if (t.isoY < minIsoY) minIsoY = t.isoY;
        if (t.isoY > maxIsoY) maxIsoY = t.isoY;
      }
      const south = isoToScreen(minIsoX,     minIsoY);
      const east  = isoToScreen(maxIsoX + 1, minIsoY);
      const north = isoToScreen(maxIsoX + 1, maxIsoY + 1);
      const west  = isoToScreen(minIsoX,     maxIsoY + 1);
      return { south, east, north, west };
    }).filter((r): r is NonNullable<typeof r> => r !== null);
  }, []);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    for (const r of rhombi) {
      g.moveTo(r.south.screenX, r.south.screenY);
      g.lineTo(r.east.screenX,  r.east.screenY);
      g.lineTo(r.north.screenX, r.north.screenY);
      g.lineTo(r.west.screenX,  r.west.screenY);
      g.closePath();
    }
    g.stroke({ color: FOOTPRINT_OUTLINE_COLOR, width: 2, alpha: 0.9 });
  }, [rhombi]);

  return <pixiGraphics draw={draw} zIndex={FOOTPRINT_OUTLINE_Z} />;
}

// ─── Tile floor overlay ──────────────────────────────────────────────────────
// Renders one floor.png sprite per walkable tile, z-ordered as background so
// it sits behind every stand / pedestrian. Computed once since the tile
// registry is static.

interface TileFloorOverlayProps {
  texture: Texture;
}

function TileFloorOverlay({ texture }: TileFloorOverlayProps) {
  const positions = useMemo(
    () =>
      TILES.map(t => {
        const { screenX, screenY } = isoToScreen(t.isoX, t.isoY);
        return {
          key: tileKey(t.isoX, t.isoY),
          x: screenX,
          y: screenY,
          // Slightly behind every entity but in front of the page background.
          zIndex: computeLayerZ(t.isoX, t.isoY, 'background') - 1000,
          hasConnection: !!t.connections?.length,
        };
      }),
    [],
  );

  // No wrapping container — sprites are returned as a fragment so they become
  // direct children of the scene container and sort against stands / peds via
  // the scene's `sortableChildren`.
  return (
    <>
      {positions.map(p => (
        <pixiSprite
          key={p.key}
          texture={texture}
          x={p.x}
          y={p.y}
          scale={FLOOR_TILE_SCALE}
          anchor={{ x: 0.5, y: 1 }}
          zIndex={p.zIndex}
          tint={p.hasConnection ? 0xffe6a0 : 0xffffff}
          eventMode="none"
        />
      ))}
    </>
  );
}

// Shared tileKey helper to avoid pulling in the util file just for this.
const tileKey = (x: number, y: number) => `${x},${y}`;

// ─── Pedestrian debug labels ──────────────────────────────────────────────────
// Renders one text label per pedestrian showing FSM state + target POI name (if
// Traveling). Floated above the sprite anchor (screenY) so labels don't z-sort
// against scene geometry. Gated behind showDebug.

const PED_LABEL_STATE_STYLE = {
  fontSize: 150,
  fill: 0x000000,
  fontFamily: 'monospace',
  stroke: { color: 0xffffff, width: 14 },
  align: 'center' as const,
  fontWeight: 'bold' as const,
};

const PED_LABEL_POI_STYLE = {
  fontSize: 135,
  fill: 0xffe066,
  fontFamily: 'monospace',
  stroke: { color: 0x000000, width: 12 },
  align: 'center' as const,
};

// Offset moves the label container high enough so:
// - State text (150px, anchor y=1) sits above y=0
// - POI text (135px, anchor y=0) hangs below y=0
// Container must be at least 300px above the sprite foot anchor to avoid overlap.
const PED_LABEL_OFFSET_Y = -300;

interface PedestrianDebugLabelsProps {
  pedestrians: UsePixiPedestriansHandle;
}

function PedestrianDebugLabels({ pedestrians }: PedestrianDebugLabelsProps) {
  const drawables = pedestrians.getDrawables();

  return (
    <pixiContainer zIndex={LABEL_Z}>
      {drawables.map(d => {
        const { screenX, screenY } = isoToScreen(d.isoX, d.isoY);
        const labelY = screenY + PED_LABEL_OFFSET_Y;
        return (
          <pixiContainer key={d.id} x={screenX} y={labelY}>
            {/* FSM state name */}
            <pixiText
              text={d.fsmState}
              x={0}
              y={0}
              anchor={{ x: 0.5, y: 1 }}
              style={PED_LABEL_STATE_STYLE}
            />
            {/* Target POI name — only shown while Traveling */}
            {d.fsmState === 'Traveling' && d.targetPoiDisplayName && (
              <pixiText
                text={`→ ${d.targetPoiDisplayName}`}
                x={0}
                y={2}
                anchor={{ x: 0.5, y: 0 }}
                style={PED_LABEL_POI_STYLE}
              />
            )}
          </pixiContainer>
        );
      })}
    </pixiContainer>
  );
}

// ─── Origin marker overlay ──────────────────────────────────────────────────
// Iso-axis crosshair at iso (0, 0) so the coordinate system is visually grounded
// while debugging. Arms run along the iso X (east↔west) and iso Y (north↔south)
// axes so they trace two of the major grid lines exactly. Gated behind debug.origin.

// Half-arm length in ISO TILE UNITS. Each arm spans this many tiles outward
// from the origin (so a value of 5 means the crosshair covers a 10×10-tile area).
const ORIGIN_MARKER_ARM_ISO = 5;
const ORIGIN_MARKER_WIDTH = 5;       // stroke thickness in pre-zoom screen px

function OriginOverlay() {
  const drawMarker = useCallback((g: Graphics) => {
    g.clear();
    // Iso-axis arms: east↔west along +/-isoX, north↔south along +/-isoY.
    const east  = isoToScreen( ORIGIN_MARKER_ARM_ISO, 0);
    const west  = isoToScreen(-ORIGIN_MARKER_ARM_ISO, 0);
    const north = isoToScreen(0,  ORIGIN_MARKER_ARM_ISO);
    const south = isoToScreen(0, -ORIGIN_MARKER_ARM_ISO);
    g.moveTo(west.screenX,  west.screenY);
    g.lineTo(east.screenX,  east.screenY);
    g.moveTo(south.screenX, south.screenY);
    g.lineTo(north.screenX, north.screenY);
    g.stroke({ color: 0x00ffff, width: ORIGIN_MARKER_WIDTH, alpha: 1 });
  }, []);

  return (
    <pixiContainer zIndex={LABEL_Z}>
      <pixiGraphics draw={drawMarker} />
    </pixiContainer>
  );
}

// ─── Stand label overlay ─────────────────────────────────────────────────────
// One text label per stand, placed at the stand's anchor (SW corner of the 2×2
// footprint) and lifted vertically so it floats above the stall sprite. Gated
// behind showDebug.

const STAND_LABEL_STYLE = {
  fontSize: 120,
  fill: 0xffffff,
  fontFamily: 'monospace',
  stroke: { color: 0x000000, width: 12 },
  align: 'center' as const,
  fontWeight: 'bold' as const,
};

const STAND_LABEL_OFFSET_Y = -200;

function StandLabelOverlay() {
  const positions = useMemo(
    () =>
      DEMO_STALLS.map(s => {
        const { screenX, screenY } = isoToScreen(s.isoX, s.isoY);
        return { id: s.assetId, name: s.displayName, x: screenX, y: screenY + STAND_LABEL_OFFSET_Y };
      }),
    [],
  );
  return (
    <pixiContainer zIndex={LABEL_Z}>
      {positions.map(p => (
        <pixiText
          key={p.id}
          text={p.name}
          x={p.x}
          y={p.y}
          anchor={{ x: 0.5, y: 1 }}
          style={STAND_LABEL_STYLE}
        />
      ))}
    </pixiContainer>
  );
}

// ─── Pedestrian name overlay ────────────────────────────────────────────────
// Renders one text label per pedestrian showing its id. Floated above the
// sprite anchor so it doesn't z-sort against scene geometry. Gated behind
// debug.standLabels (the "display names" toggle covers both stands and peds).

const PED_NAME_STYLE = {
  fontSize: 50,
  fill: 0xffffff,
  fontFamily: 'monospace',
  stroke: { color: 0x000000, width: 6 },
  align: 'center' as const,
  fontWeight: 'bold' as const,
};

// Lifted higher than the FSM state label so the two don't collide when both
// toggles are active.
const PED_NAME_OFFSET_Y = -460;

interface PedestrianNameLabelsProps {
  pedestrians: UsePixiPedestriansHandle;
}

function PedestrianNameLabels({ pedestrians }: PedestrianNameLabelsProps) {
  const drawables = pedestrians.getDrawables();
  return (
    <pixiContainer zIndex={LABEL_Z}>
      {drawables.map(d => {
        const { screenX, screenY } = isoToScreen(d.isoX, d.isoY);
        return (
          <pixiText
            key={d.id}
            text={d.id}
            x={screenX}
            y={screenY + PED_NAME_OFFSET_Y}
            anchor={{ x: 0.5, y: 1 }}
            style={PED_NAME_STYLE}
          />
        );
      })}
    </pixiContainer>
  );
}

// ─── Street label overlay ───────────────────────────────────────────────────
// One text label per Street, placed at the street's iso midpoint and lifted
// slightly so it floats above the walkway floor. Gated behind showDebug.

const STREET_LABEL_STYLE = {
  fontSize: 180,
  fill: 0xff0000,
  fontFamily: 'monospace',
  align: 'center' as const,
  fontStyle: 'italic' as const,
};

const STREET_LABEL_OFFSET_Y = -40;

function StreetLabelOverlay() {
  const positions = useMemo(
    () =>
      STREETS.map(s => {
        // Midpoint along the primary axis; centered across the street's width.
        const mid = (s.start + s.end) / 2;
        const perpMid = s.offset + (s.width - 1) / 2;
        const isoX = s.isNorthSouth ? perpMid : mid;
        const isoY = s.isNorthSouth ? mid : perpMid;
        const { screenX, screenY } = isoToScreen(isoX, isoY);
        return { name: s.name, x: screenX, y: screenY + STREET_LABEL_OFFSET_Y };
      }),
    [],
  );
  return (
    <pixiContainer zIndex={LABEL_Z}>
      {positions.map(p => (
        <pixiText
          key={p.name}
          text={p.name}
          x={p.x}
          y={p.y}
          anchor={{ x: 0.5, y: 0.5 }}
          style={STREET_LABEL_STYLE}
        />
      ))}
    </pixiContainer>
  );
}

// ─── Coordinate label overlay ────────────────────────────────────────────────
// (isoX, isoY) labels for every demo stand (cyan, static) and every pedestrian
// (green, ticked). Lets you visually verify authored stall placement and watch
// pedestrian movement in iso space without console logging.

const STAND_COORD_STYLE = {
  fontSize: 90,
  fill: 0x66e0ff,
  fontFamily: 'monospace',
  stroke: { color: 0x000000, width: 10 },
  align: 'center' as const,
  fontWeight: 'bold' as const,
};

const PED_COORD_STYLE = {
  fontSize: 90,
  fill: 0xaaffaa,
  fontFamily: 'monospace',
  stroke: { color: 0x000000, width: 10 },
  align: 'center' as const,
  fontWeight: 'bold' as const,
};

// Lifts the stand coord label slightly higher than the name label so the two
// don't sit on top of each other when both overlays are on.
const STAND_COORD_OFFSET_Y = -340;
// Ped coord sits just below the sprite foot so it doesn't fight the FSM-state
// label that sits well above the head (PED_LABEL_OFFSET_Y = -300).
const PED_COORD_OFFSET_Y = 30;

interface CoordinateLabelOverlayProps {
  pedestrians?: UsePixiPedestriansHandle;
}

function CoordinateLabelOverlay({ pedestrians }: CoordinateLabelOverlayProps) {
  const standPositions = useMemo(
    () =>
      DEMO_STALLS.map(s => {
        const { screenX, screenY } = isoToScreen(s.isoX, s.isoY);
        // Stand z shown as the base depth from computeLayerZ at the `background`
        // slot (which contributes 0). Per-layer slot offsets aren't surfaced
        // here since a stand is not a single z value.
        const baseZ = computeLayerZ(s.isoX, s.isoY, 'background');
        return {
          id: s.assetId,
          text: `(${s.isoX}, ${s.isoY}, z=${baseZ.toFixed(2)})`,
          x: screenX,
          y: screenY + STAND_COORD_OFFSET_Y,
        };
      }),
    [],
  );

  const pedDrawables = pedestrians?.getDrawables() ?? [];

  return (
    <pixiContainer zIndex={LABEL_Z}>
      {standPositions.map(p => (
        <pixiText
          key={`stand-${p.id}`}
          text={p.text}
          x={p.x}
          y={p.y}
          anchor={{ x: 0.5, y: 1 }}
          style={STAND_COORD_STYLE}
        />
      ))}
      {pedDrawables.map(d => {
        const { screenX, screenY } = isoToScreen(d.isoX, d.isoY);
        const pedZ = computePedestrianZ(d.isoX, d.isoY);
        return (
          <pixiText
            key={`ped-${d.id}`}
            text={`(${d.isoX.toFixed(1)}, ${d.isoY.toFixed(1)}, z=${pedZ.toFixed(1)})`}
            x={screenX}
            y={screenY + PED_COORD_OFFSET_Y}
            anchor={{ x: 0.5, y: 0 }}
            style={PED_COORD_STYLE}
          />
        );
      })}
    </pixiContainer>
  );
}

// ─── Tile info overlay ──────────────────────────────────────────────────────
// Per-tile small-font annotation showing which street graph entity owns the
// tile: node id, edge id, or just street name(s) for tiles that don't sit on
// the macro graph. Designed to be readable only when the user zooms in.

const TILE_INFO_STYLE = {
  fontSize: 12,
  fill: 0xffffaa,
  fontFamily: 'monospace',
  stroke: { color: 0x000000, width: 2 },
  align: 'center' as const,
};

/** Strip the long `node:Streets@x,y` prefix down to its `x,y` part. */
function shortNodeId(id: string): string {
  const at = id.lastIndexOf('@');
  return at >= 0 ? `N@${id.slice(at + 1)}` : id;
}

function TileInfoOverlay() {
  const labels = useMemo(
    () =>
      TILES.map(t => {
        const k = tileKey(t.isoX, t.isoY);
        const node = STREET_GRAPH.tileToNode.get(k);
        const edge = STREET_GRAPH.tileToEdge.get(k);
        let text: string;
        if (node) {
          text = shortNodeId(node.id);
        } else if (edge) {
          text = `E:${edge.street.name}`;
        } else {
          text = t.intersectingStreets?.map(s => s.name).join('|') || '-';
        }
        const { screenX, screenY } = isoToScreen(t.isoX, t.isoY);
        return { key: k, x: screenX, y: screenY, text };
      }),
    [],
  );
  return (
    <pixiContainer zIndex={LABEL_Z}>
      {labels.map(l => (
        <pixiText
          key={l.key}
          text={l.text}
          x={l.x}
          y={l.y}
          anchor={{ x: 0.5, y: 1 }}
          style={TILE_INFO_STYLE}
        />
      ))}
    </pixiContainer>
  );
}

// ─── NightMarketScene ────────────────────────────────────────────────────────
// Runs inside <Application>. Handles the animation tick, pan/tap events,
// walkway rendering, static layer sprites, and pedestrian sprites.

function NightMarketScene({ layers, textures, pan, zoom, onPanChange, onLayerTap, pedestrians, showGrid, debug, isPinchingRef }: SceneProps) {
  const { app } = useApplication();
  const [t, setT] = useState(0);
  const floorTexture = textures.get(FLOOR_TILE_IMAGE_PATH);

  // Drag tracking in refs — avoids extra re-renders during pan.
  const drag = useRef({ active: false, startX: 0, startY: 0, origPanX: 0, origPanY: 0, totalDist: 0 });

  // Stable callback refs so stage useEffect only runs once on mount.
  const panRef = useRef(pan);
  panRef.current = pan;
  const onPanChangeRef = useRef(onPanChange);
  onPanChangeRef.current = onPanChange;
  const onLayerTapRef = useRef(onLayerTap);
  onLayerTapRef.current = onLayerTap;

  // Pixi ticker drives both scene animation AND pedestrian simulation.
  // One RAF loop handles everything — no parallel requestAnimationFrame.
  useTick((ticker) => {
    const dtMs = ticker.deltaMS;
    setT(prev => prev + dtMs);
    if (pedestrians) {
      pedestrians.tick(dtMs, performance.now());
    }
  });

  // Stage pointer events: drag-to-pan + tap detection.
  useEffect(() => {
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
        totalDist: 0,
      };
    };

    const onMove = (e: FederatedPointerEvent) => {
      if (isPinchingRef?.current) return; // suppress drag during pinch gesture
      if (!drag.current.active) return;
      const dx = e.global.x - drag.current.startX;
      const dy = e.global.y - drag.current.startY;
      drag.current.totalDist = Math.sqrt(dx * dx + dy * dy);
      onPanChangeRef.current({ x: drag.current.origPanX + dx, y: drag.current.origPanY + dy });
    };

    const onUp = (e: FederatedPointerEvent) => {
      if (drag.current.active && drag.current.totalDist < TAP_MAX_DIST) {
        const target = e.target;
        if (target && target !== stage) {
          const label = (target as Container).label;
          if (label) {
            const numVal = Number(label);
            onLayerTapRef.current?.(isNaN(numVal) ? label : numVal);
          }
        }
      }
      drag.current.active = false;
    };

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
  }, [app]);

  // ── Static layers with motion + frame animation applied ──────────────────
  const computedLayers = useMemo(() => {
    return layers.map((layer, index) => {
      let dX = 0;
      let dY = 0;
      if (layer.motions?.length) {
        for (const spec of layer.motions) {
          const { dIsoX, dIsoY } = evaluateMotion(spec, t);
          // isoToScreen is linear through origin so deltas compose directly.
          const { screenX, screenY } = isoToScreen(dIsoX, dIsoY);
          dX += screenX;
          dY += screenY;
        }
      }
      let texKey = layer.imagePath;
      if (layer.frameAnimation) {
        const paths = layer.frameAnimation.imagePaths;
        const rawIdx = Math.floor((t * layer.frameAnimation.fps) / 1000);
        const loop = layer.frameAnimation.loop ?? true;
        texKey = paths[loop ? rawIdx % paths.length : Math.min(rawIdx, paths.length - 1)];
      }
      return { layer, index, finalX: layer.x + dX, finalY: layer.y + dY, texKey };
    });
  }, [layers, t]);

  // ── Unified render list: static layers + pedestrians, sorted back-to-front ─
  // Pedestrians carry their own isoX/isoY so they z-sort correctly against stalls.
  const allSprites = useMemo(() => {
    type SpriteEntry = {
      key: string;
      x: number;
      y: number;
      zIndex: number;
      texKey: string;
      scale: number;
      label: string;
      tappable: boolean;
    };

    const items: SpriteEntry[] = computedLayers.map(({ layer, index, finalX, finalY, texKey }) => ({
      key: `layer-${index}`,
      x: finalX,
      y: finalY,
      zIndex: layer.zIndex,
      texKey,
      scale: layer.scale,
      label: layer.groupId ?? String(index),
      tappable: true,
    }));

    if (pedestrians) {
      for (const d of pedestrians.getDrawables()) {
        // Peds anchor at the southern (bottom) vertex of their current tile —
        // same model as stands. d.isoX/d.isoY name the tile's SW corner.
        const { screenX, screenY } = isoToScreen(d.isoX, d.isoY);
        items.push({
          key: `ped-${d.id}`,
          x: screenX,
          y: screenY,
          zIndex: computePedestrianZ(d.isoX, d.isoY),
          texKey: d.imagePath,
          scale: d.scale,
          label: d.id,   // ped IDs don't match any asset — taps won't open a dialog
          tappable: false,
        });
      }
    }

    // No manual sort — the parent <pixiContainer sortableChildren> handles z-order.
    return items;
  }, [computedLayers, pedestrians]);

  const cx = app.screen.width / 2 + pan.x;
  const cy = app.screen.height / 2 + pan.y;

  return (
    <pixiContainer x={cx} y={cy} scale={zoom} sortableChildren>
      {showGrid && <GridOverlay />}
      {floorTexture && <TileFloorOverlay texture={floorTexture} />}
      {allSprites.map(({ key, x, y, zIndex, texKey, scale, label, tappable }) => {
        const texture = textures.get(texKey);
        if (!texture) return null;
        return (
          <pixiSprite
            key={key}
            texture={texture}
            x={x}
            y={y}
            scale={scale}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={zIndex}
            eventMode={tappable ? 'static' : 'none'}
            label={label}
          />
        );
      })}
      {debug.footprints && <FootprintOutlineOverlay />}
      {debug.origin && <OriginOverlay />}
      {debug.standLabels && <StandLabelOverlay />}
      {debug.standLabels && pedestrians && <PedestrianNameLabels pedestrians={pedestrians} />}
      {debug.streetLabels && <StreetLabelOverlay />}
      {debug.pedestrianStates && pedestrians && <PedestrianDebugLabels pedestrians={pedestrians} />}
      {debug.coordinates && <CoordinateLabelOverlay pedestrians={pedestrians} />}
      {debug.tileInfo && <TileInfoOverlay />}
    </pixiContainer>
  );
}

// ─── MarketEngineViewer ───────────────────────────────────────────────────────
// Outer component: texture loading, pan/zoom state, Application mount.

function MarketEngineViewer({ layers, onLayerTap, pedestrians, showGrid, debug = ALL_DEBUG_OFF }: MarketEngineViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.25);
  const [textures, setTextures] = useState<Map<string, Texture> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Refs kept in sync with state so event handlers always read the latest values
  // without needing to be recreated on every render.
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Set to true while a 2-finger pinch is active — suppresses Pixi drag handler.
  const isPinchingRef = useRef(false);

  // Tracks pinch gesture start state so zoom/pan are computed relative to initial contact.
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, startPanX: 0, startPanY: 0, midX: 0, midY: 0 });

  useEffect(() => {
    if (containerRef.current) setReady(true);
  }, []);

  // All unique image paths: static layer images + pedestrian sprite images
  // + the floor-tile sprite used by every walkable tile.
  const allImagePaths = useMemo(() => {
    const paths = new Set<string>();
    paths.add(FLOOR_TILE_IMAGE_PATH);
    for (const layer of layers) {
      if (layer.frameAnimation) {
        for (const p of layer.frameAnimation.imagePaths) paths.add(p);
      } else {
        paths.add(layer.imagePath);
      }
    }
    if (pedestrians) {
      for (const p of pedestrians.spriteImagePaths) paths.add(p);
    }
    return Array.from(paths);
  }, [layers, pedestrians]);

  useEffect(() => {
    if (allImagePaths.length === 0) {
      setTextures(new Map());
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const entries = await Promise.all(
          allImagePaths.map(async (path) => {
            const tex = await Assets.load<Texture>(path);
            return [path, tex] as const;
          })
        );
        if (!cancelled) setTextures(new Map(entries));
      } catch (err) {
        if (!cancelled) setLoadError(`Failed to load textures: ${err}`);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [allImagePaths]);

  // Compute new zoom and adjust pan so the focal point (cursor / pinch midpoint)
  // stays fixed in screen space: pan' = focalOffset * (1 - ratio) + pan * ratio.
  const applyZoomAtPoint = useCallback((focalX: number, focalY: number, newZoom: number) => {
    const el = containerRef.current;
    if (!el) return;
    const ratio = newZoom / zoomRef.current;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const newPan = {
      x: (focalX - w / 2) * (1 - ratio) + panRef.current.x * ratio,
      y: (focalY - h / 2) * (1 - ratio) + panRef.current.y * ratio,
    };
    // Sync refs immediately so rapid events read the updated values before re-render.
    zoomRef.current = newZoom;
    panRef.current = newPan;
    setZoom(newZoom);
    setPan(newPan);
  }, []);

  // Wheel zoom centered on the cursor position.
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * (1 - e.deltaY * 0.001)));
    applyZoomAtPoint(mouseX, mouseY, newZoom);
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
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchRef.current.startZoom * scale));
    const ratio = newZoom / pinchRef.current.startZoom;
    const { midX, midY, startPanX, startPanY } = pinchRef.current;
    const el = containerRef.current!;
    const w = el.clientWidth;
    const h = el.clientHeight;
    // Compute pan relative to pinch start (not current), so zoom feels stable.
    zoomRef.current = newZoom;
    const newPan = {
      x: (midX - w / 2) * (1 - ratio) + startPanX * ratio,
      y: (midY - h / 2) * (1 - ratio) + startPanY * ratio,
    };
    panRef.current = newPan;
    setZoom(newZoom);
    setPan(newPan);
  }, []);

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

  if (loadError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{loadError}</Alert>
      </Box>
    );
  }

  return (
    <Box
      className="market-engine-viewer"
      ref={containerRef}
      sx={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {!textures && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <CircularProgress className="market-engine-loading-spinner" />
        </Box>
      )}

      {textures && ready && (
        <Application resizeTo={containerRef} backgroundAlpha={0} antialias={true}>
          <NightMarketScene
            layers={layers}
            textures={textures}
            pan={pan}
            zoom={zoom}
            onPanChange={setPan}
            onLayerTap={onLayerTap}
            pedestrians={pedestrians}
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
