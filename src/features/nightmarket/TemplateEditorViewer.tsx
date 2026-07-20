import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Application, extend, useTick, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text, Assets, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box } from '@mui/material';
import { isoToScreen, computeLayerZ, TILE_WIDTH, TILE_HEIGHT } from '../../engine/market/isometric';
import {
  buildEditorField, editorSurfaceAt, editorDecorRotation,
  type EditorMasks, type DecorCategory,
} from '../../engine/market/farmTerrain';
import { HOUSE_ANCHOR, occupantHousesForArea } from '../../engine/market/house';
import {
  placeholderAreaFits, placeholderAreaOverlapsAny, placeholderAreaCells, type PlaceholderArea,
} from '../../engine/market/placeholderArea';
// The house sprite for the filled-placeholder occupant preview — imported directly like
// EditorTerrainLayer (House.png lives in the pack's excluded Originals/ bucket).
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
  | 'familyDecor'
  | 'commonDecor'
  | 'treeDecor'
  | 'plankDecor'
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
   * tool into {@link onPaintCell}); it needs the tool only to preview the placeholder DROP
   * footprint under the cursor (a normal single-cell hover for every other tool).
   */
  activeTool?: EditorTool;
  /**
   * The current placeholder DROP size in cells (Space cycles it on the parent — 4×5 / 5×4 /
   * 4×10 / 10×4). Drives the placeholder tool's footprint GHOST so the author sees the area before
   * dropping. (The placeholder tool is a fixed-size DROP, not a rectangle.)
   */
  placeholderSize?: { w: number; h: number };
  /**
   * The active DECOR tool's category (`family` / `common` / `tree` / `plank`), or null when
   * no decor tool is active. Drives the decor GHOST — a translucent preview of the sprite the
   * next click will place — so the author sees the selected variant before committing.
   */
  decorCategory?: DecorCategory | null;
  /**
   * The current decor VARIANT index (Space cycles it on the parent). Resolved against the
   * active category's rotation for the hovered cell's surface (`family` is surface-dependent)
   * via a modulo, so an out-of-range index simply wraps.
   */
  decorVariantIdx?: number;
  /**
   * Whether the active tool uses a two-click RECTANGLE selection instead of the default
   * free drag-paint. The parent turns this on for the annotation-mask tools (street /
   * communal / placeholder), the terrain tools (terrain 1 / terrain 2), AND the clipboard
   * COPY tool: a press-drag-release selection —
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
   * Whether the PASTE tool is active (with a non-empty clipboard). Like the placeholder drop it
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
   * cue and (b) fall back to the single-cell hover even under the placeholder tool (you erase
   * one whole area per cell, so the drop footprint preview would be misleading).
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

// ─── Grid overlay (fine per-cell + major every 4, from the SW corner) ───────────
const GRID_Z = 9_000;
const GRID_MAJOR_INTERVAL = 4;
function GridOverlay({ width, height }: { width: number; height: number }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    // Board-bounded lines: iso rows/cols from 0..width and 0..height.
    // Major lines are counted from the SW corner — col 0 (west) and row `height` (south) —
    // so col lines land on multiples of the interval, row lines on multiples of distance
    // from the south edge. Fine (non-major) lines draw green first; major lines draw red on top.
    for (let c = 0; c <= width; c++) {
      if (c % GRID_MAJOR_INTERVAL === 0) continue;
      const a = isoToScreen(c, 0);
      const b = isoToScreen(c, height);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    for (let r = 0; r <= height; r++) {
      if ((height - r) % GRID_MAJOR_INTERVAL === 0) continue;
      const a = isoToScreen(0, r);
      const b = isoToScreen(width, r);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    g.stroke({ color: 0x00c800, width: 0.5, alpha: 0.5 });

    for (let c = 0; c <= width; c++) {
      if (c % GRID_MAJOR_INTERVAL !== 0) continue;
      const a = isoToScreen(c, 0);
      const b = isoToScreen(c, height);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    for (let r = 0; r <= height; r++) {
      if ((height - r) % GRID_MAJOR_INTERVAL !== 0) continue;
      const a = isoToScreen(0, r);
      const b = isoToScreen(width, r);
      g.moveTo(a.screenX, a.screenY);
      g.lineTo(b.screenX, b.screenY);
    }
    g.stroke({ color: 0xff2020, width: 1, alpha: 0.8 });
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

// ─── Placeholder drop preview ────────────────────────────────────────────────────
// While the placeholder tool is active, the cursor becomes the drop footprint (the current
// 4×5 / 5×4 / 4×10 / 10×4 size, anchored at the hovered near corner, extending +isoX/+isoY) tinted
// by whether an area can drop there: GREEN if the whole footprint is in-bounds AND overlaps no
// existing area, RED otherwise (the drop is refused).
const PLACEHOLDER_PREVIEW_VALID_COLOR = 0x33ff66;
const PLACEHOLDER_PREVIEW_INVALID_COLOR = 0xff4d4d;

function PlaceholderPreviewOverlay({
  cell, size, width, height, areas,
}: {
  cell: Cell | null;
  size: { w: number; h: number };
  width: number;
  height: number;
  /** Already-placed areas — a drop is refused where its footprint overlaps any of them. */
  areas: readonly PlaceholderArea[];
}) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (!cell) return;
    const area: PlaceholderArea = { col: cell.col, row: cell.row, w: size.w, h: size.h };
    const valid = placeholderAreaFits(area, width, height) && !placeholderAreaOverlapsAny(area, areas);
    const color = valid ? PLACEHOLDER_PREVIEW_VALID_COLOR : PLACEHOLDER_PREVIEW_INVALID_COLOR;
    // Trace each footprint cell that is on the board (an off-board overhang isn't drawn; the
    // red tint already flags it refused).
    for (let dx = 0; dx < size.w; dx++) {
      for (let dy = 0; dy < size.h; dy++) {
        const col = cell.col + dx;
        const row = cell.row + dy;
        if (col < 0 || col >= width || row < 0 || row >= height) continue;
        traceCellDiamond(g, col, row);
      }
    }
    g.fill({ color, alpha: 0.35 });
    g.stroke({ color, width: 1, alpha: 0.9 });
  }, [cell, size, width, height, areas]);
  return <pixiGraphics draw={draw} zIndex={HOVER_Z} />;
}

