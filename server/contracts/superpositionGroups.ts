/**
 * superpositionGroups.ts — how Superposition cuts a character's strokes into tiles
 * (docs/SUPERPOSITION_GAME.md § Stroke groups).
 *
 * Pure, with no value imports, so both halves load one definition:
 *   - the client builds tiles from it (src/games/superposition/board.ts → buildTiles);
 *   - the stored-groups backfill writes its output to `dictionaryentries_zh."superpositionGroups"`
 *     (server/scripts/backfill/chinese/backfill-superposition-groups.ts, migration 180), read
 *     only while `FEATURE_FLAGS.superpositionStoredGroups` is on.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 * A UNIT is a natural part (strokeParts.json: 口, 氵, …) or a stroke no part claims. Parts
 * are atomic, never opened, but they can be pulled into a neighbour's group like a stroke.
 * Units sit in stroke order, by their first stroke.
 *
 *  1. SEED: the free unit with the least ink opens a group.
 *  2. GROW, in stroke order only: the candidates are the free unit just before the group
 *     and the free unit just after it. Pull in the better one (see `compareContact`) until
 *     the group's ink reaches the threshold. A side whose next unit already belongs to a
 *     group is closed; with both sides closed the group stops, even under the threshold.
 *  3. Repeat from 1 until every unit is grouped. The next seed is again the smallest FREE
 *     unit; a group never collects the other small units by size alone.
 *  4. STRANDED: a group that stopped under the threshold joins a neighbouring group (the
 *     one before or after it, chosen by `compareContact`), smallest first, until none is
 *     left or the character is one group.
 *  5. A character that ends as ONE group gives back its last addition (the last pull or
 *     the last merge) as a second tile, because a lone tile is already a finished stack.
 *
 * Every group is a contiguous run of units, so a tile's strokes are neighbours in writing
 * order (a part may still reach around others, as 囗 does in 国).
 *
 * Referenced by: docs/SUPERPOSITION_GAME.md § Stroke groups,
 * src/games/superposition/board.ts, src/games/superposition/SuperpositionStage.tsx,
 * server/services/SuperpositionService.ts (stored groups),
 * server/scripts/backfill/chinese/backfill-superposition-groups.ts.
 */

/**
 * The ink (outline area, square glyph units) at which a group stops pulling in units.
 * 25,000 is set from 木 (2026-11-02): its smallest stroke holds about 26,000, so each of its
 * four strokes stands alone (at 30,000 the first three merged). 灬 no longer sets it: it is a
 * whole part in strokeParts.json, kept on one tile whatever the threshold. It does not
 * depend on the tile's size on screen.
 */
export const INK_MERGE_THRESHOLD = 25000;

/**
 * Outlines this close (glyph units, of 1024) count as touching. The data draws joined
 * strokes overlapping, so this only forgives hairline gaps where a join is drawn short.
 */
export const TOUCH_TOLERANCE_UNITS = 4;

/** Sampling pitch (glyph units) for the overlap measure. Coarse is fine: it only ranks. */
const OVERLAP_SAMPLE_UNITS = 8;
/** Line segments per curve when flattening an outline. */
const CURVE_SEGMENTS = 8;
/** Points each outline command reads. The hanzi-writer data uses only these, absolute. */
const COMMAND_POINTS: Record<string, number> = { M: 1, L: 1, Q: 2, C: 3 };

type Coordinate = [number, number];
/** A stroke's outline, flattened into a closed polygon. */
type Polygon = Coordinate[];

/** A point along a Bézier curve of any order (de Casteljau). */
function bezierAt(points: readonly Coordinate[], t: number): Coordinate {
  if (points.length === 1) return points[0];
  const next = points.slice(1).map((point, i): Coordinate => [
    points[i][0] + (point[0] - points[i][0]) * t,
    points[i][1] + (point[1] - points[i][1]) * t,
  ]);
  return bezierAt(next, t);
}

