import { MEMORY_MAP_SCALE_RANGE } from '../contracts/wire.js';

/**
 * Memory Map geometry — where a new word lands on the map.
 *
 * LAYER: pure module. No database, no I/O, no clock, and no `Math.random` unless the
 * caller hands one in. Everything here is a function of its arguments, which is the
 * whole reason it is not folded into MemoryMapService: the archipelago rules are the
 * part of this feature most likely to need tuning, and tuning a rule you can only
 * exercise by hitting an endpoint is guesswork. See docs/MEMORY_MAP_GAME.md § 2.4.
 *
 * It is also NOT in the DAL, which would mean expressing "10% of the time, start a new
 * island" in SQL.
 *
 * ── WORLD COORDINATES ────────────────────────────────────────────────────────
 * Continuous and unitless. One world unit is the height of an unscaled word box; the
 * client picks pixels-per-unit at render time and nothing here cares. A box is
 * axis-aligned and identified by its CENTRE, because tangency maths on centres is
 * symmetric in a way that corner-anchored boxes are not.
 *
 * ── SHARED WITH THE CLIENT ───────────────────────────────────────────────────
 * `wordBoxSize` is imported by the game page as well as the service. That is
 * deliberate and load-bearing: the server places boxes by this formula, so if the
 * client drew words at their natural rendered width instead, tangent neighbours would
 * visibly overlap or float apart wherever the real font disagreed with the estimate.
 * The client therefore renders each word into a box of exactly this size and fits the
 * text inside it. GEOMETRY IS AUTHORITATIVE; typography conforms to it.
 * (Precedent for a client import of a shared server module:
 * `src/features/flashcards/collectionRef.ts` imports from `server/dal/shared/vetTable`.)
 */

/** An axis-aligned box on the map, identified by its centre. */
export interface MapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Just the extents of a box, before it has a position. */
export interface BoxSize {
  width: number;
  height: number;
}

/** A position for a newly placed box, plus how it got there (for logging/tests). */
export interface SpawnResult {
  x: number;
  y: number;
  /** `island` = started a new island; `grow` = placed tangent to an existing word. */
  mode: 'island' | 'grow';
}

/** A 0..1 random source. Injected so every function here is deterministic in a test. */
export type Rng = () => number;

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

/** Probability that a new word starts its own island instead of joining one (§ 2.4). */
export const NEW_ISLAND_CHANCE = 0.1;

/**
 * Clear water, in world units, between a new island and the coast it was launched from.
 *
 * Wide enough that "these are two islands" reads instantly at a zoom level where both
 * are on screen — the archipelago is the point, so islands must not look like one blob
 * with a seam — and no wider. Roughly one word-width.
 */
const ISLAND_GAP = 2.5;

/**
 * How much FURTHER than `ISLAND_GAP` a new island may be pushed while hunting for water
 * that is actually free, in world units. This is the hard cap on how far off the coast
 * an island can end up.
 *
 * It exists because the first version had no cap at all: it placed each island outside
 * the WHOLE MAP's bounding rect, at `halfDiagonal + gap` from the map's centre. That
 * radius grows with the map, so every island was flung further out than the last and
 * the map's area grew super-linearly — by 100 words the archipelago was mostly empty
 * ocean and the player spent the run panning between specks (reported 2026-08-18).
 *
 * Anchoring on a COAST rather than on the map's centre is the real fix; this bounds the
 * search that follows it.
 */
const ISLAND_MAX_DRIFT = 22;

/** How far each outward probe steps while looking for free water, in world units. */
const ISLAND_PROBE_STEP = 1;

/**
 * How much slack the overlap test allows, in world units.
 *
 * Tangent boxes touch EXACTLY, so a naive "do these intersect?" test would report a
 * box as overlapping the very neighbour it was just placed against, and every
 * placement would be rejected. The interiors are compared instead, shrunk by this
 * epsilon, so sharing a border is legal and sharing area is not.
 */
const OVERLAP_EPSILON = 1e-3;

/**
 * Fraction of the shared edge a tangent placement must actually overlap.
 *
 * Two boxes that meet at a single corner are technically tangent and look, on screen,
 * like two islands that happen to be near each other. Requiring a real shared SEGMENT
 * is what makes an island read as connected.
 */
const MIN_EDGE_OVERLAP = 0.35;

