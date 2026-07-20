import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box } from '@mui/material';
import { isoToScreen, TILE_WIDTH, TILE_HEIGHT } from '../../engine/market/isometric';
import { buildEditorField, type EditorMasks } from '../../engine/market/farmTerrain';
import EditorTerrainLayer from './EditorTerrainLayer';
import { TemplateMaskOverlays } from './TemplateEditorViewer';

// Register Pixi.js classes as pixiContainer / pixiSprite / pixiGraphics / pixiText.
extend({ Container, Sprite, Graphics, Text });

/**
 * TemplateSandboxViewer — Pixi.js host for the desktop-only Template Sandbox tool
 * (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md).
 *
 * Renders MANY placed catalog templates tiled on one shared isometric grid (this is the first
 * surface that composites multiple templates — the runtime placement renderer is not built yet).
 * Each placement draws its own {@link EditorTerrainLayer} + {@link TemplateMaskOverlays} inside a
 * container translated to the placement's SW-corner offset (`isoToScreen` is linear, so a local
 * cell renders at the correct global position). Templates may overlap freely.
 *
 * Interaction:
 *   - LEFT-click a template → select it (reported via {@link onSelect}); LEFT-drag a template →
 *     move it, snapped to whole cells (committed via {@link onMove} on release).
 *   - LEFT-drag empty space, or MIDDLE/RIGHT-drag anywhere → pan; wheel → integer zoom.
 *   - LEFT-click empty space → clear the selection.
 *
 * The parent owns the placement list, the def cache (tiles/masks per name+version), selection,
 * and persistence; this component is a pure renderer + gesture source.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
const DEFAULT_ZOOM = 3;

/** One placed template, prepared with its render inputs (tiles/masks) for the active version. */
export interface SandboxItem {
  id: string;
  templateName: string;
  activeVersion: number;
  offsetCol: number;
  offsetRow: number;
  width: number;
  height: number;
  masks: EditorMasks;
  /** When true, this tile cannot be dragged (still selectable). */
  locked: boolean;
  /**
   * When true, EVERY placeholder area of this placement previews an occupant house; when false,
   * none do. The sandbox's per-placement houses toggle (`settings.showHouses`) — it replaces the
   * editor's condition-driven filled-slot rule for this surface.
   */
  showHouses: boolean;
}

interface GlobalCell { col: number; row: number; }

/**
 * Invert the iso projection: camera-local (lx, ly) → nearest GLOBAL tile (col, row). Unbounded
 * (the sandbox has no board edges). Mirrors {@link isoToScreen} against the diamond centre — the
 * same math as the editor viewer's `localToCell`, minus the bounds check.
 */
function localToGlobalCell(lx: number, ly: number): GlobalCell {
  const xMinusY = lx / (TILE_WIDTH / 2);
  const xPlusY = -(ly + TILE_HEIGHT / 2) / (TILE_HEIGHT / 2);
  return {
    col: Math.round((xMinusY + xPlusY) / 2),
    row: Math.round((xPlusY - xMinusY) / 2),
  };
}

/** Whether a global cell falls inside a placement's footprint rectangle. */
function itemContains(item: SandboxItem, gc: GlobalCell): boolean {
  return (
    gc.col >= item.offsetCol && gc.col < item.offsetCol + item.width &&
    gc.row >= item.offsetRow && gc.row < item.offsetRow + item.height
  );
}

// ─── One placed template's scene (terrain + mask overlays), offset to its SW corner ──
function PlacedTemplate({ item, dragOffset }: { item: SandboxItem; dragOffset?: { col: number; row: number } }) {
  const tiles = useMemo(
    () => buildEditorField(item.width, item.height, item.masks),
    [item.width, item.height, item.masks],
  );
  // While this item is being dragged the parent supplies a provisional offset so the preview
  // tracks the cursor before the move is committed.
  const col = dragOffset ? dragOffset.col : item.offsetCol;
  const row = dragOffset ? dragOffset.row : item.offsetRow;
  const { screenX, screenY } = isoToScreen(col, row);
  return (
    // Own sortableChildren so the board's internal terrain/house z-sort stays local to this
    // template and never bleeds across placements.
    <pixiContainer x={screenX} y={screenY} sortableChildren>
      <EditorTerrainLayer tiles={tiles} />
      {/* Sandbox previews the FINISHED look: no walkability/placeholder/condition tints. Houses
          are an ALL-or-NOTHING per-placement choice here (the header's Houses toggle) rather than
          the editor's condition-driven filled-slot rule. */}
      <TemplateMaskOverlays
        masks={item.masks}
        showStreet={false}
        showCommunal={false}
        showPlaceholder={false}
        showCondition={false}
        houseMode={item.showHouses ? 'all' : 'none'}
      />
    </pixiContainer>
  );
}

