/**
 * The beginner keyboard's handwriting recognizer: score a learner's ink against
 * every known glyph — components and whole characters alike — and rank them.
 *
 * LAYER: pure client logic. No network, no DOM, no React — recognition is local,
 * synchronous and offline by design (docs/BEGINNER_KEYBOARD.md § 6a/§ 6b explain
 * why the existing Google proxy cannot do this job).
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6s ("Ink → glyph — the matcher").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE PROPERTIES THAT MAKE THIS WORK FOR BEGINNERS
 *
 * 1. STROKE ORDER IS IGNORED. Drawn strokes are assigned onto template strokes
 *    greedily, not positionally. A learner who writes 木 bottom-up scores the
 *    same as one who writes it correctly — this is a writing keyboard, not a
 *    stroke-order drill.
 * 2. STROKE DIRECTION IS IGNORED. Each pair is scored forwards and reversed and
 *    the better is taken.
 * 3. STROKE COUNT IS NOT GATED — not as a filter, and not as a ranking penalty.
 *    Measured: a hard gate scores 0% whenever the learner miscounts, and
 *    miscounting is the single most common beginner error (§ 6s, "ANSWERS open
 *    question #10"). Count enters only through the normalizing denominator.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A TWO-STAGE CASCADE
 *
 * The set is 7,258 glyphs, not 895, because the learner may draw a whole
 * character and there is no mode switch to say which they meant. Scoring all of
 * them with the full scorer costs ~1.3 s — far too slow for a keystroke.
 *
 * So each submission runs a CHEAP pass first: every stroke is reduced to its
 * centroid (2 floats instead of 16), which makes a template ~60× cheaper to
 * score, and the best CANDIDATE_POOL survive to the full scorer. Measured
 * 2026-09-07: 100% of true answers survive the coarse pass, top-1 is unchanged,
 * and the whole thing runs in 41–59 ms — FASTER than the old exhaustive scan of
 * the 895-component set, while searching eight times as much.
 *
 * The prefilter is safe because centroids are invariant to exactly what the full
 * scorer already ignores — translation, scale, stroke order, stroke direction —
 * so it discards on the same axis rather than a different one. It is the same
 * retrieve-then-rerank shape as gloss confusability's bi-encoder → cross-encoder
 * (docs/GLOSS_CONFUSABILITY.md § 5).
 */
import type { Ink } from './types';
import type { GlyphTemplates } from './glyphTemplates';
import { KIND_COMPONENT, KIND_CHARACTER } from './glyphTemplates';
import { POINTS_PER_STROKE, normalizeStrokes, resampleStroke, type Point, type PolyStroke } from './inkGeometry';

/**
 * Cost charged for a template stroke the learner never drew (or vice versa).
 *
 * Tuning note: this is the knob that decides how badly a missing/extra stroke is
 * punished. Too low and a 3-stroke scribble matches every 8-stroke glyph; too
 * high and it becomes the hard stroke-count gate we deliberately rejected. The
 * value is empirical — roughly the mean point distance between two genuinely
 * different strokes in the normalized box.
 */
const UNMATCHED_STROKE_COST = 0.35;

/**
 * How many coarse survivors reach the full scorer.
 *
 * 200 of 7,258 is a ~36× cut and still measured 100% recall of the true answer.
 * It is deliberately generous: the coarse score is a summary, so the cheap way
 * to stay honest is to keep the pool far wider than the ~10 chips the row shows.
 */
const CANDIDATE_POOL = 200;

export interface GlyphCandidate {
  /** The glyph. */
  char: string;
  /** Match cost — LOWER is better. Not a probability; only the ordering is meaningful. */
  cost: number;
  /** KIND_COMPONENT | KIND_CHARACTER — decides whether a tap appends or commits. */
  kind: number;
}

export interface MatchOptions {
  /** Cap the returned list. 0 (default) returns everything scored. */
  limit?: number;
  /** Only return glyphs with at least one of these role bits set. */
  kindMask?: number;
  /** Coarse survivors passed to the full scorer. Exposed for benchmarking. */
  pool?: number;
}

/** Convert captured ink into the same normalized fingerprint the templates use. */
export function fingerprintInk(ink: Ink): PolyStroke[] {
  const polylines = ink
    // A stroke with no points cannot be resampled and carries no shape; dropping
    // it here keeps the scoring loops free of length checks.
    .filter((stroke) => stroke.xs.length > 0)
    .map((stroke) => stroke.xs.map((x, i) => [x, stroke.ys[i]] as Point));
  return normalizeStrokes(polylines.map((points) => resampleStroke(points)));
}

/** Reduce a fingerprint to one centroid per stroke — the coarse descriptor. */
function centroidsOf(drawn: PolyStroke[]): Float32Array {
  const out = new Float32Array(drawn.length * 2);
  for (let i = 0; i < drawn.length; i++) {
    let sumX = 0;
    let sumY = 0;
    for (const [x, y] of drawn[i]) {
      sumX += x;
      sumY += y;
    }
    out[i * 2] = sumX / drawn[i].length;
    out[i * 2 + 1] = sumY / drawn[i].length;
  }
  return out;
}

/**
 * Distance between one drawn stroke and one template stroke, taking the better of
 * the two traversal directions.
 *
 * `coords` is the flat template array; `base` is the float index of the template
 * stroke's first x. Reading straight out of the Float32Array avoids materializing
 * a per-stroke object for all ~77,000 template strokes.
 */