/** Attempts at growing an island before falling back to starting a new one. */
const GROW_ATTEMPTS = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Portrait bias
// ─────────────────────────────────────────────────────────────────────────────
//
// The map is played on a PHONE — a viewport roughly twice as tall as it is wide. A map
// that grows equally in all directions is therefore the wrong shape for its container:
// fitting it to the screen leaves fat empty margins above and below, and every word ends
// up smaller than it needed to be.
//
// Both growth rules are biased vertically to match. This is a bias, not a constraint:
// horizontal growth still happens, so the archipelago keeps an organic outline rather
// than becoming a column.

/**
 * Chance that a growth attempt tries a TOP or BOTTOM edge rather than a left/right one.
 * At 0.5 the map grows isotropically; at 1.0 it becomes a single-file column.
 */
const VERTICAL_GROWTH_BIAS = 0.9;

/**
 * How much a new island's bearing is squashed horizontally, as a multiplier on the
 * x-component before the direction is renormalized. Lower = islands stack more directly
 * above and below the archipelago rather than beside it. 1 would be no bias.
 */
const ISLAND_BEARING_ASPECT = 0.18;

/**
 * How far a word stacking on a TOP or BOTTOM edge may slide sideways, as a fraction of
 * the full legal range.
 *
 * Without this the vertical bias alone does not produce a narrow map: a word box is
 * wider than it is tall (~2.4 × 1.45 units for two characters), so each vertical stack
 * that is free to slide the full width of its anchor still fans the island outward. This
 * keeps a column reading as a column. It is not clamped to zero because perfectly
 * centred stacking would look like a table, not a coastline.
 */
const VERTICAL_SIDE_OFFSET_DAMP = 0.4;

// ─────────────────────────────────────────────────────────────────────────────
// Sizing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Advance width of one glyph, in world units, where a word box is 1 unit tall.
 *
 * CJK glyphs are square by construction; Latin letters are roughly half as wide as
 * they are tall. Getting this wrong is not a correctness bug — the client fits its
 * text into whatever box comes back — but a bad ratio makes Spanish words either
 * cramped or surrounded by dead space that other words then tangent against.
 */
const GLYPH_ADVANCE: Record<string, number> = {
  zh: 1.0,
  es: 0.55,
};

/** Breathing room around the text inside its box, in world units (total, both sides). */
const BOX_PADDING = 0.45;

/**
 * The world-space box a word occupies at a given frozen scale.
 *
 * Called by the server when placing neighbours AND by the client when drawing — see
 * the module docblock. Both must agree exactly, so this takes only the word and its
 * stored scale: nothing font-dependent, nothing viewport-dependent, nothing that
 * could differ between the two callers.
 *
 * `entryKey` is measured by CODE POINT rather than `.length` so a word containing an
 * astral-plane character (rare CJK ideographs live above U+FFFF) is not counted as two
 * glyphs and given a box twice as wide as it draws.
 */
export function wordBoxSize(entryKey: string, scale: number, language: string): BoxSize {
  const advance = GLYPH_ADVANCE[language] ?? GLYPH_ADVANCE.zh;
  const glyphs = Math.max(1, [...entryKey].length);
  return {
    width: (glyphs * advance + BOX_PADDING) * scale,
    height: (1 + BOX_PADDING) * scale,
  };
}

/** A frozen-at-spawn size multiplier drawn from the documented range (§ 2.3). */
export function drawScale(rng: Rng): number {
  const { min, max } = MEMORY_MAP_SCALE_RANGE;
  return min + rng() * (max - min);
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether two boxes share INTERIOR area. Touching along an edge or at a corner is
 * explicitly not an overlap — that is what the map is built out of.
 */
export function boxesOverlap(a: MapBox, b: MapBox): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 - OVERLAP_EPSILON &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 - OVERLAP_EPSILON
  );
}

/**
 * Shortest distance between two boxes' edges, in world units. Zero when they touch or
 * overlap.
 *
 * `boxesOverlap` answers yes/no; this answers "how much water is between them", which is
 * what island placement needs. A candidate that merely fails to overlap is not an
 * island — it could be a hair's breadth off a coast and read as part of it.
 */