// ─── Selection outline: the footprint rectangle's four diamond edges, in global coords ──
const SELECT_Z = 100_000;
const SELECT_COLOR = 0xffe066; // the editor's save-yellow accent (unlocked selection)
const SELECT_LOCKED_COLOR = 0xff6b6b; // red — a locked selection can't be dragged
function SelectionOutline({ item, dragOffset }: { item: SandboxItem; dragOffset?: { col: number; row: number } }) {
  const col = dragOffset ? dragOffset.col : item.offsetCol;
  const row = dragOffset ? dragOffset.row : item.offsetRow;
  const locked = item.locked;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    // Four corners of the footprint rectangle, in global cell space → screen (surface plane).
    const corners = [
      isoToScreen(col, row),
      isoToScreen(col + item.width, row),
      isoToScreen(col + item.width, row + item.height),
      isoToScreen(col, row + item.height),
    ];
    g.moveTo(corners[0].screenX, corners[0].screenY);
    for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].screenX, corners[i].screenY);
    g.closePath();
    // Locked tiles outline red (and dashed-feel via lower alpha) to signal they won't drag.
    g.stroke({ color: locked ? SELECT_LOCKED_COLOR : SELECT_COLOR, width: 2, alpha: 0.95 });
  }, [col, row, item.width, item.height, locked]);
  return <pixiGraphics draw={draw} zIndex={SELECT_Z} />;
}

// ─── Scene: all placements inside one pan/zoom camera ────────────────────────────────
interface SceneProps {
  items: SandboxItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, offsetCol: number, offsetRow: number) => void;
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
}

