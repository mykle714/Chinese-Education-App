import type { MemoryMapLink } from '../contracts/wire.js';

/**
 * Memory Map layout — turns the stored SLOT TREE into positions.
 * See docs/MEMORY_MAP_GAME.md § 2.3 (glyph shapes) and § 2.4 (the slot tree).
 *
 * LAYER: pure module. No database, no I/O, no randomness, no DOM. Everything here is a
 * deterministic function of its arguments.
 *
 * ── A WORD IS A SET OF CHARACTER BOXES, NOT A TILE ───────────────────────────
 * Since 2026-10-06 (second pass) words are drawn as bare outlined characters with no
 * container, and words touch CHARACTER TO CHARACTER. A slot's collision shape is
 * therefore a list of `ShapePart`s — one rectangle per character's INK, in the word's own
 * unrotated frame — and the slot's tilt rotates the whole set about the word's anchor.
 * Before the tilt, the slot's BOW (§ 2.3a) bends the characters onto a gentle arc: each
 * box is shifted perpendicular to the line and rotated to the arc's tangent about its
 * character's pivot (`bowShape`), so a box can carry its own rotation on top of the tilt.
 *
 * Ink depends on the typeface, so the shapes are NOT computed here. `layoutMap` takes a
 * `shapeOf` callback:
 *   • the CLIENT passes shapes MEASURED from the learner's font on load
 *     (src/games/memory-map/glyphShapes.ts) — the layout it draws;
 *   • the SERVER, which has no fonts, uses `estimatedShape` — good enough to choose
 *     bearings and score compactness at spawn time (memoryMapSpawn.ts).
 * The two layouts therefore differ by a few percent. That is fine because nothing
 * positional is stored: the client's layout is the only one anyone sees, and it is
 * overlap-free by construction whatever shapes it is given.
 *
 * ── WORLD COORDINATES ────────────────────────────────────────────────────────
 * Unitless; one world unit is the font size of an unscaled word (so a slot of scale s
 * renders its text at s world units). Y GROWS DOWNWARD (screen space), so a bearing of
 * 90° points DOWN and a positive tilt rotates clockwise — exactly what CSS `rotate()`
 * does with the same number. No flip anywhere.
 *
 * ── THE ONE ALGORITHM ────────────────────────────────────────────────────────
 * Slots are laid in ascending id order (parents always precede children). Each one
 * starts at its parent's anchor and SLIDES OUT along its bearing until none of its
 * character boxes overlaps any box laid so far:
 *   • `grow`   — clear of every box. Usually that is the instant it leaves its parent,
 *                so it ends up touching the parent; if a neighbour is in the way it
 *                keeps going and ends up touching that neighbour instead (owner-settled
 *                2026-10-06: push out along the ray, never re-aim).
 *   • `island` — clear of every box by `ISLAND_GAP` of water.
 * Exact, not stepped: for straight-line motion each (moving box, obstacle box) pair
 * blocks a single interval of slide distance, computed in closed form by the
 * separating-axis theorem (`blockedInterval`), and the slide stops at the first distance
 * outside all of them. A word's boxes move rigidly together, so every pair just
 * contributes its interval to the same list.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Unrotated extents of a box, in world units. */
export interface TileSize {
  width: number;
  height: number;
}

/** A placed box: centre, unrotated extents, and its rotation in degrees (cw). */
export interface Tile extends TileSize {
  x: number;
  y: number;
  tilt: number;
}

/**
 * One rectangle of a word's collision shape — normally one character's ink, outline
 * included — as an offset from the word's ANCHOR (the centre of its line box), in the
 * word's own unrotated frame, in world units.
 */
export interface ShapePart extends TileSize {
  dx: number;
  dy: number;
  /**
   * The x of the point the character turns about when bowed — the centre of its ADVANCE
   * box (which is also its line-box centre, so the pivot's y is the anchor's, 0). Distinct
   * from `dx` because ink is rarely centred in the advance; the renderer turns each
   * character span about this same point (MemoryMapWord.tsx). Absent = `dx`.
   */
  pivotDx?: number;
  /** Extra rotation of this box in degrees (cw), on top of the word's tilt. Set by `bowShape`. */
  rotate?: number;
}

/** The slot fields the layout reads. `entryKey` null = an empty slot. */
export interface LayoutSlot {
  slotId: number;
  parentSlotId: number | null;
  link: MemoryMapLink;
  angle: number | null;
  tilt: number;
  /** Outer-character lean in degrees (`MEMORY_MAP_BOW_RANGE`); + = smile. */
  bow: number;
  scale: number;
  entryKey: string | null;
  language: string;
}

