import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useTick, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text, Assets, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box } from '@mui/material';
import { isoToScreen, TILE_WIDTH, TILE_HEIGHT } from '../../engine/market/isometric';
import { buildEditorField, type EditorMasks } from '../../engine/market/farmTerrain';
import {
  houseFootprintCells, houseFits, houseOccupiedCells, houseFootprintSpans, HOUSE_ANCHOR,
} from '../../engine/market/house';
// The house sprite for the placement ghost — imported directly like EditorTerrainLayer
// (House.png lives in the pack's excluded Originals/ bucket).
import houseUrl from '../../assets/free-assets/free-farm-assets/Environment/Originals/House.png';
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
  | 'terrain1'
  | 'terrain2'
  | 'street'
  | 'communal'
  | 'placeholder'
  | 'condition'
  | 'house'
  | 'familyDecor'
  | 'commonDecor'
  | 'treeDecor'
  | 'copy'
  | 'paste';

export interface TemplateEditorViewerProps {
  width: number;
  height: number;
  masks: EditorMasks;
  showGrid?: boolean;
  /**
   * Whether to draw the street-walkable highlight tint. The parent decides the
   * effective value (persistent toggle OR the street tool being active), so the viewer
   * just honors this flag. (Street is now a spriteless walkability tint, not a plank.)
   */
  showStreet?: boolean;
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
   * The current house-placement mirror orientation (Space toggles it on the parent). Drives
   * the placement GHOST's horizontal flip so the author sees the facing before dropping.
   */
  houseFlip?: boolean;
  /**
   * Whether the active tool uses a two-click RECTANGLE selection instead of the default
   * free drag-paint. The parent turns this on for the annotation-mask tools (street /
   * communal / placeholder) AND the clipboard COPY tool: a press-drag-release selection —
   * pointer-down anchors one corner, the pointer release reports the finished rectangle via
   * {@link onRectComplete} (the parent then paints each cell, or captures the region for
   * copy), and the in-progress selection rubber-bands live under the cursor while dragging.
   * A plain click yields a 1×1 selection; Escape cancels a pending drag.
   */
  rectangleMode?: boolean;
  /**
   * Fired on the RELEASE of a rectangle-drag selection with the two opposite corners. The
   * parent decides what it means for the active tool — fill the rectangle for a mask tool,
   * or capture it into the clipboard for the copy tool — so the viewer stays tool-agnostic.
   */
  onRectComplete?: (a: { col: number; row: number }, b: { col: number; row: number }) => void;
  /**
   * Whether the PASTE tool is active (with a non-empty clipboard). Like the house tool it
   * previews a footprint under the cursor — sized by {@link pasteFootprint} — and a single
   * left click stamps the clipboard there via {@link onPasteAt} (refused if the footprint
   * would fall off the board).
   */
  pasteMode?: boolean;
  /** Clipboard footprint size (cells) for the paste preview + bounds check; null when empty. */
  pasteFootprint?: { w: number; h: number } | null;
  /** Stamp the clipboard with its min-corner at (col,row). Fired on a valid paste click. */
  onPasteAt?: (col: number, row: number) => void;
  /**
   * Whether the eraser modifier is toggled on (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md).
   * Erase is a modifier layered on the active tool — it removes that tool's own layer at
   * the cell — so the viewer only needs it to (a) tint the hover diamond RED as a mode
   * cue and (b) fall back to the single-cell hover even under the house tool (you erase
   * one house per cell, so the 4×5 placement preview would be misleading).
   */
  eraseMode?: boolean;
  /**
   * Paint onto a cell. The parent bakes the active tool into this callback (it
   * owns the masks), so the viewer stays tool-agnostic — it only reports cells.
   */
  onPaintCell: (col: number, row: number) => void;
  /**
   * Fired ONCE at the start of a free drag-paint gesture (before the first cell is painted),
   * so the parent can snapshot the pre-edit board for undo — coalescing the whole stroke into
   * a single history entry. The rectangle-fill and paste paths snapshot in their own parent
   * handlers instead, so the viewer does not fire this for them.
   */
  onEditBegin?: () => void;
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
const HOVER_ERASE_COLOR = 0xff4d4d; // red — signals the eraser modifier is on
function HoverOverlay({ cell, erase }: { cell: Cell | null; erase?: boolean }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (!cell) return;
    const color = erase ? HOVER_ERASE_COLOR : 0xffffff;
    const { screenX, screenY } = isoToScreen(cell.col, cell.row);
    const cy = screenY - TILE_HEIGHT / 2; // diamond centre
    g.moveTo(screenX, cy - TILE_HEIGHT / 2);
    g.lineTo(screenX + TILE_WIDTH / 2, cy);
    g.lineTo(screenX, cy + TILE_HEIGHT / 2);
    g.lineTo(screenX - TILE_WIDTH / 2, cy);
    g.closePath();
    g.fill({ color, alpha: 0.25 });
    g.stroke({ color, width: 1, alpha: 0.9 });
  }, [cell, erase]);
  return <pixiGraphics draw={draw} zIndex={HOVER_Z} />;
}