export function boxSeparation(a: MapBox, b: MapBox): number {
  const gapX = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
  const gapY = Math.abs(a.y - b.y) - (a.height + b.height) / 2;
  // Negative on an axis means the boxes span each other there, so only the positive
  // gaps contribute to the true edge-to-edge distance.
  return Math.hypot(Math.max(gapX, 0), Math.max(gapY, 0));
}

/** Water between `candidate` and the nearest existing box (Infinity on an empty map). */
function nearestSeparation(candidate: MapBox, existing: MapBox[]): number {
  let nearest = Infinity;
  for (const box of existing) nearest = Math.min(nearest, boxSeparation(candidate, box));
  return nearest;
}

/** True when `candidate` overlaps nothing already on the map. */
function fits(candidate: MapBox, existing: MapBox[]): boolean {
  return !existing.some((box) => boxesOverlap(candidate, box));
}

/** The axis-aligned rect containing every placed box, or null for an empty map. */
export function mapBounds(
  boxes: MapBox[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x - box.width / 2);
    minY = Math.min(minY, box.y - box.height / 2);
    maxX = Math.max(maxX, box.x + box.width / 2);
    maxY = Math.max(maxY, box.y + box.height / 2);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Whether two boxes belong to the same island — i.e. they share a border segment.
 *
 * This is the inverse question to `boxesOverlap`, and the tolerance is why it needs its
 * own function: "tangent" means the gap on one axis is ~0 while the OTHER axis genuinely
 * overlaps. A corner touch (both axes at the boundary) is not a connection — two boxes
 * meeting at a point look like two islands that happen to be near each other, which is
 * exactly what MIN_EDGE_OVERLAP exists to prevent when placing.
 *
 * Overlap counts as connected too. It should never happen, but if a bad placement ever
 * did overlap, reporting the two as separate islands would be a stranger lie than
 * reporting them joined.
 */
export function boxesTouch(a: MapBox, b: MapBox, tolerance = 1e-2): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const halfW = (a.width + b.width) / 2;
  const halfH = (a.height + b.height) / 2;

  // Too far apart on either axis to be related at all.
  if (dx > halfW + tolerance || dy > halfH + tolerance) return false;

  if (boxesOverlap(a, b)) return true;

  const meetsOnX = Math.abs(dx - halfW) <= tolerance && dy < halfH - tolerance;
  const meetsOnY = Math.abs(dy - halfH) <= tolerance && dx < halfW - tolerance;
  return meetsOnX || meetsOnY;
}

/** Which of a box's four edges are shared with a neighbour. */
export interface TouchedSides {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/**
 * For every box, which of its edges are shared with another box.
 *
 * Drives the map's borders: a word draws a line only where it actually abuts a
 * neighbour, so an island reads as a set of parcels sharing fences while its coastline
 * stays open to the water. A full outline on every word would draw the coast too, and
 * doubled lines everywhere two words meet.
 *
 * Y GROWS DOWNWARD, matching screen space — a neighbour with a larger `y` is BELOW, and
 * so touches this box's `bottom`. The world layer applies no flip, so world and screen
 * agree on which way is up and this can be read literally by the renderer.
 *
 * O(n²) like `connectedIslands`, and for the same reason: the map is capped at 100.
 */
export function touchedSidesForAll(boxes: MapBox[], tolerance = 1e-2): TouchedSides[] {
  const sides: TouchedSides[] = boxes.map(() => ({
    top: false,
    right: false,
    bottom: false,
    left: false,
  }));

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const halfW = (a.width + b.width) / 2;
      const halfH = (a.height + b.height) / 2;

      // A shared EDGE needs the gap to close on one axis while the other genuinely
      // overlaps. Requiring real overlap is what stops a corner touch from drawing two
      // stray border stubs on boxes that only meet at a point.
      if (Math.abs(Math.abs(dx) - halfW) <= tolerance && Math.abs(dy) < halfH - tolerance) {
        if (dx > 0) {
          sides[i].right = true;
          sides[j].left = true;
        } else {
          sides[i].left = true;
          sides[j].right = true;
        }
      }

      if (Math.abs(Math.abs(dy) - halfH) <= tolerance && Math.abs(dx) < halfW - tolerance) {
        if (dy > 0) {
          sides[i].bottom = true;
          sides[j].top = true;
        } else {
          sides[i].top = true;
          sides[j].bottom = true;
        }
      }
    }
  }

  return sides;
}

