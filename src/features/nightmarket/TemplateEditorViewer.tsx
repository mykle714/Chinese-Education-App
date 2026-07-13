import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useTick, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box } from '@mui/material';
import { isoToScreen, TILE_WIDTH, TILE_HEIGHT } from '../../engine/market/isometric';
import { buildEditorField, type EditorMasks } from '../../engine/market/farmTerrain';
import {
  houseFootprintCells, houseFits, houseOccupiedCells,
  HOUSE_FOOTPRINT_X, HOUSE_FOOTPRINT_Y,
} from '../../engine/market/house';
import EditorTerrainLayer from './EditorTerrainLayer';

// Register Pixi.js classes as pixiContainer / pixiSprite / pixiGraphics / pixiText.
extend({ Container, Sprite, Graphics, Text });

/**
 * TemplateEditorViewer — Pixi.js host for the Night Market template editor
 * (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md). Desktop-only.
 *
 * Renders a mask-driven {@link EditorTerrainLayer} at the authored W×H, plus:
 *   - a HOVER highlight diamond over the cell under the cursor,
 *   - LEFT-drag painting (applies the active tool to each cell touched),
 *   - MIDDLE/RIGHT-drag panning + wheel zoom (left is reserved for painting).
 *
 * Cell picking inverts the 2:1 iso projection against each tile's surface-diamond
 * CENTRE (screenY − TILE_HEIGHT/2), so rounding lands on the diamond the cursor is
 * actually over.
 */

export type EditorTool =
  | 'lightGrass'
  | 'darkGrass'
  | 'street'
  | 'communal'
  | 'placeholder'
  | 'condition'
  | 'house'
  | 'familyDecor'
  | 'commonDecor'
  | 'treeDecor'
  | 'erase';

export interface TemplateEditorViewerProps {
  width: number;
  height: number;
  masks: EditorMasks;
  showGrid?: boolean;
  /**
   * Whether to draw the communal-walkable highlight tint. The parent decides the
   * effective value (persistent toggle OR the communal tool being active), so the
   * viewer just honors this flag.
   */
  showCommunal?: boolean;
  /** Same as {@link showCommunal} for the placeholder-area highlight tint. */
  showPlaceholder?: boolean;
  /** Same as {@link showCommunal} for the condition-mask highlight tint. */
  showCondition?: boolean;
  /**
   * The active tool. The viewer stays tool-agnostic for PAINTING (the parent bakes the
   * tool into {@link onPaintCell}); it needs the tool only to preview the HOUSE tool's
   * 4×5 footprint under the cursor (a normal single-cell hover for every other tool).
   */
  activeTool?: EditorTool;
  /**
   * Paint onto a cell. The parent bakes the active tool into this callback (it
   * owns the masks), so the viewer stays tool-agnostic — it only reports cells.
   */
  onPaintCell: (col: number, row: number) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
const DEFAULT_ZOOM = 3;

interface Cell { col: number; row: number; }

/**
 * Invert the iso projection: scene-local (lx, ly) → nearest tile (col, row), or
 * null if outside the board. Mirrors {@link isoToScreen} against the diamond centre.
 */
function localToCell(lx: number, ly: number, width: number, height: number): Cell | null {
  // screenX = (X−Y)·(TILE_WIDTH/2); diamond-centre Y = −(X+Y)·(TILE_HEIGHT/2) − TILE_HEIGHT/2.
  const xMinusY = lx / (TILE_WIDTH / 2);
  const xPlusY = -(ly + TILE_HEIGHT / 2) / (TILE_HEIGHT / 2);
  const col = Math.round((xMinusY + xPlusY) / 2);
  const row = Math.round((xPlusY - xMinusY) / 2);
  if (col < 0 || col >= width || row < 0 || row >= height) return null;
  return { col, row };
}

// ─── Grid overlay (fine per-cell + major every 5) ───────────────────────────────
const GRID_Z = 9_000;
function GridOverlay({ width, height }: { width: number; height: number }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    // Board-bounded lines: iso rows/cols from 0..width and 0..height.
    for (let c = 0; c <= width; c++) {
      const a = isoToScreen(c, 0);
      const b = isoToScreen(c, height);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    for (let r = 0; r <= height; r++) {
      const a = isoToScreen(0, r);
      const b = isoToScreen(width, r);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    g.stroke({ color: 0x00c800, width: 0.5, alpha: 0.5 });
  }, [width, height]);
  return <pixiGraphics draw={draw} zIndex={GRID_Z} />;
}

// ─── Hover highlight ────────────────────────────────────────────────────────────
const HOVER_Z = 9_500;
function HoverOverlay({ cell }: { cell: Cell | null }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (!cell) return;
    const { screenX, screenY } = isoToScreen(cell.col, cell.row);
    const cy = screenY - TILE_HEIGHT / 2; // diamond centre
    g.moveTo(screenX, cy - TILE_HEIGHT / 2);
    g.lineTo(screenX + TILE_WIDTH / 2, cy);
    g.lineTo(screenX, cy + TILE_HEIGHT / 2);
    g.lineTo(screenX - TILE_WIDTH / 2, cy);
    g.closePath();
    g.fill({ color: 0xffffff, alpha: 0.25 });
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.9 });
  }, [cell]);
  return <pixiGraphics draw={draw} zIndex={HOVER_Z} />;
}

