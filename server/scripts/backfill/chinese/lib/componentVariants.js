/**
 * In-context component variants for the beginner keyboard's handwriting matcher.
 *
 * LAYER: build/asset generation utility. Pure computation over already-loaded
 * data — no DB, no filesystem, no network. Consumed only by
 * generate-handwriting-templates.js, which owns the I/O.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-5.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM
 *
 * A component's template is its STANDALONE drawing from hanzi-writer-data — ⺈
 * as a tall glyph with a long 丿 and a long descending hook. But a learner draws
 * a component the way it looks inside the character they are writing, and inside
 * 你 / 尔 / 称 the same ⺈ is short and flat. Measured on a real device
 * (2026-09-27): that drawing ranked ⺈ 589th, with 冖 first.
 *
 * THE FIX
 *
 * makemeahanzi's `matches` says which component each stroke of a character
 * belongs to (decompose.js → componentStrokesOf), and hanzi-writer-data holds
 * those strokes in the same order. So every character that contains a component
 * is a free sample of what that component looks like IN CONTEXT: cut its strokes
 * out, normalize them on their own, and it is directly comparable to ink.
 *
 * There are far too many samples to ship (口 alone appears in ~1,300
 * characters), and most are the standalone shape again. So the samples are
 * reduced to at most MAX_VARIANTS_PER_COMPONENT REPRESENTATIVES by greedy set
 * cover: repeatedly take the sample that stands in for the most samples nothing
 * chosen so far already covers, and stop once the next one would cover too few
 * to be a real in-context form rather than a one-off. The standalone drawing
 * seeds the cover, so a component whose context shapes are all close to it gets
 * no variants at all.
 *
 * Distances use `shapeCost` from src/components/handwriting/strokeScoring.ts —
 * the runtime's own scorer — passed in by the caller.
 */

/**
 * A sample stands in for another when the scorer rates the other's strokes this
 * close to it.
 *
 * Measured against the corpus (2026-09-27): a component's in-context samples
 * typically sit 0.03–0.15 from its standalone drawing, and the distinct
 * in-context FORMS that motivated this (⺈ inside 尔, ~0.20) sit well outside
 * that. 0.08 keeps a variant's coverage to "the same form", not "the same
 * component".
 */
export const COVER_RADIUS = 0.08;

/** Cap per component — the asset and the matcher's coarse pass both scale with it. */
export const MAX_VARIANTS_PER_COMPONENT = 3;

/**
 * A form must stand in for at least this many samples (and MIN_SUPPORT_SHARE of
 * them) to ship. Below that it is a one-off calligraphic quirk or a mislabelled
 * stroke in the source, and shipping it would only add a confusable template.
 */
export const MIN_SUPPORT = 4;
export const MIN_SUPPORT_SHARE = 0.03;

/**
 * Samples considered per component. The cover is O(n²) in scorer calls, and the
 * characters are fed in commonest-first, so the cut drops only rare characters.
 */
export const MAX_SAMPLES_PER_COMPONENT = 400;

/**
 * Cut every wanted component out of one character.
 *
 * @param {string[]} parts          componentStrokesOf(...).parts
 * @param {Array<number|null>} labels componentStrokesOf(...).labels — stroke → index into parts
 * @param {Array<Array<[number,number]>>} medians the character's raw medians, stroke order
 * @param {(glyph: string) => boolean} wanted     is this glyph a component we ship?
 * @returns {Array<{ component: string, medians: Array<Array<[number,number]>> }>}
 */
export function cutComponents(parts, labels, medians, wanted) {
  // A null label means the source could not say which part a stroke serves. It
  // might belong to any of them, so no cut from this character can be trusted
  // to be complete.
  if (!labels || labels.length !== medians.length || labels.some((label) => label === null)) return [];

  const cuts = [];
  parts.forEach((component, partIndex) => {
    if (!wanted(component)) return;
    const strokes = [];
    labels.forEach((label, stroke) => {
      if (label === partIndex) strokes.push(medians[stroke]);
    });
    if (strokes.length > 0) cuts.push({ component, medians: strokes });
  });
  return cuts;
}

/**
 * Choose the representative in-context shapes for one component.
 *
 * @param {Array<Array<[number,number]>>|null} standalone the component's own fingerprint, or null if it has none
 * @param {Array<{ source: string, shape: Array<Array<[number,number]>> }>} samples fingerprinted cuts, commonest source first
 * @param {(drawn, template) => number} shapeCost the runtime scorer
 * @returns {Array<{ source: string, shape, support: number }>} chosen variants, best first
 */
export function selectVariants(standalone, samples, shapeCost) {
  // Only samples with the standalone's stroke count are comparable to it — a
  // count mismatch is almost always a labelling fault, not a new form. A glyph
  // with NO standalone drawing (the unrecognizable components) takes the most
  // common count among its samples instead, so a variant can give it a template
  // at all.
  const expected = standalone ? standalone.length : modalStrokeCount(samples);
  const pool = samples.filter((sample) => sample.shape.length === expected).slice(0, MAX_SAMPLES_PER_COMPONENT);
  if (pool.length === 0) return [];

  const minSupport = Math.max(MIN_SUPPORT, Math.ceil(pool.length * MIN_SUPPORT_SHARE));
  if (pool.length < minSupport) return [];

  // covers[v] = the samples v stands in for. Computed once; the greedy loop
  // then only does set arithmetic.
  const covers = pool.map((candidate) => {
    const set = [];
    pool.forEach((other, i) => {
      if (shapeCost(other.shape, candidate.shape) <= COVER_RADIUS) set.push(i);
    });
    return set;
  });

  // Seed with what the standalone template already explains.
  const covered = new Uint8Array(pool.length);
  if (standalone) {
    pool.forEach((sample, i) => {
      if (shapeCost(sample.shape, standalone) <= COVER_RADIUS) covered[i] = 1;
    });
  }

  const chosen = [];
  while (chosen.length < MAX_VARIANTS_PER_COMPONENT) {
    let best = -1;
    let bestGain = 0;
    covers.forEach((set, v) => {
      let gain = 0;
      for (const i of set) if (!covered[i]) gain++;
      // Ties go to the earlier (commoner) source — pool order is commonest-first.
      if (gain > bestGain) {
        best = v;
        bestGain = gain;
      }
    });
    if (best < 0 || bestGain < minSupport) break;
    for (const i of covers[best]) covered[i] = 1;
    chosen.push({ source: pool[best].source, shape: pool[best].shape, support: bestGain });
  }
  return chosen;
}

function modalStrokeCount(samples) {
  const counts = new Map();
  for (const sample of samples) counts.set(sample.shape.length, (counts.get(sample.shape.length) || 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [strokes, count] of counts) {
    if (count > bestCount || (count === bestCount && strokes < best)) {
      best = strokes;
      bestCount = count;
    }
  }
  return best;
}