/** A stroke's SVG outline as a polygon, curves flattened into short segments. */
export function strokeOutline(path: string): Polygon {
  const tokens = path.match(/[A-Z]|-?\d*\.?\d+/g) ?? [];
  const outline: Polygon = [];
  let i = 0;
  while (i < tokens.length) {
    const pointCount = COMMAND_POINTS[tokens[i++]];
    if (!pointCount) continue;
    const points: Coordinate[] = [];
    for (let p = 0; p < pointCount; p++) {
      points.push([Number(tokens[i]), Number(tokens[i + 1])]);
      i += 2;
    }
    if (pointCount === 1) {
      outline.push(points[0]);
    } else {
      const curve = [outline[outline.length - 1] ?? points[0], ...points];
      for (let k = 1; k <= CURVE_SEGMENTS; k++) outline.push(bezierAt(curve, k / CURVE_SEGMENTS));
    }
  }
  return outline;
}

/** A polygon's area (shoelace formula). */
function polygonArea(outline: Polygon): number {
  const doubled = outline.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = outline[(index + 1) % outline.length];
    return sum + x * nextY - nextX * y;
  }, 0);
  return Math.abs(doubled) / 2;
}

/** A stroke's ink: the area of its outline in square glyph units. */
export function strokeInk(path: string): number {
  return polygonArea(strokeOutline(path));
}