// ─── House footprint preview ─────────────────────────────────────────────────────
// While the house tool is active, the cursor becomes a 4×5 footprint (anchored at the
// hovered FRONT corner, extending +isoX/+isoY) tinted by whether a house can drop
// there: GREEN if the whole footprint is in-bounds and free of streets/other houses,
// RED otherwise. This is the "selector changes to a 5×4" preview.
const HOUSE_PREVIEW_VALID_COLOR = 0x33ff66;
const HOUSE_PREVIEW_INVALID_COLOR = 0xff4d4d;

function HousePreviewOverlay({
  cell, width, height, street, houses,
}: {
  cell: Cell | null;
  width: number;
  height: number;
  street: Set<string>;
  houses: Set<string>;
}) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (!cell) return;
    const fits = houseFits(cell.col, cell.row, width, height);
    const footprint = houseFootprintCells(cell.col, cell.row);
    const occupied = houseOccupiedCells(houses);
    // Valid only if fully in-bounds and no footprint cell hits a street or a house.
    const valid = fits && footprint.every((c) => !street.has(c) && !occupied.has(c));
    const color = valid ? HOUSE_PREVIEW_VALID_COLOR : HOUSE_PREVIEW_INVALID_COLOR;
    // Trace each footprint cell's surface diamond that is actually on the board (an
    // off-board overhang near the edge simply isn't drawn; `fits` already flags it red).
    for (let dx = 0; dx < HOUSE_FOOTPRINT_X; dx++) {
      for (let dy = 0; dy < HOUSE_FOOTPRINT_Y; dy++) {
        const col = cell.col + dx;
        const row = cell.row + dy;
        if (col < 0 || col >= width || row < 0 || row >= height) continue;
        const { screenX, screenY } = isoToScreen(col, row);
        const cy = screenY - TILE_HEIGHT / 2; // diamond centre
        g.moveTo(screenX, cy - TILE_HEIGHT / 2);
        g.lineTo(screenX + TILE_WIDTH / 2, cy);
        g.lineTo(screenX, cy + TILE_HEIGHT / 2);
        g.lineTo(screenX - TILE_WIDTH / 2, cy);
        g.closePath();
      }
    }
    g.fill({ color, alpha: 0.35 });
    g.stroke({ color, width: 1, alpha: 0.9 });
  }, [cell, width, height, street, houses]);
  return <pixiGraphics draw={draw} zIndex={HOVER_Z} />;
}

// ─── Mask tint highlights (communal / placeholder) ───────────────────────────────
// A translucent diamond tint over every cell in a spriteless annotation mask,
// mirroring the nmp GrassOverlay. These masks (communal-walkable, placeholder areas)
// render no sprite of their own, so the editor visualizes them purely with this tint
// drawn straight from the mask Set. Each mask gets a distinct colour so they read
// apart from each other and from the green grass / brown planks. All sit below the
// grid (9_000) and hover (9_500) so those still read over them.
const MASK_TINT_Z = 8_800;
const COMMUNAL_OVERLAY_COLOR = 0xc266ff; // violet
const PLACEHOLDER_OVERLAY_COLOR = 0x33c8ff; // cyan
const CONDITION_OVERLAY_COLOR = 0xff9f40; // orange
const MASK_TINT_ALPHA = 0.4;

