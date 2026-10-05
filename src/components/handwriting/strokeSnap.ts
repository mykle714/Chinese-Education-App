/**
 * strokeSnap.ts — Snap level's stroke matcher (Level 1, docs/PRACTICE_WRITING.md § "Snap").
 *
 * After each stroke the learner finishes, Snap asks one question: does this stroke
 * correspond closely enough with the NEXT stroke of the character? A match is replaced
 * by the printed stroke (the stage paints the corpus stroke shape in ink, and the ink
 * data becomes the stroke's median line, so Verify grades the canonical shape); a miss
 * turns red and fades out.
 *
 * WHY NOT Hanzi Writer's quiz mode: the guide is display-only (HanziGuide.tsx) and the
 * capture canvas sits on top of it; the quiz would need its own capture layer. This
 * reads the same corpus `medians` and judges in the CANVAS's px space, so the canvas
 * stays the only capture path.
 *
 * POSITION MATTERS. Unlike the beginner keyboard's matcher (inkGeometry.ts →
 * `fingerprint`, which normalizes away position and size), Snap compares the raw
 * canvas positions: the right shape in the wrong place is the wrong stroke. Both
 * strokes are resampled by arc length (`resampleStroke`) so point i of each sits the
 * same fraction along it; a stroke drawn backwards therefore fails the pointwise test.
 *
 * Coordinates: corpus glyphs are y-up, x ∈ [0, 1024], y ∈ [-124, 900]. Hanzi Writer
 * places that box inside the panel with `guidePadding(size)` on each side; in a square
 * panel that is `x' = pad + s·x`, `y' = pad + s·(900 − y)` with `s = (size − 2·pad)/1024`
 * (node_modules/hanzi-writer → Positioner).
 *
 * Layer: pure client utility (no React). Referenced by: WritingStage.tsx.
 * Docs: docs/PRACTICE_WRITING.md § "Snap", docs/WRITING_PRACTICE_REWORK.md § 1.
 */
import { resampleStroke, type Point } from "./inkGeometry";
import type { Stroke } from "./types";

/**
 * The guide's inner padding (px) for a `size` px panel. HanziGuide passes it to Hanzi
 * Writer, and Snap's printed strokes use it to land exactly on that outline — one
 * value, so the two cannot drift.
 */
export function guidePadding(size: number): number {
  return Math.round(size * 0.06);
}

/** Points both strokes are resampled to before comparing. */
const SNAP_SAMPLES = 16;
/**
 * Thresholds, as fractions of the glyph box's side (so they scale with the panel).
 * Starting values to tune from play — "closely enough" is a feel, not a spec.
 */
/** Mean distance between corresponding resampled points. */
const MAX_MEAN_DISTANCE = 0.12;
/** Start-to-start and end-to-end distance (catches a stroke drawn backwards). */
const MAX_ENDPOINT_DISTANCE = 0.2;
/** Drawn length ÷ expected length must fall in this band. */
const MIN_LENGTH_RATIO = 0.4;
const MAX_LENGTH_RATIO = 2.2;
/** Short strokes (dots) are judged against at least this length, so a tap can match. */
const MIN_REFERENCE_LENGTH = 0.08;

/** Font-unit → canvas-px mapping for a `size` px panel (matches HanziGuide). */
export function guideToCanvas(size: number) {
  const pad = guidePadding(size);
  const scale = (size - 2 * pad) / 1024;
  return {
    pad,
    scale,
    /** The glyph box's side in px — the unit the thresholds are fractions of. */
    box: size - 2 * pad,
    point: ([x, y]: readonly number[]): Point => [pad + scale * x, pad + scale * (900 - y)],
    /** SVG transform that draws corpus stroke paths onto the panel. */
    svgTransform: `translate(${pad}, ${pad}) scale(${scale}) translate(0, 900) scale(1, -1)`,
  };
}

function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/** True when the drawn `stroke` corresponds to the corpus `median` (font units). */
export function strokeMatchesMedian(stroke: Stroke, median: readonly number[][], size: number): boolean {
  if (stroke.xs.length === 0 || median.length === 0) return false;
  const map = guideToCanvas(size);
  const drawn: Point[] = stroke.xs.map((x, i) => [x, stroke.ys[i]]);
  const expected: Point[] = median.map(map.point);

  // Length band first — the cheapest reject.
  const drawnLength = polylineLength(drawn);
  const expectedLength = Math.max(polylineLength(expected), MIN_REFERENCE_LENGTH * map.box);
  const ratio = drawnLength / expectedLength;
  if (ratio < MIN_LENGTH_RATIO || ratio > MAX_LENGTH_RATIO) return false;

  const a = resampleStroke(drawn, SNAP_SAMPLES);
  const b = resampleStroke(expected, SNAP_SAMPLES);
  const dist = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]);

  const maxEndpoint = MAX_ENDPOINT_DISTANCE * map.box;
  if (dist(a[0], b[0]) > maxEndpoint || dist(a[a.length - 1], b[b.length - 1]) > maxEndpoint) return false;

  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += dist(a[i], b[i]);
  return sum / a.length <= MAX_MEAN_DISTANCE * map.box;
}

/**
 * The corpus median as a canvas `Stroke` — what a snapped stroke's ink data becomes.
 * Timestamps are spread evenly across the learner's own stroke's time span, so the
 * recognizer still sees a plausibly-paced stroke in draw order.
 */
export function medianToStroke(median: readonly number[][], size: number, drawn: Stroke): Stroke {
  const map = guideToCanvas(size);
  const points = median.map(map.point);
  const t0 = drawn.ts[0] ?? performance.now();
  const t1 = drawn.ts[drawn.ts.length - 1] ?? t0;
  const step = points.length > 1 ? (t1 - t0) / (points.length - 1) : 0;
  return {
    xs: points.map((p) => p[0]),
    ys: points.map((p) => p[1]),
    ts: points.map((_, i) => t0 + step * i),
  };
}