// ─── House footprint preview ─────────────────────────────────────────────────────
// While the house tool is active, the cursor becomes the house footprint (anchored at the
// hovered FRONT corner, extending +isoX/+isoY) tinted by whether a house can drop
// there: GREEN if the whole footprint is in-bounds and free of other houses, RED
// otherwise. A house overwrites the street/communal walkability tint under its
// footprint (mirroring communal), so a street cell does NOT block placement. The footprint
// is flip-aware — 4×5 by default, transposed to 5×4 when the pending placement is mirrored —
// so the green/red cells always match the ghost sprite drawn over them.
const HOUSE_PREVIEW_VALID_COLOR = 0x33ff66;
const HOUSE_PREVIEW_INVALID_COLOR = 0xff4d4d;

function HousePreviewOverlay({
  cell, width, height, houses, flip,
}: {
  cell: Cell | null;
  width: number;
  height: number;
  /** Placed houses (anchor → flip); flip drives each house's footprint span (occupancy check). */
  houses: ReadonlyMap<string, boolean>;
  /** The PENDING placement's mirror orientation — transposes this preview's footprint. */
  flip: boolean;
}) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (!cell) return;
    const fits = houseFits(cell.col, cell.row, width, height, flip);
    const footprint = houseFootprintCells(cell.col, cell.row, flip);
    const occupied = houseOccupiedCells(houses);
    // Valid only if fully in-bounds and no footprint cell hits another house.
    const valid = fits && footprint.every((c) => !occupied.has(c));
    const color = valid ? HOUSE_PREVIEW_VALID_COLOR : HOUSE_PREVIEW_INVALID_COLOR;
    // Trace each footprint cell's surface diamond that is actually on the board (an
    // off-board overhang near the edge simply isn't drawn; `fits` already flags it red).
    const { spanX, spanY } = houseFootprintSpans(flip);
    for (let dx = 0; dx < spanX; dx++) {
      for (let dy = 0; dy < spanY; dy++) {
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
  }, [cell, width, height, houses, flip]);
  return <pixiGraphics draw={draw} zIndex={HOVER_Z} />;
}

// ─── House placement ghost sprite ────────────────────────────────────────────────
// A translucent House.png preview drawn ON TOP of the footprint tint while the house tool
// hovers, so the author sees the actual sprite — and, crucially, its MIRROR orientation —
// before committing. Seated exactly like a placed house (HOUSE_ANCHOR on the front-corner
// foot cell, mirrored by negating scale.x around that anchor), so the ghost lands where the
// real house will. Sits just above the footprint diamonds (HOVER_Z) so both read together.
const HOUSE_GHOST_Z = HOVER_Z + 1;
const HOUSE_GHOST_ALPHA = 0.55;

function HouseGhostOverlay({ cell, flip }: { cell: Cell | null; flip: boolean }) {
  const [texture, setTexture] = useState<Texture | null>(null);
  // Load House.png once; Assets caches it, so this is a no-op after the first mount.
  useEffect(() => {
    let cancelled = false;
    Assets.load<Texture>(houseUrl).then((tex) => {
      tex.source.scaleMode = 'nearest';
      if (!cancelled) setTexture(tex);
    });
    return () => { cancelled = true; };
  }, []);
  if (!cell || !texture) return null;
  const { screenX, screenY } = isoToScreen(cell.col, cell.row);
  return (
    <pixiSprite
      texture={texture}
      x={screenX}
      y={screenY}
      anchor={HOUSE_ANCHOR}
      scale={{ x: flip ? -1 : 1, y: 1 }}
      alpha={HOUSE_GHOST_ALPHA}
      zIndex={HOUSE_GHOST_Z}
      eventMode="none"
    />
  );
}