function SandboxScene({ items, selectedId, onSelect, onMove, pan, zoom, onPanChange }: SceneProps) {
  const { app, isInitialised } = useApplication();

  // Provisional offset for the tile currently being dragged (null = no drag in progress).
  const [drag, setDrag] = useState<{ id: string; col: number; row: number } | null>(null);

  // Refs so the stable pointer handlers read the latest without re-subscribing.
  const panRef = useRef(pan); panRef.current = pan;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const itemsRef = useRef(items); itemsRef.current = items;
  const onPanChangeRef = useRef(onPanChange); onPanChangeRef.current = onPanChange;
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onMoveRef = useRef(onMove); onMoveRef.current = onMove;
  const dragRef = useRef(drag); dragRef.current = drag;

  // One active gesture at a time: 'move' (drag a selected tile) or 'pan'.
  const gesture = useRef({
    mode: 'none' as 'none' | 'move' | 'pan',
    startX: 0, startY: 0, origPanX: 0, origPanY: 0,
    // move gesture: the global cell where the drag began + the tile's original offset.
    startCell: { col: 0, row: 0 } as GlobalCell,
    origOffset: { col: 0, row: 0 },
    movedId: '' as string,
  });

  // Back-to-front draw order: larger (col+row) sits further into the screen, so draw it first.
  // Chronological order (array index) breaks depth ties — later placements sit on top.
  const drawOrder = useMemo(() => {
    return items.map((it, seq) => ({ it, seq }))
      .sort((a, b) => (b.it.offsetCol + b.it.offsetRow) - (a.it.offsetCol + a.it.offsetRow) || a.seq - b.seq)
      .map((x) => x.it);
  }, [items]);

  const globalCellFromEvent = useCallback((e: FederatedPointerEvent): GlobalCell | null => {
    if (!app?.renderer) return null;
    const cx = app.screen.width / 2 + panRef.current.x;
    const cy = app.screen.height / 2 + panRef.current.y;
    return localToGlobalCell((e.global.x - cx) / zoomRef.current, (e.global.y - cy) / zoomRef.current);
  }, [app]);

  /** Topmost placement under a global cell (front-most first), or null. */
  const hitTest = useCallback((gc: GlobalCell): SandboxItem | null => {
    // Front-most = smallest (col+row), tie-broken by latest in the array. Iterate that order.
    const frontFirst = itemsRef.current
      .map((it, seq) => ({ it, seq }))
      .sort((a, b) => (a.it.offsetCol + a.it.offsetRow) - (b.it.offsetCol + b.it.offsetRow) || b.seq - a.seq);
    for (const { it } of frontFirst) {
      if (itemContains(it, gc)) return it;
    }
    return null;
  }, []);

  useEffect(() => {
    if (!isInitialised || !app?.stage || !app.renderer) return;
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = app.screen;

    const onDown = (e: FederatedPointerEvent) => {
      if (e.button === 0) {
        // Left button: select + drag a tile, or pan empty space.
        const gc = globalCellFromEvent(e);
        const hit = gc ? hitTest(gc) : null;
        if (hit && gc && hit.locked) {
          // A locked tile is still selectable (so it can be unlocked/deleted) but never dragged;
          // consume the gesture so the camera doesn't pan under it either.
          onSelectRef.current(hit.id);
          gesture.current.mode = 'none';
        } else if (hit && gc) {
          onSelectRef.current(hit.id);
          gesture.current.mode = 'move';
          gesture.current.startCell = gc;
          gesture.current.origOffset = { col: hit.offsetCol, row: hit.offsetRow };
          gesture.current.movedId = hit.id;
          // Seed the provisional offset at the tile's current position (no jump on click).
          setDrag({ id: hit.id, col: hit.offsetCol, row: hit.offsetRow });
        } else {
          onSelectRef.current(null);
          gesture.current.mode = 'pan';
          gesture.current.startX = e.global.x;
          gesture.current.startY = e.global.y;
          gesture.current.origPanX = panRef.current.x;
          gesture.current.origPanY = panRef.current.y;
        }
      } else {
        // Middle / right button always pans.
        gesture.current.mode = 'pan';
        gesture.current.startX = e.global.x;
        gesture.current.startY = e.global.y;
        gesture.current.origPanX = panRef.current.x;
        gesture.current.origPanY = panRef.current.y;
      }
    };

    const onMoveEvt = (e: FederatedPointerEvent) => {
      if (gesture.current.mode === 'move') {
        const gc = globalCellFromEvent(e);
        if (!gc) return;
        // Snap: shift the tile by the whole-cell delta from where the drag began.
        const col = gesture.current.origOffset.col + (gc.col - gesture.current.startCell.col);
        const row = gesture.current.origOffset.row + (gc.row - gesture.current.startCell.row);
        setDrag({ id: gesture.current.movedId, col, row });
      } else if (gesture.current.mode === 'pan') {
        const dx = e.global.x - gesture.current.startX;
        const dy = e.global.y - gesture.current.startY;
        onPanChangeRef.current({ x: gesture.current.origPanX + dx, y: gesture.current.origPanY + dy });
      }
    };

    const onUp = () => {
      if (gesture.current.mode === 'move') {
        const d = dragRef.current;
        const orig = gesture.current.origOffset;
        // Commit only a real move (a plain click leaves the tile where it was).
        if (d && (d.col !== orig.col || d.row !== orig.row)) {
          onMoveRef.current(gesture.current.movedId, d.col, d.row);
        }
        setDrag(null);
      }
      gesture.current.mode = 'none';
    };

    stage.on('pointerdown', onDown);
    stage.on('pointermove', onMoveEvt);
    stage.on('pointerup', onUp);
    stage.on('pointerupoutside', onUp);
    return () => {
      stage.off('pointerdown', onDown);
      stage.off('pointermove', onMoveEvt);
      stage.off('pointerup', onUp);
      stage.off('pointerupoutside', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, isInitialised]);

  if (!app?.renderer) return null;
  const cx = app.screen.width / 2 + pan.x;
  const cy = app.screen.height / 2 + pan.y;
  const selected = items.find((it) => it.id === selectedId) ?? null;
  const dragForSelected = drag && selected && drag.id === selected.id ? drag : undefined;

  return (
    <pixiContainer x={cx} y={cy} scale={zoom}>
      {drawOrder.map((item) => (
        <PlacedTemplate
          key={item.id}
          item={item}
          dragOffset={drag && drag.id === item.id ? drag : undefined}
        />
      ))}
      {selected && <SelectionOutline item={selected} dragOffset={dragForSelected} />}
    </pixiContainer>
  );
}

// ─── Outer component: Application mount + wheel zoom ──────────────────────────────────
export interface TemplateSandboxViewerProps {
  items: SandboxItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, offsetCol: number, offsetRow: number) => void;
}

function TemplateSandboxViewer({ items, selectedId, onSelect, onMove }: TemplateSandboxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [ready, setReady] = useState(false);

  const panRef = useRef(pan); panRef.current = pan;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;

  useEffect(() => { if (containerRef.current) setReady(true); }, []);

  // Seat the origin cell a little below the translucent header on first mount, so the SW corner
  // of a template dropped at (0,0) is comfortably in view.
  const HEADER_CLEARANCE = 60;
  const didCentre = useRef(false);
  useEffect(() => {
    if (!ready || didCentre.current) return;
    didCentre.current = true;
    const next = { x: 0, y: HEADER_CLEARANCE };
    panRef.current = next;
    setPan(next);
  }, [ready]);

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

  // Suppress the context menu so right-drag pan doesn't pop one.
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
      className="template-sandbox-viewer"
      ref={containerRef}
      sx={{ width: '100%', height: '100%', position: 'relative', cursor: 'grab' }}
    >
      {ready && (
        <Application resizeTo={containerRef} backgroundAlpha={0} antialias={false}>
          <SandboxScene
            items={items}
            selectedId={selectedId}
            onSelect={onSelect}
            onMove={onMove}
            pan={pan}
            zoom={zoom}
            onPanChange={setPan}
          />
        </Application>
      )}
    </Box>
  );
}

export default TemplateSandboxViewer;