function strokeCost(drawn: PolyStroke, coords: Float32Array, base: number, points: number): number {
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
function assignmentCost(
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
 * Rank glyphs against the ink, best first.
 *
 * ⚠️ NEVER returns an empty list for non-empty ink. With no clear button, an
 * empty candidate row is a dead end — the learner cannot empty the canvas
 * (§ 6r, "Clearing the canvas"). There is deliberately no confidence threshold
 * here: poor guesses are shown, ranked, and the list is cut from the bottom only.
 */
export function matchGlyphs(
  ink: Ink,
  templates: GlyphTemplates,
  options: MatchOptions = {},
): GlyphCandidate[] {
  const { limit = 0, kindMask = KIND_COMPONENT | KIND_CHARACTER, pool = CANDIDATE_POOL } = options;

  const drawn = fingerprintInk(ink);
  if (drawn.length === 0) return [];

  const points = templates.pointsPerStroke;
  const count = templates.chars.length;
  // One scratch buffer reused across every template rather than allocating per
  // template. 255 is the max a u8 stroke count can express.
  const used = new Uint8Array(255);

  // ── Stage 1: coarse. Score every eligible template on stroke centroids only.
  const inkCentroids = centroidsOf(drawn);
  const coarse: { index: number; cost: number }[] = [];
  for (let i = 0; i < count; i++) {
    if ((templates.kinds[i] & kindMask) === 0) continue;
    const strokeCount = templates.strokeCounts[i];
    const base = templates.centroidOffsets[i];
    const cost = assignmentCost(drawn.length, strokeCount, used, (d, j) => {
      const c = base + j * 2;
      return Math.hypot(
        inkCentroids[d * 2] - templates.centroids[c],
        inkCentroids[d * 2 + 1] - templates.centroids[c + 1],
      );
    });
    coarse.push({ index: i, cost });
  }
  if (coarse.length === 0) return [];

  // Partial order would be cheaper, but a full sort of ~7k small objects is
  // already well under a millisecond and keeps the code honest.
  coarse.sort((a, b) => a.cost - b.cost);
  const survivors = coarse.slice(0, Math.max(pool, limit));

  // ── Stage 2: full scorer on the survivors only.
  const strokeStride = points * 2;
  const candidates: GlyphCandidate[] = survivors.map(({ index }) => {
    const strokeCount = templates.strokeCounts[index];
    const base = templates.offsets[index];
    return {
      char: templates.chars[index],
      kind: templates.kinds[index],
      cost: assignmentCost(drawn.length, strokeCount, used, (d, j) =>
        strokeCost(drawn[d], templates.coords, base + j * strokeStride, points),
      ),
    };
  });
  candidates.sort((a, b) => a.cost - b.cost);

  return limit > 0 ? candidates.slice(0, limit) : candidates;
}

/** One drawn-stroke ↔ template-stroke pairing, as the scorer actually chose it. */
export interface StrokePairing {
  /** Index into the drawn strokes, or -1 for a template stroke never drawn. */
  drawn: number;
  /** Index into the template's strokes, or -1 for a drawn stroke with no partner. */
  template: number;
  /** What this pairing contributed before the final division. */
  cost: number;
}

export interface MatchExplanation {
  char: string;
  /** False when the glyph has no template at all — then nothing else is meaningful. */
  found: boolean;
  /** The glyph's own score against this ink. */
  cost: number;
  /** Its position in the full ranking, 0-based. -1 when it has no template. */
  rank: number;
  drawnStrokes: number;
  templateStrokes: number;
  pairings: StrokePairing[];
}

/**
 * Score ONE named glyph against the ink and show the work (§ 6w).
 *
 * ⚠️ THIS IS A DEBUGGING TOOL, NOT PART OF THE KEYBOARD'S PATH. It scores the
 * whole corpus to establish a rank, which is far more work than the two-stage
 * cascade does on a keystroke.
 *
 * It exists because a rank alone does not say WHY. The first real hand-drawn
 * sample scored the intended glyph at rank 1409 with a cost 6% better than the
 * corpus average — a number that says "the matcher saw noise" and nothing about
 * which stroke went wrong. The pairings say that: which of the learner's strokes
 * the scorer matched to which template stroke, and what each pairing cost.
 *
 * ⚠️ Note the greedy assignment can pair strokes a human never would. That is not
 * a bug in the explanation — it is the scorer's real behaviour, and seeing it is
 * often the answer.
 */
export function explainGlyphMatch(
  ink: Ink,
  templates: GlyphTemplates,
  char: string,
): MatchExplanation {
  const index = templates.chars.indexOf(char);
  const drawn = fingerprintInk(ink);
  const empty: MatchExplanation = {
    char,
    found: false,
    cost: Infinity,
    rank: -1,
    drawnStrokes: drawn.length,
    templateStrokes: 0,
    pairings: [],
  };
  if (index < 0 || drawn.length === 0) return empty;

  const points = templates.pointsPerStroke;
  const strokeCount = templates.strokeCounts[index];
  const base = templates.offsets[index];
  const used = new Uint8Array(255);
  const pairings: StrokePairing[] = [];

  const cost = assignmentCost(
    drawn.length,
    strokeCount,
    used,
    (d, j) => strokeCost(drawn[d], templates.coords, base + j * points * 2, points),
    (d, j, pairCost) => pairings.push({ drawn: d, template: j, cost: Number(pairCost.toFixed(6)) }),
  );

  // Rank over the WHOLE corpus, not the cascade's pool — the glyph being absent
  // from the pool is itself a finding, and a pool-relative rank would hide it.
  const all = matchGlyphs(ink, templates, { pool: templates.chars.length });
  return {
    char,
    found: true,
    cost: Number(cost.toFixed(6)),
    rank: all.findIndex((candidate) => candidate.char === char),
    drawnStrokes: drawn.length,
    templateStrokes: strokeCount,
    pairings,
  };
}

export { POINTS_PER_STROKE, KIND_COMPONENT, KIND_CHARACTER, CANDIDATE_POOL };
