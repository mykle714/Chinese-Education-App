/**
 * Stroke centrelines ("medians") recovered from a font OUTLINE, so a component's
 * § 6z-13 display form can also be a handwriting template (§ 6z-14).
 *
 * LAYER: build/asset generation utility. Pure computation — no DB, no filesystem,
 * no network. Consumed only by generate-handwriting-templates.js, which owns the I/O.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-14.
 * Depends on / referenced by: docs/BEGINNER_KEYBOARD.md § 6z-13, § 6z-14;
 *   server/__tests__/outlineMedians.test.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * The chip draws ⺈ as an outline cut from Noto Sans SC's 尔: a short 丿, a wide 横
 * across its middle, and a hook that drops BELOW the 丿. Every matcher template for
 * ⺈ comes from hanzi-writer-data instead, whose 尔 has a long 丿, a bar near its
 * foot and a short hook. A learner who copied the chip drew a shape the matcher had
 * no template for — measured 2026-11-15: ⺈ ranked 25th (cost 0.264), 冖 first
 * (0.153). What we SHOW and what we MATCH must be the same shape.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW
 *
 * A font outline is closed CONTOURS, not strokes, and the two do not line up: in
 * 尔's hat the 横钩 is two contours (the bar and the hook). So:
 *
 *   1. Each contour → its own centreline: rasterize it, thin it to a 1-px skeleton
 *      (Zhang–Suen), and keep the skeleton's longest path (which drops the short
 *      spurs thinning leaves at square corners). Per contour, not per glyph, so two
 *      strokes that touch never merge into one skeleton with a junction to untangle.
 *   2. Pieces → strokes, using a GUIDE: the same component's hanzi-writer strokes
 *      (cut from the same host), which know the stroke count, order and direction
 *      but not the font's proportions. Every guide stroke must receive at least one
 *      piece, so the assignment is the cheapest one under that constraint (see
 *      `assignPieces`) — not each piece's nearest stroke on its own, which fails
 *      when the two fonts place small strokes differently (§ 6z-15: Noto sets 然's
 *      two dots lower and further right than hanzi-writer's Kai, and both dots fell
 *      to one guide dot). Pieces are then ordered and oriented along their stroke,
 *      and concatenated.
 *
 * It fails LOUDLY (throws) rather than guess when there are fewer contours than guide
 * strokes: one contour then spans several strokes, which this does not split.
 */

/** Font units per raster pixel. Strokes are ~70 units wide, so ~17 px across. */
const RASTER_UNIT = 4;
/** Line segments per quadratic/cubic curve when flattening. */
const CURVE_STEPS = 12;

/**
 * Parse an absolute-command SVG path (M L Q C Z, as harfbuzz emits) into contours,
 * each a closed polygon of [x, y] points. Curves are flattened.
 *
 * @param {string} d
 * @returns {Array<Array<[number, number]>>}
 */
export function parseOutline(d) {
  const tokens = d.match(/[MLQCZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const contours = [];
  let current = null;
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') {
      current = [[num(), num()]];
      contours.push(current);
    } else if (command === 'L') {
      current.push([num(), num()]);
    } else if (command === 'Q' || command === 'C') {
      const [x0, y0] = current[current.length - 1];
      const control = command === 'Q' ? [[num(), num()]] : [[num(), num()], [num(), num()]];
      const [x3, y3] = [num(), num()];
      for (let step = 1; step <= CURVE_STEPS; step++) {
        const t = step / CURVE_STEPS;
        const u = 1 - t;
        if (command === 'Q') {
          const [[cx, cy]] = control;
          current.push([u * u * x0 + 2 * u * t * cx + t * t * x3, u * u * y0 + 2 * u * t * cy + t * t * y3]);
        } else {
          const [[ax, ay], [bx, by]] = control;
          current.push([
            u ** 3 * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t ** 3 * x3,
            u ** 3 * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t ** 3 * y3,
          ]);
        }
      }
    } else if (command === 'Z') {
      current = null;
    } else {
      throw new Error(`parseOutline: unsupported token "${command}" — expected absolute M/L/Q/C/Z`);
    }
  }
  return contours.filter((contour) => contour.length >= 3);
}

/** Even-odd scanline fill of one polygon onto a grid. Returns { grid, width, height, minX, minY }. */
function rasterize(polygon) {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  // One empty pixel of margin on every side: Zhang–Suen reads 8 neighbours.
  const minX = Math.min(...xs) - RASTER_UNIT;
  const minY = Math.min(...ys) - RASTER_UNIT;
  const width = Math.ceil((Math.max(...xs) - minX) / RASTER_UNIT) + 2;
  const height = Math.ceil((Math.max(...ys) - minY) / RASTER_UNIT) + 2;
  const grid = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const y = minY + (row + 0.5) * RASTER_UNIT;
    const crossings = [];
    for (let k = 0; k < polygon.length; k++) {
      const [x1, y1] = polygon[k];
      const [x2, y2] = polygon[(k + 1) % polygon.length];
      // Half-open rule so a vertex exactly on the scanline counts once.
      if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    crossings.sort((a, b) => a - b);
    for (let c = 0; c + 1 < crossings.length; c += 2) {
      const from = Math.max(0, Math.ceil((crossings[c] - minX) / RASTER_UNIT - 0.5));
      const to = Math.min(width - 1, Math.floor((crossings[c + 1] - minX) / RASTER_UNIT - 0.5));
      for (let col = from; col <= to; col++) grid[row * width + col] = 1;
    }
  }
  return { grid, width, height, minX, minY };
}

