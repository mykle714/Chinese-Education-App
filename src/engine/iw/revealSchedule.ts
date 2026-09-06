/**
 * iw reveal schedule — when each glyph of an NPC's line appears (§ 5.3a, § 6.4 rule 3).
 *
 * LAYER: engine (pure). No clock, no DOM, no audio. It answers one question — *given a line
 * and how long it takes to say, at what offset does each glyph appear?* — and the two callers
 * differ only in where the duration comes from:
 *
 * | Path | Duration |
 * |---|---|
 * | **audio-paced** (primary) | the decoded MP3's own `duration` |
 * | **timer-paced** (fallback) | {@link estimateSpeechMs}, at {@link IW_TIMER_GLYPHS_PER_SEC} |
 *
 * § 5.3a requires the two to be indistinguishable — "the learner should never be able to tell
 * which one ran" — which is exactly what sharing this module buys. A separate fallback pacer
 * would drift from the real one the first time either was tuned.
 *
 * ⚠️ **WHY GLYPHS ARE NOT EVENLY SPACED.** § 6.4 rule 3 settles on `duration / glyphCount`
 * because Mandarin syllables are near-isochronous — and then names the one thing that breaks
 * it: *"a comma is silence with no glyph under it"*. 好的，请坐 spoken over 1.6 s does not
 * spend 320 ms on each of its five glyphs; the pause after 的 eats a fifth of the line while
 * nothing paints. Even spacing therefore runs AHEAD of the voice for the whole tail of any
 * punctuated sentence, which is the desync the audio-as-clock decision exists to prevent.
 *
 * So each glyph gets a WEIGHT instead of a slot, and time is divided in proportion. A
 * punctuation mark's weight is the mark plus the silence that follows it (see
 * {@link GLYPH_WEIGHTS}) — hence the reveal offset of glyph *i* is the weight of everything
 * BEFORE it, not including it: the comma appears when it is reached, and the pause it carries
 * delays the glyph after it rather than itself.
 *
 * ⚠️ THESE WEIGHTS ARE NOT MEASURED. They are a shape that is obviously better than uniform,
 * not a fit to a waveform — the shipped REST voice returns no timing marks (§ 6.4 rule 3), so
 * there is nothing to fit against short of decoding and hunting for silence. If the reveal
 * ever reads as out of step, the honest fix is timing marks (a `v1beta1` SSML feature the app
 * does not use), not further hand-tuning of this table.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.3a, § 6.4.
 */

/**
 * The fallback cadence, in glyphs per second — the middle of § 5.3a's 8–14 for CJK.
 *
 * Deliberately far slower than the ~40 glyph/s a stream can deliver: the fallback is
 * pretending to be speech, and speech is slow.
 */
export const IW_TIMER_GLYPHS_PER_SEC = 11;

/**
 * Relative time each kind of glyph occupies.
 *
 * `1` is one CJK syllable. Latin letters are a fraction of one because a romanized word inside
 * a Chinese line ("OK") is said in about the time of a single syllable, not one per letter.
 */
const GLYPH_WEIGHTS = {
  /** A syllable — the unit everything else is expressed in. */
  syllable: 1,
  /** A latin letter or digit: several of them make up one spoken unit. */
  latin: 0.4,
  /** Whitespace is not spoken, but it is not free either — it separates. */
  space: 0.2,
  /** A phrase break: the mark, plus the breath after it. */
  minorPause: 2.4,
  /** A sentence end: the longest silence a line contains. */
  majorPause: 3.4,
} as const;

/** `，、,` and friends — a phrase break. */
const MINOR_PAUSE = /[，、,；;：:]/;
/** `。！？` and friends — a sentence end. */
const MAJOR_PAUSE = /[。！？!?…]/;
/** Latin letters and digits, which are sub-syllabic (see {@link GLYPH_WEIGHTS}). */
const LATIN = /[A-Za-z0-9]/;

/** How long one glyph occupies, relative to a syllable. */
function weightOf(glyph: string): number {
  if (MAJOR_PAUSE.test(glyph)) return GLYPH_WEIGHTS.majorPause;
  if (MINOR_PAUSE.test(glyph)) return GLYPH_WEIGHTS.minorPause;
  if (/\s/.test(glyph)) return GLYPH_WEIGHTS.space;
  if (LATIN.test(glyph)) return GLYPH_WEIGHTS.latin;
  return GLYPH_WEIGHTS.syllable;
}

/**
 * Split a line into GLYPHS — code points, not UTF-16 units.
 *
 * The same rule as `checkUtterance`'s cap on the server: an emoji or any astral character is
 * one thing a reader sees, and `.length` would reveal it as two halves, the first of which is
 * an unpaired surrogate that renders as a replacement character.
 */
export const toGlyphs = (text: string): string[] => [...text];

/**
 * How long this line would take to say, in ms, at the fallback cadence.
 *
 * Weighted like the reveal itself, so a heavily punctuated line is given the extra time its
 * pauses need rather than being rushed — which is what keeps the timer-paced path from
 * reading faster than the audio-paced one on exactly the lines where they differ most.
 */
export function estimateSpeechMs(text: string): number {
  const total = toGlyphs(text).reduce((sum, g) => sum + weightOf(g), 0);
  return Math.round((total / IW_TIMER_GLYPHS_PER_SEC) * 1000);
}

/**
 * The offset, in ms from the start of playback, at which each glyph appears.
 *
 * `schedule[i]` is when glyph `i` becomes visible, so `schedule[0]` is always 0 — the first
 * glyph is on screen the instant the voice starts, which is what makes the two look
 * simultaneous. The returned array has one entry per glyph and is non-decreasing.
 *
 * A non-finite or non-positive `totalMs` falls back to {@link estimateSpeechMs}, so a caller
 * that got a broken duration out of a decoder still paints a sensible line instead of dumping
 * the whole sentence at once.
 */
export function planGlyphReveal(text: string, totalMs?: number): number[] {
  const glyphs = toGlyphs(text);
  if (glyphs.length === 0) return [];

  const duration = Number.isFinite(totalMs) && (totalMs as number) > 0
    ? (totalMs as number)
    : estimateSpeechMs(text);

  const weights = glyphs.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return glyphs.map(() => 0);

  const schedule: number[] = [];
  let before = 0;
  for (const w of weights) {
    // Weight BEFORE this glyph, not including it: a comma appears when it is reached and the
    // silence it carries delays what comes next.
    schedule.push(Math.round((before / total) * duration));
    before += w;
  }
  return schedule;
}

/**
 * How many glyphs are visible `elapsedMs` into the reveal.
 *
 * A linear scan rather than a binary search on purpose: a bubble is capped at a handful of
 * glyphs (§ 5.6's 16-glyph ceiling) and this runs once per animation frame, where the cost of
 * being clever is a bug and the cost of being simple is nothing.
 */
export function glyphsVisibleAt(schedule: readonly number[], elapsedMs: number): number {
  let visible = 0;
  while (visible < schedule.length && schedule[visible] <= elapsedMs) visible++;
  return visible;
}

/**
 * The prefix of `text` visible `elapsedMs` in — what the bubble actually renders.
 *
 * Rebuilt from the glyph array rather than `text.slice`, because a slice by UTF-16 index can
 * cut an astral character in half.
 */
export function revealedText(text: string, schedule: readonly number[], elapsedMs: number): string {
  return toGlyphs(text).slice(0, glyphsVisibleAt(schedule, elapsedMs)).join('');
}
