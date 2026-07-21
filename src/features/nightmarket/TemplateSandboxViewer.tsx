import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box } from '@mui/material';
import { isoToScreen, TILE_WIDTH, TILE_HEIGHT } from '../../engine/market/isometric';
import { computeMinZoom } from '../../engine/market/cameraFit';
import { buildEditorField, type EditorMasks } from '../../engine/market/farmTerrain';
import EditorTerrainLayer from './EditorTerrainLayer';
import { TemplateMaskOverlays } from './TemplateEditorViewer';
import type { SandboxHouseMode } from './templateSandboxApi';

// Register Pixi.js classes as pixiContainer / pixiSprite / pixiGraphics / pixiText.
extend({ Container, Sprite, Graphics, Text });

/**
 * TemplateSandboxViewer — Pixi.js host for the desktop-only Template Sandbox tool
 * (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md).
 *
 * Renders MANY placed catalog templates tiled on one shared isometric grid (this is the first
 * surface that composites multiple templates — the runtime placement renderer is not built yet).
 * Templates may overlap freely.
 *
 * DEPTH (the reason this file looks the way it does): every placement renders its
 * {@link EditorTerrainLayer} + {@link TemplateMaskOverlays} FLAT into the one camera container,
 * with its cells shifted by the placement's SW corner (`origin`) into the shared GLOBAL cell
 * space. Pixi's `sortableChildren` then resolves occlusion PER SPRITE across all placements.
 *
 * It must not go back to a container-per-placement: Pixi sorts only within a parent, so a
 * per-placement container collapses an entire template to a single depth, and a placement's tall
 * sprites (trees, roofs, tall dirt slabs) then paint over a template that genuinely stands in
 * front of it. No single corner of a footprint can order two templates of different sizes.
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

// Whole-number zoom keeps the pixel-art crisp (nearest-neighbour, no fractional resampling), so
// CRISP_FLOOR is the smallest zoom the sandbox uses while a world still fits on screen. Once the
// placed continent outgrows the viewport at 1×, the floor drops BELOW it continuously — see
// {@link computeMinZoom} — trading crispness for the ability to see the whole layout.
const CRISP_FLOOR = 1;
const MAX_ZOOM = 10;
const DEFAULT_ZOOM = 3;
/** Multiplicative wheel step used below {@link CRISP_FLOOR}, where integer steps no longer exist. */
const SUB_UNIT_ZOOM_FACTOR = 0.8;

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
   * What this placement draws in its placeholder AREAS (`settings.houseMode`, cycled by the
   * header's Houses button): `'all'` = a house in every area, `'placeholder'` = no houses but the
   * areas TINTED so the slots are visible, `'none'` = neither. Replaces the editor's
   * condition-driven filled-slot rule for this surface.
   */
  houseMode: SandboxHouseMode;
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
function PlacedTemplate(
  { item, dragOffset, showStreet }: {
    item: SandboxItem;
    dragOffset?: { col: number; row: number };
    /** Tint this placement's street-walkable cells (the view-wide Street overlay toggle). */
    showStreet: boolean;
  },
) {
  const tiles = useMemo(
    () => buildEditorField(item.width, item.height, item.masks),
    [item.width, item.height, item.masks],
  );
  // While this item is being dragged the parent supplies a provisional offset so the preview
  // tracks the cursor before the move is committed.
  const col = dragOffset ? dragOffset.col : item.offsetCol;
  const row = dragOffset ? dragOffset.row : item.offsetRow;
  // The placement's SW corner IS the local→global cell shift. Everything below draws in GLOBAL
  // cells rather than inside a translated container — see the depth note in the file header.
  const origin = useMemo(() => ({ col, row }), [col, row]);
  return (
    <>
      <EditorTerrainLayer tiles={tiles} origin={origin} />
      {/* Sandbox previews the FINISHED look, so the communal/condition tints never show. Two
          exceptions, both author-driven: the STREET tint (view-wide toggle, key S — street
          alignment across seams is what tiling is judged on), and the PLACEHOLDER tint, which is
          the middle state of this placement's houseMode cycle (key H) — houses off, slots shown.
          houseMode replaces the editor's condition-driven filled-slot rule on this surface. */}
      <TemplateMaskOverlays
        masks={item.masks}
        showStreet={showStreet}
        showCommunal={false}
        showPlaceholder={item.houseMode === 'placeholder'}
        showCondition={false}
        houseMode={item.houseMode === 'all' ? 'all' : 'none'}
        origin={origin}
        depthMode="world"
      />
    </>
  );
}

// ─── Grid overlay (fine per-cell + major every 8, anchored at the global origin) ──────
// Mirrors the editor's GridOverlay (TemplateEditorViewer.tsx) but the sandbox surface is
// UNBOUNDED, so instead of the board rectangle it spans whatever cell range the camera can
// currently see, recomputed whenever the viewport (pan/zoom/size) changes. Major lines are
// anchored at global cell 0 rather than the editor's SW board corner — the sandbox has no
// corner, and the origin is the one landmark every placement's offset is measured from.
const GRID_Z = 9_000;
// Every 8 cells, matching the editor's major-line interval (TemplateEditorViewer.GridOverlay) so
// the two authoring surfaces read at the same scale. The editor counts its majors inward from the
// board's NE corner; the sandbox has no board, so its lattice stays anchored at global cell 0.
const GRID_MAJOR_INTERVAL = 8;
/** Positive modulo, so major lines stay on the same lattice at negative global coords. */
const mod = (n: number, m: number) => ((n % m) + m) % m;

interface GridBounds { minCol: number; maxCol: number; minRow: number; maxRow: number; }

function SandboxGridOverlay({ bounds }: { bounds: GridBounds }) {
  const { minCol, maxCol, minRow, maxRow } = bounds;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    // Fine (non-major) lines first, in green; major lines then paint red on top.
    for (let c = minCol; c <= maxCol; c++) {
      if (mod(c, GRID_MAJOR_INTERVAL) === 0) continue;
      const a = isoToScreen(c, minRow);
      const b = isoToScreen(c, maxRow);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    for (let r = minRow; r <= maxRow; r++) {
      if (mod(r, GRID_MAJOR_INTERVAL) === 0) continue;
      const a = isoToScreen(minCol, r);
      const b = isoToScreen(maxCol, r);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    g.stroke({ color: 0x00c800, width: 0.5, alpha: 0.5 });

    for (let c = minCol; c <= maxCol; c++) {
      if (mod(c, GRID_MAJOR_INTERVAL) !== 0) continue;
      const a = isoToScreen(c, minRow);
      const b = isoToScreen(c, maxRow);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    for (let r = minRow; r <= maxRow; r++) {
      if (mod(r, GRID_MAJOR_INTERVAL) !== 0) continue;
      const a = isoToScreen(minCol, r);
      const b = isoToScreen(maxCol, r);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    g.stroke({ color: 0xff2020, width: 1, alpha: 0.8 });
  }, [minCol, maxCol, minRow, maxRow]);
  return <pixiGraphics draw={draw} zIndex={GRID_Z} />;
}

/**
 * The global cell range the camera can currently see, padded by a cell so lines run past the
 * viewport edges. Derived by inverting the projection at the four screen corners: in iso space a
 * screen rectangle maps to a diamond, so the axis-aligned min/max over its corners bounds it.
 */
function visibleGridBounds(screenW: number, screenH: number, pan: { x: number; y: number }, zoom: number): GridBounds {
  const cx = screenW / 2 + pan.x;
  const cy = screenH / 2 + pan.y;
  const corners = [
    localToGlobalCell((0 - cx) / zoom, (0 - cy) / zoom),
    localToGlobalCell((screenW - cx) / zoom, (0 - cy) / zoom),
    localToGlobalCell((0 - cx) / zoom, (screenH - cy) / zoom),
    localToGlobalCell((screenW - cx) / zoom, (screenH - cy) / zoom),
  ];
  const cols = corners.map((c) => c.col);
  const rows = corners.map((c) => c.row);
  const PAD = 1;
  return {
    minCol: Math.min(...cols) - PAD,
    maxCol: Math.max(...cols) + PAD,
    minRow: Math.min(...rows) - PAD,
    maxRow: Math.max(...rows) + PAD,
  };
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
  showGrid: boolean;
  showStreet: boolean;
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
}

function SandboxScene({ items, selectedId, onSelect, onMove, showGrid, showStreet, pan, zoom, onPanChange }: SceneProps) {
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

  // NOTE: there is deliberately NO cross-placement draw-order sort here. Depth is resolved
  // PER SPRITE by the scene container's `sortableChildren` pass, because every placement emits
  // its sprites flat in global cell space (see PlacedTemplate). Ordering whole placements by
  // their SW-corner (col+row) — as this component used to — collapses a template to one depth
  // and makes its tall sprites (trees, roofs, dirt slabs) occlude a placement that genuinely
  // stands in front of it.
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
  // Cheap plain compute (no useMemo — this sits after an early return, so hooks are off-limits
  // here); GridOverlay's draw callback memoizes on the resulting numbers.
  const gridBounds = showGrid
    ? visibleGridBounds(app.screen.width, app.screen.height, pan, zoom)
    : null;

  return (
    // sortableChildren: the single global depth sort over EVERY placement's sprites.
    <pixiContainer x={cx} y={cy} scale={zoom} sortableChildren>
      {items.map((item) => (
        <PlacedTemplate
          key={item.id}
          item={item}
          dragOffset={drag && drag.id === item.id ? drag : undefined}
          showStreet={showStreet}
        />
      ))}
      {gridBounds && <SandboxGridOverlay bounds={gridBounds} />}
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
  /** Draw the isometric cell grid over the scene (fine green, red every 8 cells). */
  showGrid?: boolean;
  /** Tint every placement's street-walkable cells (the header's Street overlay toggle). */
  showStreet?: boolean;
}

function TemplateSandboxViewer({ items, selectedId, onSelect, onMove, showGrid = false, showStreet = false }: TemplateSandboxViewerProps) {
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

  // Placements change on every drag/add/remove, so the fit-derived floor is read lazily from a ref
  // at gesture time (against the CURRENT element size) rather than recomputed into state on resize.
  const itemsRef = useRef(items); itemsRef.current = items;
  const minZoomFor = useCallback((el: HTMLDivElement) => (
    computeMinZoom(itemsRef.current, el.clientWidth, el.clientHeight, CRISP_FLOOR)
  ), []);

  const applyZoomAtPoint = useCallback((focalX: number, focalY: number, rawZoom: number) => {
    const el = containerRef.current;
    if (!el) return;
    // At/above the crisp floor zoom stays on whole numbers; below it (a continent too big to fit
    // at 1×) any fractional value down to the fitted floor is allowed.
    const minZoom = minZoomFor(el);
    const newZoom = rawZoom >= CRISP_FLOOR
      ? Math.min(MAX_ZOOM, Math.round(rawZoom))
      : Math.max(minZoom, rawZoom);
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
  }, [minZoomFor]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const current = zoomRef.current;
    const zoomingIn = e.deltaY < 0;
    // Integer ladder at/above the crisp floor, geometric ladder below it (there are no whole
    // numbers left down there, and a fixed −1 step would jump straight to the fitted floor).
    let next: number;
    if (zoomingIn) {
      next = current < CRISP_FLOOR ? Math.min(CRISP_FLOOR, current / SUB_UNIT_ZOOM_FACTOR) : current + 1;
    } else {
      next = current > CRISP_FLOOR ? current - 1 : current * SUB_UNIT_ZOOM_FACTOR;
    }
    applyZoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, next);
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
            showGrid={showGrid}
            showStreet={showStreet}
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