// ─── Decor placement ghost sprite ────────────────────────────────────────────────
// While a decor tool is active, the cursor shows a translucent preview of the sprite the
// next click will place — the currently-selected variant (Space cycles it) resolved for the
// hovered cell's surface (family decor is surface-dependent). Seated like a real decor sprite
// (anchor {0.5,1} at the cell foot, matching EditorTerrainLayer) so the ghost lands where the
// sprite will. Planks preview their flat CENTER tile; the far-end cap is derived only at
// render (see plankRenderUrl), so the ghost intentionally shows the mid-run tile.
const DECOR_GHOST_Z = HOVER_Z + 1;
const DECOR_GHOST_ALPHA = 0.55;

function DecorGhostOverlay({
  cell, masks, category, variantIdx,
}: {
  cell: Cell | null;
  masks: EditorMasks;
  category: DecorCategory;
  variantIdx: number;
}) {
  // Resolve the selected variant to a concrete sprite url for the hovered cell's surface.
  const url = useMemo(() => {
    if (!cell) return null;
    const surface = editorSurfaceAt(masks, cell.col, cell.row);
    const rotation = editorDecorRotation(category, surface);
    if (rotation.length === 0) return null;
    return rotation[variantIdx % rotation.length];
  }, [cell, masks, category, variantIdx]);

  const [texture, setTexture] = useState<Texture | null>(null);
  // Load the ghost sprite whenever the resolved url changes (Assets caches, so re-hovering a
  // seen sprite is a no-op). Cleared to null between loads so no stale texture flashes.
  useEffect(() => {
    if (!url) { setTexture(null); return; }
    let cancelled = false;
    Assets.load<Texture>(url).then((tex) => {
      tex.source.scaleMode = 'nearest';
      if (!cancelled) setTexture(tex);
    });
    return () => { cancelled = true; };
  }, [url]);

  if (!cell || !texture) return null;
  const { screenX, screenY } = isoToScreen(cell.col, cell.row);
  return (
    <pixiSprite
      texture={texture}
      x={screenX}
      y={screenY}
      anchor={{ x: 0.5, y: 1 }}
      alpha={DECOR_GHOST_ALPHA}
      zIndex={DECOR_GHOST_Z}
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

// ─── Placeholder-area highlight ──────────────────────────────────────────────────
// Placeholder areas are fixed-size DROPPED rectangles (occupant slots), not a per-cell mask,
// so each is drawn as its filled cell diamonds PLUS a bright outline around the whole block.
// The per-area border is what makes two ADJACENT slots read as distinct (a merged cyan tint
// could not tell them apart). Same z as the other mask tints. The block outline connects the
// four extreme cell vertices of the axis-aligned area (apex = far cell's top vertex, etc.),
// matching the 2:1 iso projection.
function PlaceholderAreaOverlay({ areas }: { areas: readonly PlaceholderArea[] }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    // Fill every covered cell diamond (translucent), so the whole slot reads as filled.
    for (const area of areas) {
      for (let dx = 0; dx < area.w; dx++) {
        for (let dy = 0; dy < area.h; dy++) traceCellDiamond(g, area.col + dx, area.row + dy);
      }
    }
    g.fill({ color: PLACEHOLDER_OVERLAY_COLOR, alpha: MASK_TINT_ALPHA });
    // Then stroke each area's block outline so adjacent areas are visibly separated.
    for (const area of areas) {
      const vertex = (c: number, r: number) => {
        const { screenX, screenY } = isoToScreen(c, r);
        return { x: screenX, y: screenY - TILE_HEIGHT / 2 }; // diamond centre
      };
      const c0 = area.col, c1 = area.col + area.w - 1;
      const r0 = area.row, r1 = area.row + area.h - 1;
      const apex = vertex(c1, r1); // far cell — top of the block on screen
      const right = vertex(c1, r0);
      const bottom = vertex(c0, r0); // near cell — bottom of the block
      const left = vertex(c0, r1);
      g.moveTo(apex.x, apex.y - TILE_HEIGHT / 2); // far cell's TOP vertex
      g.lineTo(right.x + TILE_WIDTH / 2, right.y); // its RIGHT vertex
      g.lineTo(bottom.x, bottom.y + TILE_HEIGHT / 2); // near cell's BOTTOM vertex
      g.lineTo(left.x - TILE_WIDTH / 2, left.y); // its LEFT vertex
      g.closePath();
    }
    g.stroke({ color: PLACEHOLDER_OVERLAY_COLOR, width: 1.5, alpha: 0.95 });
  }, [areas]);
  return <pixiGraphics draw={draw} zIndex={MASK_TINT_Z} />;
}