/**
 * The islands of a map: connected components of the tangency graph, as arrays of
 * indices into `boxes`.
 *
 * THIS IS WHY THERE IS NO `islandId` COLUMN (§ 2.4). An island is not a stored fact, it
 * is whatever the geometry currently says — so a graduation that splits one island into
 * two, or a spawn that bridges two into one, is reflected immediately with nothing to
 * migrate and no column left telling an old story.
 *
 * Plain BFS over an O(n²) neighbour scan: the map is capped at MEMORY_MAP_CAPACITY
 * (100), so that is 10,000 cheap comparisons — far below the point where a spatial index
 * would earn its complexity.
 */
export function connectedIslands(boxes: MapBox[]): number[][] {
  const seen = new Array<boolean>(boxes.length).fill(false);
  const islands: number[][] = [];

  for (let start = 0; start < boxes.length; start++) {
    if (seen[start]) continue;

    const island: number[] = [];
    const queue = [start];
    seen[start] = true;

    while (queue.length > 0) {
      const current = queue.pop() as number;
      island.push(current);
      for (let other = 0; other < boxes.length; other++) {
        if (seen[other]) continue;
        if (boxesTouch(boxes[current], boxes[other])) {
          seen[other] = true;
          queue.push(other);
        }
      }
    }

    islands.push(island);
  }

  return islands;
}

/** The four sides of an anchor box a newcomer can attach to. */
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];

const VERTICAL_SIDES: readonly Side[] = ['top', 'bottom'];
const HORIZONTAL_SIDES: readonly Side[] = ['left', 'right'];

/**
 * A side to grow onto, biased toward the vertical so the map ends up portrait-shaped
 * like the phone it is played on (see VERTICAL_GROWTH_BIAS).
 */
function pickSide(rng: Rng): Side {
  const sides = rng() < VERTICAL_GROWTH_BIAS ? VERTICAL_SIDES : HORIZONTAL_SIDES;
  return sides[Math.floor(rng() * sides.length)];
}

/**
 * A unit bearing for a new island, squashed horizontally so islands stack above and
 * below the archipelago more often than beside it (see ISLAND_BEARING_ASPECT).
 *
 * Squashing the x-component of a uniform bearing and renormalizing — rather than
 * sampling from a narrower angular range — keeps every direction reachable. A map that
 * could never put an island due east would read as a rule rather than as a coastline.
 */