/** Zhang–Suen thinning, in place. */
function thin(grid, width, height) {
  const at = (r, c) => grid[r * width + c];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      const clear = [];
      for (let r = 1; r < height - 1; r++) {
        for (let c = 1; c < width - 1; c++) {
          if (!at(r, c)) continue;
          // P2..P9 clockwise from north.
          const n = [at(r - 1, c), at(r - 1, c + 1), at(r, c + 1), at(r + 1, c + 1), at(r + 1, c), at(r + 1, c - 1), at(r, c - 1), at(r - 1, c - 1)];
          const filled = n.reduce((sum, v) => sum + v, 0);
          if (filled < 2 || filled > 6) continue;
          let transitions = 0;
          for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) transitions++;
          if (transitions !== 1) continue;
          const [p2, , p4, , p6, , p8] = n;
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          clear.push(r * width + c);
        }
      }
      for (const index of clear) grid[index] = 0;
      if (clear.length) changed = true;
    }
  }
}

/** Farthest pixel from `start` over 8-connected skeleton pixels, plus the BFS parent map. */
function bfsFarthest(grid, width, start) {
  const parent = new Map([[start, -1]]);
  const queue = [start];
  let last = start;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    last = index;
    const r = Math.floor(index / width);
    const c = index % width;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const next = (r + dr) * width + (c + dc);
        if ((dr || dc) && grid[next] && !parent.has(next)) {
          parent.set(next, index);
          queue.push(next);
        }
      }
    }
  }
  return { far: last, parent };
}

/**
 * One contour's centreline in font units: the longest path through its skeleton
 * (double-sweep BFS — exact for a tree, which a thinned simple contour is).
 *
 * @param {Array<[number, number]>} polygon
 * @returns {Array<[number, number]>}
 */
export function contourCentreline(polygon) {
  const { grid, width, height, minX, minY } = rasterize(polygon);
  thin(grid, width, height);
  const seed = grid.findIndex((v) => v === 1);
  if (seed < 0) throw new Error('contourCentreline: contour rasterized to nothing — RASTER_UNIT too coarse?');
  const { far: end } = bfsFarthest(grid, width, seed);
  const { far: other, parent } = bfsFarthest(grid, width, end);
  const path = [];
  for (let index = other; index !== -1; index = parent.get(index)) {
    path.push([minX + ((index % width) + 0.5) * RASTER_UNIT, minY + (Math.floor(index / width) + 0.5) * RASTER_UNIT]);
  }
  return path;
}

/** Bbox-centre / max-side normalization, the same frame inkGeometry's `normalizeStrokes` uses. */
function frameOf(polylines) {
  const all = polylines.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6);
  return ([x, y]) => [(x - cx) / scale, (y - cy) / scale];
}

/** Nearest point on a polyline: { distance, t } with t = arc-length fraction along it. */
function project(point, polyline) {
  let total = 0;
  const lengths = [];
  for (let k = 0; k + 1 < polyline.length; k++) {
    const len = Math.hypot(polyline[k + 1][0] - polyline[k][0], polyline[k + 1][1] - polyline[k][1]);
    lengths.push(len);
    total += len;
  }
  let best = { distance: Infinity, t: 0 };
  let walked = 0;
  for (let k = 0; k < lengths.length; k++) {
    const [ax, ay] = polyline[k];
    const [bx, by] = polyline[k + 1];
    const len = lengths[k];
    const u = len === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - ax) * (bx - ax) + (point[1] - ay) * (by - ay)) / (len * len)));
    const distance = Math.hypot(point[0] - (ax + u * (bx - ax)), point[1] - (ay + u * (by - ay)));
    if (distance < best.distance) best = { distance, t: total === 0 ? 0 : (walked + u * len) / total };
    walked += len;
  }
  return best;
}

/**
 * Rectangular assignment (Hungarian algorithm, O(n²·m)): match each of n rows to a
 * DISTINCT one of m ≥ n columns, minimizing the summed cost.
 *
 * @param {number[][]} cost n × m
 * @returns {number[]} column chosen for each row
 */
