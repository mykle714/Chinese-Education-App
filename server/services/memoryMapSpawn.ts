import {
  MEMORY_MAP_BOW_RANGE,
  MEMORY_MAP_BOW_SIGMA,
  MEMORY_MAP_SCALE_RANGE,
  MEMORY_MAP_TILT_RANGE,
  MEMORY_MAP_TILT_SIGMA,
  type MemoryMapLink,
} from '../contracts/wire.js';
import {
  ISLAND_GAP,
  allParts,
  bowShape,
  estimatedShape,
  laySlot,
  layoutMap,
  mapBounds,
  partsOverlap,
  placeShape,
  type LaidSlot,
  type LayoutSlot,
  type ShapePart,
  type Tile,
} from './memoryMapLayout.js';

/**
 * Memory Map spawn — WHERE in the tree a new slot hangs (docs/MEMORY_MAP_GAME.md § 2.4).
 *
 * LAYER: pure module. No database, no I/O, no clock, and no `Math.random` unless the
 * caller hands one in, so every rule here can be exercised by a test instead of by
 * hitting an endpoint and squinting at the result.
 *
 * Division of labour with memoryMapLayout.ts: the LAYOUT turns a tree into positions
 * and is shared with the client; THIS module only decides, at spawn time, which parent
 * a new slot hangs off, at what bearing, and with what frozen tilt/bow/scale. It tries
 * candidates by actually laying them with `laySlot` — the same step the client's
 * `layoutMap` repeats. The server lays ESTIMATED glyph shapes and the client MEASURED
 * ones, so the spot it scores is a close approximation of the spot that gets drawn, not
 * an exact copy (memoryMapLayout.ts docblock).
 */

/** A 0..1 random source. Injected so every function here is deterministic in a test. */
export type Rng = () => number;

/**
 * A slot this spawn wants created. `tempId` stands in for the id the database will
 * assign; `parentSlotId` may name an existing slot OR an earlier planned slot's
 * `tempId`. Temp ids are allocated above every existing id, in plan order, so the
 * layout's "ascending id" order is the same before and after the insert.
 */
