/**
 * superpositionGroups.ts — how Superposition cuts a character's strokes into tiles
 * (docs/SUPERPOSITION_GAME.md § Stroke groups).
 *
 * Pure, with no value imports, so both halves load one definition:
 *   - the client builds tiles from it (src/games/superposition/board.ts → buildTiles);
 *   - it is the FALLBACK for a character whose `dictionaryentries_zh."superpositionGroups"`
 *     (migration 180) is still NULL: those groups are AI-authored by
 *     server/scripts/backfill/chinese/backfill-superposition-groups.js, which also imports
 *     `SINGLE_STROKE_MAX`, `isStrokePartition`, `strokeOutline` and `strokeInk` from here.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 * A natural part (strokeParts.json: 口, 氵, …) is a CLOSED tile: exactly its own strokes,
 * never opened and never added to. Grouping runs only over the FREE strokes (the ones no
 * part claims), and ignores stroke order: it grows DENSE tiles, density being a group's ink
 * (outline area) over its bounding-box area. No stroke-count limit decides a tile's size;
 * the density curve does.
 *
 *  0. SIMPLE: a character of at most `SINGLE_STROKE_MAX` strokes deals every stroke alone
 *     (parts ignored), since it has too few strokes to break into anything else.
 *  1. SEED: the densest pair of free strokes starts a group.
 *  2. GROW: add the free stroke that leaves the group densest, and repeat. Stop before a
 *     SHARP DROP: when the next best stroke would leave density under `dropRatio` × the
 *     current density, the group is closed (it sits at a local peak of its density curve).
 *     Then seed the next group from the strokes left.
 *  3. LEFTOVER: a lone free stroke left at the end joins the group it leaves densest, so no
 *     tile is a single stroke. It stays alone only when no free group exists to join (every
 *     other stroke is in a part). A one-stroke PART (a split 心's dot) is a part, not this.
 *  4. A character that ends as ONE tile is cut at the sharpest drop of its growth, keeping
 *     both halves at two strokes or more, because a lone tile is already a finished stack.
 *
 * A tile's strokes need not be neighbours in writing order (耳 can pair strokes 1, 2).
 *
 * Referenced by: docs/SUPERPOSITION_GAME.md § Stroke groups,
 * src/games/superposition/board.ts, src/games/superposition/SuperpositionStage.tsx,
 * server/services/SuperpositionService.ts (stored groups),
 * server/scripts/backfill/chinese/backfill-superposition-groups.js.
 */

/** A character of at most this many strokes deals every stroke as its own tile (rule 0). */
export const SINGLE_STROKE_MAX = 4;

/**
 * Rule 2's sharp drop: a group stops growing when its next best stroke would leave it under
 * this fraction of its current density (2026-11-03, still to be tuned). Over the 710 most
 * frequent characters, 0.9 deals 3.05 tiles a character, 19% single strokes (nearly all
 * from characters of ≤ 4 strokes), 5% of five strokes or more. Lower ratios tolerate bigger
 * drops and so grow bigger tiles: 0.85 gives 2.97 tiles and lets 球's right side grow to 7.
 */
export const DENSITY_DROP_RATIO = 0.9;

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

// ── Bounding boxes ───────────────────────────────────────────────────────────────────

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

/** A free-stroke group while growing. */
interface FreeGroup {
  strokes: number[];
  ink: number;
  box: Box;
  /** Density after each step: [0] is the seed pair, [k] after the k-th added stroke. */
  densities: number[];
}

/** Floored at 1 so a zero-width stroke (a straight line's box) cannot divide by zero. */
const boxArea = (box: Box) => Math.max(1, (box.maxX - box.minX) * (box.maxY - box.minY));
const boxUnion = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

interface Shape {
  ink: number;
  box: Box;
}

const densityOf = (ink: number, box: Box) => ink / boxArea(box);

/** A copy of `group` with `stroke` added and its new density recorded. */
const withStroke = (group: FreeGroup, stroke: number, shape: Shape): FreeGroup => {
  const box = boxUnion(group.box, shape.box);
  const ink = group.ink + shape.ink;
  return { strokes: [...group.strokes, stroke], ink, box, densities: [...group.densities, densityOf(ink, box)] };
};

/** The free stroke that leaves `group` densest. Ties go to the lowest stroke index. */
function bestAddition(group: FreeGroup, free: readonly number[], shapes: readonly Shape[]) {
  let best: { stroke: number; density: number } | null = null;
  for (const stroke of free) {
    const density = densityOf(group.ink + shapes[stroke].ink, boxUnion(group.box, shapes[stroke].box));
    if (best === null || density > best.density) best = { stroke, density };
  }
  return best;
}

