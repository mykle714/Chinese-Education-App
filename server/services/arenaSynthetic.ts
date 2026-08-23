import { ARENA_DIVISION_COUNT } from '../contracts/wire.js';

/**
 * Synthetic member scoring — pure functions, no I/O
 * (docs/ARENA_FEATURE.md § 6).
 *
 * An arena below 25 humans is padded, because without padding a 3-person arena
 * makes "top 5" and "bottom 5" overlap and the ladder collapses.
 *
 * ── Scores are COMPUTED ON READ, never stored ────────────────────────────────
 * Each bot carries a seed and an end-of-week target; its displayed score is a
 * pure function of (seed, target, fraction of the week elapsed). No cron, no
 * writes, no drift, and every viewer sees the same number at the same instant.
 * A wall of zeros would be worse than no padding at all, so the curve matters.
 */

/**
 * Per-division fallback target bands, used until there is real history to draw
 * from (§ 6.2).
 *
 * A division-11 bot must not be lazier than a division-2 human, or the top of
 * the ladder becomes the easiest place to stay. These are minutes-per-week.
 */
const FALLBACK_TARGET_BANDS: [number, number][] = [
  [60, 160],   // div 1
  [90, 200],
  [120, 240],
  [150, 280],
  [180, 320],
  [220, 380],
  [260, 440],
  [300, 500],
  [350, 570],
  [400, 640],
  [460, 720],
  [520, 820],  // div 12
];

/**
 * Deterministic hash -> [0, 1). A small xorshift on the seed.
 *
 * Not cryptographic and not trying to be. It only needs to be stable across
 * processes and evenly spread, so that a bot's curve is identical on every
 * server that renders it.
 */
function unitNoise(seed: number, step: number): number {
  let x = (seed * 2654435761 + step * 40503) | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}

/**
 * Draw an end-of-week target for a bot in `division`.
 *
 * `observed` is the distribution of real end-of-week scores for that division
 * from recent closed arenas; when it is empty (early life, or a division nobody
 * has finished yet) the fallback band is used.
 */
export function pickSyntheticTarget(
  division: number,
  seed: number,
  observed: number[] = [],
): number {
  const d = Math.min(Math.max(Math.round(division), 1), ARENA_DIVISION_COUNT);

  if (observed.length >= 5) {
    // Sample the real distribution rather than fitting it: pick an observed
    // score and jitter it +/-15%. Keeps bots inside the shape of real play,
    // including its skew, without modelling that shape explicitly.
    const sorted = [...observed].sort((a, b) => a - b);
    const pick = sorted[Math.floor(unitNoise(seed, 1) * sorted.length)];
    const jitter = 0.85 + unitNoise(seed, 2) * 0.3;
    return Math.max(1, Math.round(pick * jitter));
  }

  const [lo, hi] = FALLBACK_TARGET_BANDS[d - 1];
  return Math.round(lo + unitNoise(seed, 3) * (hi - lo));
}

/**
 * A bot's displayed score at `elapsedFraction` of the way through the week.
 *
 * Three properties the design requires (§ 6.2), all asserted in the tests:
 *  1. MONOTONIC — a score that ticks downward is instantly recognisable as fake.
 *  2. IRREGULAR — a perfectly linear climb is just as recognisable once watched
 *     for a day, so the curve is stepped: the bot "studies" in bursts.
 *  3. CONVERGENT — it arrives at exactly `target` at the end of the week, so the
 *     end-of-week ranking is the one the target implied.
 *
 * The burst pattern is a smooth ease combined with per-day noise, where the
 * noise is scaled down as the week ends so convergence is exact rather than
 * approximate.
 */
export function syntheticScoreAt(
  seed: number,
  target: number,
  elapsedFraction: number,
): number {
  const t = Math.min(Math.max(elapsedFraction, 0), 1);
  if (t <= 0) return 0;
  if (t >= 1) return target;

  // MONOTONIC BY CONSTRUCTION. The curve is built from per-segment EFFORT
  // WEIGHTS that are strictly positive, accumulated and then normalised, rather
  // than from a smooth base with a signed wobble added on top.
  //
  // The earlier version did the latter and was wrong: the wobble was redrawn at
  // each segment boundary, so a segment whose noise happened to be lower than
  // its predecessor's stepped the displayed score DOWN — a visible tick
  // backwards, which is the single most obvious tell that a member is fake.
  // Clamping against the previous value only hid it between boundaries. Here a
  // dip is not possible: the cumulative sum of positive weights only rises.
  const weights = segmentWeights(seed);
  const total = weights.reduce((a, b) => a + b, 0);

  const scaled = t * SCORE_SEGMENTS;
  const index = Math.min(Math.floor(scaled), SCORE_SEGMENTS - 1);
  const within = scaled - index;

  let before = 0;
  for (let i = 0; i < index; i++) before += weights[i];

  // Linear inside the segment; the SLOPE differs per segment, which is what
  // makes the climb look like bursts of study rather than a machine.
  const fraction = (before + weights[index] * within) / total;
  return Math.round(target * Math.min(Math.max(fraction, 0), 1));
}