function minCostMatching(cost) {
  const n = cost.length;
  const m = cost[0].length;
  // 1-indexed potentials/links, the classic formulation; column 0 is a sentinel.
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const rowOfColumn = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let row = 1; row <= n; row++) {
    rowOfColumn[0] = row;
    let column0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = rowOfColumn[column0];
      let delta = Infinity;
      let column1 = 0;
      for (let column = 1; column <= m; column++) {
        if (used[column]) continue;
        const reduced = cost[row0 - 1][column - 1] - u[row0] - v[column];
        if (reduced < minv[column]) {
          minv[column] = reduced;
          way[column] = column0;
        }
        if (minv[column] < delta) {
          delta = minv[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= m; column++) {
        if (used[column]) {
          u[rowOfColumn[column]] += delta;
          v[column] -= delta;
        } else {
          minv[column] -= delta;
        }
      }
      column0 = column1;
    } while (rowOfColumn[column0] !== 0);
    do {
      const column1 = way[column0];
      rowOfColumn[column0] = rowOfColumn[column1];
      column0 = column1;
    } while (column0);
  }
  const columnOfRow = new Array(n).fill(-1);
  for (let column = 1; column <= m; column++) if (rowOfColumn[column]) columnOfRow[rowOfColumn[column] - 1] = column - 1;
  return columnOfRow;
}

/**
 * Which guide stroke each piece belongs to: the cheapest assignment in which EVERY
 * stroke gets at least one piece.
 *
 * With `nearest(p)` the cost of piece p's closest stroke, any valid assignment costs
 * Σ nearest(p) plus, for one "anchor" piece per stroke, its extra cost over nearest —
 * the non-anchor pieces simply take their nearest stroke. So the optimum is a
 * one-to-one matching of strokes to distinct anchor pieces on that extra cost, which
 * `minCostMatching` solves exactly. When every stroke already is some piece's nearest,
 * all extras can be 0 and the result equals plain nearest-stroke assignment.
 *
 * @param {number[][]} cost pieces × strokes, mean distance of the piece to the stroke
 * @returns {number[]} stroke index per piece
 */
function assignPieces(cost) {
  const strokeCount = cost[0].length;
  const nearest = cost.map((row) => row.indexOf(Math.min(...row)));
  const extra = Array.from({ length: strokeCount }, (_, stroke) =>
    cost.map((row, piece) => row[stroke] - row[nearest[piece]]),
  );
  const anchorOfStroke = minCostMatching(extra);
  const assignment = [...nearest];
  anchorOfStroke.forEach((piece, stroke) => {
    assignment[piece] = stroke;
  });
  return assignment;
}

/**
 * Recover per-stroke medians from a display outline, using a guide drawing of the
 * same component for stroke count, order and direction.
 *
 * Both inputs must share an axis convention (font units and hanzi-writer medians
 * are both y-up); scale and position need not match.
 *
 * @param {string} outline           SVG path of the display form (COMPONENT_DISPLAY_PATHS value)
 * @param {Array<Array<[number,number]>>} guide the component's hanzi-writer strokes, in stroke order
 * @returns {Array<Array<[number,number]>>} one polyline per guide stroke, in guide order and direction
 */
export function outlineMedians(outline, guide) {
  if (!guide?.length) throw new Error('outlineMedians: empty guide');
  const pieces = parseOutline(outline).map(contourCentreline);
  if (pieces.length < guide.length) {
    throw new Error(`outlineMedians: ${pieces.length} contour(s) for ${guide.length} guide stroke(s) — a contour spans several strokes`);
  }

  const toPieceFrame = frameOf(pieces);
  const toGuideFrame = frameOf(guide);
  const guideN = guide.map((stroke) => stroke.map(toGuideFrame));

  // cost[p][j]: how far piece p's points lie from guide stroke j, on average.
  const piecesN = pieces.map((piece) => piece.map(toPieceFrame));
  const cost = piecesN.map((pointsN) =>
    guideN.map((stroke) => pointsN.reduce((sum, p) => sum + project(p, stroke).distance, 0) / pointsN.length),
  );
  const strokeOfPiece = assignPieces(cost);

  const byStroke = guide.map(() => []);
  pieces.forEach((piece, p) => {
    const best = strokeOfPiece[p];
    const pointsN = piecesN[p];
    // Where along the stroke the piece starts and ends, to order and orient it.
    const tStart = project(pointsN[0], guideN[best]).t;
    const tEnd = project(pointsN[pointsN.length - 1], guideN[best]).t;
    byStroke[best].push({ points: tStart <= tEnd ? piece : [...piece].reverse(), t: (tStart + tEnd) / 2 });
  });

  return byStroke.map((assigned, j) => {
    // Unreachable by construction (assignPieces anchors a piece on every stroke, and
    // pieces ≥ strokes is checked above) — kept as a guard against a future edit.
    if (assigned.length === 0) {
      throw new Error(`outlineMedians: no contour lies along guide stroke ${j} — a contour spans several strokes`);
    }
    return assigned.sort((a, b) => a.t - b.t).flatMap((piece) => piece.points);
  });
}
