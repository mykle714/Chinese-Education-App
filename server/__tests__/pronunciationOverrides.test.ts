import { describe, expect, it } from 'vitest';
import { normalizePronunciationOverrides } from '../utils/pronunciationOverrides.js';

// READING CHOICES validation (server/utils/pronunciationOverrides.ts).

const content = '我觉得他得去';

describe('normalizePronunciationOverrides', () => {
  it('keeps valid entries, sorted, with the reading lower-cased', () => {
    const result = normalizePronunciationOverrides([
      { start: 4, end: 5, text: '得', reading: 'DEI3' },
      { start: 2, end: 3, text: '得', reading: 'de2' },
    ], content);
    expect(result.shapeError).toBeUndefined();
    expect(result.overrides.map((o) => [o.start, o.reading])).toEqual([[2, 'de2'], [4, 'dei3']]);
  });
  it('drops a stale entry whose word is no longer at its offsets', () => {
    const result = normalizePronunciationOverrides([{ start: 1, end: 2, text: '得', reading: 'de2' }], content);
    expect(result).toEqual({ overrides: [], dropped: 1 });
  });
  it('rejects a malformed reading', () => {
    expect(normalizePronunciationOverrides([{ start: 2, end: 3, text: '得', reading: '<b>' }], content).shapeError).toBeTruthy();
  });
  it('rejects a non-array', () => {
    expect(normalizePronunciationOverrides({}, content).shapeError).toBeTruthy();
  });
  it('keeps the later of two overlapping entries', () => {
    const result = normalizePronunciationOverrides([
      { start: 2, end: 3, text: '得', reading: 'de2' },
      { start: 2, end: 3, text: '得', reading: 'dei3' },
    ], content);
    expect(result.overrides).toEqual([{ start: 2, end: 3, text: '得', reading: 'dei3' }]);
  });
});
