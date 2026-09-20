import { describe, expect, it } from 'vitest';
import { clipSegmentsToLength } from '../lineReveal';

/**
 * clipSegmentsToLength — the reveal/segmentation reconciliation behind § 5.3b.
 *
 * The invariant every case here asserts is the one `SegmentedSentenceDisplay` depends on:
 * the returned segments must join back to EXACTLY the first `length` characters of the line.
 * The display walks a cursor across `[...foreignText]` consuming each segment's length, so a
 * clipped list that is one character long or short silently shifts every popup after it.
 */
describe('clipSegmentsToLength', () => {
  const line = ['不好意思', '，', '我', '要', '一碗', '面'];
  const full = line.join(''); // 不好意思，我要一碗面

  /** The property the display relies on, checked at every reveal position. */
  it('always joins back to the revealed prefix, at every length', () => {
    const chars = [...full];
    for (let n = 0; n <= chars.length; n++) {
      expect(clipSegmentsToLength(line, n).join('')).toBe(chars.slice(0, n).join(''));
    }
  });

  it('returns nothing before the first glyph is due', () => {
    expect(clipSegmentsToLength(line, 0)).toEqual([]);
    expect(clipSegmentsToLength(line, -1)).toEqual([]);
  });

  it('keeps a whole segment whole once its last character lands', () => {
    expect(clipSegmentsToLength(line, 4)).toEqual(['不好意思']);
  });

  it('cuts a straddling segment rather than dropping it', () => {
    // Two characters into a four-character word: the visible half stays, so the bubble does
    // not reflow when the rest of the word arrives.
    expect(clipSegmentsToLength(line, 2)).toEqual(['不好']);
  });

  it('a cut segment no longer matches its metadata key', () => {
    // Deliberate: `segmentMetadata` is keyed by segment text, so the half-word is inert until
    // completed. Asserted because it is a behaviour, not an accident.
    const clipped = clipSegmentsToLength(line, 2);
    expect(clipped[0]).not.toBe('不好意思');
  });

  it('does not run past the end of the line', () => {
    expect(clipSegmentsToLength(line, 999).join('')).toBe(full);
  });

  it('counts by code point, matching the display\'s [...text] spread', () => {
    // A surrogate pair is ONE cell in the display; `.length` would call it two and clip early.
    const emoji = ['a', '😀', 'b'];
    expect(clipSegmentsToLength(emoji, 2)).toEqual(['a', '😀']);
    expect(clipSegmentsToLength(emoji, 3)).toEqual(['a', '😀', 'b']);
  });

  it('handles an empty segment list', () => {
    expect(clipSegmentsToLength([], 5)).toEqual([]);
  });
});
