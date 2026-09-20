/**
 * The author-only debug dump (§ 6w).
 *
 * The property that matters is REPLAYABILITY: a dump pasted back into a terminal
 * must reproduce the ranking the learner saw. So the central test does the whole
 * round trip — real ink → snapshot → formatted text → JSON.parse → ink again →
 * matcher — and asserts the candidate list is unchanged. If the compaction ever
 * loses too much (coordinate rounding, a dropped field), this fails rather than
 * quietly producing dumps that debug the wrong thing.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6w.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseGlyphTemplates } from '../components/handwriting/glyphTemplates';
import { matchGlyphs } from '../components/handwriting/glyphMatcher';
import { expandGlyph, parseGlyphLookup, parseGlyphWords } from '../components/handwriting/glyphLookup';
import {
  buildDebugSnapshot,
  formatDebugSnapshot,
  DEBUG_CANDIDATE_LIMIT,
  type DebugSnapshot,
} from '../features/beginnerKeyboard/debugSnapshot';
import type { Ink } from '../components/handwriting/types';
import { inkFromMedians } from './support/inkFromMedians';

const ASSETS = path.resolve(__dirname, '../assets/handwriting');

function read(name: string): ArrayBuffer {
  const buffer = fs.readFileSync(path.join(ASSETS, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/** Median ink, offset in time so the rebasing is actually exercised. */
/** Rebuild capture ink from a dump, the way an offline replay would. */
function inkFromSnapshot(snapshot: DebugSnapshot): Ink {
  return snapshot.ink.map((stroke) => ({ xs: stroke.x, ys: stroke.y, ts: stroke.t }));
}

const templates = parseGlyphTemplates(read('glyph-templates.bin'));
const index = parseGlyphLookup(read('glyph-lookup.bin'));
const words = parseGlyphWords(read('glyph-words.bin'), index);

const base = { canvasSize: 240, templates, index, words };

/** The buffer entries one submission of `glyph` contributes (§ 6x expansion). */
function submit(glyph: string) {
  return expandGlyph(glyph, index);
}

describe('buildDebugSnapshot', () => {
  it('captures the ink, the buffer and both candidate lists', () => {
    const ink = inkFromMedians('木');
    const snapshot = buildDebugSnapshot({ ...base, ink, buffer: submit('日'), mode: 'glyph' });

    expect(snapshot.v).toBe(2);
    expect(snapshot.strokeCount).toBe(ink.length);
    expect(snapshot.ink).toHaveLength(ink.length);
    expect(snapshot.buffer).toEqual(['日']);
    // ⚠️ BOTH lists, regardless of mode — the row shows one, and the failures
    // worth debugging are the ones where the other is the wrong one.
    expect(snapshot.suggested.length).toBeGreaterThan(0);
    expect(snapshot.results.length).toBeGreaterThan(0);
  });

  it('rebases timestamps onto the first sampled point', () => {
    const snapshot = buildDebugSnapshot({ ...base, ink: inkFromMedians('木'), buffer: [], mode: 'glyph' });
    expect(snapshot.ink[0].t[0]).toBe(0);
    // Later strokes stay ordered — a dump that flattened time would hide any
    // future stroke-order work.
    const last = snapshot.ink[snapshot.ink.length - 1];
    expect(last.t[last.t.length - 1]).toBeGreaterThan(0);
  });

  it('goes deeper than the row does, so a near-miss rank is visible', () => {
    const snapshot = buildDebugSnapshot({ ...base, ink: inkFromMedians('想'), buffer: [], mode: 'glyph' });
    expect(snapshot.suggested.length).toBeGreaterThan(12);
    expect(snapshot.suggested.length).toBeLessThanOrEqual(DEBUG_CANDIDATE_LIMIT);
  });

  it('reports which assets were loaded, so a thin dump is not read as a bad match', () => {
    const empty = buildDebugSnapshot({
      ink: inkFromMedians('木'),
      buffer: submit('木'),
      mode: 'glyph',
      canvasSize: 240,
      templates: null,
      index: null,
      words: null,
    });
    expect(empty.suggested).toEqual([]);
    expect(empty.results).toEqual([]);
    expect(empty.assets).toEqual({ templates: null, index: null, words: null });
  });

  it('scores and explains the target when one is set', () => {
    // The motivating dump: real ink for 尔 while trying to write 你.
    const snapshot = buildDebugSnapshot({
      ...base,
      ink: inkFromMedians('尔'),
      buffer: submit('亻'),
      mode: 'glyph',
      target: '你',
    });
    expect(snapshot.target?.char).toBe('你');
    // § 6x — the expansion is the thing that made the old buffer unmatchable.
    expect(snapshot.target?.expansion).toEqual(['亻', '⺈', '小']);
    expect(snapshot.target?.match.found).toBe(true);
    // One pairing per drawn stroke, plus any template stroke left unmatched.
    expect(snapshot.target?.match.pairings.length).toBeGreaterThanOrEqual(
      snapshot.target!.match.drawnStrokes,
    );
  });

  it('ranks the target over the FULL result list, not the displayed cut', () => {
    // The bug being chased is precisely a target ranked past the row's 12, so a
    // display-relative rank would report -1 for the interesting case.
    const snapshot = buildDebugSnapshot({
      ...base,
      ink: [],
      buffer: submit('亻'),
      mode: 'result',
      target: '你',
    });
    expect(snapshot.target?.resultRank).toBeGreaterThan(DEBUG_CANDIDATE_LIMIT);
  });

  it('omits the target block entirely when none is set', () => {
    const snapshot = buildDebugSnapshot({ ...base, ink: inkFromMedians('木'), buffer: [], mode: 'glyph' });
    expect(snapshot.target).toBeUndefined();
  });

  it('is safe on an empty canvas and an empty buffer', () => {
    const snapshot = buildDebugSnapshot({ ...base, ink: [], buffer: [], mode: 'result' });
    expect(snapshot.strokeCount).toBe(0);
    expect(snapshot.suggested).toEqual([]);
    expect(snapshot.results).toEqual([]);
  });
});

describe('formatDebugSnapshot', () => {
  it('keeps coordinate arrays on one line so the dump stays pasteable', () => {
    const text = formatDebugSnapshot(
      buildDebugSnapshot({ ...base, ink: inkFromMedians('木'), buffer: [], mode: 'glyph' }),
    );
    // A fully-indented dump of a 4-stroke character runs to hundreds of lines.
    expect(text.split('\n').length).toBeLessThan(200);
    expect(text).toMatch(/"x": \[[-\d., ]+\]/);
  });

  it('round-trips through JSON and reproduces the same ranking', () => {
    const ink = inkFromMedians('想');
    const snapshot = buildDebugSnapshot({ ...base, ink, buffer: [], mode: 'glyph' });
    const replayed: DebugSnapshot = JSON.parse(formatDebugSnapshot(snapshot));

    const again = matchGlyphs(inkFromSnapshot(replayed), templates, { limit: DEBUG_CANDIDATE_LIMIT });
    // Coordinate rounding is the only loss, and it must not move the ranking.
    expect(again.map((c) => c.char)).toEqual(snapshot.suggested.map((c) => c.char));
  });
});