// ─── Mask tint highlights (street / communal / placeholder / condition) ──────────
// A translucent diamond tint over every cell in a spriteless annotation mask,
// mirroring the nmp GrassOverlay. These masks (street-walkable, communal-walkable,
// placeholder areas, condition) render no sprite of their own, so the editor visualizes
// them purely with this tint drawn straight from the mask Set. Each mask gets a distinct
// colour so they read apart from each other and from the green grass terrain. All sit
// below the grid (9_000) and hover (9_500) so those still read over them.
const MASK_TINT_Z = 8_800;
const STREET_OVERLAY_COLOR = 0xd2a679; // warm tan (echoes the retired wood planks)
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

// ─── Rectangle selection preview ─────────────────────────────────────────────────
// The two-click rectangle tool (street / communal / placeholder). Once the first corner
// is anchored, this tints every cell of the anchor→cursor rectangle so the author sees
// exactly where the mask will land before committing with the second click. Painted in the
// target mask's own colour (red under the eraser modifier), sitting at the hover z so it
// reads over the mask tints and grid, mirroring the single-cell HoverOverlay it replaces.
const COPY_SELECT_COLOR = 0xf48fb1; // pink — the clipboard group's accent
const RECT_TOOL_COLOR: Partial<Record<EditorTool, number>> = {
  street: STREET_OVERLAY_COLOR,
  communal: COMMUNAL_OVERLAY_COLOR,
  placeholder: PLACEHOLDER_OVERLAY_COLOR,
  copy: COPY_SELECT_COLOR,
};

/** Trace a cell's surface diamond onto `g` (shared by the selection preview). */
function traceCellDiamond(g: Graphics, col: number, row: number) {
  const { screenX, screenY } = isoToScreen(col, row);
  const cy = screenY - TILE_HEIGHT / 2; // diamond centre
  g.moveTo(screenX, cy - TILE_HEIGHT / 2);
  g.lineTo(screenX + TILE_WIDTH / 2, cy);
  g.lineTo(screenX, cy + TILE_HEIGHT / 2);
  g.lineTo(screenX - TILE_WIDTH / 2, cy);
  g.closePath();
}

/** Every cell (inclusive) of the axis-aligned rectangle spanned by two corners. */
function rectCells(a: Cell, b: Cell): Cell[] {
  const c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
  const r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
  const out: Cell[] = [];
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push({ col: c, row: r });
  return out;
}

function RectPreviewOverlay({
  anchor, cursor, color, erase,
}: {
  anchor: Cell;
  cursor: Cell | null;
  color: number;
  erase?: boolean;
}) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    // Before the cursor re-enters the board, still show the anchored corner alone.
    const cells = rectCells(anchor, cursor ?? anchor);
    for (const cell of cells) traceCellDiamond(g, cell.col, cell.row);
    const c = erase ? HOVER_ERASE_COLOR : color;
    g.fill({ color: c, alpha: 0.3 });
    g.stroke({ color: c, width: 1, alpha: 0.9 });
  }, [anchor, cursor, color, erase]);
  return <pixiGraphics draw={draw} zIndex={HOVER_Z} />;
}

// ─── Paste footprint preview ──────────────────────────────────────────────────────
// The paste tool stamps the clipboard as a whole, so (like the house tool) its cursor is a
// footprint the size of the clipboard, anchored at the hovered min-iso corner and extending
// +isoX/+isoY. Tinted GREEN when the whole footprint is in-bounds (a valid stamp) and RED
// when it overhangs the board (paste is refused — the pasted area must match the copy 1:1).
const PASTE_PREVIEW_VALID_COLOR = 0x33ff66;
const PASTE_PREVIEW_INVALID_COLOR = 0xff4d4d;

function PastePreviewOverlay({
  cell, w, h, width, height,
}: {
  cell: Cell | null;
  w: number;
  h: number;
  width: number;
  height: number;
}) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (!cell) return;
    const fits = cell.col + w <= width && cell.row + h <= height;
    const color = fits ? PASTE_PREVIEW_VALID_COLOR : PASTE_PREVIEW_INVALID_COLOR;
    // Trace each footprint cell on the board (off-board overhang is simply not drawn; the
    // red tint already flags it as refused).
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const col = cell.col + dx;
        const row = cell.row + dy;
        if (col < 0 || col >= width || row < 0 || row >= height) continue;
        traceCellDiamond(g, col, row);
      }
    }
    g.fill({ color, alpha: 0.35 });
    g.stroke({ color, width: 1, alpha: 0.9 });
  }, [cell, w, h, width, height]);
  return <pixiGraphics draw={draw} zIndex={HOVER_Z} />;
}

