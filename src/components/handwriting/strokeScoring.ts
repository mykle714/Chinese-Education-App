/**
 * The stroke-to-stroke scoring primitives behind the beginner keyboard's matcher.
 *
 * LAYER: pure client utility. Like inkGeometry.ts it imports nothing that touches
 * an asset URL, so the offline template generator
 * (server/scripts/backfill/chinese/generate-handwriting-templates.js) can load it
 * under tsx. That is the whole reason it is its own file: the generator picks
 * which in-context component shapes to ship (§ 6z-5) by the SAME distance the
 * runtime ranks with. A second, generator-local metric would choose variants that
 * look different to a function the keyboard never runs.
 *
 * Consumers: glyphMatcher.ts (runtime ranking), generate-handwriting-templates.js
 * (variant selection).
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6s ("Ink → glyph — the matcher"), § 6z-5.
 */
import type { PolyStroke } from './inkGeometry';

/**
 * Cost charged for a template stroke the learner never drew (or vice versa).
 *
 * Tuning note: this is the knob that decides how badly a missing/extra stroke is
 * punished. Too low and a 3-stroke scribble matches every 8-stroke glyph; too
 * high and it becomes the hard stroke-count gate we deliberately rejected. The
 * value is empirical — roughly the mean point distance between two genuinely
 * different strokes in the normalized box.
 */
export const UNMATCHED_STROKE_COST = 0.35;

/**
 * Distance between one drawn stroke and one template stroke, taking the better of
 * the two traversal directions.
 *
 * `coords` is a flat x/y-interleaved array; `base` is the float index of the
 * template stroke's first x. Reading straight out of the Float32Array avoids
 * materializing a per-stroke object for all ~77,000 template strokes.
 */
export function strokeCost(drawn: PolyStroke, coords: ArrayLike<number>, base: number, points: number): number {
  let forward = 0;
  let reversed = 0;
  for (let i = 0; i < points; i++) {
    const [dx, dy] = drawn[i];
    const f = base + i * 2;
    forward += Math.hypot(dx - coords[f], dy - coords[f + 1]);
    const r = base + (points - 1 - i) * 2;
    reversed += Math.hypot(dx - coords[r], dy - coords[r + 1]);
  }
  return Math.min(forward, reversed) / points;
}

/**
 * Greedy assignment of drawn strokes onto template strokes, charging
 * UNMATCHED_STROKE_COST for anything left over on either side.
 *
 * Greedy rather than optimal (Hungarian): at ~10 strokes the greedy choice is
 * almost always the optimal one, and the difference is not worth an O(n³) step.
 *
 * `cost` is the per-pair distance function, so the coarse and full passes share
 * this assignment logic instead of duplicating it — the only thing that changes
 * between the two stages is how expensive comparing one pair is.
 */
export function assignmentCost(
  drawnCount: number,
  strokeCount: number,
  used: Uint8Array,
  cost: (drawnIndex: number, templateStroke: number) => number,
  /**
   * Optional observer for the pairings chosen. Used only by `explainGlyphMatch`
   * (§ 6w) — threaded through rather than duplicated into a second greedy loop,
   * so the explanation can never describe an assignment the scorer did not make.
   */
  record?: (drawnIndex: number, templateStroke: number, pairCost: number) => void,
): number {
  used.fill(0, 0, strokeCount);
  let total = 0;

  for (let i = 0; i < drawnCount; i++) {
    let best = Infinity;
    let bestIndex = -1;
    for (let j = 0; j < strokeCount; j++) {
      if (used[j]) continue;
      const c = cost(i, j);
      if (c < best) {
        best = c;
        bestIndex = j;
      }
    }
    if (bestIndex < 0) {
      // The learner drew more strokes than the template has: the surplus is
      // unmatched, and pays the same constant as a missing one.
      total += UNMATCHED_STROKE_COST;
      record?.(i, -1, UNMATCHED_STROKE_COST);
      continue;
    }
    used[bestIndex] = 1;
    total += best;
    record?.(i, bestIndex, best);
  }

  // Template strokes the learner never drew.
  for (let j = 0; j < strokeCount; j++) {
    if (!used[j]) {
      total += UNMATCHED_STROKE_COST;
      record?.(-1, j, UNMATCHED_STROKE_COST);
    }
  }

  // Divide by the LARGER count so a template cannot look good merely by having
  // few strokes to explain — otherwise 一 would rank near the top of everything.
  return total / Math.max(drawnCount, strokeCount, 1);
}

/**
 * The full scorer's cost between two already-fingerprinted shapes.
 *
 * The runtime never calls this — it scores against the flat template arrays
 * directly. It exists for the generator, which compares shapes that are not in
 * any asset yet (candidate in-context variants, § 6z-5), and must do so with the
 * exact assignment + stroke cost the runtime will later rank them by.
 *
 * Not symmetric in general (greedy assignment walks `drawn` in order), which is
 * fine: it is used to ask "how well does template B explain ink shaped like A".
 */
export function shapeCost(drawn: readonly PolyStroke[], template: readonly PolyStroke[]): number {
  const points = template[0]?.length ?? 0;
  const flat = new Float32Array(template.length * points * 2);
  let write = 0;
  for (const stroke of template) {
    for (const [x, y] of stroke) {
      flat[write++] = x;
      flat[write++] = y;
    }
  }
  const used = new Uint8Array(Math.max(template.length, 1));
  return assignmentCost(drawn.length, template.length, used, (d, j) =>
    strokeCost(drawn[d], flat, j * points * 2, points),
  );
}