/** Rules 1–2: seed the densest pair of `free`, then grow it until the next stroke is a sharp drop. */
function growGroup(free: readonly number[], shapes: readonly Shape[], dropRatio: number): FreeGroup {
  let seed: { a: number; b: number; density: number } | null = null;
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = shapes[free[i]];
      const b = shapes[free[j]];
      const density = densityOf(a.ink + b.ink, boxUnion(a.box, b.box));
      if (seed === null || density > seed.density) seed = { a: free[i], b: free[j], density };
    }
  }
  if (seed === null) throw new Error('growGroup needs two free strokes');
  const { a, b } = seed;
  let group: FreeGroup = {
    strokes: [a, b],
    ink: shapes[a].ink + shapes[b].ink,
    box: boxUnion(shapes[a].box, shapes[b].box),
    densities: [seed.density],
  };
  let rest = free.filter((stroke) => stroke !== a && stroke !== b);
  for (;;) {
    const next = bestAddition(group, rest, shapes);
    if (next === null) break;
    const current = group.densities[group.densities.length - 1];
    if (next.density < current * dropRatio) break; // the sharp drop: close the group
    group = withStroke(group, next.stroke, shapes[next.stroke]);
    rest = rest.filter((stroke) => stroke !== next.stroke);
  }
  return group;
}

/**
 * A character's tiles: stroke indices per group, each group sorted, groups ordered by their
 * first stroke. `parts` are its natural parts (strokeParts.json); parts that do not fit are
 * ignored. `dropRatio` defaults to `DENSITY_DROP_RATIO`; tests pass their own.
 */
export function groupStrokes(
  paths: readonly string[],
  parts: readonly (readonly number[])[] = [],
  dropRatio: number = DENSITY_DROP_RATIO
): number[][] {
  if (paths.length === 0) return [];
  // Rule 0: a simple character is all single strokes.
  if (paths.length <= SINGLE_STROKE_MAX) return paths.map((_, stroke) => [stroke]);

  const shapes: Shape[] = paths.map((path) => {
    const outline = strokeOutline(path);
    return { box: boxOf(outline), ink: polygonArea(outline) };
  });

  // Parts are closed tiles; only the free strokes are grouped.
  const fitParts = usableParts(parts, paths.length).map((part) => [...part].sort((a, b) => a - b));
  const claimed = new Set(fitParts.flat());
  let free = paths.map((_, stroke) => stroke).filter((stroke) => !claimed.has(stroke));

  // Rules 1–2: grow groups until fewer than two free strokes are left.
  // O(n³) over ≤ ~30 free strokes, so no heap.
  const groups: FreeGroup[] = [];
  while (free.length >= 2) {
    const group = growGroup(free, shapes, dropRatio);
    groups.push(group);
    free = free.filter((stroke) => !group.strokes.includes(stroke));
  }

  // Rule 3: a lone leftover joins the group it leaves densest (or stays alone when there is none).
  const lone: number[][] = [];
  for (const stroke of free) {
    let target = -1;
    let targetDensity = -Infinity;
    groups.forEach((group, index) => {
      const density = densityOf(group.ink + shapes[stroke].ink, boxUnion(group.box, shapes[stroke].box));
      if (density > targetDensity) {
        targetDensity = density;
        target = index;
      }
    });
    if (target === -1) lone.push([stroke]);
    else groups[target] = withStroke(groups[target], stroke, shapes[stroke]);
  }

  let result: number[][] = [...fitParts, ...groups.map((group) => group.strokes), ...lone];

  // Rule 4: one tile would deal as a finished stack, so it is cut in two.
  if (result.length === 1) {
    const only = groups[0];
    if (only && only.strokes.length >= 4) {
      // Cut after step k (strokes [0, k + 1]) where the density fell hardest, both halves ≥ 2.
      // strokes.length > SINGLE_STROKE_MAX here, so at least one cut exists.
      let cut = 2;
      let worst = Infinity;
      for (let k = 0; k + 1 < only.densities.length && k + 4 <= only.strokes.length; k++) {
        const fall = only.densities[k + 1] / only.densities[k];
        if (fall < worst) {
          worst = fall;
          cut = k + 2;
        }
      }
      result = [only.strokes.slice(0, cut), only.strokes.slice(cut)];
    } else if (groups.length === 0 && result[0].length > 1) {
      // A single part covering the whole character (strokeParts.json never emits one): its largest stroke.
      const largest = result[0].reduce((most, stroke) => (shapes[stroke].ink > shapes[most].ink ? stroke : most));
      result = [result[0].filter((stroke) => stroke !== largest), [largest]];
    }
  }

  return result.map((strokes) => [...strokes].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}