// ─── Scene ──────────────────────────────────────────────────────────────────────
interface SceneProps {
  width: number;
  height: number;
  masks: EditorMasks;
  showGrid?: boolean;
  showStreet?: boolean;
  showCommunal?: boolean;
  showPlaceholder?: boolean;
  showCondition?: boolean;
  activeTool?: EditorTool;
  /** Current house-placement mirror orientation — drives the placement ghost's flip. */
  houseFlip?: boolean;
  rectangleMode?: boolean;
  onRectComplete?: (a: { col: number; row: number }, b: { col: number; row: number }) => void;
  pasteMode?: boolean;
  pasteFootprint?: { w: number; h: number } | null;
  onPasteAt?: (col: number, row: number) => void;
  eraseMode?: boolean;
  onPaintCell: (col: number, row: number) => void;
  onEditBegin?: () => void;
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
}

function EditorScene({ width, height, masks, showGrid, showStreet, showCommunal, showPlaceholder, showCondition, activeTool, houseFlip, rectangleMode, onRectComplete, pasteMode, pasteFootprint, onPasteAt, eraseMode, onPaintCell, onEditBegin, pan, zoom, onPanChange }: SceneProps) {
  const { app, isInitialised } = useApplication();
  const [hover, setHover] = useState<Cell | null>(null);
  // Latest hovered cell for the stable pointer handlers — lets the rectangle-drag release
  // fall back to the last on-board cell when the pointer is lifted just off the canvas.
  const hoverRef = useRef(hover); hoverRef.current = hover;
  // The anchored first corner of a pending rectangle selection (rectangle tools only);
  // null when no selection is in progress. State drives the live preview; a ref lets the
  // stable pointer handlers read the latest without re-subscribing.
  const [rectAnchor, setRectAnchor] = useState<Cell | null>(null);
  const rectAnchorRef = useRef(rectAnchor); rectAnchorRef.current = rectAnchor;
  const rectangleModeRef = useRef(rectangleMode); rectangleModeRef.current = rectangleMode;
  const onRectCompleteRef = useRef(onRectComplete); onRectCompleteRef.current = onRectComplete;
  // Latest paste state for the pointer handler (kept in refs so it stays subscribed once).
  const pasteModeRef = useRef(pasteMode); pasteModeRef.current = pasteMode;
  const pasteFootprintRef = useRef(pasteFootprint); pasteFootprintRef.current = pasteFootprint;
  const onPasteAtRef = useRef(onPasteAt); onPasteAtRef.current = onPasteAt;

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
  const onEditBeginRef = useRef(onEditBegin); onEditBeginRef.current = onEditBegin;
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
        // Rectangle tools: a press-drag-release selection (not a drag-paint gesture). This
        // press anchors one corner; the matching pointer release (onUp) reports the finished
        // rectangle to the parent, which fills it (mask tools) or captures it (copy). The live
        // preview rubber-bands against `hover` while dragging. Escape/tool-switch clears a
        // pending anchor; a plain click (down + up on one cell) yields a 1×1 selection.
        if (rectangleModeRef.current) {
          const cell = cellFromEvent(e);
          if (!cell) return;
          rectAnchorRef.current = cell;
          setRectAnchor(cell);
          return;
        }
        // Paste tool: one click stamps the whole clipboard footprint here, refused if it
        // would overhang the board (the pasted area must match the copy 1:1).
        if (pasteModeRef.current && pasteFootprintRef.current) {
          const cell = cellFromEvent(e);
          if (!cell) return;
          const { w, h } = pasteFootprintRef.current;
          if (cell.col + w > dimsRef.current.width || cell.row + h > dimsRef.current.height) return;
          onPasteAtRef.current?.(cell.col, cell.row);
          return;
        }
        gesture.current.mode = 'paint';
        gesture.current.lastKey = '';
        // Snapshot the pre-stroke board once, so the whole drag is a single undo step.
        onEditBeginRef.current?.();
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
    const onUp = (e: FederatedPointerEvent) => {
      // Complete a rectangle-drag selection on release: use the cell under the pointer, or the
      // last hovered on-board cell if the pointer was lifted just off the canvas. Releasing
      // with no resolvable cell (fully off-board) abandons the pending anchor.
      if (rectangleModeRef.current && rectAnchorRef.current) {
        const cell = cellFromEvent(e) ?? hoverRef.current;
        if (cell) onRectCompleteRef.current?.(rectAnchorRef.current, cell);
        rectAnchorRef.current = null;
        setRectAnchor(null);
      }
      gesture.current.mode = 'none';
      gesture.current.lastKey = '';
    };
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

  // Switching tool (or leaving rectangle mode) abandons any half-drawn selection.
  useEffect(() => {
    setRectAnchor(null);
    rectAnchorRef.current = null;
  }, [activeTool, rectangleMode]);

  // Escape cancels a pending rectangle corner (back to normal single-cell hover).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rectAnchorRef.current) {
        setRectAnchor(null);
        rectAnchorRef.current = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!app?.renderer) return null;
  const cx = app.screen.width / 2 + pan.x;
  const cy = app.screen.height / 2 + pan.y;

  // The 4×5 footprint preview is a PLACEMENT aid, so it shows only when the house tool is
  // painting. While erasing, drop back to the single-cell hover (you erase one house per
  // cell), which the red tint marks as the eraser modifier being on.
  const houseTool = activeTool === 'house' && !eraseMode;
  const pasteTool = activeTool === 'paste' && !!pasteFootprint;
  // Colour of the rectangle-selection preview: the target mask's own tint (white fallback).
  const rectColor = (activeTool && RECT_TOOL_COLOR[activeTool]) ?? 0xffffff;
  // Copy just reads the region — the eraser modifier is a no-op for it, so don't tint its
  // selection red (that cue belongs to the mask tools, which really do erase-fill).
  const rectErase = eraseMode && activeTool !== 'copy';

  return (
    <pixiContainer x={cx} y={cy} scale={zoom} sortableChildren>
      <EditorTerrainLayer tiles={tiles} houses={[...masks.houses].map(([cell, flip]) => ({ cell, flip }))} />
      {showStreet && <MaskTintOverlay cells={masks.street} color={STREET_OVERLAY_COLOR} />}
      {showCommunal && <MaskTintOverlay cells={masks.communal} color={COMMUNAL_OVERLAY_COLOR} />}
      {showPlaceholder && <MaskTintOverlay cells={masks.placeholder} color={PLACEHOLDER_OVERLAY_COLOR} />}
      {showCondition && <MaskTintOverlay cells={masks.condition} color={CONDITION_OVERLAY_COLOR} />}
      {showGrid && <GridOverlay width={width} height={height} />}
      {/* Preview priority: an anchored rectangle selection → its live preview; the paste
          tool → a clipboard-sized footprint stamp; the house tool → its 4×5 footprint; every
          other tool (and any erase) → single-cell hover, tinted red under the eraser modifier.
          A rectangle/paste tool BEFORE it has anything to preview falls through to the hover. */}
      {rectangleMode && rectAnchor
        ? <RectPreviewOverlay anchor={rectAnchor} cursor={hover} color={rectColor} erase={rectErase} />
        : pasteTool
          ? <PastePreviewOverlay cell={hover} w={pasteFootprint!.w} h={pasteFootprint!.h} width={width} height={height} />
          : houseTool
            ? <>
                <HousePreviewOverlay cell={hover} width={width} height={height} houses={masks.houses} flip={!!houseFlip} />
                {/* Ghost sprite over the footprint so the mirror orientation is visible pre-drop. */}
                <HouseGhostOverlay cell={hover} flip={!!houseFlip} />
              </>
            : <HoverOverlay cell={hover} erase={eraseMode} />}
    </pixiContainer>
  );
}

// ─── Outer component: pan/zoom state + wheel zoom + Application mount ─────────────
function TemplateEditorViewer({ width, height, masks, showGrid, showStreet, showCommunal, showPlaceholder, showCondition, activeTool, houseFlip, rectangleMode, onRectComplete, pasteMode, pasteFootprint, onPasteAt, eraseMode, onPaintCell, onEditBegin }: TemplateEditorViewerProps) {
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
            showStreet={showStreet}
            showCommunal={showCommunal}
            showPlaceholder={showPlaceholder}
            showCondition={showCondition}
            activeTool={activeTool}
            houseFlip={houseFlip}
            rectangleMode={rectangleMode}
            onRectComplete={onRectComplete}
            pasteMode={pasteMode}
            pasteFootprint={pasteFootprint}
            onPasteAt={onPasteAt}
            eraseMode={eraseMode}
            onPaintCell={onPaintCell}
            onEditBegin={onEditBegin}
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