// ── Contact between outlines ─────────────────────────────────────────────────────────

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const boxOf = (outline: Polygon): Box =>
  outline.reduce(
    (box, [x, y]) => ({
      minX: Math.min(box.minX, x),
      minY: Math.min(box.minY, y),
      maxX: Math.max(box.maxX, x),
      maxY: Math.max(box.maxY, y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );

/** Even-odd ray cast. */
function pointInPolygon(x: number, y: number, outline: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance([px, py]: Coordinate, [ax, ay]: Coordinate, [bx, by]: Coordinate): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const cross = (o: Coordinate, a: Coordinate, b: Coordinate) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Distance between two segments: 0 when they cross. */
function segmentDistance(a1: Coordinate, a2: Coordinate, b1: Coordinate, b2: Coordinate): number {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2)
  );
}

/** One stroke's measures, computed once per character. */
interface StrokeShape {
  outline: Polygon;
  box: Box;
  ink: number;
}

/** How two strokes meet: the gap between their outlines (0 when they overlap) and the overlap's area. */
interface Contact {
  distance: number;
  overlap: number;
}

function strokeContact(a: StrokeShape, b: StrokeShape): Contact {
  // The boxes' gap is a lower bound; a pair this far apart has no overlap to sample.
  const boxGap = Math.hypot(
    Math.max(0, a.box.minX - b.box.maxX, b.box.minX - a.box.maxX),
    Math.max(0, a.box.minY - b.box.maxY, b.box.minY - a.box.maxY)
  );
  if (a.outline.length === 0 || b.outline.length === 0) return { distance: Infinity, overlap: 0 };
  let distance: number;
  if (boxGap > 0) {
    distance = Infinity;
  } else if (pointInPolygon(a.outline[0][0], a.outline[0][1], b.outline) || pointInPolygon(b.outline[0][0], b.outline[0][1], a.outline)) {
    distance = 0;
  } else {
    distance = Infinity;
  }
  for (let i = 0; i < a.outline.length && distance > 0; i++) {
    const a1 = a.outline[i];
    const a2 = a.outline[(i + 1) % a.outline.length];
    for (let j = 0; j < b.outline.length && distance > 0; j++) {
      distance = Math.min(distance, segmentDistance(a1, a2, b.outline[j], b.outline[(j + 1) % b.outline.length]));
    }
  }
  return { distance, overlap: distance > 0 ? 0 : overlapArea(a, b) };
}

/** The shared area of two outlines, sampled on a grid over their boxes' intersection. */
function overlapArea(a: StrokeShape, b: StrokeShape): number {
  const minX = Math.max(a.box.minX, b.box.minX);
  const maxX = Math.min(a.box.maxX, b.box.maxX);
  const minY = Math.max(a.box.minY, b.box.minY);
  const maxY = Math.min(a.box.maxY, b.box.maxY);
  let hits = 0;
  for (let x = minX + OVERLAP_SAMPLE_UNITS / 2; x < maxX; x += OVERLAP_SAMPLE_UNITS) {
    for (let y = minY + OVERLAP_SAMPLE_UNITS / 2; y < maxY; y += OVERLAP_SAMPLE_UNITS) {
      if (pointInPolygon(x, y, a.outline) && pointInPolygon(x, y, b.outline)) hits++;
    }
  }
  return hits * OVERLAP_SAMPLE_UNITS * OVERLAP_SAMPLE_UNITS;
}

/**
 * Rank two candidates for the same group, given how each meets it. Negative: `a` goes
 * first. Touching beats not touching; between two touching, the bigger overlap wins;
 * between two apart, the shorter gap wins. A full tie goes to the unit AFTER the group,
 * the way the hand moves on.
 */
function compareContact(a: Contact & { after: boolean }, b: Contact & { after: boolean }): number {
  const touchA = a.distance <= TOUCH_TOLERANCE_UNITS;
  const touchB = b.distance <= TOUCH_TOLERANCE_UNITS;
  if (touchA !== touchB) return touchA ? -1 : 1;
  const byMeasure = touchA ? b.overlap - a.overlap : a.distance - b.distance;
  if (byMeasure !== 0) return byMeasure;
  return a.after === b.after ? 0 : a.after ? -1 : 1;
}

// ── Grouping ─────────────────────────────────────────────────────────────────────────

/** Is `groups` an exact partition of `strokeCount` strokes? Guards stored and dealt data. */
export function isStrokePartition(groups: readonly (readonly number[])[], strokeCount: number): boolean {
  const seen = new Set<number>();
  for (const group of groups) {
    if (group.length === 0) return false;
    for (const stroke of group) {
      if (!Number.isInteger(stroke) || stroke < 0 || stroke >= strokeCount || seen.has(stroke)) return false;
      seen.add(stroke);
    }
  }
  return seen.size === strokeCount;
}

/** Parts that fit the glyph and do not share a stroke; anything else is ignored whole. */
function usableParts(parts: readonly (readonly number[])[], strokeCount: number): readonly (readonly number[])[] {
  const seen = new Set<number>();
  for (const part of parts) {
    for (const stroke of part) {
      if (!Number.isInteger(stroke) || stroke < 0 || stroke >= strokeCount || seen.has(stroke)) return [];
      seen.add(stroke);
    }
  }
  return parts.filter((part) => part.length > 0);
}

/** A group under construction: a run of units `lo..hi` in stroke order. */
interface OpenGroup {
  lo: number;
  hi: number;
  ink: number;
  /** Unit indices in the order they joined, one entry per pull or merge (rule 5 undoes the last). */
  additions: number[][];
}

/**
 * A character's tiles: stroke indices per group, each group sorted, groups in stroke order.
 * `parts` are its natural parts (strokeParts.json); parts that do not fit are ignored.
 */
export function groupStrokes(
  paths: readonly string[],
  parts: readonly (readonly number[])[] = [],
  inkThreshold: number = INK_MERGE_THRESHOLD
): number[][] {
  if (paths.length === 0) return [];
  const shapes: StrokeShape[] = paths.map((path) => {
    const outline = strokeOutline(path);
    return { outline, box: boxOf(outline), ink: polygonArea(outline) };
  });

  // Units in stroke order, by first stroke.
  const fitParts = usableParts(parts, paths.length);
  const claimed = new Set(fitParts.flat());
  const units = [
    ...fitParts.map((part) => [...part].sort((a, b) => a - b)),
    ...paths.map((_, stroke) => stroke).filter((stroke) => !claimed.has(stroke)).map((stroke) => [stroke]),
  ].sort((a, b) => a[0] - b[0]);
  const unitInk = units.map((strokes) => strokes.reduce((sum, stroke) => sum + shapes[stroke].ink, 0));

  // Stroke-pair contact is the costly measure, so each pair is measured once.
  const pairCache = new Map<number, Contact>();
  const pairContact = (a: number, b: number): Contact => {
    const key = Math.min(a, b) * paths.length + Math.max(a, b);
    let contact = pairCache.get(key);
    if (!contact) {
      contact = strokeContact(shapes[a], shapes[b]);
      pairCache.set(key, contact);
    }
    return contact;
  };
  /** How the strokes of some units meet the strokes of others: the nearest gap, the summed overlap. */
  const contactBetween = (unitsA: readonly number[], unitsB: readonly number[]): Contact => {
    let distance = Infinity;
    let overlap = 0;
    for (const ua of unitsA) {
      for (const ub of unitsB) {
        for (const sa of units[ua]) {
          for (const sb of units[ub]) {
            const contact = pairContact(sa, sb);
            distance = Math.min(distance, contact.distance);
            overlap += contact.overlap;
          }
        }
      }
    }
    return { distance, overlap };
  };
  const unitsOf = (group: OpenGroup) => group.additions.flat();

  // Rules 1–3: seed at the smallest free unit, grow to a stroke-order neighbour.
  const owner: (OpenGroup | null)[] = units.map(() => null);
  const groups: OpenGroup[] = [];
  for (;;) {
    let seed = -1;
    owner.forEach((group, unit) => {
      if (group === null && (seed === -1 || unitInk[unit] < unitInk[seed])) seed = unit;
    });
    if (seed === -1) break;
    const group: OpenGroup = { lo: seed, hi: seed, ink: unitInk[seed], additions: [[seed]] };
    owner[seed] = group;
    groups.push(group);
    while (group.ink < inkThreshold) {
      const options = [
        { unit: group.lo - 1, after: false },
        { unit: group.hi + 1, after: true },
      ].filter(({ unit }) => unit >= 0 && unit < units.length && owner[unit] === null);
      if (options.length === 0) break;
      // Contact is only measured when there is a choice to rank.
      const members = unitsOf(group);
      const [pick] =
        options.length === 1
          ? options
          : options.map((option) => ({ ...option, ...contactBetween([option.unit], members) })).sort(compareContact);
      owner[pick.unit] = group;
      group.additions.push([pick.unit]);
      group.ink += unitInk[pick.unit];
      group.lo = Math.min(group.lo, pick.unit);
      group.hi = Math.max(group.hi, pick.unit);
    }
  }

  // Rule 4: a group stranded under the threshold joins its better neighbour, smallest first.
  for (;;) {
    if (groups.length < 2) break;
    const stranded = groups
      .filter((group) => group.ink < inkThreshold)
      .sort((a, b) => a.ink - b.ink || a.lo - b.lo)[0];
    if (!stranded) break;
    const members = unitsOf(stranded);
    const neighbours = [
      { group: stranded.lo > 0 ? owner[stranded.lo - 1] : null, after: false },
      { group: stranded.hi < units.length - 1 ? owner[stranded.hi + 1] : null, after: true },
    ].filter((option): option is { group: OpenGroup; after: boolean } => option.group !== null);
    const [into] =
      neighbours.length === 1
        ? neighbours
        : neighbours.map((option) => ({ ...option, ...contactBetween(members, unitsOf(option.group)) })).sort(compareContact);
    into.group.additions.push(members);
    into.group.ink += stranded.ink;
    into.group.lo = Math.min(into.group.lo, stranded.lo);
    into.group.hi = Math.max(into.group.hi, stranded.hi);
    members.forEach((unit) => (owner[unit] = into.group));
    groups.splice(groups.indexOf(stranded), 1);
  }

  let result = groups.map((group) => unitsOf(group).flatMap((unit) => units[unit]));

  // Rule 5: one tile would deal as a finished stack, so the last addition stands apart.
  if (groups.length === 1) {
    const [only] = groups;
    if (only.additions.length > 1) {
      const last = only.additions[only.additions.length - 1];
      const rest = only.additions.slice(0, -1).flat();
      result = [rest.flatMap((unit) => units[unit]), last.flatMap((unit) => units[unit])];
    } else if (result[0].length > 1) {
      // A single part covering the whole character (strokeParts.json never emits one): its largest stroke.
      const largest = result[0].reduce((best, stroke) => (shapes[stroke].ink > shapes[best].ink ? stroke : best));
      result = [result[0].filter((stroke) => stroke !== largest), [largest]];
    }
  }

  return result.map((strokes) => [...strokes].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}
