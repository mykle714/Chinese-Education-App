import { describe, expect, it } from 'vitest';
import {
  buildDictMap,
  buildExcludeSet,
  getAllSubstrings,
  segmentWithDict,
  buildSegmentMetadata,
  splitHanRuns,
  SEGMENTATION_MAX_TOKEN_CHARS,
} from '../dal/shared/segmentString.js';
import type { DictionaryEntry } from '../types/index.js';

/**
 * Tests for the greedy segmentation algorithm (gsa) — the function that decides where
 * word boundaries fall in a Chinese string. It drives example-sentence rendering, the
 * Reader, long-definition runs and the flashcard breakdown, and it had no test
 * coverage at all.
 *
 * NOTE: `src/features/reader/documentSegmentation.ts` is a CLIENT PORT of
 * `segmentWithDict` (docs/READER_SEGMENTATION.md). The scoring and tie-break rules
 * asserted here are the ones that port must mirror.
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 7.
 */

/** Minimal det row — only the fields the segmenter reads. */
function entry(
  word1: string,
  frequencyScore: number | null = null,
  matchException?: string[]
): DictionaryEntry {
  return {
    word1,
    frequencyScore,
    matchException: matchException ?? null,
    definitions: [`${word1}-def`],
    pronunciation: null,
    word2: null,
    language: 'zh',
    id: 0,
    discoverable: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as DictionaryEntry;
}

function dict(...entries: DictionaryEntry[]) {
  return buildDictMap(entries);
}

describe('getAllSubstrings', () => {
  it('returns every substring up to the max token length, deduplicated', () => {
    const subs = getAllSubstrings('中国人');
    expect(subs).toContain('中');
    expect(subs).toContain('中国');
    expect(subs).toContain('中国人');
    expect(new Set(subs).size).toBe(subs.length);
  });

  it('never emits a substring longer than the cap', () => {
    const subs = getAllSubstrings('一二三四五六');
    expect(Math.max(...subs.map((s) => [...s].length))).toBe(SEGMENTATION_MAX_TOKEN_CHARS);
  });

  it('handles the empty string', () => {
    expect(getAllSubstrings('')).toEqual([]);
  });
});

describe('buildDictMap', () => {
  it('keeps the FIRST entry for a repeated word1', () => {
    const map = buildDictMap([entry('会', 5), { ...entry('会', 1), definitions: ['second'] }]);
    expect(map.get('会')!.definition).toBe('会-def');
  });
});

describe('buildExcludeSet', () => {
  it('collects every matchException token across entries', () => {
    const set = buildExcludeSet([entry('中国', 5, ['中国']), entry('人', 5, ['人民'])]);
    expect(set.has('中国')).toBe(true);
    expect(set.has('人民')).toBe(true);
  });

  it('is empty when no entry declares one', () => {
    expect(buildExcludeSet([entry('中')]).size).toBe(0);
  });
});

describe('segmentWithDict', () => {
  it('returns nothing for an empty string', () => {
    expect(segmentWithDict('', dict())).toEqual([]);
  });

  it('falls back to single characters when the dictionary is empty', () => {
    expect(segmentWithDict('中国人', dict())).toEqual(['中', '国', '人']);
  });

  it('prefers a longer dictionary match over its component characters', () => {
    const map = dict(entry('中国', 3), entry('中', 5), entry('国', 5));
    expect(segmentWithDict('中国', map)).toEqual(['中国']);
  });

  it('breaks a same-length tie on frequencyScore', () => {
    // Both 'AB' and 'BC' are 2-char matches; the higher score wins the tier.
    const map = dict(entry('中国', 5), entry('国人', 1), entry('中'), entry('人'));
    expect(segmentWithDict('中国人', map)).toEqual(['中国', '人']);
  });

  it('treats a null frequencyScore as zero', () => {
    const map = dict(entry('中国', null), entry('国人', 2), entry('中'), entry('人'));
    expect(segmentWithDict('中国人', map)).toEqual(['中', '国人']);
  });

  it('segments the remainders on both sides of the winning token', () => {
    const map = dict(entry('国人', 9), entry('中'), entry('的'));
    expect(segmentWithDict('中国人的', map)).toEqual(['中', '国人', '的']);
  });

  it('skips excluded multi-char tokens', () => {
    const map = dict(entry('中国', 9), entry('中'), entry('国'));
    const excluded = new Set(['中国']);
    expect(segmentWithDict('中国', map, excluded)).toEqual(['中', '国']);
  });

  it('never excludes single characters — they are the last-resort fallback', () => {
    const map = dict(entry('中'));
    // Even if '中' were listed, a single char must still be emittable.
    expect(segmentWithDict('中', map, new Set(['中']))).toEqual(['中']);
  });

  it('lets a priority segment beat both length tier and score', () => {
    const map = dict(entry('中国', 9), entry('国人', 1), entry('中'), entry('国'), entry('人'));
    // Without priority, 中国 (score 9) wins. With it, 国人 is forced.
    expect(segmentWithDict('中国人', map)).toEqual(['中国', '人']);
    expect(segmentWithDict('中国人', map, undefined, ['国人'])).toEqual(['中', '国人']);
  });

  it('ranks priority segments by their position in the list', () => {
    const map = dict(entry('中国'), entry('国人'), entry('中'), entry('国'), entry('人'));
    expect(segmentWithDict('中国人', map, undefined, ['国人', '中国'])).toEqual(['中', '国人']);
    expect(segmentWithDict('中国人', map, undefined, ['中国', '国人'])).toEqual(['中国', '人']);
  });

  it('force-splits classifier tokens into their own segment', () => {
    const map = dict(entry('一个', 9), entry('一'), entry('个'));
    // 一个 would win on length+score; marking 个 a classifier splits it out.
    expect(segmentWithDict('一个', map)).toEqual(['一个']);
    expect(segmentWithDict('一个', map, undefined, undefined, new Set(['个']))).toEqual(['一', '个']);
  });

  it('covers the whole input — segments always rejoin to the original', () => {
    const map = dict(entry('中国', 4), entry('人民', 6), entry('共和', 2), entry('国'));
    const input = '中国人民共和国';
    expect(segmentWithDict(input, map).join('')).toBe(input);
  });
});

describe('splitHanRuns', () => {
  it('separates Chinese runs from surrounding prose without losing characters', () => {
    const input = 'The word 中国 means China.';
    const runs = splitHanRuns(input);
    expect(runs.map((r) => r.value).join('')).toBe(input);
    const han = runs.filter((r) => r.type === 'han');
    expect(han).toHaveLength(1);
    expect(han[0].value).toBe('中国');
  });

  it('returns a single text run for pure English', () => {
    const runs = splitHanRuns('no chinese here');
    expect(runs).toHaveLength(1);
    expect(runs[0].type).toBe('text');
  });

  it('strictly alternates — adjacent text runs are merged', () => {
    const runs = splitHanRuns('a 中 b 国 c');
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].type).not.toBe(runs[i - 1].type);
    }
  });

  it('keeps interior CJK punctuation INSIDE the han run', () => {
    // Deliberate: the run regex matches a maximal CJK stretch, punctuation included,
    // so a sentence stays one cpcd block instead of fragmenting at every comma.
    const runs = splitHanRuns('中国。、');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ type: 'han', value: '中国。、' });
  });

  it('folds a punctuation-ONLY CJK stretch into text — it has no lookup value', () => {
    const runs = splitHanRuns('hello 。、 world');
    expect(runs.filter((r) => r.type === 'han')).toHaveLength(0);
    expect(runs).toHaveLength(1);
    expect(runs[0].value).toBe('hello 。、 world');
  });

  it('handles the empty string', () => {
    expect(splitHanRuns('')).toEqual([]);
  });
});