// ─── Filled-placeholder occupant houses ──────────────────────────────────────────
// A placeholder area whose footprint contains any CONDITION-mask cell reads as an OCCUPIED
// slot for this version, so the editor previews its occupant the same way the runtime does —
// a house (or two adjacent houses for a 4×10/10×4 slot; see {@link occupantHousesForArea}) —
// INSTEAD of the placeholder/condition tint. Seated exactly like a placed house (HOUSE_ANCHOR
// on each front-corner foot cell, mirrored by negating scale.x). Lifted above the mask tints
// (MASK_TINT_Z) and z-ordered per foot cell so a 4×10's two houses stack correctly.
const OCCUPANT_HOUSE_Z_BASE = MASK_TINT_Z + 100;

function PlaceholderOccupantHouses({ areas }: { areas: readonly PlaceholderArea[] }) {
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

  const houses = useMemo(
    () => areas.flatMap((area) => occupantHousesForArea(area)),
    [areas],
  );
  if (!texture) return null;

  return (
    <>
      {houses.map((h) => {
        const { screenX, screenY } = isoToScreen(h.col, h.row);
        return (
          <pixiSprite
            key={`occupant:${h.col},${h.row}`}
            texture={texture}
            x={screenX}
            y={screenY}
            anchor={HOUSE_ANCHOR}
            scale={{ x: h.flip ? -1 : 1, y: 1 }}
            // Lift above the tints, preserving per-foot-cell iso ordering (nearer = on top).
            zIndex={OCCUPANT_HOUSE_Z_BASE + computeLayerZ(h.col, h.row, 'entity')}
            eventMode="none"
          />
        );
      })}
    </>
  );
}

/**
 * The full spriteless mask-tint stack (street / communal / placeholder / condition) for a
 * board, each layer independently toggleable. Extracted so BOTH the editor scene (per-toggle
 * control) and the read-only Load gallery (all layers on) render the exact same tints — the
 * gallery would otherwise duplicate these four overlays. Defaults every layer ON (the
 * gallery's case); the editor passes its four show* toggles. Renders nothing on its own
 * container — the caller nests it inside the board's `sortableChildren` container so the
 * MASK_TINT_Z ordering lands the tints above the terrain sprites.
 */