/** Returns a slot's collision shape, already scaled to world units. */
export type ShapeOf = (slot: LayoutSlot) => ShapePart[];

/**
 * One laid slot: its anchor (`x`, `y`), its tilt, and its character boxes in WORLD
 * space (`parts`, each already rotated with the word). `islandRootSlotId` names the
 * island it belongs to (§ 2.4).
 */
export interface LaidSlot {
  slotId: number;
  x: number;
  y: number;
  tilt: number;
  parts: Tile[];
  islandRootSlotId: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-side shape estimate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Advance width of one glyph, in em. CJK glyphs are square by construction; Latin
 * letters average roughly half as wide.
 */
const GLYPH_ADVANCE: Record<string, number> = {
  zh: 1.0,
  es: 0.55,
};

/** Fraction of its advance / of the em that a glyph's ink typically covers. */
const ESTIMATED_INK = 0.9;

/** The glyph count an EMPTY slot is estimated as — the commonest word length. */
const EMPTY_SLOT_GLYPHS = 2;

/**
 * A font-free guess at a word's character boxes, for the SERVER (which has no fonts) and
 * for empty slots. One box per code point (so an astral-plane ideograph is one glyph,
 * not two), each `ESTIMATED_INK` of its advance, laid out left to right and centred on
 * the anchor. The client replaces this with measured ink (glyphShapes.ts).
 */
export function estimatedShape(entryKey: string | null, scale: number, language: string): ShapePart[] {
  const advance = GLYPH_ADVANCE[language] ?? GLYPH_ADVANCE.zh;
  const glyphs = entryKey ? [...entryKey].length : EMPTY_SLOT_GLYPHS;
  const total = Math.max(1, glyphs) * advance;
  const parts: ShapePart[] = [];
  for (let i = 0; i < Math.max(1, glyphs); i++) {
    const dx = (i * advance + advance / 2 - total / 2) * scale;
    parts.push({
      dx,
      dy: 0,
      // The estimate centres ink in its advance, so the pivot is the box centre.
      pivotDx: dx,
      width: advance * ESTIMATED_INK * scale,
      height: ESTIMATED_INK * scale,
    });
  }
  return parts;
}

/** The default `ShapeOf`: the estimate. */
export const estimatedShapeOf: ShapeOf = (slot) => estimatedShape(slot.entryKey, slot.scale, slot.language);

// ─────────────────────────────────────────────────────────────────────────────
// The bow (§ 2.3a)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where each character sits on a word's arc: a vertical shift `dy` (y down) and a
 * rotation `rotate` (degrees, cw), for characters whose pivots lie at `pivots` along the
 * line. Units in = units out (em on the client's render path, world units in the layout),
 * because the arc scales with the word.
 *
 * The arc is a parabola through the pivots (indistinguishable from a circle at these
 * depths, and its tangent is closed-form). With the outer pivots at ±H from the middle
 * and the outer characters leaning ±`bowDeg`, the slope at the ends is tan(bow), which
 * fixes the depth at H·tan(bow)/2. The arc is centred vertically on the line — middle
 * down by half the depth, ends up by half — so a bowed word stays balanced on its anchor
 * instead of drifting off it.
 *
 * Positive bow = smile: the ends are raised, the right end turns counter-clockwise and
 * the left end clockwise. Fewer than two characters (or every pivot in one place) has no
 * arc: all zeros. Shared by `bowShape` (collision) and the client renderer (drawing), so
 * the two cannot disagree.
 */
export function bowOffsets(pivots: number[], bowDeg: number): { dy: number; rotate: number }[] {
  if (pivots.length < 2 || bowDeg === 0) return pivots.map(() => ({ dy: 0, rotate: 0 }));
  const first = Math.min(...pivots);
  const last = Math.max(...pivots);
  const half = (last - first) / 2;
  if (half <= 1e-9) return pivots.map(() => ({ dy: 0, rotate: 0 }));
  const middle = (first + last) / 2;
  const endSlope = Math.tan(bowDeg * DEG);
  const depth = (half * endSlope) / 2;
  return pivots.map((pivot) => {
    const u = (pivot - middle) / half; // −1 at the left end, +1 at the right end
    return {
      dy: depth / 2 - depth * u * u,
      // Slope of dy along the line is −endSlope·u; y grows down, so that slope's angle is
      // already the cw rotation CSS wants.
      rotate: Math.atan(-endSlope * u) / DEG,
    };
  });
}

/**
 * A word's collision shape bent onto its bow: each box's pivot moves by `bowOffsets`'s
 * `dy`, and the box turns by its `rotate` about that pivot — exactly the transform the
 * renderer applies to the character span, so ink and collision box stay together.
 */
export function bowShape(shape: ShapePart[], bowDeg: number): ShapePart[] {
  const pivots = shape.map((part) => part.pivotDx ?? part.dx);
  const offsets = bowOffsets(pivots, bowDeg);
  return shape.map((part, i) => {
    const { dy, rotate } = offsets[i];
    if (dy === 0 && rotate === 0) return part;
    // The box centre relative to its pivot (which sits on the line, y = 0), turned.
    const turned = rotateOffset(part.dx - pivots[i], part.dy, rotate);
    return {
      ...part,
      dx: pivots[i] + turned.x,
      dy: dy + turned.y,
      rotate: (part.rotate ?? 0) + rotate,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tunables shared by layout and spawn
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clear water, in world units, between a new island and every box already laid.
 *
 * Wide enough that "these are two islands" reads instantly at a zoom where both are on
 * screen, and no wider. Lives HERE rather than in the spawn module because an island
 * link is re-derived by `layoutMap` on every draw: the gap is part of the geometry, not
 * a spawn-time preference. Changing it moves every island on every existing map.
 */
export const ISLAND_GAP = 1.75;

/**
 * Overlap slack, in world units. Boxes are laid exactly touching, so a strict
 * "do these intersect" test would call every touching pair overlapping. Interiors are
 * compared shrunk by this, so sharing a boundary is legal and sharing area is not.
 */
const OVERLAP_EPSILON = 1e-4;

/** See `slideOut`: how far past the exact contact distance a slide stops. */
const CONTACT_NUDGE = 1e-7;

// ─────────────────────────────────────────────────────────────────────────────
// Oriented-box geometry (separating-axis theorem)
// ─────────────────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;

/** Unit vector for a bearing in degrees (0 = east, clockwise on screen). */
export function bearingVector(angleDeg: number): { x: number; y: number } {
  return { x: Math.cos(angleDeg * DEG), y: Math.sin(angleDeg * DEG) };
}

/** A box's two local axes (its width direction and its height direction). */
function axesOf(tilt: number): [{ x: number; y: number }, { x: number; y: number }] {
  const c = Math.cos(tilt * DEG);
  const s = Math.sin(tilt * DEG);
  return [
    { x: c, y: s },
    { x: -s, y: c },
  ];
}

/** Rotate a word-frame offset by the word's tilt into world space. */
function rotateOffset(dx: number, dy: number, tilt: number): { x: number; y: number } {
  const c = Math.cos(tilt * DEG);
  const s = Math.sin(tilt * DEG);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/**
 * Half the length of a box's shadow on `axis` — its projection radius. `inflate` grows
 * the box by that much on every side first (how "clear by the island gap" is tested).
 */
function projectionRadius(size: TileSize, tilt: number, axis: { x: number; y: number }, inflate = 0): number {
  const [u, v] = axesOf(tilt);
  return (
    Math.abs(u.x * axis.x + u.y * axis.y) * (size.width / 2 + inflate) +
    Math.abs(v.x * axis.x + v.y * axis.y) * (size.height / 2 + inflate)
  );
}

/**
 * The slide distances at which a moving box overlaps `obstacle`, as an open interval
 * `[enter, exit]`, or null when it never does.
 *
 * The moving box has `size`/`tilt` and its centre travels `origin + t·dir`. By the
 * separating-axis theorem two convex boxes overlap exactly when their shadows overlap on
 * all four candidate axes (each box's two edge normals). On any one axis the shadow gap
 * is LINEAR in t, so "overlapping on this axis" is a single t-interval; the boxes
 * overlap on the intersection of the four. Closed form — no stepping.
 */
function blockedInterval(
  size: TileSize,
  tilt: number,
  origin: { x: number; y: number },
  dir: { x: number; y: number },
  obstacle: Tile,
  inflate: number
): [number, number] | null {
  let enter = -Infinity;
  let exit = Infinity;
  for (const axis of [...axesOf(tilt), ...axesOf(obstacle.tilt)]) {
    const reach =
      projectionRadius(size, tilt, axis, inflate) + projectionRadius(obstacle, obstacle.tilt, axis) - OVERLAP_EPSILON;
    const start = (origin.x - obstacle.x) * axis.x + (origin.y - obstacle.y) * axis.y;
    const rate = dir.x * axis.x + dir.y * axis.y;
    if (Math.abs(rate) < 1e-12) {
      // Moving parallel to this axis: the shadow gap never changes. Either it overlaps
      // here for every t (no constraint) or for none (never blocked at all).
      if (Math.abs(start) >= reach) return null;
      continue;
    }
    const a = (-reach - start) / rate;
    const b = (reach - start) / rate;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter >= exit) return null;
  }
  return [enter, exit];
}

/**
 * The first slide distance ≥ 0 at which the word is clear of every obstacle.
 *
 * Repeatedly hops to the far end of whichever blocked interval currently contains t.
 * Terminates because every hop strictly increases t to an interval end, and there are
 * finitely many ends.
 */
function firstClearDistance(intervals: [number, number][]): number {
  let t = 0;
  let moved = true;
  while (moved) {
    moved = false;
    for (const [enter, exit] of intervals) {
      // `enter === t` blocks too: the word is on the obstacle's boundary and about to
      // enter it. Only matters at t = 0, where the origin is the parent's anchor.
      if ((enter < t || enter === t) && t < exit) {
        t = exit;
        moved = true;
      }
    }
  }
  return t;
}

/**
 * Where a word lands when slid out from `origin` along `angle` (§ 2.4).
 *
 * `shape` is the word's boxes in its own frame; `tilt` rotates them about the anchor.
 * `inflate` is the water it must leave around every obstacle box: 0 for a grown slot,
 * the island gap for a new island's root.
 */
export function slideOut(
  shape: ShapePart[],
  tilt: number,
  origin: { x: number; y: number },
  angle: number,
  obstacles: Tile[],
  inflate: number
): { x: number; y: number; distance: number } {
  const dir = bearingVector(angle);
  const intervals: [number, number][] = [];
  for (const part of shape) {
    // Each box moves rigidly with the anchor, offset by its rotated position in the word.
    // Its own orientation is the word's tilt plus any bow rotation.
    const offset = rotateOffset(part.dx, part.dy, tilt);
    const partOrigin = { x: origin.x + offset.x, y: origin.y + offset.y };
    const partTilt = tilt + (part.rotate ?? 0);
    for (const obstacle of obstacles) {
      const blocked = blockedInterval(part, partTilt, partOrigin, dir, obstacle, inflate);
      if (blocked && blocked[1] > 0) intervals.push(blocked);
    }
  }
  // The clear distance sits EXACTLY on an obstacle's boundary, where float rounding
  // (~1e-15) can land a box a hair inside it by the very same test. A nudge far below
  // anything visible (and below OVERLAP_EPSILON, so it cannot reach the next obstacle's
  // blocked interval either) puts it strictly outside.
  const contact = firstClearDistance(intervals);
  const distance = contact > 0 ? contact + CONTACT_NUDGE : 0;
  return { x: origin.x + dir.x * distance, y: origin.y + dir.y * distance, distance };
}

/** A word's boxes in world space, for an anchor position and tilt. */
export function placeShape(shape: ShapePart[], x: number, y: number, tilt: number): Tile[] {
  return shape.map((part) => {
    const offset = rotateOffset(part.dx, part.dy, tilt);
    return { x: x + offset.x, y: y + offset.y, width: part.width, height: part.height, tilt: tilt + (part.rotate ?? 0) };
  });
}

/** Whether two boxes share interior area (touching is not overlapping). */
export function tilesOverlap(a: Tile, b: Tile, inflate = 0): boolean {
  for (const axis of [...axesOf(a.tilt), ...axesOf(b.tilt)]) {
    const reach = projectionRadius(a, a.tilt, axis, inflate) + projectionRadius(b, b.tilt, axis) - OVERLAP_EPSILON;
    const gap = Math.abs((a.x - b.x) * axis.x + (a.y - b.y) * axis.y);
    if (gap >= reach) return false;
  }
  return true;
}

/** Whether any box of one word overlaps any box of another (optionally inflated). */
export function partsOverlap(a: Tile[], b: Tile[], inflate = 0): boolean {
  return a.some((pa) => b.some((pb) => tilesOverlap(pa, pb, inflate)));
}

/** Half extents of a rotated box's axis-aligned bounding box. */
export function tileAabbHalf(tile: TileSize & { tilt: number }): { halfW: number; halfH: number } {
  const c = Math.abs(Math.cos(tile.tilt * DEG));
  const s = Math.abs(Math.sin(tile.tilt * DEG));
  return {
    halfW: (c * tile.width + s * tile.height) / 2,
    halfH: (s * tile.width + c * tile.height) / 2,
  };
}

/** The axis-aligned rect containing every box (rotation included), or null if none. */
export function mapBounds(
  tiles: Tile[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (tiles.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const tile of tiles) {
    const { halfW, halfH } = tileAabbHalf(tile);
    minX = Math.min(minX, tile.x - halfW);
    minY = Math.min(minY, tile.y - halfH);
    maxX = Math.max(maxX, tile.x + halfW);
    maxY = Math.max(maxY, tile.y + halfH);
  }
  return { minX, minY, maxX, maxY };
}

/** Every box of a laid map, flattened — what bounds and obstacle lists want. */
export function allParts(laid: LaidSlot[]): Tile[] {
  return laid.flatMap((slot) => slot.parts);
}

// ─────────────────────────────────────────────────────────────────────────────
// The layout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lay ONE slot against the boxes already laid. The step `layoutMap` repeats, and the
 * step the spawn module calls directly to try out candidate bearings.
 *
 * `parent` is null only for the first root, whose anchor sits at the world origin.
 */
export function laySlot(
  shape: ShapePart[],
  tilt: number,
  link: MemoryMapLink,
  angle: number | null,
  parent: { x: number; y: number } | null,
  obstacles: Tile[]
): { x: number; y: number; distance: number } {
  if (!parent || angle === null) return { x: 0, y: 0, distance: 0 };
  return slideOut(shape, tilt, parent, angle, obstacles, link === 'island' ? ISLAND_GAP : 0);
}

/**
 * Derive every slot's position from the tree. Output is in the input's order.
 *
 * Input MUST be ordered by `slotId` ascending — the wire contract and the DAL both
 * guarantee it, and the layout is order-dependent (each slot clears only the boxes laid
 * before it). Sorted defensively anyway.
 *
 * A slot whose parent is missing (it should be impossible — the parent FK refuses to
 * delete a slot that still has children) is laid as an island off the first slot rather
 * than thrown on, so one bad row costs a misplaced word, not an unplayable map.
 */
export function layoutMap(slots: LayoutSlot[], shapeOf: ShapeOf = estimatedShapeOf): LaidSlot[] {
  const ordered = [...slots].sort((a, b) => a.slotId - b.slotId);
  const laidById = new Map<number, LaidSlot>();
  const laid: LaidSlot[] = [];
  const obstacles: Tile[] = [];

  for (const slot of ordered) {
    const shape = bowShape(shapeOf(slot), slot.bow);
    // Orphaned = names a parent that is not laid, or is a SECOND parentless slot (only
    // the first root may sit at the origin). Both "impossible"; both degrade to an
    // island launched off the first slot.
    const orphaned = slot.parentSlotId === null ? laid.length > 0 : !laidById.has(slot.parentSlotId);
    const parent = orphaned
      ? laid[0]
      : slot.parentSlotId === null
        ? null
        : (laidById.get(slot.parentSlotId) as LaidSlot);
    const link: MemoryMapLink = orphaned ? 'island' : slot.link;
    const { x, y } = laySlot(shape, slot.tilt, link, slot.angle ?? 0, parent, obstacles);

    const placed: LaidSlot = {
      slotId: slot.slotId,
      x,
      y,
      tilt: slot.tilt,
      parts: placeShape(shape, x, y, slot.tilt),
      // An island is the tree's own structure: a root or an island link starts one,
      // and a grown slot belongs to its parent's.
      islandRootSlotId: !parent || link === 'island' ? slot.slotId : parent.islandRootSlotId,
    };
    laidById.set(slot.slotId, placed);
    laid.push(placed);
    obstacles.push(...placed.parts);
  }

  const order = new Map(slots.map((slot, i) => [slot.slotId, i]));
  return laid.sort((a, b) => (order.get(a.slotId) ?? 0) - (order.get(b.slotId) ?? 0));
}

/**
 * The islands of a laid map, as arrays of indices into `laid`, keyed by island root.
 * Read off the tree (`islandRootSlotId`), not off the geometry.
 */
export function islandsOf(laid: LaidSlot[]): { rootSlotId: number; indices: number[] }[] {
  const byRoot = new Map<number, number[]>();
  laid.forEach((slot, index) => {
    const list = byRoot.get(slot.islandRootSlotId);
    if (list) list.push(index);
    else byRoot.set(slot.islandRootSlotId, [index]);
  });
  return [...byRoot.entries()].map(([rootSlotId, indices]) => ({ rootSlotId, indices }));
}
