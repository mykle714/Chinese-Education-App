import { describe, it, expect } from 'vitest';
import { parsePinyinQuery, resolveMatchedSense } from '../utils/searchSenseMatch.js';
import type { DefinitionCluster } from '../types/index.js';

const cluster = (sense: string, reading: string | null, frequencyScore: number | null, glosses: string[]): DefinitionCluster =>
  ({ sense, reading, pos: null, frequencyScore, glosses });

// 行: default xíng (score 5), a háng "row" sense (score 3).
const xing = {
  pronunciation: 'xíng',
  numberedPinyin: 'xing2',
  definitionClusters: [
    cluster('to walk / go', 'xing2', 5, ['to walk', 'to go']),
    cluster('row / line', 'hang2', 3, ['row', 'line']),
    cluster('profession', 'hang2', 2, ['profession']),
  ],
};

// 么: column still says the rare má, every sense reads me5.
const me = {
  pronunciation: 'má',
  numberedPinyin: 'ma2',
  definitionClusters: [
    cluster('question particle', 'me5', 5, ['question particle']),
    cluster('suffix', 'me5', 5, ['suffix']),
  ],
};

describe('parsePinyinQuery', () => {
  it('parses numbered, tone-marked, neutral and toneless syllables', () => {
    expect(parsePinyinQuery('ma2')).toEqual([{ base: 'ma', tone: 2 }]);
    expect(parsePinyinQuery('má')).toEqual([{ base: 'ma', tone: 2 }]);
    expect(parsePinyinQuery('ma0')).toEqual([{ base: 'ma', tone: 5 }]);
    expect(parsePinyinQuery('Ni3 hao')).toEqual([{ base: 'ni', tone: 3 }, { base: 'hao', tone: null }]);
    expect(parsePinyinQuery('lǜ')).toEqual([{ base: 'lv', tone: 4 }]);
  });
  it('rejects tokens that are not syllable-shaped', () => {
    expect(parsePinyinQuery('má2')).toBeNull();
    expect(parsePinyinQuery("ma'an")).toBeNull();
    expect(parsePinyinQuery('')).toBeNull();
  });
});

describe('resolveMatchedSense', () => {
  it('is null when the default sense already matches the pinyin', () => {
    expect(resolveMatchedSense(xing, 'xing2')).toBeNull();
    expect(resolveMatchedSense(xing, 'xing')).toBeNull();
  });
  it('names the highest-frequency non-default sense the pinyin hits', () => {
    expect(resolveMatchedSense(xing, 'hang2')).toBe('row / line');
    expect(resolveMatchedSense(xing, 'háng')).toBe('row / line');
    expect(resolveMatchedSense(xing, 'hang')).toBe('row / line');
  });
  it('falls back to English when no sense reading matches', () => {
    expect(resolveMatchedSense(xing, 'profession')).toBe('profession');
    expect(resolveMatchedSense(xing, 'to go')).toBeNull(); // default sense's own gloss
  });
  it('prefers a complete gloss match over a partial one', () => {
    const e = { ...xing, definitionClusters: [
      xing.definitionClusters[0],
      cluster('a', 'hang2', 4, ['line of business']),
      cluster('b', 'hang2', 1, ['line']),
    ] };
    expect(resolveMatchedSense(e, 'line')).toBe('b');
  });
  it('does not switch when the match is only through a reading no sense carries', () => {
    expect(resolveMatchedSense(me, 'ma2')).toBeNull();
  });
  it('is null for single-sense entries', () => {
    expect(resolveMatchedSense({ ...xing, definitionClusters: [xing.definitionClusters[1]] }, 'hang2')).toBeNull();
  });
});
