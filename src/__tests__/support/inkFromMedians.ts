/**
 * Build synthetic ink from hanzi-writer medians, in the coordinate system a real
 * canvas actually produces.
 *
 * LAYER: test support. Shared by every suite that simulates a drawing, so the
 * convention below is stated once.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6y (the y-axis convention).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE FLIP IS THE WHOLE POINT OF THIS FILE
 *
 * hanzi-writer stores strokes in a 1024×1024 box with its origin at the BOTTOM
 * left (hence its renderer's `scale(1, -1)`). A `<canvas>` — and therefore every
 * stroke a learner draws — has its origin at the TOP left.
 *
 * Test ink that skips this conversion is mirrored relative to real ink. That is
 * not a harmless test-only detail: until 2026-09-07 the TEMPLATES were mirrored
 * too, so both sides cancelled and the whole synthetic benchmark reported 85–100%
 * top-1 for a matcher that could not read a single real drawing (two hand-drawn
 * 尔 ranked 1409 and 1670 of 7,258).
 *
 * So this helper exists to make the suite live in the same coordinate system as
 * the learner. Do not "simplify" the negation away.
 */
import fs from 'fs';
import path from 'path';
import type { Ink } from '../../components/handwriting/types';

const HANZI_DATA = path.resolve(__dirname, '../../../node_modules/hanzi-writer-data');

/** Median strokes for one glyph, converted to canvas (y-down) coordinates. */
export function inkFromMedians(char: string): Ink {
  const { medians } = JSON.parse(fs.readFileSync(path.join(HANZI_DATA, `${char}.json`), 'utf8'));
  return (medians as number[][][]).map((stroke) => ({
    xs: stroke.map((point) => point[0]),
    // ⚠️ Negated: y-up source, y-down capture. See the note above.
    ys: stroke.map((point) => -point[1]),
    ts: stroke.map((_, i) => i * 16),
  }));
}

/** True when hanzi-writer-data ships this glyph (it is simplified-only). */
export function hasMedians(char: string): boolean {
  return fs.existsSync(path.join(HANZI_DATA, `${char}.json`));
}