function MaskTintOverlay({ cells, color }: { cells: Set<string>; color: number }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    for (const cell of cells) {
      const [col, row] = cell.split(',').map(Number);
      const { screenX, screenY } = isoToScreen(col, row);
      const cy = screenY - TILE_HEIGHT / 2; // diamond centre
      g.moveTo(screenX, cy - TILE_HEIGHT / 2);
      g.lineTo(screenX + TILE_WIDTH / 2, cy);
      g.lineTo(screenX, cy + TILE_HEIGHT / 2);
      g.lineTo(screenX - TILE_WIDTH / 2, cy);
      g.closePath();
    }
    g.fill({ color, alpha: MASK_TINT_ALPHA });
  }, [cells, color]);
  return <pixiGraphics draw={draw} zIndex={MASK_TINT_Z} />;
}

// ─── Scene ──────────────────────────────────────────────────────────────────────
interface SceneProps {
  width: number;
  height: number;
  masks: EditorMasks;
  showGrid?: boolean;
  showCommunal?: boolean;
  showPlaceholder?: boolean;
  showCondition?: boolean;
  activeTool?: EditorTool;
  onPaintCell: (col: number, row: number) => void;
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
}

function EditorScene({ width, height, masks, showGrid, showCommunal, showPlaceholder, showCondition, activeTool, onPaintCell, pan, zoom, onPanChange }: SceneProps) {
  const { app, isInitialised } = useApplication();
  const [hover, setHover] = useState<Cell | null>(null);

  // Rebuild the field whenever the board or any mask changes — this is what
  // "recompute the overlay caps on each paint" reduces to.
  const tiles = useMemo(
    () => buildEditorField(width, height, masks),
    [width, height, masks],
  );

  // Latest values for the pointer handlers (kept stable across re-renders).
  const panRef = useRef(pan); panRef.current = pan;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const onPanChangeRef = useRef(onPanChange); onPanChangeRef.current = onPanChange;
  const onPaintRef = useRef(onPaintCell); onPaintRef.current = onPaintCell;
  const dimsRef = useRef({ width, height }); dimsRef.current = { width, height };

  // One active gesture at a time: paint (left) OR pan (middle/right).
  const gesture = useRef({ mode: 'none' as 'none' | 'paint' | 'pan', startX: 0, startY: 0, origPanX: 0, origPanY: 0, lastKey: '' });

  useTick(() => {});

  // Convert a pointer event to a board cell (or null), inverting pan+zoom+iso.
  const cellFromEvent = useCallback((e: FederatedPointerEvent): Cell | null => {
    if (!app?.renderer) return null;
    const cx = app.screen.width / 2 + panRef.current.x;
    const cy = app.screen.height / 2 + panRef.current.y;
    const lx = (e.global.x - cx) / zoomRef.current;
    const ly = (e.global.y - cy) / zoomRef.current;
    return localToCell(lx, ly, dimsRef.current.width, dimsRef.current.height);
  }, [app]);

  useEffect(() => {
    if (!isInitialised || !app?.stage || !app.renderer) return;
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = app.screen;

    const paintAt = (cell: Cell | null) => {
      if (!cell) return;
      const key = `${cell.col},${cell.row}`;
      if (key === gesture.current.lastKey) return; // don't re-fire on the same cell
      gesture.current.lastKey = key;
      onPaintRef.current(cell.col, cell.row);
    };

    const onDown = (e: FederatedPointerEvent) => {
      if (e.button === 0) {
        gesture.current.mode = 'paint';
        gesture.current.lastKey = '';
        paintAt(cellFromEvent(e));
      } else {
        gesture.current.mode = 'pan';
        gesture.current.startX = e.global.x;
        gesture.current.startY = e.global.y;
        gesture.current.origPanX = panRef.current.x;
        gesture.current.origPanY = panRef.current.y;
      }
    };
    const onMove = (e: FederatedPointerEvent) => {
      const cell = cellFromEvent(e);
      setHover(cell);
      if (gesture.current.mode === 'paint') {
        paintAt(cell);
      } else if (gesture.current.mode === 'pan') {
        const dx = e.global.x - gesture.current.startX;
        const dy = e.global.y - gesture.current.startY;
        onPanChangeRef.current({ x: gesture.current.origPanX + dx, y: gesture.current.origPanY + dy });
      }
    };
    const onUp = () => { gesture.current.mode = 'none'; gesture.current.lastKey = ''; };
    const onLeave = () => { setHover(null); };

    stage.on('pointerdown', onDown);
    stage.on('pointermove', onMove);
    stage.on('pointerup', onUp);
    stage.on('pointerupoutside', onUp);
    stage.on('pointerleave', onLeave);
    return () => {
      stage.off('pointerdown', onDown);
      stage.off('pointermove', onMove);
      stage.off('pointerup', onUp);
      stage.off('pointerupoutside', onUp);
      stage.off('pointerleave', onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, isInitialised]);

  if (!app?.renderer) return null;
  const cx = app.screen.width / 2 + pan.x;
  const cy = app.screen.height / 2 + pan.y;

  const houseTool = activeTool === 'house';

  return (
    <pixiContainer x={cx} y={cy} scale={zoom} sortableChildren>
      <EditorTerrainLayer tiles={tiles} houseCells={[...masks.houses]} />
      {showCommunal && <MaskTintOverlay cells={masks.communal} color={COMMUNAL_OVERLAY_COLOR} />}
      {showPlaceholder && <MaskTintOverlay cells={masks.placeholder} color={PLACEHOLDER_OVERLAY_COLOR} />}
      {showCondition && <MaskTintOverlay cells={masks.condition} color={CONDITION_OVERLAY_COLOR} />}
      {showGrid && <GridOverlay width={width} height={height} />}
      {/* House tool → 4×5 footprint preview; every other tool → single-cell hover. */}
      {houseTool
        ? <HousePreviewOverlay cell={hover} width={width} height={height} street={masks.street} houses={masks.houses} />
        : <HoverOverlay cell={hover} />}
    </pixiContainer>
  );
}

// ─── Outer component: pan/zoom state + wheel zoom + Application mount ─────────────
function TemplateEditorViewer({ width, height, masks, showGrid, showCommunal, showPlaceholder, showCondition, activeTool, onPaintCell }: TemplateEditorViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [ready, setReady] = useState(false);

  const panRef = useRef(pan); panRef.current = pan;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;

  useEffect(() => { if (containerRef.current) setReady(true); }, []);

  // Centre the board in the viewport on mount and whenever the size changes. Centre
  // the board's true screen bounding box: its top is the far corner's surface
  // (foot −TILE_HEIGHT) and its bottom is the near corner's dirt body (foot
  // +TILE_HEIGHT); localX is symmetric about 0. An extra downward offset clears the
  // translucent header so the board sits in the visible area below it.
  const HEADER_CLEARANCE = 40;
  useEffect(() => {
    if (!ready) return;
    const topLocalY = -((width - 1) + (height - 1)) * (TILE_HEIGHT / 2) - TILE_HEIGHT; // far corner surface
    const bottomLocalY = TILE_HEIGHT; // near corner (0,0) dirt body
    const centreLocalY = (topLocalY + bottomLocalY) / 2;
    const next = { x: 0, y: -centreLocalY * zoomRef.current + HEADER_CLEARANCE };
    panRef.current = next;
    setPan(next);
  }, [width, height, ready]);

  const applyZoomAtPoint = useCallback((focalX: number, focalY: number, rawZoom: number) => {
    const el = containerRef.current;
    if (!el) return;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(rawZoom)));
    if (newZoom === zoomRef.current) return;
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

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const step = e.deltaY < 0 ? 1 : -1;
    applyZoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoomRef.current + step);
  }, [applyZoomAtPoint]);

  // Suppress the browser context menu so right-drag pan doesn't pop a menu.
  const handleContextMenu = useCallback((e: MouseEvent) => { e.preventDefault(); }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('contextmenu', handleContextMenu);
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [handleWheel, handleContextMenu, ready]);

  return (
    <Box
      className="template-editor-viewer"
      ref={containerRef}
      sx={{ width: '100%', height: '100%', position: 'relative', cursor: 'crosshair' }}
    >
      {ready && (
        <Application resizeTo={containerRef} backgroundAlpha={0} antialias={false}>
          <EditorScene
            width={width}
            height={height}
            masks={masks}
            showGrid={showGrid}
            showCommunal={showCommunal}
            showPlaceholder={showPlaceholder}
            showCondition={showCondition}
            activeTool={activeTool}
            onPaintCell={onPaintCell}
            pan={pan}
            zoom={zoom}
            onPanChange={setPan}
          />
        </Application>
      )}
    </Box>
  );
}

export default TemplateEditorViewer;