export function TemplateMaskOverlays({
  masks, showStreet = true, showCommunal = true, showPlaceholder = true, showCondition = true,
  houseMode = showCondition ? 'filled' : 'none',
}: {
  masks: EditorMasks;
  showStreet?: boolean;
  showCommunal?: boolean;
  showPlaceholder?: boolean;
  showCondition?: boolean;
  /**
   * Which placeholder areas preview an occupant HOUSE:
   *   - `'filled'` — only areas containing a condition cell (the editor/gallery rule: a filled
   *     slot IS a condition, so the houses ride the condition toggle). The default.
   *   - `'all'`    — every placeholder area, condition or not. Used by the Template Sandbox,
   *     where the author toggles the whole tile's houses on per placement rather than authoring
   *     conditions.
   *   - `'none'`   — no houses.
   */
  houseMode?: 'filled' | 'all' | 'none';
}) {
  // A placeholder area with any condition-mask cell inside its footprint reads as an OCCUPIED
  // slot for this version, so it previews as an occupant HOUSE instead of the placeholder /
  // condition tint (see PlaceholderOccupantHouses). Split the areas into filled vs empty, and
  // strip the condition cells that fall inside a filled area from the orange tint (border-street
  // condition cells — outside any placeholder — still tint, so version authoring stays visible).
  const { filledAreas, emptyAreas, tintCondition } = useMemo(() => {
    const filled: PlaceholderArea[] = [];
    const empty: PlaceholderArea[] = [];
    const occupantCells = new Set<string>();
    for (const area of masks.placeholder) {
      const cells = placeholderAreaCells(area);
      if (cells.some((c) => masks.condition.has(c))) {
        filled.push(area);
        for (const c of cells) occupantCells.add(c);
      } else {
        empty.push(area);
      }
    }
    const cond = occupantCells.size === 0
      ? masks.condition
      : new Set([...masks.condition].filter((c) => !occupantCells.has(c)));
    return { filledAreas: filled, emptyAreas: empty, tintCondition: cond };
  }, [masks.placeholder, masks.condition]);

  // The occupant houses are tied to the CONDITION view toggle (a filled slot IS a condition):
  // when condition view is OFF the houses hide, and their slots fall back to the normal cyan
  // placeholder tint (so a filled area doesn't vanish) — i.e. show ALL areas, not just empty.
  const placeholderAreas = showCondition ? emptyAreas : masks.placeholder;

  // `'all'` ignores the condition split entirely (the sandbox's per-placement houses toggle).
  const houseAreas = houseMode === 'all' ? masks.placeholder : filledAreas;

  return (
    <>
      {showStreet && <MaskTintOverlay cells={masks.street} color={STREET_OVERLAY_COLOR} />}
      {showCommunal && <MaskTintOverlay cells={masks.communal} color={COMMUNAL_OVERLAY_COLOR} />}
      {showPlaceholder && <PlaceholderAreaOverlay areas={placeholderAreas} />}
      {showCondition && <MaskTintOverlay cells={tintCondition} color={CONDITION_OVERLAY_COLOR} />}
      {/* Occupant house previews. `'filled'` (default) draws them in place of the condition tint,
          so editor/gallery are unchanged; the sandbox passes `'all'`/`'none'` to render every
          placeholder area's house or none. */}
      {houseMode !== 'none' && <PlaceholderOccupantHouses areas={houseAreas} />}
    </>
  );
}

