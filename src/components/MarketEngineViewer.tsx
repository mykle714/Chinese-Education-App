import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useTick, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text, Assets, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box, CircularProgress, Alert } from '@mui/material';
import type { FrameAnimation, MotionSpec } from '../config/nightMarketRegistry';
import { evaluateMotion } from '../utils/nightMarketMotion';
import { isoToScreen, computeLayerZ } from '../utils/isometric';
import { WALKWAYS, POIS, WALKWAY_MAP } from '../config/walkwayRegistry';
import { pointAtT } from '../utils/walkwayTraversal';
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

export interface MarketEngineViewerProps {
  layers: EngineLayer[];
  onLayerTap?: (id: string | number) => void;
  /** Pixi-native pedestrian handle. When provided, pedestrians are ticked via
   *  Pixi's useTick and rendered z-sorted alongside static layers. */
  pedestrians?: UsePixiPedestriansHandle;
  /** Render the isometric debug grid (fine green + major red lines). Default false. */
  showGrid?: boolean;
  /** Render POI dots/labels and pedestrian FSM state labels. Default false. */
  showDebug?: boolean;
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
  showDebug?: boolean;
  /** Ref set to true by the outer component during a pinch gesture — suppresses Pixi drag. */
  isPinchingRef?: React.RefObject<boolean>;
}

const TAP_MAX_DIST = 5;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5.0;

// ─── Grid overlay ────────────────────────────────────────────────────────────
// Static isometric debug grid — fine lines every 10 units (green), major every 100 (red).
// Drawn once since the grid never changes.

const GRID_MIN = -500;
const GRID_MAX = 500;

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

    drawGridLines(10, 0x00C800, 0.5, 1);    // fine: green
    drawGridLines(100, 0xFF0000, 0.9, 1.5); // major: red on top
  }, []);

  return <pixiGraphics draw={draw} />;
}

// ─── Walkway overlay ─────────────────────────────────────────────────────────
// Static Graphics element — drawn once since walkways never change.

function WalkwayOverlay() {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    for (const walkway of WALKWAYS) {
      const pts = walkway.polyline.map(([ix, iy]) => isoToScreen(ix, iy));
      g.moveTo(pts[0].screenX, pts[0].screenY);
      for (let i = 1; i < pts.length; i++) {
        g.lineTo(pts[i].screenX, pts[i].screenY);
      }
      g.stroke({ color: 0xd2b478, width: 6, alpha: 0.85 });
    }
  }, []);

  return <pixiGraphics draw={draw} />;
}

// ─── Walkway label overlay ───────────────────────────────────────────────────
// Renders the displayName of each walkway at its midpoint in red text.

const WALKWAY_LABEL_STYLE = {
  fontSize: 150,
  fill: 0xff2222,
  fontFamily: 'sans-serif',
  fontWeight: 'bold' as const,
  stroke: { color: 0x000000, width: 3 },
  align: 'center' as const,
};

function WalkwayLabelOverlay() {
  const midpoints = useMemo(() =>
    WALKWAYS
      .filter(w => w.displayName)
      .map(w => {
        const [p0, p1] = w.polyline;
        const midIsoX = (p0[0] + p1[0]) / 2;
        const midIsoY = (p0[1] + p1[1]) / 2;
        const { screenX, screenY } = isoToScreen(midIsoX, midIsoY);
        return { walkwayId: w.walkwayId, displayName: w.displayName!, screenX, screenY };
      }),
    []);

  return (
    <pixiContainer>
      {midpoints.map(({ walkwayId, displayName, screenX, screenY }) => (
        <pixiText
          key={walkwayId}
          text={displayName}
          x={screenX}
          y={screenY - 10}
          anchor={{ x: 0.5, y: 1 }}
          style={WALKWAY_LABEL_STYLE}
        />
      ))}
    </pixiContainer>
  );
}

// ─── POI overlay ─────────────────────────────────────────────────────────────
// Draws one orange dot + display name per POI at its projected iso position.
// Gated behind showDebug — only rendered when the debug overlay is active.

const POI_LABEL_STYLE = {
  fontSize: 165,
  fill: 0x000000,
  fontFamily: 'sans-serif',
  stroke: { color: 0xffffff, width: 15 },
  align: 'center' as const,
};

function PoiOverlay() {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    for (const poi of POIS) {
      const walkway = WALKWAY_MAP.get(poi.walkwayId);
      if (!walkway) continue;
      const { isoPos } = pointAtT(walkway.polyline, poi.t);
      const { screenX, screenY } = isoToScreen(isoPos[0], isoPos[1]);
      g.circle(screenX, screenY, 8);
    }
    g.fill({ color: 0xff6600, alpha: 0.9 });
  }, []);

  const poiScreenPositions = useMemo(() =>
    POIS.map(poi => {
      const walkway = WALKWAY_MAP.get(poi.walkwayId);
      if (!walkway) return null;
      const { isoPos } = pointAtT(walkway.polyline, poi.t);
      return { ...isoToScreen(isoPos[0], isoPos[1]), displayName: poi.displayName };
    }).filter(Boolean),
    []);

  return (
    <pixiContainer>
      <pixiGraphics draw={draw} />
      {poiScreenPositions.map((pos, i) => pos?.displayName && (
        <pixiText
          key={i}
          text={pos.displayName}
          x={pos.screenX}
          y={pos.screenY - 20}
          anchor={{ x: 0.5, y: 1 }}
          style={POI_LABEL_STYLE}
        />
      ))}
    </pixiContainer>
  );
}

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
    <pixiContainer>
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

// ─── NightMarketScene ────────────────────────────────────────────────────────
// Runs inside <Application>. Handles the animation tick, pan/tap events,
// walkway rendering, static layer sprites, and pedestrian sprites.

function NightMarketScene({ layers, textures, pan, zoom, onPanChange, onLayerTap, pedestrians, showGrid, showDebug, isPinchingRef }: SceneProps) {
  const { app } = useApplication();
  const [t, setT] = useState(0);

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
        const { screenX, screenY } = isoToScreen(d.isoX, d.isoY);
        items.push({
          key: `ped-${d.id}`,
          x: screenX,
          y: screenY,
          zIndex: computeLayerZ(d.isoX, d.isoY, 'entity'),
          texKey: d.imagePath,
          scale: d.scale,
          label: d.id,   // ped IDs don't match any asset — taps won't open a dialog
          tappable: false,
        });
      }
    }

    return items.sort((a, b) => a.zIndex - b.zIndex);
    // t drives both computedLayers and pedestrian positions, so one dep covers both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedLayers, pedestrians]);

  const cx = app.screen.width / 2 + pan.x;
  const cy = app.screen.height / 2 + pan.y;

  return (
    <pixiContainer x={cx} y={cy} scale={zoom}>
      {showGrid && <GridOverlay />}
      <WalkwayOverlay />
      {showDebug && <WalkwayLabelOverlay />}
      {showDebug && <PoiOverlay />}
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
      {showDebug && pedestrians && <PedestrianDebugLabels pedestrians={pedestrians} />}
    </pixiContainer>
  );
}

// ─── MarketEngineViewer ───────────────────────────────────────────────────────
// Outer component: texture loading, pan/zoom state, Application mount.

function MarketEngineViewer({ layers, onLayerTap, pedestrians, showGrid, showDebug }: MarketEngineViewerProps) {
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

  // All unique image paths: static layer images + pedestrian sprite images.
  const allImagePaths = useMemo(() => {
    const paths = new Set<string>();
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
            showDebug={showDebug}
            isPinchingRef={isPinchingRef}
          />
        </Application>
      )}
    </Box>
  );
}

export default MarketEngineViewer;