export interface PlannedSlot {
  tempId: number;
  parentSlotId: number | null;
  link: MemoryMapLink;
  angle: number | null;
  tilt: number;
  bow: number;
  scale: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

/** Probability that a new word starts its own island instead of growing one. */
export const NEW_ISLAND_CHANCE = 0.1;

/**
 * How much FURTHER than the bare island gap a new island may be pushed, in world units,
 * while hunting along its bearing for free water. A ray that would have to travel
 * further (it points across the whole map) is discarded rather than flinging an island
 * out to sea — the original unbounded version grew the map super-linearly (§ 14.7).
 */
const ISLAND_MAX_DRIFT = 12;

/** Bearings tried for a new island before choosing the most compact landing. */
const ISLAND_BEARING_PROBES = 16;

/** Legal growth candidates gathered before choosing the most compact one. */
const GROW_CANDIDATES = 8;

/** Growth attempts (legal or not) before giving up on the bridge rule. */
const GROW_ATTEMPTS = 40;

/**
 * Viewport shape the map is played in, as height / width — a phone held upright.
 * `frameCost` scores growth against a frame of this shape, not raw area: plain area
 * rewards a long thin map that then fits the phone at a tiny zoom (§ 2.4b).
 */
const VIEWPORT_ASPECT = 2;

/**
 * Portrait bias on bearings: the horizontal component of a uniformly drawn direction is
 * multiplied by this before the angle is taken back out, so bearings cluster toward
 * straight up/down. 1 = isotropic. A BIAS, not a constraint — every bearing stays
 * reachable, it is just rarer. `frameCost` does most of the shaping; this only makes
 * the candidates it chooses between mostly vertical to begin with.
 */
const GROW_BEARING_ASPECT = 0.6;
const ISLAND_BEARING_ASPECT = 0.3;

// ─────────────────────────────────────────────────────────────────────────────
// Random draws
// ─────────────────────────────────────────────────────────────────────────────

/** A frozen-at-spawn size multiplier drawn from `MEMORY_MAP_SCALE_RANGE`. */
export function drawScale(rng: Rng): number {
  const { min, max } = MEMORY_MAP_SCALE_RANGE;
  return min + rng() * (max - min);
}

/**
 * A normal draw around 0 with standard deviation `sigma`, truncated to `range`.
 *
 * Box–Muller turns two uniforms into one standard normal. Truncation is by REJECTION —
 * redraw anything outside the range — so the tails thin out smoothly instead of a
 * clamp stacking the overflow at exactly the cap. Bounded at 8 tries for safety (both
 * callers cap at ≥ 3σ, so a run of 8 rejections is vanishingly rare); the fallback clamps.
 */
function drawTruncatedNormal(rng: Rng, sigma: number, range: { min: number; max: number }): number {
  let value = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    // 1 - rng() keeps the log argument in (0, 1], so log never sees 0.
    const radius = Math.sqrt(-2 * Math.log(1 - rng()));
    value = radius * Math.cos(2 * Math.PI * rng()) * sigma;
    if (value >= range.min && value <= range.max) return value;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

/** A frozen-at-spawn render tilt in degrees: normal, σ `MEMORY_MAP_TILT_SIGMA`, within `MEMORY_MAP_TILT_RANGE`. */
export function drawTilt(rng: Rng): number {
  return drawTruncatedNormal(rng, MEMORY_MAP_TILT_SIGMA, MEMORY_MAP_TILT_RANGE);
}

/** A frozen-at-spawn bow in degrees of outer-character lean: normal, σ `MEMORY_MAP_BOW_SIGMA`, within `MEMORY_MAP_BOW_RANGE`. */
export function drawBow(rng: Rng): number {
  return drawTruncatedNormal(rng, MEMORY_MAP_BOW_SIGMA, MEMORY_MAP_BOW_RANGE);
}

/** A bearing in [0, 360), squashed toward vertical by `aspect` (see the constants). */
function drawBearing(rng: Rng, aspect: number): number {
  const theta = rng() * 2 * Math.PI;
  const degrees = (Math.atan2(Math.sin(theta), Math.cos(theta) * aspect) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much of a phone-shaped frame the map would need with `candidate` added. Lower is
 * more compact; only comparisons mean anything.
 *
 * Primary term: the frame's height — the taller of the map's height and
 * VIEWPORT_ASPECT × its width, i.e. whichever axis binds when the camera fits the map.
 * A candidate that fills slack without moving the binding edge costs nothing extra, so
 * new words fill coves before pushing the coastline out. The tiny area term breaks ties.
 */
function frameCost(
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  candidate: Tile[]
): number {
  const own = mapBounds(candidate);
  if (!own) return Infinity;
  const minX = Math.min(bounds?.minX ?? Infinity, own.minX);
  const maxX = Math.max(bounds?.maxX ?? -Infinity, own.maxX);
  const minY = Math.min(bounds?.minY ?? Infinity, own.minY);
  const maxY = Math.max(bounds?.maxY ?? -Infinity, own.maxY);
  const width = maxX - minX;
  const height = maxY - minY;
  return Math.max(VIEWPORT_ASPECT * width, height) + 1e-3 * width * height;
}

// ─────────────────────────────────────────────────────────────────────────────
// Choosing a parent + bearing
// ─────────────────────────────────────────────────────────────────────────────

interface Choice {
  parentIndex: number;
  link: MemoryMapLink;
  angle: number;
  x: number;
  y: number;
  parts: Tile[];
}

/**
 * Try to start a new island: ISLAND_BEARING_PROBES random (coast slot, bearing) rays,
 * each slid out until clear of everything by ISLAND_GAP, keeping the most compact.
 *
 * A ray is discarded when its landing drifted more than ISLAND_MAX_DRIFT past where it
 * would have stopped for the coast slot alone — i.e. it had to cross the map to find
 * water. Returns null when every ray was discarded; the caller then grows instead, so a
 * crowded map gains a neighbour rather than an outlier.
 */
function chooseIsland(
  laid: LaidSlot[],
  shape: ShapePart[],
  tilt: number,
  rng: Rng
): Choice | null {
  const obstacles = allParts(laid);
  const bounds = mapBounds(obstacles);
  let best: Choice | null = null;
  let bestCost = Infinity;

  for (let probe = 0; probe < ISLAND_BEARING_PROBES; probe++) {
    const parentIndex = Math.floor(rng() * laid.length);
    const coast = laid[parentIndex];
    const angle = drawBearing(rng, ISLAND_BEARING_ASPECT);

    const landing = laySlot(shape, tilt, 'island', angle, coast, obstacles);
    const coastOnly = laySlot(shape, tilt, 'island', angle, coast, coast.parts);
    if (landing.distance - coastOnly.distance > ISLAND_MAX_DRIFT) continue;

    const parts = placeShape(shape, landing.x, landing.y, tilt);
    const cost = frameCost(bounds, parts);
    if (cost < bestCost) {
      bestCost = cost;
      best = { parentIndex, link: 'island', angle, x: landing.x, y: landing.y, parts };
    }
  }
  return best;
}

/**
 * Grow an existing island: random (parent, bearing) pairs, each slid out until clear,
 * keeping the most compact of the first GROW_CANDIDATES LEGAL ones.
 *
 * Legal = the landing does not come within ISLAND_GAP of a tile on a DIFFERENT island.
 * Without that rule one word could land against two islands at once and visually merge
 * them, eroding the archipelago a word at a time (§ 2.4). A slide can carry a tile past
 * its parent into a neighbour on the same island; that is fine — it is still that
 * island.
 *
 * If no attempt is legal (a very crowded map), the most compact illegal one is used:
 * a slightly-too-close island beats a word with nowhere to go.
 */
function chooseGrowth(
  laid: LaidSlot[],
  shape: ShapePart[],
  tilt: number,
  rng: Rng
): Choice {
  const obstacles = allParts(laid);
  const bounds = mapBounds(obstacles);
  let bestLegal: Choice | null = null;
  let bestLegalCost = Infinity;
  let bestAny: Choice | null = null;
  let bestAnyCost = Infinity;
  let legalFound = 0;

  for (let attempt = 0; attempt < GROW_ATTEMPTS && legalFound < GROW_CANDIDATES; attempt++) {
    const parentIndex = Math.floor(rng() * laid.length);
    const parent = laid[parentIndex];
    const angle = drawBearing(rng, GROW_BEARING_ASPECT);
    const landing = laySlot(shape, tilt, 'grow', angle, parent, obstacles);
    const parts = placeShape(shape, landing.x, landing.y, tilt);
    const cost = frameCost(bounds, parts);
    const choice: Choice = { parentIndex, link: 'grow', angle, x: landing.x, y: landing.y, parts };

    if (cost < bestAnyCost) {
      bestAnyCost = cost;
      bestAny = choice;
    }

    const bridges = laid.some(
      (other) => other.islandRootSlotId !== parent.islandRootSlotId && partsOverlap(parts, other.parts, ISLAND_GAP)
    );
    if (bridges) continue;

    legalFound++;
    if (cost < bestLegalCost) {
      bestLegalCost = cost;
      bestLegal = choice;
    }
  }
  return (bestLegal ?? bestAny) as Choice;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Plan new slots for `incoming` words on a map whose current tree is `existing`.
 *
 * Each word, in order: draw its frozen scale, tilt and bow; on an empty map it becomes the
 * first root; otherwise NEW_ISLAND_CHANCE of the time try to start an island (falling
 * back to growth if no ray finds water), else grow. The chosen slot is appended to the
 * working layout so the next word clears it.
 *
 * `existing` must carry the CURRENT occupants' entryKeys — shapes come from them. The
 * server has no fonts, so this lays the map with `estimatedShape`; the client re-lays
 * the same tree with MEASURED glyph shapes (memoryMapLayout.ts docblock), which shifts
 * positions a little but cannot introduce an overlap.
 */
export function planSlots(
  existing: LayoutSlot[],
  incoming: { entryKey: string; language: string }[],
  rng: Rng
): PlannedSlot[] {
  const laid = layoutMap(existing);
  let nextTempId = existing.reduce((max, slot) => Math.max(max, slot.slotId), 0) + 1;
  const planned: PlannedSlot[] = [];

  for (const word of incoming) {
    const scale = drawScale(rng);
    const tilt = drawTilt(rng);
    const bow = drawBow(rng);
    // Bent exactly as `layoutMap` will bend it, so candidates are scored on the real arc.
    const shape = bowShape(estimatedShape(word.entryKey, scale, word.language), bow);
    const tempId = nextTempId++;

    if (laid.length === 0) {
      planned.push({ tempId, parentSlotId: null, link: 'grow', angle: null, tilt, bow, scale });
      laid.push({ slotId: tempId, x: 0, y: 0, tilt, parts: placeShape(shape, 0, 0, tilt), islandRootSlotId: tempId });
      continue;
    }

    const choice =
      (rng() < NEW_ISLAND_CHANCE ? chooseIsland(laid, shape, tilt, rng) : null) ??
      chooseGrowth(laid, shape, tilt, rng);
    const parent = laid[choice.parentIndex];

    planned.push({
      tempId,
      parentSlotId: parent.slotId,
      link: choice.link,
      angle: choice.angle,
      tilt,
      bow,
      scale,
    });
    laid.push({
      slotId: tempId,
      x: choice.x,
      y: choice.y,
      tilt,
      parts: choice.parts,
      islandRootSlotId: choice.link === 'island' ? tempId : parent.islandRootSlotId,
    });
  }

  return planned;
}