/**
 * buildSegmentMetadata — the per-segment popup data (pronunciation + dd) behind the
 * example-sentence tab. See docs/EXAMPLE_SENTENCES.md ("senseDict").
 *
 * The point of these: a tagged sense supplies BOTH halves of the popup, so a heteronym
 * shows the reading of the sense the sentence actually uses (会 = kuài in
 * "to reckon accounts") rather than the entry-level primary reading.
 */
describe('buildSegmentMetadata — sense-aware pronunciation', () => {
  /** 会: three huì senses + the kuài "reckon accounts" sense, as the clusterer writes them. */
  function huiEntry(): DictionaryEntry {
    return {
      ...entry('会', 5),
      pronunciation: 'huì',
      definitions: ['can', 'to reckon accounts'],
      definitionClusters: [
        { sense: 'able to / will likely', reading: 'hui4', pos: ['verb'], gender: null, frequencyScore: 5, glosses: ['can'] },
        { sense: 'to reckon accounts', reading: 'kuai4', pos: ['verb'], gender: null, frequencyScore: 1, glosses: ['to reckon accounts'] },
      ],
    } as DictionaryEntry;
  }

  it('uses the TAGGED sense’s cluster reading, not the entry-level pronunciation', () => {
    const meta = buildSegmentMetadata(['会'], dict(huiEntry()), {
      senseDict: { 会: 'to reckon accounts' },
    });
    expect(meta['会'].pronunciation).toBe('kuài');
    expect(meta['会'].definition).toBe('to reckon accounts');
  });

  it('falls back to the entry-level pronunciation when the segment is un-tagged', () => {
    const meta = buildSegmentMetadata(['会'], dict(huiEntry()));
    expect(meta['会'].pronunciation).toBe('huì');
  });

  it('falls back when the tagged label matches no cluster (stale label after re-clustering)', () => {
    const meta = buildSegmentMetadata(['会'], dict(huiEntry()), {
      senseDict: { 会: 'a sense label that no longer exists' },
    });
    expect(meta['会'].pronunciation).toBe('huì');
  });

  it('a manual pronunciation override still wins over the sense reading', () => {
    const withOverride = {
      ...huiEntry(),
      exampleSentenceDefinitionPronunciationOverride: { pronunciation: 'OVERRIDE' },
    } as DictionaryEntry;
    const meta = buildSegmentMetadata(['会'], dict(withOverride), {
      senseDict: { 会: 'to reckon accounts' },
    });
    expect(meta['会'].pronunciation).toBe('OVERRIDE');
  });

  it('rejects a reading whose syllable count does not match the segment length', () => {
    // cpcd pairs syllables to characters positionally, so a 1-syllable reading on a
    // 2-character segment would shift the whole pinyin row. Keep the aligned column value.
    const misaligned = {
      ...entry('会计', 3),
      pronunciation: 'kuài jì',
      definitions: ['accounting'],
      definitionClusters: [
        { sense: 'accounting', reading: 'kuai4', pos: ['noun'], gender: null, frequencyScore: 3, glosses: ['accounting'] },
      ],
    } as DictionaryEntry;
    const meta = buildSegmentMetadata(['会计'], dict(misaligned), { senseDict: { 会计: 'accounting' } });
    expect(meta['会计'].pronunciation).toBe('kuài jì');
  });

  it('renders a multi-syllable sense reading tone-marked', () => {
    const kuaiji = {
      ...entry('会计', 3),
      pronunciation: 'huì jì',
      definitions: ['accounting'],
      definitionClusters: [
        { sense: 'accounting', reading: 'kuai4 ji4', pos: ['noun'], gender: null, frequencyScore: 3, glosses: ['accounting'] },
      ],
    } as DictionaryEntry;
    const meta = buildSegmentMetadata(['会计'], dict(kuaiji), { senseDict: { 会计: 'accounting' } });
    expect(meta['会计'].pronunciation).toBe('kuài jì');
  });
});
