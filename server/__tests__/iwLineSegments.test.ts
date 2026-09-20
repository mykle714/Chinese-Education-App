import { describe, expect, it } from 'vitest';
import { partsToLineSegments } from '../services/iw/lineSegments.js';
import type { LongDefinitionPart } from '../contracts/wire.js';

/**
 * lineSegments — the reshaping between the est's segmentation output and an iw bubble.
 *
 * The invariant under test is the one `SegmentedSentenceDisplay` depends on: `segments` must
 * be an in-order partition of `foreignText`. The DAL returns ordered PARTS with English prose
 * between the Chinese runs, and it is the interleaving that is easy to get wrong — dropping
 * the prose leaves every later popup pointing at the wrong characters.
 */
describe('partsToLineSegments', () => {
  const foreign = (text: string, segments: string[], meta: Record<string, any> = {}): LongDefinitionPart =>
    ({ type: 'foreign', foreignText: text, _segments: segments, segmentMetadata: meta }) as LongDefinitionPart;
  const prose = (value: string): LongDefinitionPart => ({ type: 'text', value }) as LongDefinitionPart;

  it('partitions a pure target-language line exactly', () => {
    const line = partsToLineSegments('我要一碗面', [
      foreign('我要一碗面', ['我', '要', '一碗', '面'], { 一碗: { definition: 'a bowl of' } }),
    ]);
    expect(line).not.toBeNull();
    expect(line!.segments.join('')).toBe('我要一碗面');
    expect(line!.segmentMetadata['一碗'].definition).toBe('a bowl of');
  });

  it('keeps the partition exact across an embedded non-Chinese stretch', () => {
    // The case a naive concat of only the foreign runs gets wrong: without the prose
    // characters the cursor reaches 好 four positions early.
    const text = '我要 OK 吗';
    const line = partsToLineSegments(text, [
      foreign('我要', ['我', '要']),
      prose(' OK '),
      foreign('吗', ['吗']),
    ]);
    expect(line!.segments.join('')).toBe(text);
  });

  it('emits prose one character at a time, so none of it is tappable', () => {
    const line = partsToLineSegments('我 OK', [foreign('我', ['我']), prose(' OK')]);
    // Three single-character segments for " OK", none of which has a metadata entry.
    expect(line!.segments).toEqual(['我', ' ', 'O', 'K']);
    expect(Object.keys(line!.segmentMetadata)).toEqual([]);
  });

  it('merges metadata across runs', () => {
    const line = partsToLineSegments('好 and 好', [
      foreign('好', ['好'], { 好: { definition: 'good' } }),
      prose(' and '),
      foreign('好', ['好'], { 好: { definition: 'good' } }),
    ]);
    expect(line!.segmentMetadata['好'].definition).toBe('good');
  });

  it('falls back to per-character segments when a run has none', () => {
    const line = partsToLineSegments('你好', [
      { type: 'foreign', foreignText: '你好', segmentMetadata: {} } as LongDefinitionPart,
    ]);
    expect(line!.segments).toEqual(['你', '好']);
  });

  it('returns null when there is nothing to look up', () => {
    // A line with no target-language run at all: a segmented display would only add tap
    // targets that answer nothing, so the bubble stays plain text.
    expect(partsToLineSegments('hello', [prose('hello')])).toBeNull();
    expect(partsToLineSegments('hello', null)).toBeNull();
    expect(partsToLineSegments('hello', [])).toBeNull();
  });
});