// ─── Rectangle selection preview ─────────────────────────────────────────────────
// The two-click rectangle tools (street / communal / placeholder / terrain 1 / terrain 2 /
// copy). Once the first corner is anchored, this tints every cell of the anchor→cursor
// rectangle so the author sees exactly where the fill will land before committing with the
// second click. Painted in the target layer's own colour (red under the eraser modifier),
// sitting at the hover z so it
// reads over the mask tints and grid, mirroring the single-cell HoverOverlay it replaces.
const COPY_SELECT_COLOR = 0xf48fb1; // pink — the clipboard group's accent
// Terrain has no persistent tint overlay (it paints real grass sprites), so its rectangle
// preview uses the terrain group's green accent — light for terrain 1, darker for terrain 2.
const TERRAIN1_SELECT_COLOR = 0x84cc78;
const TERRAIN2_SELECT_COLOR = 0x4a9e3f;
// The wood-panel (plank) decor tool tiles by rectangle (unlike the other decor tools, which
// drag-paint), so it needs a selection tint: a warm wood brown, distinct from the street tan.
const PLANK_SELECT_COLOR = 0xb5651d;
const RECT_TOOL_COLOR: Partial<Record<EditorTool, number>> = {
  street: STREET_OVERLAY_COLOR,
  communal: COMMUNAL_OVERLAY_COLOR,
  // Placeholder is NOT a rectangle tool (it is a fixed-size footprint DROP), so it has no
  // rectangle-preview colour — see PlaceholderAreaOverlay / PlaceholderPreviewOverlay.
  terrain1: TERRAIN1_SELECT_COLOR,
  terrain2: TERRAIN2_SELECT_COLOR,
  plankDecor: PLANK_SELECT_COLOR,
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
// The paste tool stamps the clipboard as a whole, so (like the placeholder drop) its cursor is a
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
  /** Current placeholder drop size — drives the placeholder tool's footprint ghost. */
  placeholderSize?: { w: number; h: number };
  /** Active decor tool's category (null when not a decor tool) — drives the decor ghost. */
  decorCategory?: DecorCategory | null;
  /** Current decor variant index (Space cycles it) — resolved per the hovered surface. */
  decorVariantIdx?: number;
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

function EditorScene({ width, height, masks, showGrid, showStreet, showCommunal, showPlaceholder, showCondition, activeTool, placeholderSize, decorCategory, decorVariantIdx, rectangleMode, onRectComplete, pasteMode, pasteFootprint, onPasteAt, eraseMode, onPaintCell, onEditBegin, pan, zoom, onPanChange }: SceneProps) {
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

  // The placeholder drop footprint is a PLACEMENT aid — shown only while dropping
  // (not erasing, where you remove one whole area per click via the single-cell hover).
  const placeholderTool = activeTool === 'placeholder' && !eraseMode && !!placeholderSize;
  const pasteTool = activeTool === 'paste' && !!pasteFootprint;
  // A decor tool shows a ghost of the sprite the next click will place (over the normal
  // single-cell hover). Suppressed while erasing — there you remove the cell's existing
  // decor, so previewing a to-be-placed sprite would mislead (the red hover marks erase).
  const decorTool = !!decorCategory && !eraseMode;
  // Colour of the rectangle-selection preview: the target mask's own tint (white fallback).
  const rectColor = (activeTool && RECT_TOOL_COLOR[activeTool]) ?? 0xffffff;
  // Copy just reads the region — the eraser modifier is a no-op for it, so don't tint its
  // selection red (that cue belongs to the mask tools, which really do erase-fill).
  const rectErase = eraseMode && activeTool !== 'copy';

  return (
    <pixiContainer x={cx} y={cy} scale={zoom} sortableChildren>
      <EditorTerrainLayer tiles={tiles} />
      {/* Spriteless mask tints (street/communal/placeholder/condition) + filled-slot occupant
          houses — the shared overlay stack the Load gallery also renders; here each layer is
          per-toggle. */}
      <TemplateMaskOverlays
        masks={masks}
        showStreet={showStreet}
        showCommunal={showCommunal}
        showPlaceholder={showPlaceholder}
        showCondition={showCondition}
      />
      {showGrid && <GridOverlay width={width} height={height} />}
      {/* Preview priority: an anchored rectangle selection → its live preview; the paste
          tool → a clipboard-sized footprint stamp; the placeholder tool → its current drop
          footprint; every other tool (and any erase) → single-cell hover, tinted red under the
          eraser modifier. A rectangle/paste tool BEFORE it has anything to preview falls
          through to the hover. */}
      {rectangleMode && rectAnchor
        ? <RectPreviewOverlay anchor={rectAnchor} cursor={hover} color={rectColor} erase={rectErase} />
        : pasteTool
          ? <PastePreviewOverlay cell={hover} w={pasteFootprint!.w} h={pasteFootprint!.h} width={width} height={height} />
          : placeholderTool
            ? <PlaceholderPreviewOverlay cell={hover} size={placeholderSize!} width={width} height={height} areas={masks.placeholder} />
            : <>
                <HoverOverlay cell={hover} erase={eraseMode} />
                {/* Decor tools add a ghost of the selected sprite over the hover diamond. */}
                {decorTool && <DecorGhostOverlay cell={hover} masks={masks} category={decorCategory!} variantIdx={decorVariantIdx ?? 0} />}
              </>}
    </pixiContainer>
  );
}

// ─── Outer component: pan/zoom state + wheel zoom + Application mount ─────────────
function TemplateEditorViewer({ width, height, masks, showGrid, showStreet, showCommunal, showPlaceholder, showCondition, activeTool, placeholderSize, decorCategory, decorVariantIdx, rectangleMode, onRectComplete, pasteMode, pasteFootprint, onPasteAt, eraseMode, onPaintCell, onEditBegin }: TemplateEditorViewerProps) {
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
            placeholderSize={placeholderSize}
            decorCategory={decorCategory}
            decorVariantIdx={decorVariantIdx}
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