function pickIslandBearing(rng: Rng): { x: number; y: number } {
  const angle = rng() * Math.PI * 2;
  const x = Math.cos(angle) * ISLAND_BEARING_ASPECT;
  const y = Math.sin(angle);
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/**
 * Position `size` tangent to `anchor` on `side`, slid along that side by `offset`.
 *
 * `offset` is in [-1, 1] and is scaled to the range over which the two boxes still
 * share at least MIN_EDGE_OVERLAP of their common edge — so every value produces a
 * genuinely connected neighbour rather than a corner kiss.
 */
function tangentTo(anchor: MapBox, size: BoxSize, side: Side, offset: number): MapBox {
  // Half the distance the newcomer can slide before the shared edge shrinks below the
  // minimum. At offset 0 the boxes are centred on each other.
  const slideX = ((anchor.width + size.width) / 2) * (1 - MIN_EDGE_OVERLAP);
  const slideY = ((anchor.height + size.height) / 2) * (1 - MIN_EDGE_OVERLAP);

  switch (side) {
    case 'top':
      return {
        x: anchor.x + offset * slideX,
        y: anchor.y - (anchor.height + size.height) / 2,
        ...size,
      };
    case 'bottom':
      return {
        x: anchor.x + offset * slideX,
        y: anchor.y + (anchor.height + size.height) / 2,
        ...size,
      };
    case 'left':
      return {
        x: anchor.x - (anchor.width + size.width) / 2,
        y: anchor.y + offset * slideY,
        ...size,
      };
    case 'right':
      return {
        x: anchor.x + (anchor.width + size.width) / 2,
        y: anchor.y + offset * slideY,
        ...size,
      };
  }
}

/**
 * Place a new island: a bounded stretch of water off an existing island's coast.
 *
 * Anchored on a RANDOM EXISTING BOX rather than on the map's bounding rect, which is
 * what keeps the archipelago compact. Pushing out from the rect meant the distance grew
 * with the map (see ISLAND_MAX_DRIFT); pushing out from a coast means a new island is
 * always within a fixed swim of land that already exists, however big the map gets.
 *
 * The probe walks outward from the anchor along a random bearing until it finds water
 * that overlaps nothing, giving up at ISLAND_MAX_DRIFT. Giving up is not failure — see
 * the fallback in `spawnPosition`; a word must always get a spot.
 */
function placeNewIsland(existing: MapBox[], size: BoxSize, rng: Rng): SpawnResult | null {
  if (existing.length === 0) return { x: 0, y: 0, mode: 'island' };

  const anchor = existing[Math.floor(rng() * existing.length)];
  const bearing = pickIslandBearing(rng);
  const dirX = bearing.x;
  const dirY = bearing.y;

  // Distance at which the two boxes would just touch along this bearing. Using the
  // half-extents PROJECTED onto the bearing (rather than a circumscribing radius) keeps
  // a wide, short word from being pushed out as if it were square.
  const clearance =
    Math.abs(dirX) * (anchor.width + size.width) / 2 +
    Math.abs(dirY) * (anchor.height + size.height) / 2;

  // THE RAY MUST BE ALLOWED TO CROSS LAND. The bearing is random, so it very often
  // points INTO the island the anchor belongs to, and the probe has to traverse that
  // island before it reaches open water. Budgeting only ISLAND_MAX_DRIFT for the whole
  // ray meant any inward bearing gave up before clearing the coast — so almost every
  // island attempt fell through to growth and maps came out as ONE island (reported
  // 2026-08-18). The map's own span is therefore added to the search length; the drift
  // cap governs how far past the coast we may drift, not how far we may travel.
  const bounds = mapBounds(existing);
  const span = bounds
    ? Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    : 0;
  const maxDistance = clearance + span + ISLAND_GAP + ISLAND_MAX_DRIFT;

  for (let distance = clearance; distance <= maxDistance; distance += ISLAND_PROBE_STEP) {
    const candidate: MapBox = {
      x: anchor.x + dirX * distance,
      y: anchor.y + dirY * distance,
      ...size,
    };
    // Real water on every side, not merely "does not overlap": a candidate a hair off a
    // coast would be tangent-adjacent and read as part of that island rather than a new
    // one. The FIRST distance that satisfies this is by construction just off the coast,
    // which is what keeps the archipelago compact.
    if (nearestSeparation(candidate, existing) >= ISLAND_GAP) {
      return { x: candidate.x, y: candidate.y, mode: 'island' };
    }
  }

  return null;
}

/**
 * Last resort: outside the whole map, where nothing can possibly be in the way.
 *
 * Only reached when neither growing an island nor launching a new one found room within
 * their budgets. It is the placement that used to be used for EVERY island, and it is
 * kept solely because it cannot fail — a card that silently never appears on the
 * learner's map is the one outcome the feature cannot tolerate.
 */
function placeBeyondMap(existing: MapBox[], size: BoxSize, rng: Rng): SpawnResult {
  const bounds = mapBounds(existing);
  if (!bounds) return { x: 0, y: 0, mode: 'island' };

  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  const halfDiagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
  const radius = halfDiagonal + ISLAND_GAP + Math.hypot(size.width, size.height) / 2;

  const angle = rng() * Math.PI * 2;
  return {
    x: centreX + Math.cos(angle) * radius,
    y: centreY + Math.sin(angle) * radius,
    mode: 'island',
  };
}

/**
 * Island id per box, parallel to `boxes`. A flattened `connectedIslands`.
 */
function islandIndexByBox(boxes: MapBox[]): number[] {
  const ids = new Array<number>(boxes.length).fill(-1);
  connectedIslands(boxes).forEach((island, id) => {
    for (const i of island) ids[i] = id;
  });
  return ids;
}

/**
 * Whether placing `candidate` would JOIN TWO ISLANDS INTO ONE.
 *
 * Growth places a word tangent to a random neighbour, and nothing in that rule stops the
 * new box from also landing against a DIFFERENT island across a narrow channel. Each
 * such placement silently merges two islands, and over a whole map the archipelago
 * erodes back into one landmass — which is what a 65-word map still did once in every
 * thirty attempts even after island placement itself was fixed.
 *
 * So a grown word must stay clear of every island except the one it is joining. The
 * required clearance is the same `ISLAND_GAP` used to launch an island, which keeps a
 * channel that was cut wide enough to see from being silted up one word at a time.
 */
function bridgesIslands(
  candidate: MapBox,
  existing: MapBox[],
  islandOf: number[],
  joiningIsland: number
): boolean {
  for (let i = 0; i < existing.length; i++) {
    if (islandOf[i] === joiningIsland) continue;
    if (boxSeparation(candidate, existing[i]) < ISLAND_GAP) return true;
  }
  return false;
}

/**
 * Where to put one new word.
 *
 * The three cases, in the order they are tried:
 *   1. Empty map      → the origin. Every map's first word anchors the coordinate space.
 *   2. Roll < 10%     → a new island (§ 2.4).
 *   3. Otherwise      → tangent to a random existing word, on a random side, retried
 *                       with fresh anchors/sides/offsets until it fits.
 *
 * FALLBACK: if GROW_ATTEMPTS tangent positions all collide, the word starts a new
 * island instead of failing. A dense map with no free edge is not an error state and a
 * word must always get a spot — the alternative is a card that silently never appears
 * on the learner's map, which is the one outcome the feature cannot tolerate.
 */
export function spawnPosition(existing: MapBox[], size: BoxSize, rng: Rng): SpawnResult {
  if (existing.length === 0) return { x: 0, y: 0, mode: 'island' };

  if (rng() < NEW_ISLAND_CHANCE) {
    const island = placeNewIsland(existing, size, rng);
    if (island) return island;
    // No free water within the drift cap — grow instead of drifting off to sea. Falling
    // through to the tangent search (rather than straight to placeBeyondMap) is what
    // keeps a crowded map compact: a denied island becomes a neighbour, not an outlier.
  }

  // Computed once per placement rather than per attempt: the map does not change while
  // we are hunting for a spot on it.
  const islandOf = islandIndexByBox(existing);

  for (let attempt = 0; attempt < GROW_ATTEMPTS; attempt++) {
    const anchorIndex = Math.floor(rng() * existing.length);
    const anchor = existing[anchorIndex];
    const side = pickSide(rng);
    // Offset in [-1, 1]; 0 centres the newcomer on the anchor's edge. Lateral slide is
    // damped when stacking vertically, or the width a word box carries would undo the
    // vertical bias one stack at a time (see VERTICAL_SIDE_OFFSET_DAMP).
    const stacking = side === 'top' || side === 'bottom';
    const offset = (rng() * 2 - 1) * (stacking ? VERTICAL_SIDE_OFFSET_DAMP : 1);
    const candidate = tangentTo(anchor, size, side, offset);
    if (!fits(candidate, existing)) continue;
    // Growing an island must never silently merge it with its neighbour (see above).
    if (bridgesIslands(candidate, existing, islandOf, islandOf[anchorIndex])) continue;
    return { x: candidate.x, y: candidate.y, mode: 'grow' };
  }

  // Boxed in on every edge it tried. One more go at open water before the guaranteed
  // placement, so a dense map still produces an archipelago rather than a distant speck.
  return placeNewIsland(existing, size, rng) ?? placeBeyondMap(existing, size, rng);
}

/**
 * Place a batch of words in order, each seeing the ones placed before it.
 *
 * Sequential rather than parallel BY NECESSITY: word 2 must tangent against a map that
 * already contains word 1, or a batch load would stack every newcomer on the same spot.
 * The input order is the priority order the caller chose, and it is preserved in the
 * output so the caller can zip the results back onto its own rows.
 */
export function spawnBatch(
  existing: MapBox[],
  incoming: { entryKey: string; language: string }[],
  rng: Rng
): { x: number; y: number; scale: number }[] {
  // Copied, not mutated in place: the caller's array of already-placed boxes is its
  // own state and a spawn call must not silently extend it.
  const placed = [...existing];
  const results: { x: number; y: number; scale: number }[] = [];

  for (const word of incoming) {
    const scale = drawScale(rng);
    const size = wordBoxSize(word.entryKey, scale, word.language);
    const { x, y } = spawnPosition(placed, size, rng);
    placed.push({ x, y, ...size });
    results.push({ x, y, scale });
  }

  return results;
}
