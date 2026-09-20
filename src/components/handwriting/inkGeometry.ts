/**
 * Shape-normalization geometry shared by the beginner keyboard's component
 * matcher and the offline template generator.
 *
 * LAYER: pure client utility. No imports, no DOM, no React — deliberately, so
 * that `server/scripts/backfill/chinese/generate-handwriting-templates.js` can
 * import this same file under tsx and produce templates that are byte-for-byte
 * consistent with what the runtime computes from a learner's ink. If these two
 * ever diverge, every stored template silently becomes wrong.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6s ("Ink → component — the matcher").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PIPELINE
 *
 *   raw points  →  resampleStroke (arc length, POINTS_PER_STROKE)
 *               →  normalizeStrokes (centre + uniform scale)
 *               →  a fixed-size numeric fingerprint, comparable to any other
 *
 * Both halves of the keyboard run exactly this: the generator over
 * hanzi-writer-data `medians`, the runtime over captured pointer positions.
 */

/**
 * Points each stroke is resampled to. Chosen as 8 over 16 because accuracy is
 * flat between them while 8 halves the scoring inner loop (§ 6s, "RESOLVED
 * 2026-09-07"). This is a build constant on BOTH sides: changing it invalidates
 * the generated asset, so regenerate whenever it moves.
 */
export const POINTS_PER_STROKE = 8;

/**
 * Fixed-point scale for int8 template storage. Normalized coordinates live in
 * roughly [-0.5, 0.5], so ×254 maps them onto the signed-byte range with a
 * little headroom. Paired with POINTS_PER_STROKE in the asset header.
 */
export const QUANT_SCALE = 254;

/** A stroke as the matcher sees it: [x, y] pairs, in draw order. */
export type Point = readonly [number, number];
export type PolyStroke = Point[];

/**
 * Resample a polyline to exactly `count` points spaced evenly along its ARC
 * LENGTH (not evenly by index).
 *
 * Why arc length: the inputs are wildly non-uniform. hanzi-writer medians are
 * sparse and bunched at curves; captured ink is dense where the pen moved slowly.
 * Comparing them point-by-point is only meaningful once both are re-parameterized
 * by distance travelled, which makes point i of one stroke correspond to the same
 * fraction along the other.
 */
export function resampleStroke(points: readonly Point[], count = POINTS_PER_STROKE): PolyStroke {
  if (points.length === 0) return [];

  // Cumulative arc length at each input point.
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    cumulative.push(cumulative[i - 1] + Math.hypot(dx, dy));
  }

  const total = cumulative[cumulative.length - 1];
  const out: PolyStroke = [];

  // Degenerate stroke (a tap, or a single point): every sample is that point.
  // Real ink produces these whenever the learner dots rather than draws.
  if (total === 0) {
    for (let i = 0; i < count; i++) out.push([points[0][0], points[0][1]]);
    return out;
  }

  // Walk the target distances forward through the segments. `segment` only ever
  // advances, so this is O(points + count) rather than a search per sample.
  let segment = 0;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1);
    while (segment < cumulative.length - 2 && cumulative[segment + 1] < target) segment++;
    const spanLength = cumulative[segment + 1] - cumulative[segment] || 1;
    const t = (target - cumulative[segment]) / spanLength;
    out.push([
      points[segment][0] + (points[segment + 1][0] - points[segment][0]) * t,
      points[segment][1] + (points[segment + 1][1] - points[segment][1]) * t,
    ]);
  }
  return out;
}

/**
 * Centre a set of strokes on their shared bounding box and scale them by the
 * LARGER of width/height, so the result is free of size and position but keeps
 * its aspect ratio.
 *
 * ⚠️ The scale must be uniform. Stretching each axis to fill the box would make
 * 日 and 曰 identical, and would turn every single-stroke component (一, 丨)
 * into the same object — their bounding box is degenerate on one axis, which is
 * also why the divisor is floored.
 */
export function normalizeStrokes(strokes: readonly PolyStroke[]): PolyStroke[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return strokes.map((stroke) => stroke.map((p) => [p[0], p[1]] as Point));

  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  // Floored so a perfectly flat component (一) does not divide by zero.
  const scale = Math.max(maxX - minX, maxY - minY, 1e-6);

  return strokes.map((stroke) =>
    stroke.map((p) => [(p[0] - centreX) / scale, (p[1] - centreY) / scale] as Point),
  );
}

/** Resample then normalize — the full fingerprint step, as both sides run it. */
export function fingerprint(strokes: readonly (readonly Point[])[]): PolyStroke[] {
  return normalizeStrokes(strokes.map((stroke) => resampleStroke(stroke)));
}