/** Segments the active period is divided into — roughly one per day. */
const SCORE_SEGMENTS = 6;

/**
 * Strictly positive per-segment effort weights for one bot.
 *
 * The base term rises with the segment index because real players finish a week
 * harder than they start it; the noise term is what makes two bots with the same
 * target climb differently. Both are bounded well above zero, which is the
 * property monotonicity rests on.
 */
function segmentWeights(seed: number): number[] {
  const weights: number[] = [];
  for (let i = 0; i < SCORE_SEGMENTS; i++) {
    weights.push(0.6 + 0.12 * i + unitNoise(seed, i + 10) * 0.9);
  }
  return weights;
}

/**
 * Fraction of the arena's active period that has elapsed at `now`.
 * Clamped to [0, 1] so a late read of a closed arena returns the final score.
 */
export function elapsedFraction(weekStartsAt: Date, closesAt: Date, now: Date): number {
  const span = closesAt.getTime() - weekStartsAt.getTime();
  if (span <= 0) return 1;
  return Math.min(Math.max((now.getTime() - weekStartsAt.getTime()) / span, 0), 1);
}

/**
 * Names for synthetic members.
 *
 * Deliberately ordinary given-names with no surname — a bot must read as an
 * unremarkable stranger, which is exactly what a real arena is full of. Names
 * that are jokes, brands, or obviously generated ("Player_4471") are the one
 * part of this feature a user can spot as fake at a glance.
 */
const SYNTHETIC_NAMES = [
  'Mira', 'Tobias', 'Yara', 'Nils', 'Priya', 'Ezra', 'Lina', 'Cato',
  'Suri', 'Bram', 'Noor', 'Ivo', 'Tessa', 'Hugo', 'Anouk', 'Milo',
  'Zofia', 'Rune', 'Cleo', 'Otto', 'Sena', 'Kai', 'Iris', 'Emre',
  'Vera', 'Joss', 'Nadia', 'Pax', 'Rhea', 'Silas', 'Wren', 'Ada',
];

/** Pick a name deterministically, avoiding collisions within one arena. */
export function pickSyntheticName(seed: number, taken: Set<string>): string {
  const start = Math.floor(unitNoise(seed, 4) * SYNTHETIC_NAMES.length);
  for (let i = 0; i < SYNTHETIC_NAMES.length; i++) {
    const name = SYNTHETIC_NAMES[(start + i) % SYNTHETIC_NAMES.length];
    if (!taken.has(name)) return name;
  }
  // More bots than names in one arena: fall back to a suffixed variant rather
  // than repeating a name, since two identical names on one board is the kind of
  // detail that gives the whole thing away.
  return `${SYNTHETIC_NAMES[start]} ${taken.size}`;
}

/**
 * Messages for synthetic members (docs/ARENA_FEATURE.md § 2.1a).
 *
 * The same rule the names follow: unremarkable, first-person, and about STUDYING —
 * a bot must read as one of the 24 strangers a real arena is full of. Nothing here
 * may be a joke, a brand, or something a reader could see twice on one board and
 * recognise as canned.
 *
 * These are drawn by a pure function of the bot's existing `syntheticSeed`, exactly
 * as its score is (§ 6.2): computed on read, never stored, so there is no column and
 * no drift.
 */
const SYNTHETIC_MESSAGES = [
  'Trying to keep the streak alive.',
  'Ten minutes before work, every day.',
  'Back after a long break.',
  'Reading practice this week.',
  'Just here for the flashcards.',
  'Going for the promotion spot.',
  'Slow week, but still showing up.',
  'Studying on the train.',
  'Third division in a row — one more.',
  'Mostly evenings.',
  'Trying to finish my deck this month.',
  'Good luck everyone.',
];

/**
 * A bot's message, or null.
 *
 * Roughly six in ten bots get one, which is the whole reason this is not "every
 * bot gets a message". If padding always carried a line while most humans left
 * theirs empty, HAVING a message would identify the fakes just as reliably as a
 * "bot" tag would — the exact failure the padding design exists to avoid.
 */
export function pickSyntheticMessage(seed: number): string | null {
  if (unitNoise(seed, 9) > 0.6) return null;
  return SYNTHETIC_MESSAGES[Math.floor(unitNoise(seed, 11) * SYNTHETIC_MESSAGES.length)];
}
